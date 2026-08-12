import ExcelJS from "exceljs";
import type { Company } from "./companies.js";

export type PricingExcelRow = {
  partNo: string;
  custPartNo: string | null;
  vendorPartNo: string | null;
  itemType: string | null;
  surface: string | null;
  construction: string | null;
  thickness: string | null;
  widthIn: number | null;
  widthMm: number | null;
  lengthIn: number | null;
  lengthMm: number | null;
  description: string | null;
  colorName: string | null;
  vendorColorCode: string | null;
  shortColorName: string | null;
  pricePerSqft: number | null;
  pricePerM2: number | null;
  pricePerMsq: number | null;
  pricePerSheet: number | null;
};

export type PricingExcelSheet = {
  name: string;
  /** Guessed effective date from sheet name when present (YYYY-MM-DD). */
  guessedEffectiveFrom: string | null;
  /** Guessed end date from "Old Pricing - end …" style names. */
  guessedEffectiveTo: string | null;
  rows: PricingExcelRow[];
};

/**
 * Column positions differ between the two workbooks, so each company gets its own map.
 * `firstDataRow` skips the header block (UFP: header + units; Cynergy: title, header, units).
 */
type SheetLayout = {
  firstDataRow: number;
  /** 1-based column index, or null when the sheet has no such column. */
  col: Record<keyof Omit<PricingExcelRow, never>, number | null>;
};

const UFP_LAYOUT: SheetLayout = {
  firstDataRow: 3,
  col: {
    partNo: 1, // Product Code 1
    custPartNo: 2, // Product Code 2
    vendorPartNo: null,
    itemType: 3,
    surface: 4,
    construction: 5,
    thickness: 6,
    widthIn: 7,
    widthMm: 8,
    lengthIn: 9,
    lengthMm: 10,
    description: 11,
    colorName: 12,
    vendorColorCode: 13,
    shortColorName: null,
    pricePerSqft: 14,
    pricePerM2: 15,
    pricePerMsq: 16,
    pricePerSheet: 17,
  },
};

/**
 * Cynergy's sheet leads with the Full Item Description and only ~1/3 of items carry a
 * product code, so the description is the catalogue key (matching the workbook's own
 * VLOOKUPs against column A).
 */
const SYNERGY_LAYOUT: SheetLayout = {
  firstDataRow: 4,
  col: {
    partNo: 1, // Full Item Description
    vendorPartNo: 2, // Product Code 1
    custPartNo: 3, // Product Code 2
    itemType: 4,
    surface: 5,
    thickness: 6,
    widthIn: 7,
    widthMm: 8,
    lengthIn: 9,
    lengthMm: 10,
    construction: 11,
    colorName: 12,
    vendorColorCode: 13,
    shortColorName: 14, // Cynergy Color
    description: null,
    pricePerSqft: 15,
    pricePerM2: 16,
    pricePerMsq: 17,
    pricePerSheet: 18,
  },
};

function layoutFor(company: Company): SheetLayout {
  return company === "SYNERGY" ? SYNERGY_LAYOUT : UFP_LAYOUT;
}

/** Cynergy derives sqft from m² using this divisor (per the workbook's own formula). */
const SQFT_PER_M2 = 10.765;

/**
 * Reduce any ExcelJS cell shape to a plain primitive.
 *
 * Cynergy's sheet is full of VLOOKUPs, and some were saved without a cached result;
 * those must read as empty rather than stringifying to "[object Object]".
 */
function cellPrimitive(v: ExcelJS.CellValue): string | number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("error" in o) return null;
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("formula" in o || "sharedFormula" in o) {
      return "result" in o ? cellPrimitive(o.result as ExcelJS.CellValue) : null;
    }
    if ("text" in o) return String(o.text ?? "");
    if ("result" in o) return cellPrimitive(o.result as ExcelJS.CellValue);
    return null;
  }
  return String(v);
}

function cellStr(v: ExcelJS.CellValue): string | null {
  const p = cellPrimitive(v);
  if (p == null) return null;
  const s = String(p).trim();
  return s || null;
}

