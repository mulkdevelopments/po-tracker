/** Cynergy handwritten ORDER FORM decoder (one page = one PO). */

export type SynergyProductRow = {
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

export type SynergyRef = {
  products: SynergyProductRow[];
  sheetsPerSkid: number;
};

const SKIP_LINE =
  /^(?:@synergy_page@|full_ocr|fall_ocr|cyn(?:ergy|ergy)|order\s*form|description|quantity|alubond|broxton|douglas|p\.?\s*o\.?|order\s*date|order_date|po_no|fallback|\d{1,2}\s*of\s*\d+|2122|\d{5,6}|\s*ga\s*31533|\s*rd\s*$)/i;

/** Raw full-page OCR block embedded by the frontend hybrid pipeline. */
export function extractFullOcr(text: string): string {
  const idx = text.search(/FULL_OCR:\s*/i);
  if (idx < 0) return text;
  return text.slice(idx).replace(/^FULL_OCR:\s*/i, "").trim();
}

/** Fix common OCR confusions in numeric / PO fields. */
export function cleanOcrField(raw: string): string {
  return raw
    .replace(/[|]/g, " ")
    .replace(/\bO(\d)/g, "0$1")
    .replace(/(\d)O\b/g, "$10")
    .replace(/\bl(\d)/g, "1$1")
    .replace(/(\d)l\b/g, "$11")
    .replace(/\bS(\d)/g, "5$1")
    .replace(/(\d)S\b/g, "$15")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescription(raw: string): string {
  return cleanOcrField(raw)
    .replace(/^[\d.)>\s-]+/, "")
    .replace(/\s*["']+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const COLOR_ALIASES: [string, RegExp][] = [
  ["GLOSSY WHITE", /\b(?:glossy\s*)?white\b/i],
  ["GLOSSY BLACK", /\b(?:glossy\s*)?black\b/i],
  ["CHARCOAL METALLIC", /\b(?:charcol|charcoal)(?:\s*metallic)?\b/i],
  ["SILVER FROST", /\b(?:silvr|silver)(?:\s*frost|\s*metallic)?\b/i],
  ["PEPSI BLUE", /\bpepsi\s*blue\b/i],
  ["MATTE BLACK", /\bmatte\s*black\b/i],
  ["YELLOW", /\byellow\b/i],
  ["ORANGE", /\borange\b/i],
  ["PEWTER", /\bdove\s*gre(?:y|y)\b/i],
  ["PEPSI BLUE", /\bblue\s*metallic\b/i],
  ["PEPSI BLUE", /\bturquoise\s*blue\b/i],
  ["PEWTER", /\bemerald\s*green\b/i],
  ["PEWTER", /\bchampagne\s*beige\b/i],
  ["PEWTER", /\bdesert\s*rose\s*metallic\b/i],
  ["PEWTER", /\bpink\b/i],
];

function parseFractionalInches(raw: string): number | null {
  const s = raw.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseSynergyDimensions(text: string): { width: number; length: number } | null {
  const norm = cleanOcrField(text)
    .replace(/(\d)[oO](?=\d)/g, "$10")
    .replace(/(?<=\d)[oO](\d)/g, "0$1")
    .replace(/[×]/g, "x");
  const m = norm.match(
    /(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*[xX]\s*(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)/,
  );
  if (!m) return null;
  const width = parseFractionalInches(m[1]);
  const length = parseFractionalInches(m[2]);
  if (width == null || length == null) return null;
  return { width, length };
}

function normalizeColorHint(description: string): string {
  const up = description.toUpperCase();
  for (const [name, re] of COLOR_ALIASES) {
    if (re.test(description)) return name;
  }
  for (const token of up.split(/[^A-Z0-9]+/)) {
    if (token.length >= 4 && !/^\d+$/.test(token)) return token;
  }
  return up.replace(/[\d"'Xx×/\s-]+/g, " ").trim();
}

function colorScore(productColor: string | null, hint: string): number {
  if (!productColor || !hint) return 0;
  const p = productColor.toUpperCase();
  const h = hint.toUpperCase();
  if (p === h) return 100;
  if (p.includes(h) || h.includes(p)) return 80;
  const pWords = p.split(/\s+/);
  const hWords = h.split(/\s+/);
  let shared = 0;
  for (const w of hWords) if (w.length > 2 && pWords.some((pw) => pw.includes(w) || w.includes(pw))) shared++;
  return shared * 20;
}

function skidsFromSheets(sheets: number | null, sheetsPerSkid: number): number | null {
  if (sheets == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(sheets / sheetsPerSkid);
}

function lineFromProduct(
  p: SynergyProductRow,
  lineNo: number,
  sheets: number | null,
  sheetsPerSkid: number,
  rawDescription: string,
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
    size: sizeLabel || rawDescription,
    widthMm: p.widthMm,
    lengthMm: p.lengthMm,
    color: p.vendorColorCode || p.colorName ? `${p.vendorColorCode ?? ""} ${p.colorName ?? ""}`.trim() : null,
    qtyMsf,
    qtyM2,
    sheets,
    skids: skidsFromSheets(sheets, sheetsPerSkid),
    unitMsf: p.pricePerMsq,
    unitM2: p.pricePerM2,
    extPo,
    leadTime: p.leadTimeDays,
    matched: true,
    rawDescription,
  };
}

export function matchSynergyProduct(description: string, products: SynergyProductRow[]): SynergyProductRow | null {
  const dims = parseSynergyDimensions(description);
  if (!dims) return null;
  const colorHint = normalizeColorHint(description);
  const candidates = products.filter(
    (p) =>
      p.widthIn != null &&
      p.lengthIn != null &&
      Math.abs(p.widthIn - dims.width) < 0.75 &&
      Math.abs(p.lengthIn - dims.length) < 0.75,
  );
  if (!candidates.length) return null;
  let best: SynergyProductRow | null = null;
  let bestScore = -1;
  for (const p of candidates) {
    const score = colorScore(p.colorName, colorHint);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 20 ? best : candidates[0] ?? null;
}

export function parseSynergyDate(raw: string): string {
  const m = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!m) return "";
  let y = Number(m[3]);
  if (y < 100) y += y >= 50 ? 1900 : 2000;
  const mo = m[1].padStart(2, "0");
  const d = m[2].padStart(2, "0");
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? "" : iso;
}

export function parseSynergyPoNo(text: string): string {
  const clean = cleanOcrField(text);
  const patterns = [
    /PO_NO\s*:?\s*(?:P\.?\s*O\.?\s*)?(?:Cynergy\s+)?(\d{4}[-\s]\d+)/i,
    /(?:P\.?\s*O\.?)\s*[:\s]*(?:C[yi1l][nn]?ergy?\s*)?(\d{4}[-\s]\d+)/i,
    /\bCynergy\s+(\d{4}[-\s]\d+)/i,
    /(?:P\.?\s*O\.?).{0,24}(\d{4}[-\s]\d+)/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m?.[1]) {
      const id = m[1].replace(/\s+/g, "-");
      return `Cynergy ${id}`;
    }
  }
  return "";
}

export function parseSynergyDateFromText(text: string): string {
  const clean = cleanOcrField(text);
  const patterns = [
    /Order\s*Date\s*:?\s*([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i,
    /ORDER_DATE\s*:?\s*([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i,
    /\b([0-9]{2}[-/][0-9]{2}[-/][0-9]{2,4})\b/,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m?.[1]) {
      const iso = parseSynergyDate(m[1]);
      if (iso) return iso;
    }
  }
  return "";
}

function parseStructuredLine(line: string): { description: string; qty: number } | null {
  const body = line.replace(/^LINE:\s*/i, "").trim();
  const pipe = body.match(/^(.+?)\s*\|\s*(\d{2,5})\s*$/);
  if (pipe) {
    const description = cleanDescription(pipe[1]);
    const qty = Number(pipe[2]);
    if (description && qty >= 10) return { description, qty };
  }
  const inline = body.match(/^(.+?)\s+(\d{2,5})$/);
  if (inline) {
    const description = cleanDescription(inline[1]);
    const qty = Number(inline[2]);
    if (description && qty >= 10 && /\d/.test(description)) return { description, qty };
  }
  return null;
}

export function parseStructuredSynergyPage(text: string): {
  poNo: string;
  poDate: string;
  rows: { description: string; qty: number }[];
} | null {
  if (!/@SYNERGY_PAGE@/i.test(text)) return null;
  const poNo = parseSynergyPoNo(text);
  const poDate = parseSynergyDateFromText(text);
  const rows: { description: string; qty: number }[] = [];
  for (const line of text.split(/\n+/)) {
    if (!/^LINE:/i.test(line.trim())) continue;
    const row = parseStructuredLine(line.trim());
    if (row) rows.push(row);
  }
  return { poNo, poDate, rows };
}

function parseLooseLineRows(text: string): { description: string; qty: number }[] {
  const rows: { description: string; qty: number }[] = [];
  const lines = text
    .split(/\n+/)
    .map((l) => cleanOcrField(l))
    .filter(Boolean);

  for (const line of lines) {
    if (SKIP_LINE.test(line)) continue;
    if (/^line:/i.test(line)) {
      const row = parseStructuredLine(line);
      if (row) rows.push(row);
      continue;
    }
    if (/order\s*date|order_date|^po_no:|^full_ocr:|fallback/i.test(line)) continue;
    const poInline = line.match(/^(?:P\.?\s*O\.?\s*)?(?:Cynergy\s+)?\d{4}-\d+$/i);
    if (poInline) continue;

    const pipe = line.match(/^(.+?)\s*\|\s*(\d{2,5})$/);
    if (pipe) {
      const description = cleanDescription(pipe[1]);
      const qty = Number(pipe[2]);
      if (description && qty >= 10) {
        rows.push({ description, qty });
        continue;
      }
    }

    const m = line.match(/^(.+?)\s+(\d{2,5})$/);
    if (!m) continue;
    const description = cleanDescription(m[1]);
    const qty = Number(m[2]);
    if (!description || qty < 10 || qty > 99999) continue;
    if (!/\d/.test(description)) continue;
    if (/^(?:description|quantity)$/i.test(description)) continue;
    rows.push({ description, qty });
  }
  return rows;
}

function mergeLineRows(
  ...groups: { description: string; qty: number }[][]
): { description: string; qty: number }[] {
  const seen = new Set<string>();
  const out: { description: string; qty: number }[] = [];
  for (const group of groups) {
    for (const row of group) {
      const key = `${row.description.toLowerCase()}|${row.qty}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

export function parseSynergyLineRows(text: string): { description: string; qty: number }[] {
  const structured = parseStructuredSynergyPage(text);
  const structuredRows = structured?.rows ?? [];

  const lineTagRows: { description: string; qty: number }[] = [];
  for (const line of text.split(/\n+/)) {
    if (!/^LINE:/i.test(line.trim())) continue;
    const row = parseStructuredLine(line.trim());
    if (row) lineTagRows.push(row);
  }

  const fullOcr = extractFullOcr(text);
  const fullRows = parseLooseLineRows(fullOcr);

  // Legacy / plain OCR text (no structured wrapper).
  if (!/@SYNERGY_PAGE@/i.test(text)) {
    return parseLooseLineRows(text);
  }

  return mergeLineRows(structuredRows, lineTagRows, fullRows);
}

function summarizeLines(lines: Record<string, unknown>[]) {
  const poValue = lines.reduce((s, l) => s + (Number(l.extPo) || 0), 0);
  const totalM2 = lines.reduce((s, l) => s + (Number(l.qtyM2) || 0), 0);
  const skids = lines.reduce((s, l) => s + (Number(l.skids) || 0), 0);
  return { poValue: poValue || null, totalM2: totalM2 || null, skids: skids || null };
}

export function guessSynergyPage(text: string, ref: SynergyRef, page = 1) {
  const fullOcr = extractFullOcr(text);
  const poNo = parseSynergyPoNo(text) || parseSynergyPoNo(fullOcr);
  const poDate = parseSynergyDateFromText(text) || parseSynergyDateFromText(fullOcr);

  const rawRows = parseSynergyLineRows(text);
  const lines: Record<string, unknown>[] = [];
  let idx = 0;
  for (const row of rawRows) {
    const product = matchSynergyProduct(row.description, ref.products);
    if (product) {
      lines.push(lineFromProduct(product, ++idx, row.qty, ref.sheetsPerSkid, row.description));
    } else {
      const dims = parseSynergyDimensions(row.description);
      lines.push({
        lineNo: ++idx,
        partNo: "",
        size: row.description,
        color: normalizeColorHint(row.description),
        sheets: row.qty,
        skids: skidsFromSheets(row.qty, ref.sheetsPerSkid),
        qtyM2: null,
        qtyMsf: null,
        unitMsf: null,
        unitM2: null,
        extPo: null,
        matched: false,
        rawDescription: row.description,
        widthMm: dims && ref.products[0]?.widthMm ? null : null,
      });
    }
  }

  const matchedCount = lines.filter((l) => l.matched).length;
  const out: Record<string, unknown> = {
    page,
    poNo,
    rev: 0,
    poDate,
    stockingLocation: "",
    portOfDest: "",
    lines,
    matchedCount,
    rawLineCount: rawRows.length,
  };
  if (poNo) out.concat = `${poNo}-0`;
  Object.assign(out, summarizeLines(lines));
  return out;
}

export function guessSynergyPages(pageTexts: string[], ref: SynergyRef) {
  return pageTexts.map((text, i) => guessSynergyPage(text, ref, i + 1));
}
