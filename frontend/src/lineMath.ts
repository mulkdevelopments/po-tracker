/**
 * Live line-item maths for Upload + PO drawer edit.
 *
 * When the operator changes a driver field, cascade the rest:
 *   Qty (MSF) → sheets (nearest multiple of 5) → m² → Ext $ (PO) / Ext $ (Inv)
 *   Sheets     → m² + MSF → skids → values
 *   Unit rates → Ext $ only
 */

export type LineForm = Record<string, string>;

export const SHEET_ROUND_MULTIPLE = 5;
const SQFT_PER_M2 = 10.7639104;

/** Fields that should trigger a cascade when edited. */
export const LINE_RECOMPUTE_KEYS = [
  "qtyMsf",
  "qtyM2",
  "sheets",
  "widthMm",
  "lengthMm",
  "unitMsf",
  "unitSheet",
  "unitM2",
] as const;

export function snapSheets(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const snapped = Math.round(raw / SHEET_ROUND_MULTIPLE) * SHEET_ROUND_MULTIPLE;
  return snapped > 0 ? snapped : SHEET_ROUND_MULTIPLE;
}

export function skidsFromSheets(sheets: number | null, sheetsPerSkid: number): number | null {
  if (sheets == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(sheets / sheetsPerSkid);
}

function n(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function str(v: number | null, dp: number): string {
  return v == null ? "" : String(round(v, dp));
}

function geometry(row: LineForm): { m2PerSheet: number | null; sqftPerSheet: number | null } {
  const w = n(row.widthMm);
  const h = n(row.lengthMm);
  if (w == null || h == null || w <= 0 || h <= 0) return { m2PerSheet: null, sqftPerSheet: null };
  const m2PerSheet = (w * h) / 1_000_000;
  return { m2PerSheet, sqftPerSheet: m2PerSheet * SQFT_PER_M2 };
}

function applyValues(
  out: LineForm,
  sheets: number | null,
  qtyMsf: number | null,
  qtyM2: number | null,
  opts?: { preservePdfExtPo?: boolean },
) {
  const unitMsf = n(out.unitMsf);
  const unitSheet = n(out.unitSheet);
  const unitM2 = n(out.unitM2);

  let extPo: number | null = null;
  if (unitSheet != null && sheets != null) extPo = sheets * unitSheet;
  else if (unitMsf != null && qtyMsf != null) extPo = qtyMsf * unitMsf;
  else if (unitM2 != null && qtyM2 != null) extPo = qtyM2 * unitM2;

  const extInv = unitM2 != null && qtyM2 != null ? qtyM2 * unitM2 : extPo;

  const fromPdf = out.fromPdf === "true" || out.fromPdf === "1";
  if (!(opts?.preservePdfExtPo && fromPdf && out.extPo)) {
    out.extPo = str(extPo, 2);
  }
  out.extInv = str(extInv, 2);
  if (extInv != null) out.catalogExt = str(extInv, 2);
}

/**
 * Recompute derived line fields after `changedKey` was edited.
 * Always overwrites dependent quantities/values so the grid stays in sync.
 */
export function recomputeLineForm(
  row: LineForm,
  changedKey: string,
  sheetsPerSkid = 200,
  opts?: { preservePdfExtPo?: boolean },
): LineForm {
  const out = { ...row };
  const { m2PerSheet, sqftPerSheet } = geometry(out);

  let sheets = n(out.sheets);
  let qtyMsf = n(out.qtyMsf);
  let qtyM2 = n(out.qtyM2);
  const dimsChanged = changedKey === "widthMm" || changedKey === "lengthMm";

  // Direction of cascade depends on what the operator just typed.
  if (changedKey === "qtyMsf") {
    if (qtyMsf != null && sqftPerSheet != null && sqftPerSheet > 0) {
      sheets = snapSheets((qtyMsf * 1000) / sqftPerSheet);
      out.sheets = String(sheets);
      qtyM2 = m2PerSheet != null ? sheets * m2PerSheet : null;
      out.qtyM2 = str(qtyM2, 4);
    }
  } else if (changedKey === "sheets") {
    if (sheets != null) {
      qtyM2 = m2PerSheet != null ? sheets * m2PerSheet : null;
      qtyMsf = sqftPerSheet != null ? (sheets * sqftPerSheet) / 1000 : null;
      out.qtyM2 = str(qtyM2, 4);
      out.qtyMsf = str(qtyMsf, 4);
    }
  } else if (changedKey === "qtyM2") {
    if (qtyM2 != null && m2PerSheet != null && m2PerSheet > 0) {
      sheets = snapSheets(qtyM2 / m2PerSheet);
      out.sheets = String(sheets);
      qtyMsf = sqftPerSheet != null ? (sheets * sqftPerSheet) / 1000 : null;
      qtyM2 = sheets * m2PerSheet;
      out.qtyMsf = str(qtyMsf, 4);
      out.qtyM2 = str(qtyM2, 4);
    }
  } else if (dimsChanged) {
    if (sheets != null) {
      qtyM2 = m2PerSheet != null ? sheets * m2PerSheet : null;
      qtyMsf = sqftPerSheet != null ? (sheets * sqftPerSheet) / 1000 : null;
      out.qtyM2 = str(qtyM2, 4);
      out.qtyMsf = str(qtyMsf, 4);
    } else if (qtyMsf != null && sqftPerSheet != null && sqftPerSheet > 0) {
      sheets = snapSheets((qtyMsf * 1000) / sqftPerSheet);
      out.sheets = String(sheets);
      qtyM2 = m2PerSheet != null ? sheets * m2PerSheet : null;
      out.qtyM2 = str(qtyM2, 4);
    }
  }

  sheets = n(out.sheets);
  qtyMsf = n(out.qtyMsf);
  qtyM2 = n(out.qtyM2);

  const skids = skidsFromSheets(sheets, sheetsPerSkid);
  if (skids != null) out.skids = String(skids);

  applyValues(out, sheets, qtyMsf, qtyM2, opts);
  return out;
}

/** Sum line Ext (Inv) / Ext (PO) / m² / skids for header roll-ups while editing. */
export function lineFormTotals(lines: LineForm[]) {
  let poValue = 0;
  let grossInvoiceValue = 0;
  let totalM2 = 0;
  let skids = 0;
  let hasPo = false;
  let hasInv = false;
  let hasM2 = false;
  let hasSkids = false;
  for (const l of lines) {
    const ep = n(l.extPo);
    const ei = n(l.extInv);
    const m2 = n(l.qtyM2);
    const sk = n(l.skids);
    if (ep != null) {
      poValue += ep;
      hasPo = true;
    }
    if (ei != null) {
      grossInvoiceValue += ei;
      hasInv = true;
    }
    if (m2 != null) {
      totalM2 += m2;
      hasM2 = true;
    }
    if (sk != null) {
      skids += sk;
      hasSkids = true;
    }
  }
  return {
    poValue: hasPo ? round(poValue, 2) : null,
    grossInvoiceValue: hasInv ? round(grossInvoiceValue, 2) : null,
    totalM2: hasM2 ? round(totalM2, 4) : null,
    skids: hasSkids ? skids : null,
  };
}