function cellNum(v: ExcelJS.CellValue): number | null {
  const p = cellPrimitive(v);
  if (p == null) return null;
  const n = typeof p === "number" ? p : Number(p.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parse dates like "27-Jan-2026" or "26-Jan-2026" from sheet titles. */
function parseSheetDate(label: string): string | null {
  const m = label.match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]} ${m[3]} UTC`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function guessDatesFromSheetName(name: string): {
  guessedEffectiveFrom: string | null;
  guessedEffectiveTo: string | null;
} {
  const date = parseSheetDate(name);
  const lower = name.toLowerCase();
  if (lower.includes("old") || lower.includes("end ")) {
    return { guessedEffectiveFrom: null, guessedEffectiveTo: date };
  }
  if (lower.includes("eff")) {
    return { guessedEffectiveFrom: date, guessedEffectiveTo: null };
  }
  return { guessedEffectiveFrom: date, guessedEffectiveTo: null };
}

function isPricingSheetName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("pricing") ||
    n.includes("price table") ||
    n.includes("price list") ||
    n.includes("price sheet")
  );
}

/** Footer notes ("NOTE: …", CIF payment terms) sit in the same column as the key. */
function isNoteRow(t: string): boolean {
  if (/^note\b/i.test(t)) return true;
  return /cif|inland transit|ocean transit|accordingly/i.test(t);
}

/**
 * Is this the catalogue key for a real product?
 * UFP keys are short codes (704984, SSM90); Cynergy keys are full item descriptions
 * (`2MM ACM 49" x 96" ASC 0069 GLOSSY WHITE`), so the shape check depends on company.
 */
export function isCatalogPartNo(raw: string, company: Company = "UFP"): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (isNoteRow(t)) return false;

  if (company === "SYNERGY" && /^\d+(\.\d+)?\s*MM\b/i.test(t)) {
    return t.length <= 120;
  }

  if (t.length > 32) return false;
  if (t.split(/\s+/).length > 4) return false;
  return true;
}

function parseSheet(ws: ExcelJS.Worksheet, company: Company): PricingExcelRow[] {
  const { firstDataRow, col } = layoutFor(company);
  const rows: PricingExcelRow[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < firstDataRow) return;
    const str = (c: number | null) => (c == null ? null : cellStr(row.getCell(c).value));
    const num = (c: number | null) => (c == null ? null : cellNum(row.getCell(c).value));

    const partRaw = str(col.partNo);
    if (!partRaw || !isCatalogPartNo(partRaw, company)) return;

    const widthMm = num(col.widthMm);
    const lengthMm = num(col.lengthMm);
    const pricePerM2 = num(col.pricePerM2);
    const colorName = str(col.colorName);
    // Colors with no vendor code of their own (MILL FINISH) are keyed by their name.
    const vendorColorCode = str(col.vendorColorCode) ?? str(col.shortColorName) ?? colorName;

    let pricePerSqft = num(col.pricePerSqft);
    let pricePerMsq = num(col.pricePerMsq);
    let pricePerSheet = num(col.pricePerSheet);

    // Cynergy quotes one rate per tier and computes the others from it with a fixed
    // 10.765 sqft/m² factor. Recover any column whose cached formula result is missing
    // rather than dropping the rate.
    if (company === "SYNERGY" && pricePerM2 != null) {
      if (pricePerSqft == null) pricePerSqft = pricePerM2 / SQFT_PER_M2;
      if (pricePerMsq == null) pricePerMsq = (pricePerM2 / SQFT_PER_M2) * 1000;
      if (pricePerSheet == null && widthMm != null && lengthMm != null) {
        pricePerSheet = (widthMm / 1000) * (lengthMm / 1000) * pricePerM2;
      }
    }

    rows.push({
      partNo: partRaw,
      custPartNo: str(col.custPartNo),
      vendorPartNo: str(col.vendorPartNo),
      itemType: str(col.itemType),
      surface: str(col.surface),
      construction: str(col.construction),
      thickness: str(col.thickness),
      widthIn: num(col.widthIn),
      widthMm,
      lengthIn: num(col.lengthIn),
      lengthMm,
      description: str(col.description),
      colorName,
      vendorColorCode,
      shortColorName: str(col.shortColorName),
      pricePerSqft,
      pricePerM2,
      pricePerMsq,
      pricePerSheet,
    });
  });

  return rows;
}

export async function parsePricingWorkbook(
  buffer: Buffer,
  company: Company = "UFP",
): Promise<{ sheets: PricingExcelSheet[]; fileSheetNames: string[] }> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS typings expect specific Buffer shapes; Node Buffer is fine at runtime.
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const fileSheetNames = wb.worksheets.map((w) => w.name);
  const sheets: PricingExcelSheet[] = [];

  for (const ws of wb.worksheets) {
    if (!isPricingSheetName(ws.name)) continue;
    const rows = parseSheet(ws, company);
    if (rows.length === 0) continue;
    const dates = guessDatesFromSheetName(ws.name);
    sheets.push({
      name: ws.name,
      ...dates,
      rows,
    });
  }

  return { sheets, fileSheetNames };
}
