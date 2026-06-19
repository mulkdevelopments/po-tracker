import { Router } from "express";
import multer from "multer";
import pdf from "pdf-parse";
import { prisma, requireAuth, requirePage } from "../middleware/auth.js";
import { parseCompany } from "../companies.js";

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

type ProductRow = {
  partNo: string;
  custPartNo: string | null;
  thickness: string | null;
  construction: string | null;
  widthIn: number | null;
  widthMm: number | null;
  lengthIn: number | null;
  lengthMm: number | null;
  colorName: string | null;
  vendorColorCode: string | null;
  pricePerM2: number | null;
  pricePerMsq: number | null;
  pricePerSheet: number | null;
  leadTimeDays: number | null;
};

function skidsFromSheets(sheets: number | null, sheetsPerSkid: number): number | null {
  if (sheets == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(sheets / sheetsPerSkid);
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
  sheets: number | null,
  sheetsPerSkid: number,
  skidsOverride?: number | null,
) {
  const m2PerSheet = p.widthMm && p.lengthMm ? (p.widthMm * p.lengthMm) / 1_000_000 : null;
  const sqftPerSheet = p.widthIn && p.lengthIn ? (p.widthIn * p.lengthIn) / 144 : null;
  const qtyM2 = sheets != null && m2PerSheet != null ? sheets * m2PerSheet : null;
  const qtyMsf = sheets != null && sqftPerSheet != null ? (sheets * sqftPerSheet) / 1000 : null;
  let extPo: number | null = null;
  if (sheets != null && p.pricePerSheet != null) extPo = sheets * p.pricePerSheet;
  else if (qtyM2 != null && p.pricePerM2 != null) extPo = qtyM2 * p.pricePerM2;
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
    unitMsf: p.pricePerMsq,
    unitM2: p.pricePerM2,
    extPo,
    leadTime: p.leadTimeDays,
    matched: true,
  };
}

interface Ref {
  products: ProductRow[];
  colorNames: string[];
  locations: { name: string; arrivalPort: string | null }[];
  sheetsPerSkid: number;
}

function summarizeLines(lines: Record<string, unknown>[]) {
  const poValue = lines.reduce((s, l) => s + (Number(l.extPo) || 0), 0);
  const totalM2 = lines.reduce((s, l) => s + (Number(l.qtyM2) || 0), 0);
  const skids = lines.reduce((s, l) => s + (Number(l.skids) || 0), 0);
  return { poValue: poValue || null, totalM2: totalM2 || null, skids: skids || null };
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

  // Lines: find each part number in the text and enrich from the catalog.
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
    const ctx = clean.slice(m.index, Math.min(clean.length, m.index + 220));
    const { sheets, skids } = parseLineQty(ctx, ref.sheetsPerSkid);
    lines.push(lineFromProduct(product, ++idx, sheets, ref.sheetsPerSkid, skids));
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
        matched: false,
      });
    }
  }

  out.lines = lines;
  out.matchedCount = lines.filter((l) => l.matched).length;
  const poNo = String(out.poNo ?? "").trim();
  const rev = Number(out.rev) || 0;
  if (poNo) out.concat = `${poNo}-${rev}`;
  Object.assign(out, summarizeLines(lines));
  return out;
}

async function loadRef(company: ReturnType<typeof parseCompany>): Promise<Ref> {
  void company; // reference data is shared across companies
  const [products, colors, locations, config] = await Promise.all([
    prisma.product.findMany(),
    prisma.color.findMany(),
    prisma.stockingLocation.findMany(),
    prisma.appConfig.findUnique({ where: { id: 1 } }),
  ]);
  return {
    products: products as ProductRow[],
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
  const ref = await loadRef(parseCompany(req.query.company));
  const guess = guessFields(text, ref);
  res.json({ guess });
});

// Look up a single catalog product by part number (for manual line entry autofill).
router.get("/product/:partNo", requireAuth, requirePage("upload"), async (req, res) => {
  const product = await prisma.product.findUnique({ where: { partNo: String(req.params.partNo) } });
  if (!product) return res.status(404).json({ error: "Not found" });
  const config = await prisma.appConfig.findUnique({ where: { id: 1 } });
  const sheetsPerSkid = config?.sheetsPerSkid ?? 200;
  res.json({ line: lineFromProduct(product as ProductRow, 1, null, sheetsPerSkid), product });
});

export default router;
