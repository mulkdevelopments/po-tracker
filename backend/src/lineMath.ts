/**
 * Line-item quantity and value maths shared by PO upload, create and edit.
 *
 * Purchase orders quote quantity in MSF (thousand square feet), while production and
 * invoicing work in sheets and m². Request #24 fixes the chain:
 *
 *   MSF → # sheets (snapped to the nearest skid multiple when within 5 sheets)
 *       → m² → × $/m² = gross invoice value
 *
 * The PO value keeps its own sq-ft basis (MSF × $/MSF) so both figures can be shown
 * side by side at line level (request #1).
 */

/** A quantity this close to a full skid is treated as a full skid. */
export const SHEET_SNAP_TOLERANCE = 5;

const SQFT_PER_M2 = 10.7639104;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/**
 * Snap a raw sheet count to the nearest multiple of `sheetsPerSkid` when it is within
 * `SHEET_SNAP_TOLERANCE` sheets of one; otherwise round to a whole sheet.
 */
export function snapSheets(raw: number, sheetsPerSkid = 200): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (sheetsPerSkid > 0) {
    const nearest = Math.round(raw / sheetsPerSkid) * sheetsPerSkid;
    if (nearest > 0 && Math.abs(raw - nearest) <= SHEET_SNAP_TOLERANCE) return nearest;
  }
  return Math.round(raw);
}

/** MSF → whole sheets for a sheet of the given square footage. */
export function sheetsFromMsf(
  qtyMsf: number | null | undefined,
  sqftPerSheet: number | null | undefined,
  sheetsPerSkid = 200,
): number | null {
  const msf = num(qtyMsf);
  const sqft = num(sqftPerSheet);
  if (msf == null || sqft == null || sqft <= 0) return null;
  return snapSheets((msf * 1000) / sqft, sheetsPerSkid);
}

export function skidsFromSheets(
  sheets: number | null | undefined,
  sheetsPerSkid = 200,
): number | null {
  const s = num(sheets);
  if (s == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(s / sheetsPerSkid);
}

export type LineMathFields = {
  widthMm?: number | null;
  lengthMm?: number | null;
  qtyMsf?: number | null;
  qtyM2?: number | null;
  sheets?: number | null;
  skids?: number | null;
  unitMsf?: number | null;
  unitM2?: number | null;
  unitSheet?: number | null;
  extPo?: number | null;
  extInv?: number | null;
};

/** Per-sheet geometry from the stored millimetre dimensions. */
export function sheetGeometry(l: Pick<LineMathFields, "widthMm" | "lengthMm">) {
  const w = num(l.widthMm);
  const h = num(l.lengthMm);
  if (w == null || h == null || w <= 0 || h <= 0) return { m2PerSheet: null, sqftPerSheet: null };
  const m2PerSheet = (w * h) / 1_000_000;
  return { m2PerSheet, sqftPerSheet: m2PerSheet * SQFT_PER_M2 };
}

/**
 * Fill in whatever quantity/value fields can be derived from the ones already present.
 * Existing values are never overwritten — an operator's entry always wins.
 */
export function completeLineMath<T extends LineMathFields>(line: T, sheetsPerSkid = 200): T {
  const out = { ...line };
  const { m2PerSheet, sqftPerSheet } = sheetGeometry(out);

  if (num(out.sheets) == null) {
    const derived = sheetsFromMsf(out.qtyMsf, sqftPerSheet, sheetsPerSkid);
    if (derived != null && derived > 0) out.sheets = derived;
  }
  if (num(out.qtyM2) == null && num(out.sheets) != null && m2PerSheet != null) {
    out.qtyM2 = round(Number(out.sheets) * m2PerSheet, 4);
  }
  if (num(out.qtyMsf) == null && num(out.sheets) != null && sqftPerSheet != null) {
    out.qtyMsf = round((Number(out.sheets) * sqftPerSheet) / 1000, 4);
  }
  if (num(out.skids) == null) {
    const skids = skidsFromSheets(out.sheets, sheetsPerSkid);
    if (skids != null) out.skids = skids;
  }
  // PO value keeps the ordering basis — per sheet for Cynergy, per MSF for UFP — while the
  // gross invoice value always uses m² (request #1).
  if (num(out.extPo) == null && num(out.unitSheet) != null && num(out.sheets) != null) {
    out.extPo = round(Number(out.sheets) * Number(out.unitSheet), 2);
  }
  if (num(out.extPo) == null && num(out.qtyMsf) != null && num(out.unitMsf) != null) {
    out.extPo = round(Number(out.qtyMsf) * Number(out.unitMsf), 2);
  }
  if (num(out.extInv) == null && num(out.qtyM2) != null && num(out.unitM2) != null) {
    out.extInv = round(Number(out.qtyM2) * Number(out.unitM2), 2);
  }
  return out;
}

/** Header roll-ups that mirror the line columns O–V of the order tracker. */
export type HeaderTotals = {
  poValue: number | null;
  grossInvoiceValue: number | null;
  totalM2: number | null;
  skids: number | null;
};

function sumOrNull(lines: LineMathFields[], pick: (l: LineMathFields) => unknown, dp: number) {
  let total = 0;
  let seen = false;
  for (const l of lines) {
    const v = num(pick(l));
    if (v == null) continue;
    total += v;
    seen = true;
  }
  return seen ? round(total, dp) : null;
}

/**
 * Roll the line values up to the header: PO value from Ext (PO) (sq-ft basis) and gross
 * invoice value from Ext (Inv) (m² basis), so both figures exist at summary and line
 * level (request #1).
 */
export function headerTotalsFromLines(lines: LineMathFields[]): HeaderTotals {
  return {
    poValue: sumOrNull(lines, (l) => l.extPo, 2),
    grossInvoiceValue: sumOrNull(lines, (l) => l.extInv, 2),
    totalM2: sumOrNull(lines, (l) => l.qtyM2, 4),
    skids: sumOrNull(lines, (l) => l.skids, 2),
  };
}

/**
 * The header roll-ups a record is still missing. Values already present are kept, and an
 * order whose PO value has been zeroed — how the tracker marks a superseded revision —
 * rolls up to zero instead of to the line sums.
 */
export function missingHeaderTotals(
  existing: Record<string, unknown>,
  lines: LineMathFields[],
): Record<string, number> {
  const zeroed = existing.poValue != null && Number(existing.poValue) === 0;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(headerTotalsFromLines(lines))) {
    if (value == null || existing[key] != null) continue;
    out[key] = zeroed ? 0 : value;
  }
  return out;
}

/** Fill header roll-ups the caller left blank. */
export function fillHeaderTotals<T extends Record<string, unknown>>(
  poData: T,
  lines: LineMathFields[],
): T {
  return { ...poData, ...missingHeaderTotals(poData, lines) };
}
