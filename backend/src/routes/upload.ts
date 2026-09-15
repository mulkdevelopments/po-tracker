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

/**
 * The PO-number patterns allow letters (some POs carry a prefix), which lets a capture run
 * into the next word — UFP prints "PO# : 24099911 Ordered : MILL". Keep the leading digits
 * when a numeric PO number has words stuck to it.
 */
function trimPoNo(raw: string): string {
  const m = raw.match(/^(\d{6,})[A-Za-z]/);
  return m?.[1] ?? raw;
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

function parseMoneyOrNull(raw: string | null): number | null {
  return raw ? parseMoney(raw) : null;
}

/** UFP footer: Total:$    65,006.90 */
function parsePdfPoTotal(text: string): number | null {
  const m = text.match(/Total\s*:?\s*\$?\s*([\d,]+\.\d{2})\b/i);
  if (!m?.[1]) return null;
  return parseMoney(m[1]);
}

/** Last, i.e. closest, match of a pattern in a stretch of text. */
function lastMatch(text: string, re: RegExp): string | null {
  const all = [...text.matchAll(new RegExp(re.source, re.flags.replace("g", "") + "g"))];
  return all.length ? (all[all.length - 1][1] ?? null) : null;
}

/**
 * Quantity, rate and amount for one line. On a UFP PO these print to the left of the part
 * number, so `before` is the run of text between the previous part number and this one and
 * the values wanted are the last ones in it.
 */
function parsePdfLinePricing(before: string): {
  amount: number | null;
  unitMsf: number | null;
  qtyMsf: number | null;
} {
  const unitMsf = parseMoneyOrNull(lastMatch(before, /([\d,]+\.?\d*)\s*\/\s*MSF\b/i));
  // Strip the rate so it cannot be read back as the quantity.
  const withoutRate = before.replace(/[\d,]+\.?\d*\s*\/\s*MSF\b/gi, " ");
  const qtyMsf = parseMoneyOrNull(lastMatch(withoutRate, /([\d,]+\.?\d*)\s*MSF\b/i));
  let amount = parseMoneyOrNull(lastMatch(before, /\$\s*([\d,]+\.\d{2})\b/));
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

/** A part number printed on a PO: any catalog number, or anything shaped like one. */
function partNumberRe(products: ProductRow[]): RegExp {
  const known = products
    .map((p) => p.partNo)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${[...known, "\\d{6}"].join("|")})\\b`, "g");
}

/**
 * Where each part number sits in the text, with the run of text before it (its quantity,
 * rate and amount) and after it (its packaging). Bounded by the neighbouring part numbers
 * so one line's figures can never be read as another's.
 */
function findPartHits(clean: string, products: ProductRow[]) {
  const re = partNumberRe(products);
  const at: { partNo: string; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) && at.length < 200) {
    const partNo = m[1];
    const prev = at[at.length - 1];
    // The same number twice in one row is one line, not two.
    if (prev?.partNo === partNo && m.index - prev.end < 80) continue;
    at.push({ partNo, index: m.index, end: m.index + partNo.length });
  }
  return at.map((hit, i) => ({
    ...hit,
    before: clean.slice(at[i - 1]?.end ?? 0, hit.index),
    after: clean.slice(hit.end, Math.min(at[i + 1]?.index ?? clean.length, hit.end + 200)),
  }));
}

/** Exported as `decodePoText` for the decode CLI — see scripts/decodePoPdf.ts. */
function guessFields(text: string, ref: Ref) {
  // The column headers interleave the first item's figures in the extracted text
  // ("1 …SLVRFRST G1S PRODUCT/DESCRIPTION QUANTITY 18.477 UOM MSF PRICE/UNIT 720.0000/MSF"),
  // so drop them and every item row reads the same way.
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/\b(?:ITM|PRODUCT\/DESCRIPTION|QUANTITY|UOM|PRICE\/UNIT|AMOUNT)\b/gi, " ")
    .replace(/\s+/g, " ");
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
    poNo: trimPoNo(
      pick(clean, [
        /P\.?\s*O\.?\s*(?:Number|No|#)\s*[:#-]?\s*([A-Z0-9\-]{6,20})/i,
        /Purchase\s+Order\s*(?:No|#)?\s*[:#-]?\s*([A-Z0-9\-]{6,20})/i,
        /\b(5\d{7})\b/,
        /\b(2\d{7})\b/,
      ]),
    ),
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

  // Lines: every part number in the text, enriched from the catalog + the PO's own figures.
  const lines: Record<string, unknown>[] = [];
  let idx = 0;
  for (const hit of findPartHits(clean, ref.products)) {
    if (idx >= 40) break;
    const { sheets, skids } = parseLineQty(hit.after, ref.sheetsPerSkid);
    const pdf = parsePdfLinePricing(hit.before);
    const product = productByPart.get(hit.partNo);
    if (product) {
      lines.push(lineFromProduct(product, ++idx, sheets, ref.sheetsPerSkid, asOf, skids, pdf));
      continue;
    }
    // Not in the catalog. If it is priced and packaged like a line item, show it as one
    // for the operator to finish rather than dropping it from the order silently.
    if (pdf.amount == null && sheets == null) continue;
    lines.push({
      lineNo: ++idx,
      partNo: hit.partNo,
      size: null,
      color: null,
      sheets,
      skids,
      qtyMsf: pdf.qtyMsf,
      unitMsf: null,
      extPo: null,
      catalogExt: null,
      custUnitMsf: pdf.unitMsf,
      custExtPo: pdf.amount,
      matched: false,
    });
  }

  // Fallback: if no catalog parts matched, do best-effort size/color extraction.
  if (lines.length === 0) {
    const color = pickFrom(clean, ref.colorNames);
    const re = /(\d{1,3}MM\s*\d{1,3}["'""]\s*x\s*\d{1,3}["'""]\s*ACP)/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(clean)) && idx < 20) {
      const ctx = clean.slice(Math.max(0, mm.index - 160), Math.min(clean.length, mm.index + 220));
      const partNo = (ctx.match(/\b(\d{6})\b/) || [])[1] || "";
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

export async function loadRef(company: ReturnType<typeof parseCompany>): Promise<Ref> {
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

export { guessFields as decodePoText };
export default router;
