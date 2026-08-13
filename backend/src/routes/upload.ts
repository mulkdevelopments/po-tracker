import { Router } from "express";
import multer from "multer";
import pdf from "pdf-parse";
import type { Product, ProductPrice } from "@prisma/client";
import { prisma, requireAuth, requirePage } from "../middleware/auth.js";
import { parseCompany } from "../companies.js";
import { pickPriceForDate, ratesFromProduct } from "../productPricing.js";
import { sheetsFromMsf } from "../lineMath.js";
import { guessSynergyPage, guessSynergyPages } from "../synergyDecode.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

function pick(text: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return "";
}

function pickDate(text: string, patterns: RegExp[]): string {
  const raw = pick(text, patterns);
  if (!raw) return "";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 10);
}

function pickFrom(text: string, list: string[]): string {
  const up = text.toUpperCase();
  for (const item of list) {
    if (item && up.includes(item.toUpperCase())) return item;
  }
  return "";
}

type ProductRow = Product & { prices: ProductPrice[] };

function skidsFromSheets(sheets: number | null, sheetsPerSkid: number): number | null {
  if (sheets == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(sheets / sheetsPerSkid);
}

/** Sheet count from the PO's own quantity when it only prints MSF (request #24). */
function sheetsFromPdfQty(
  sheets: number | null,
  qtyMsf: number | null | undefined,
  sqftPerSheet: number | null,
  sheetsPerSkid: number,
): number | null {
  if (sheets != null) return sheets;
  return sheetsFromMsf(qtyMsf, sqftPerSheet, sheetsPerSkid);
}

// UFP POs often print "3 pkgs @ 200 pcs/pkg = 600 pcs" — avoid grabbing the per-pkg size.
function parseLineQty(ctx: string, sheetsPerSkid: number): { sheets: number | null; skids: number | null } {
  const total = ctx.match(/=\s*(\d{2,5})\s*(?:PCS?|SHEETS?|EA|PIECES)\b/i);
  if (total?.[1]) {
    const sheets = Number(total[1]);
    return { sheets, skids: skidsFromSheets(sheets, sheetsPerSkid) };
  }
  const pkgs = ctx.match(/(\d+)\s*pkgs?\s*@/i);
  const perPkg = ctx.match(/@\s*(\d{2,5})\s*(?:PCS?|SHEETS?)\s*\/\s*pkg/i);
  if (pkgs?.[1]) {
    const skidCount = Number(pkgs[1]);
    const per = perPkg?.[1] ? Number(perPkg[1]) : sheetsPerSkid;
    return { sheets: skidCount * per, skids: skidCount };
  }
  const loose = ctx.match(/(\d{2,5})\s*(?:SHEETS?|PCS?|EA|PIECES)\b(?!\s*\/\s*pkg)/i);
  if (loose?.[1]) {
    const sheets = Number(loose[1]);
    return { sheets, skids: skidsFromSheets(sheets, sheetsPerSkid) };
  }
  return { sheets: null, skids: null };
}

// Build a fully-populated line from a catalog product + a sheet count.
function lineFromProduct(
  p: ProductRow,
  lineNo: number,
  sheetsIn: number | null,
  sheetsPerSkid: number,
  asOf: string,
  skidsOverride?: number | null,
  pdf?: { amount?: number | null; unitMsf?: number | null; qtyMsf?: number | null },
) {
  const rates = pickPriceForDate(p.prices ?? [], asOf) ?? ratesFromProduct(p, asOf);
  const pricePerM2 = rates?.pricePerM2 ?? null;
  const pricePerMsq = rates?.pricePerMsq ?? null;
  const pricePerSheet = rates?.pricePerSheet ?? null;
  const m2PerSheet = p.widthMm && p.lengthMm ? (p.widthMm * p.lengthMm) / 1_000_000 : null;
  const sqftPerSheet = p.widthIn && p.lengthIn ? (p.widthIn * p.lengthIn) / 144 : null;
  // A PO that only prints MSF still has to yield sheets, m² and both line values.
  const sheets = sheetsFromPdfQty(sheetsIn, pdf?.qtyMsf, sqftPerSheet, sheetsPerSkid);
  const qtyM2 = sheets != null && m2PerSheet != null ? sheets * m2PerSheet : null;
  const qtyMsf =
    pdf?.qtyMsf != null
      ? pdf.qtyMsf
      : sheets != null && sqftPerSheet != null
        ? (sheets * sqftPerSheet) / 1000
        : null;
  // Catalog (PI) value — sheets × sheet price, else m² × $/m²
  let catalogExt: number | null = null;
  if (sheets != null && pricePerSheet != null) catalogExt = sheets * pricePerSheet;
  else if (qtyM2 != null && pricePerM2 != null) catalogExt = qtyM2 * pricePerM2;
  // PO line value — our price list on its sq-ft basis. The rate and amount printed on the
  // customer PO are kept separately (custUnitMsf / custExtPo) purely to flag disagreements.
  const extPo =
    qtyMsf != null && pricePerMsq != null ? qtyMsf * pricePerMsq : catalogExt;
  // Gross invoice line — m² × $/m² (independent of PDF sq-ft amount)
  const extInv = qtyM2 != null && pricePerM2 != null ? qtyM2 * pricePerM2 : catalogExt;
  const sizeLabel = [p.thickness, p.widthIn ? `${p.widthIn}"` : "", p.lengthIn ? `x ${p.lengthIn}"` : "", p.construction]
    .filter(Boolean)
    .join(" ");
  return {
    lineNo,
    partNo: p.partNo,
    custPartNo: p.custPartNo,
    size: sizeLabel || null,
    widthMm: p.widthMm,
    lengthMm: p.lengthMm,
    color: p.vendorColorCode || p.colorName ? `${p.vendorColorCode ?? ""} ${p.colorName ?? ""}`.trim() : null,
    qtyMsf,
    qtyM2,
    sheets,
    skids: skidsOverride ?? skidsFromSheets(sheets, sheetsPerSkid),
    unitMsf: pricePerMsq,
    unitM2: pricePerM2,
    extPo,
    extInv,
    custUnitMsf: pdf?.unitMsf ?? null,
    custExtPo: pdf?.amount ?? null,
    catalogExt,
    priceAsOf: rates ? asOf : null,
    priceEffectiveFrom: rates?.effectiveFrom ?? null,
    matched: true,
  };
}

interface Ref {
  products: ProductRow[];
  colorNames: string[];
  locations: { name: string; arrivalPort: string | null }[];
  sheetsPerSkid: number;
}

function parseMoney(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** UFP footer: Total:$    65,006.90 */
function parsePdfPoTotal(text: string): number | null {
  const m = text.match(/Total\s*:?\s*\$?\s*([\d,]+\.\d{2})\b/i);
  if (!m?.[1]) return null;
  return parseMoney(m[1]);
}

/** Near a part #: PRICE/UNIT …/MSF and AMOUNT $… */
function parsePdfLinePricing(ctx: string): {
  amount: number | null;
  unitMsf: number | null;
  qtyMsf: number | null;
} {
  const amountM =
    ctx.match(/\$\s*([\d,]+\.\d{2})\b/) ||
    ctx.match(/AMOUNT\s*\$?\s*([\d,]+\.\d{2})/i);
  const unitM = ctx.match(/([\d,]+\.?\d*)\s*\/\s*MSF\b/i);
  const qtyM = ctx.match(/([\d,]+\.?\d*)\s*MSF\b/i);
  const unitMsf = unitM?.[1] ? parseMoney(unitM[1]) : null;
  const qtyMsf = qtyM?.[1] ? parseMoney(qtyM[1]) : null;
  let amount = amountM?.[1] ? parseMoney(amountM[1]) : null;
  if (amount == null && unitMsf != null && qtyMsf != null) {
    amount = Math.round(unitMsf * qtyMsf * 100) / 100;
  }
  return { amount, unitMsf, qtyMsf };
}

function summarizeLines(lines: Record<string, unknown>[]) {
  const catalogValue = lines.reduce((s, l) => {
    const cat = Number(l.catalogExt);
    if (Number.isFinite(cat) && cat) return s + cat;
    return s + (Number(l.extPo) || 0);
  }, 0);
  const poValue = lines.reduce((s, l) => s + (Number(l.extPo) || 0), 0);
  const custLineSum = lines.reduce((s, l) => s + (Number(l.custExtPo) || 0), 0);
  const grossInvoiceValue = lines.reduce((s, l) => {
    const inv = Number(l.extInv);
    if (Number.isFinite(inv) && inv) return s + inv;
    const qtyM2 = Number(l.qtyM2);
    const unitM2 = Number(l.unitM2);
    if (Number.isFinite(qtyM2) && Number.isFinite(unitM2)) return s + qtyM2 * unitM2;
    return s;
  }, 0);
  const totalM2 = lines.reduce((s, l) => s + (Number(l.qtyM2) || 0), 0);
  const skids = lines.reduce((s, l) => s + (Number(l.skids) || 0), 0);
  return {
    /** Catalog / calculated — drives PI value */
    piValue: catalogValue || null,
    /** Sum of line extPo, priced from our table */
    poValue: poValue || null,
    /** Sum of the amounts printed on the customer PO */
    custLineSum: custLineSum || null,
    grossInvoiceValue: grossInvoiceValue || null,
    totalM2: totalM2 || null,
    skids: skids || null,
  };
}

function guessFields(text: string, ref: Ref) {
  const clean = text.replace(/\s+/g, " ");
  const productByPart = new Map(ref.products.map((p) => [p.partNo, p]));

  // Match a stocking location by its full name, or by "<city> ... <state>"
  // (real POs print "GRANGER IN USA" rather than "Granger, IN").
  const up = clean.toUpperCase();
  let matchedLoc = ref.locations.find((l) => up.includes(l.name.toUpperCase()));
  if (!matchedLoc) {
    matchedLoc = ref.locations.find((l) => {
      const [city, state] = l.name.split(",").map((s) => s.trim().toUpperCase());
      return city && state ? up.includes(city) && new RegExp(`\\b${state}\\b`).test(up) : false;
    });
  }
  const stockingLocation = matchedLoc?.name ?? "";

  const out: Record<string, unknown> = {
    poNo: pick(clean, [
      /P\.?\s*O\.?\s*(?:Number|No|#)\s*[:#-]?\s*([A-Z0-9\-]{6,20})/i,
      /Purchase\s+Order\s*(?:No|#)?\s*[:#-]?\s*([A-Z0-9\-]{6,20})/i,
      /\b(5\d{7})\b/,
      /\b(2\d{7})\b/,
    ]),
    rev: (() => {
      const m = clean.match(/(?:Rev(?:ision)?|Rev\.?)\s*[:#-]?\s*(\d+)/i);
      if (m?.[1]) return Number(m[1]) || 0;
      const m2 = clean.match(/\b\d{6,}\s*rev\s*(\d+)/i);
      if (m2?.[1]) return Number(m2[1]) || 0;
      return 0;
    })(),
    poDate: pickDate(clean, [
      /(?:PO|Order|Date)\s*(?:Date)?\s*[:#-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i,
      /(?:PO|Order|Date)\s*(?:Date)?\s*[:#-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
    ]),
    stockingLocation,
    portOfDest: matchedLoc?.arrivalPort ?? "",
  };

  const asOf = String(out.poDate || new Date().toISOString().slice(0, 10)).slice(0, 10);

  // Lines: find each part number in the text and enrich from the catalog + PDF pricing.
  const lines: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const partRe = /\b(6\d{5})\b/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = partRe.exec(clean)) && idx < 40) {
    const partNo = m[1];
    if (seen.has(partNo)) continue;
    const product = productByPart.get(partNo);
    if (!product) continue;
    seen.add(partNo);
    // Look ahead far enough to catch MSF rate + $ amount after the part # block
    const ctx = clean.slice(Math.max(0, m.index - 40), Math.min(clean.length, m.index + 420));
    const { sheets, skids } = parseLineQty(ctx, ref.sheetsPerSkid);
    const pdf = parsePdfLinePricing(ctx);
    lines.push(lineFromProduct(product, ++idx, sheets, ref.sheetsPerSkid, asOf, skids, pdf));
  }

  // Fallback: if no catalog parts matched, do best-effort size/color extraction.
  if (lines.length === 0) {
    const color = pickFrom(clean, ref.colorNames);
    const re = /(\d{1,3}MM\s*\d{1,3}["'""]\s*x\s*\d{1,3}["'""]\s*ACP)/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(clean)) && idx < 20) {
      const ctx = clean.slice(Math.max(0, mm.index - 160), Math.min(clean.length, mm.index + 220));
      const partNo = (ctx.match(/\b(6\d{5})\b/) || [])[1] || "";
      const qty = (ctx.match(/(\d{2,4})\s*(?:SHEETS?|PCS?|EA)/i) || [])[1];
      lines.push({
        lineNo: ++idx,
        partNo,
        size: mm[1].toUpperCase(),
        color,
        sheets: qty ? Number(qty) : null,
        skids: null,
        unitMsf: null,
        extPo: null,
        catalogExt: null,
        matched: false,
      });
    }
  }

  out.lines = lines;
  out.matchedCount = lines.filter((l) => l.matched).length;
  const poNo = String(out.poNo ?? "").trim();
  const rev = Number(out.rev) || 0;
  if (poNo) out.concat = `${poNo}-${rev}`;
  const sums = summarizeLines(lines);
  const pdfTotal = parsePdfPoTotal(clean);
  // PO value comes from our price list; the customer's own total is kept for comparison.
  out.poValue = sums.poValue;
  out.custPoTotal = pdfTotal ?? sums.custLineSum;
  // PI value = catalog calculated rates
  out.piValue = sums.piValue;
  out.grossInvoiceValue = sums.grossInvoiceValue;
  out.totalM2 = sums.totalM2;
  out.skids = sums.skids;
  return out;
}

async function loadRef(company: ReturnType<typeof parseCompany>): Promise<Ref> {
  const [products, colors, locations, config] = await Promise.all([
    prisma.product.findMany({ where: { company }, include: { prices: true } }),
    prisma.color.findMany({ where: { company } }),
    prisma.stockingLocation.findMany({ where: { company } }),
    prisma.appConfig.findUnique({ where: { company } }),
  ]);
  return {
    products,
    colorNames: colors.map((c) => c.name).filter((n): n is string => !!n),
    locations: locations.map((l) => ({ name: l.name, arrivalPort: l.arrivalPort })),
    sheetsPerSkid: config?.sheetsPerSkid ?? 200,
  };
}

router.post(
  "/decode-pdf",
  requireAuth,
  requirePage("upload"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "PDF file required" });
    try {
      const result = await pdf(req.file.buffer);
      const ref = await loadRef(parseCompany(req.query.company));
      const guess = guessFields(result.text, ref);
      res.json({ textLength: result.text.length, pages: result.numpages, guess });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Failed to parse PDF" });
    }
  },
);

router.post("/decode-text", requireAuth, requirePage("upload"), async (req, res) => {
  const text = req.body?.text as string;
  if (!text?.trim()) return res.status(400).json({ error: "Text required" });
  const company = parseCompany(req.query.company);
  const ref = await loadRef(company);
  if (company === "SYNERGY") {
    const guess = guessSynergyPage(text, ref);
    return res.json({ guess });
  }
  const guess = guessFields(text, ref);
  res.json({ guess });
});

router.post("/decode-synergy-pages", requireAuth, requirePage("upload"), async (req, res) => {
  const pages = req.body?.pages as string[];
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: "pages array required" });
  }
  if (pages.length > 50) return res.status(400).json({ error: "Maximum 50 pages per upload" });
  const ref = await loadRef("SYNERGY");
  const pos = guessSynergyPages(pages, ref);
  res.json({ pos, pageCount: pages.length });
});

// Look up a single catalog product by part number (for manual line entry autofill).
router.get("/product/:partNo", requireAuth, requirePage("upload"), async (req, res) => {
  const company = parseCompany(req.query.company);
  const product = await prisma.product.findUnique({
    where: { company_partNo: { company, partNo: String(req.params.partNo) } },
    include: { prices: true },
  });
  if (!product) return res.status(404).json({ error: "Not found" });
  const config = await prisma.appConfig.findUnique({ where: { company } });
  const sheetsPerSkid = config?.sheetsPerSkid ?? 200;
  const asOf = String(req.query.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  res.json({ line: lineFromProduct(product, 1, null, sheetsPerSkid, asOf), product });
});

export default router;
