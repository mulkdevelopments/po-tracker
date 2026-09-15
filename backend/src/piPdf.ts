import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
  type RGB,
  type PDFEmbeddedPage,
} from "pdf-lib";
import type { Company } from "./companies.js";
import { resolvePiDocument } from "./piDocumentDefaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "../assets");

interface PoLine {
  lineNo: number;
  partNo?: string | number | null;
  size?: string | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  color?: string | null;
  qtyM2?: number | null;
  sheets?: number | null;
  unitM2?: number | null;
  extInv?: number | null;
  extPo?: number | null;
}

interface PoForPi {
  poNo: string;
  portOfDest?: string | null;
  piNo?: string | null;
  piDate?: string | null;
  piValue?: number | null;
  lines: PoLine[];
}

/*
 * Layout follows the NextGen "PI FORMAT - W LETTERHEAD" master. Coordinates are
 * measured off that document: x in points from the left edge, y in points from
 * the top edge (text y values are baselines).
 */
const PAGE_W = 595;
const PAGE_H = 841;

const LABEL_X = 50;
const VALUE_X = 108;
const DOC_LABEL_X = 392;
const DOC_VALUE_X = 459;
const BANK_LABEL_RIGHT = 366;
const BANK_VALUE_X = 384;
const SIGN_RIGHT_X = 294;

const TITLE_Y = 229.5;
const META_HEAD_Y = 259;
const META_ROW_Y = [270, 281, 292, 303, 314];
const TABLE_TOP = 324;
const FOOTER_Y = 774;

/** The letterhead's blue wave starts at 646; content must stay above it. */
const CONTENT_BOTTOM = 642;
/** Baseline-to-baseline step of the detail rows on the master. */
const ROW_STEP = 10.3;
/** First content baseline on a continuation page, clear of the letterhead logo. */
const CONTINUATION_TOP = 130;

const COLS = {
  sno: { x: 34.5, w: 19.6 },
  desc: { x: 54.1, w: 240.2 },
  uom: { x: 294.3, w: 22.6 },
  width: { x: 316.9, w: 34.2 },
  length: { x: 351.1, w: 31.6 },
  sheet: { x: 382.7, w: 32 },
  m2: { x: 414.7, w: 42.1 },
  rate: { x: 456.8, w: 41 },
  total: { x: 497.8, w: 57.2 },
};
const TABLE_X = COLS.sno.x;
const TABLE_RIGHT = COLS.total.x + COLS.total.w;
const TABLE_W = TABLE_RIGHT - TABLE_X;

const HEADER_H = 22;
const HEADER_SPLIT = 11;
const ROW_H = 11;
/** The master leaves this much room for item rows, so short PIs keep the same rhythm. */
const MIN_ITEM_BODY_H = 25;
const ROW_BASELINE = 8;
const CELL_PAD = 3;

const TITLE_SIZE = 15;
const HEAD_SIZE = 7.5;
const BODY_SIZE = 7;
const TABLE_SIZE = 7;
const NOTE_SIZE = 6.5;
const SIGN_SIZE = 6.5;

const LINE = rgb(0, 0, 0);
const BLACK = rgb(0, 0, 0);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Align = "left" | "center" | "right";

function assetBytes(name: string): Uint8Array | null {
  const p = path.join(ASSETS, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

/** Code points WinAnsi can encode outside of Latin-1. */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);
const SUBSTITUTES: Record<string, string> = {
  "\u2264": "<=",
  "\u2265": ">=",
  "\u0394": "Delta ",
  "\u2212": "-",
  "\u00a0": " ",
  "\u2033": '"',
  "\u2032": "'",
};

/** Master-data text is operator supplied, so drop anything the PDF font cannot encode. */
function safe(text: string): string {
  let out = "";
  for (const ch of text) {
    const sub = SUBSTITUTES[ch];
    if (sub != null) {
      out += sub;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRAS.has(code)) {
      out += ch;
    }
  }
  return out;
}

function fmtPiDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number, grouped = false): string {
  return grouped ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(n));
}

function lineDescription(line: PoLine): string {
  const color = (line.color || "").trim();
  const thickness = line.size?.match(/(\d+\s*MM)/i)?.[1]?.replace(/\s+/g, "").toUpperCase() || "2MM";
  if (color) return `${color}, ${thickness} PE Monocoat`;
  return line.partNo != null ? String(line.partNo) : "";
}

function lineTotal(line: PoLine): number {
  if (line.extInv != null) return Number(line.extInv);
  if (line.extPo != null) return Number(line.extPo);
  const qty = Number(line.qtyM2) || 0;
  const rate = Number(line.unitM2) || 0;
  return Math.round(qty * rate * 100) / 100;
}

const BELOW_20 = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function intToWords(n: number): string {
  if (n === 0) return "Zero";
  if (n < 20) return BELOW_20[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${TENS[t]} ${BELOW_20[r]}` : TENS[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${BELOW_20[h]} Hundred ${intToWords(r)}` : `${BELOW_20[h]} Hundred`;
  }
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    return r ? `${intToWords(th)} Thousand ${intToWords(r)}` : `${intToWords(th)} Thousand`;
  }
  const m = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  return r ? `${intToWords(m)} Million ${intToWords(r)}` : `${intToWords(m)} Million`;
}

function amountInWords(amount: number): string {
  const dollars = Math.floor(amount);
  const cents = Math.round((amount - dollars) * 100);
  let words = intToWords(dollars) + (dollars === 1 ? " Dollar" : " Dollars");
  if (cents > 0) words += ` and ${intToWords(cents)} ${cents === 1 ? "Cent" : "Cents"}`;
  return words;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) current = test;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  pages: PDFPage[];
  letterhead: PDFEmbeddedPage | null;
  font: PDFFont;
  bold: PDFFont;
  boldItalic: PDFFont;
  italic: PDFFont;
  /** Current baseline, in points from the top of the page. */
  y: number;
}

function startPage(ctx: Ctx): void {
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(ctx.page);
  if (ctx.letterhead) {
    ctx.page.drawPage(ctx.letterhead, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  }
  ctx.y = CONTINUATION_TOP;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y + needed > CONTENT_BOTTOM) startPage(ctx);
}

interface TextOpts {
  font?: PDFFont;
  size?: number;
  color?: RGB;
  align?: Align;
  width?: number;
}

/** Draws one line of text and returns the x where it ends. */
function text(ctx: Ctx, value: string, x: number, y: number, opts: TextOpts = {}): number {
  const font = opts.font ?? ctx.font;
  const size = opts.size ?? BODY_SIZE;
  const body = safe(value);
  const w = font.widthOfTextAtSize(body, size);
  let tx = x;
  if (opts.align === "right") tx = x + (opts.width ?? 0) - w;
  else if (opts.align === "center") tx = x + ((opts.width ?? 0) - w) / 2;
  ctx.page.drawText(body, { x: tx, y: PAGE_H - y, size, font, color: opts.color ?? BLACK });
  return tx + w;
}

function hRule(ctx: Ctx, x1: number, x2: number, y: number, thickness = 0.5): void {
  ctx.page.drawLine({
    start: { x: x1, y: PAGE_H - y },
    end: { x: x2, y: PAGE_H - y },
    thickness,
    color: LINE,
  });
}

function vRule(ctx: Ctx, x: number, y1: number, y2: number, thickness = 0.5): void {
  ctx.page.drawLine({
    start: { x, y: PAGE_H - y1 },
    end: { x, y: PAGE_H - y2 },
    thickness,
    color: LINE,
  });
}

/** Bold, italic and underlined, like the section headings on the master. */
function sectionHeading(ctx: Ctx, label: string, x: number, y: number, italicHead = true): void {
  const font = italicHead ? ctx.boldItalic : ctx.bold;
  const end = text(ctx, label, x, y, { font, size: HEAD_SIZE });
  hRule(ctx, x, end + 2, y + 1.5, 0.6);
}

/** Label in bold with the value at a fixed column, pushed right if the label is long. */
function labelValue(
  ctx: Ctx,
  label: string,
  value: string,
  y: number,
  labelX: number,
  valueX: number,
  labelAlign: "left" | "right" = "left",
): void {
  let end = labelX;
  if (label) {
    if (labelAlign === "right") {
      const w = ctx.bold.widthOfTextAtSize(safe(label), BODY_SIZE);
      end = text(ctx, label, labelX - w, y, { font: ctx.bold });
    } else {
      end = text(ctx, label, labelX, y, { font: ctx.bold });
    }
  }
  if (value) text(ctx, value, Math.max(valueX, end + 4), y, { font: ctx.font });
}

interface Cell {
  x: number;
  w: number;
  text?: string;
  align?: Align;
  bold?: boolean;
  /** Extra right inset, used to keep the total labels clear of the column rule. */
  pad?: number;
}

function tableRow(ctx: Ctx, top: number, height: number, cells: Cell[], descLines?: string[]): void {
  ctx.page.drawRectangle({
    x: TABLE_X,
    y: PAGE_H - (top + height),
    width: TABLE_W,
    height,
    borderColor: LINE,
    borderWidth: 0.5,
  });
  for (const cell of cells) {
    if (cell.x > TABLE_X) vRule(ctx, cell.x, top, top + height);
  }
  for (const cell of cells) {
    if (!cell.text) continue;
    const font = cell.bold ? ctx.bold : ctx.font;
    const align = cell.align ?? "left";
    const pad = cell.pad ?? CELL_PAD;
    const y = top + ROW_BASELINE;
    if (align === "left") text(ctx, cell.text, cell.x + pad, y, { font, size: TABLE_SIZE });
    else if (align === "center") {
      text(ctx, cell.text, cell.x, y, { font, size: TABLE_SIZE, align: "center", width: cell.w });
    } else {
      text(ctx, cell.text, cell.x, y, { font, size: TABLE_SIZE, align: "right", width: cell.w - pad });
    }
  }
  if (descLines && descLines.length > 1) {
    descLines.slice(1).forEach((l, i) => {
      text(ctx, l, COLS.desc.x + CELL_PAD, top + ROW_BASELINE + (i + 1) * 9, { size: TABLE_SIZE });
    });
  }
}

function tableHeader(ctx: Ctx): void {
  ensure(ctx, HEADER_H + ROW_H);
  const top = ctx.y;
  ctx.page.drawRectangle({
    x: TABLE_X,
    y: PAGE_H - (top + HEADER_H),
    width: TABLE_W,
    height: HEADER_H,
    borderColor: LINE,
    borderWidth: 0.5,
  });
  for (const x of [COLS.desc.x, COLS.uom.x, COLS.width.x, COLS.sheet.x, COLS.rate.x, COLS.total.x]) {
    vRule(ctx, x, top, top + HEADER_H);
  }
  // "Size" and "Quantity" split into two columns on the lower tier only.
  const split = top + HEADER_SPLIT;
  hRule(ctx, COLS.width.x, COLS.m2.x, split);
  vRule(ctx, COLS.length.x, split, top + HEADER_H);
  vRule(ctx, COLS.m2.x, split, top + HEADER_H);

  const tier1 = top + HEADER_SPLIT - 3;
  const tier2 = top + HEADER_H - 3.5;
  const grouped = { font: ctx.bold, size: TABLE_SIZE, align: "center" as Align };
  text(ctx, "Size", COLS.width.x, tier1, { ...grouped, width: COLS.width.w + COLS.length.w });
  text(ctx, "Quantity", COLS.sheet.x, tier1, { ...grouped, width: COLS.sheet.w + COLS.m2.w });
  for (const [label, col] of [
    ["S.No", COLS.sno],
    ["Description", COLS.desc],
    ["UOM", COLS.uom],
    ["Rate", COLS.rate],
    ["Total Amount", COLS.total],
  ] as const) {
    text(ctx, label, col.x, tier2, { ...grouped, width: col.w });
  }
  for (const [label, col] of [
    ["Width", COLS.width],
    ["Length", COLS.length],
    ["Sheet", COLS.sheet],
    ["M2", COLS.m2],
  ] as const) {
    text(ctx, label, col.x, tier2, { ...grouped, width: col.w });
  }
  ctx.y = top + HEADER_H;
}

export async function generatePiPdf(
  po: PoForPi,
  company: Company,
  master?: unknown,
): Promise<Uint8Array> {
  const cfg = resolvePiDocument(company, master);
  const pdf = await PDFDocument.create();
  const letterheadBytes = assetBytes("pi-letterhead.pdf");
  const [letterhead] = letterheadBytes ? await pdf.embedPdf(letterheadBytes) : [null];

  const ctx: Ctx = {
    pdf,
    page: null as unknown as PDFPage,
    pages: [],
    letterhead: letterhead ?? null,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    y: 0,
  };
  startPage(ctx);

  text(ctx, "Proforma Invoice", 0, TITLE_Y, {
    font: ctx.bold,
    size: TITLE_SIZE,
    align: "center",
    width: PAGE_W,
  });

  // The master shows the customer over two lines: trading name, then descriptor.
  const [customerName, ...customerRest] = cfg.customerName.split(",").map((s) => s.trim());
  const customerDescriptor = customerRest.join(", ");

  sectionHeading(ctx, "Customer Details", 38, META_HEAD_Y);
  sectionHeading(ctx, "Document Details", DOC_LABEL_X - 7, META_HEAD_Y);

  labelValue(ctx, "Customer Details:", customerName, META_ROW_Y[0], LABEL_X - 3, VALUE_X);
  if (customerDescriptor) text(ctx, customerDescriptor, VALUE_X, META_ROW_Y[1], {});
  labelValue(ctx, "Customer TRN:", cfg.customerTrn, META_ROW_Y[3], LABEL_X - 3, VALUE_X);
  const projectName = `PO ${po.poNo}${po.portOfDest ? ` - ${po.portOfDest} Port` : ""}`;
  labelValue(ctx, "Project Name:", projectName, META_ROW_Y[4], LABEL_X, VALUE_X);

  labelValue(ctx, "PI Number", po.piNo || "", META_ROW_Y[0], DOC_LABEL_X, DOC_VALUE_X);
  labelValue(ctx, "Date:", fmtPiDate(po.piDate), META_ROW_Y[1], DOC_LABEL_X, DOC_VALUE_X);
  labelValue(ctx, "Currency:", cfg.currency, META_ROW_Y[2], DOC_LABEL_X, DOC_VALUE_X);
  labelValue(ctx, "Sales Person:", cfg.salesPerson, META_ROW_Y[3], DOC_LABEL_X, DOC_VALUE_X);

  ctx.y = TABLE_TOP;
  tableHeader(ctx);

  // Product family banner: one cell spanning description through total amount.
  tableRow(ctx, ctx.y, ROW_H, [
    { x: COLS.sno.x, w: COLS.sno.w },
    { x: COLS.desc.x, w: TABLE_RIGHT - COLS.desc.x, text: cfg.productCategory, bold: true },
  ]);
  ctx.y += ROW_H;

  let totalSheets = 0;
  let totalM2 = 0;
  let grossTotal = 0;
  const bodyTop = ctx.y;
  const bodyPage = ctx.pages.length;

  for (const [idx, line] of po.lines.entries()) {
    const total = lineTotal(line);
    const sheets = Number(line.sheets) || 0;
    const m2 = Number(line.qtyM2) || 0;
    totalSheets += sheets;
    totalM2 += m2;
    grossTotal += total;

    const descLines = wrapText(lineDescription(line), ctx.font, TABLE_SIZE, COLS.desc.w - CELL_PAD * 2);
    let rowH = Math.max(ROW_H, descLines.length * 9 + 3);
    if (ctx.y + rowH > CONTENT_BOTTOM) {
      startPage(ctx);
      tableHeader(ctx);
    }
    if (idx === po.lines.length - 1 && ctx.pages.length === bodyPage) {
      rowH = Math.max(rowH, bodyTop + MIN_ITEM_BODY_H - ctx.y);
    }
    tableRow(
      ctx,
      ctx.y,
      rowH,
      [
        { x: COLS.sno.x, w: COLS.sno.w, text: String(line.lineNo), align: "center" },
        { x: COLS.desc.x, w: COLS.desc.w, text: descLines[0] },
        { x: COLS.uom.x, w: COLS.uom.w, text: "M2", align: "center" },
        {
          x: COLS.width.x,
          w: COLS.width.w,
          text: line.widthMm != null ? String(line.widthMm) : "",
          align: "center",
        },
        {
          x: COLS.length.x,
          w: COLS.length.w,
          text: line.lengthMm != null ? String(line.lengthMm) : "",
          align: "center",
        },
        { x: COLS.sheet.x, w: COLS.sheet.w, text: sheets ? fmtInt(sheets) : "", align: "center" },
        { x: COLS.m2.x, w: COLS.m2.w, text: m2 ? fmtNum(m2) : "", align: "right" },
        {
          x: COLS.rate.x,
          w: COLS.rate.w,
          text: line.unitM2 != null ? fmtNum(Number(line.unitM2)) : "",
          align: "right",
        },
        { x: COLS.total.x, w: COLS.total.w, text: fmtNum(total), align: "right" },
      ],
      descLines,
    );
    ctx.y += rowH;
  }

  const netTotal = po.piValue != null ? Number(po.piValue) : grossTotal;
  if (ctx.y + ROW_H * 2 > CONTENT_BOTTOM) {
    startPage(ctx);
    tableHeader(ctx);
  }
  tableRow(ctx, ctx.y, ROW_H, [
    {
      x: COLS.sno.x,
      w: COLS.length.x + COLS.length.w - COLS.sno.x,
      text: "Gross Total",
      align: "right",
      bold: true,
      pad: 16,
    },
    { x: COLS.sheet.x, w: COLS.sheet.w, text: fmtInt(totalSheets, true), align: "right", bold: true },
    { x: COLS.m2.x, w: COLS.m2.w, text: fmtNum(totalM2), align: "right", bold: true },
    { x: COLS.rate.x, w: COLS.rate.w },
    { x: COLS.total.x, w: COLS.total.w, text: fmtNum(grossTotal), align: "right", bold: true },
  ]);
  ctx.y += ROW_H;
  tableRow(ctx, ctx.y, ROW_H, [
    {
      x: COLS.sno.x,
      w: COLS.length.x + COLS.length.w - COLS.sno.x,
      text: "Net Total",
      align: "right",
      bold: true,
      pad: 16,
    },
    { x: COLS.sheet.x, w: COLS.sheet.w },
    { x: COLS.m2.x, w: COLS.m2.w },
    { x: COLS.rate.x, w: COLS.rate.w },
    { x: COLS.total.x, w: COLS.total.w, text: fmtNum(netTotal), align: "right", bold: true },
  ]);
  ctx.y += ROW_H;

  ctx.y += 10;
  ensure(ctx, 14);
  const wordsLabelEnd = text(ctx, "Amount In Words:", LABEL_X, ctx.y, { font: ctx.bold });
  text(ctx, amountInWords(netTotal), wordsLabelEnd + 3, ctx.y, {});

  ctx.y += 12.5;
  for (const [label, value] of [
    ["Payment Terms:", cfg.paymentTerms],
    ["Incoterms:", cfg.incoterms],
    ["Partial Delivery:", cfg.partialDelivery],
    ["Shipment Mode:", cfg.shipmentMode],
  ] as const) {
    ensure(ctx, 12);
    labelValue(ctx, label, value, ctx.y, LABEL_X, VALUE_X);
    ctx.y += ROW_STEP;
  }

  ensure(ctx, 45);
  sectionHeading(ctx, "Bank Details", LABEL_X, ctx.y, false);
  ctx.y += 10;
  for (const [leftLabel, leftValue, rightLabel, rightValue] of [
    ["Bank Name:", cfg.bankName, "Account Title:", cfg.accountTitle],
    ["A/C No:", cfg.accountNo, "Swift Code & Currency:", cfg.swift],
    ["IBAN:", cfg.iban, "Bank Address:", cfg.bankAddress],
  ] as const) {
    ensure(ctx, 12);
    labelValue(ctx, leftLabel, leftValue, ctx.y, LABEL_X, VALUE_X);
    labelValue(ctx, rightLabel, rightValue, ctx.y, BANK_LABEL_RIGHT, BANK_VALUE_X, "right");
    ctx.y += ROW_STEP;
  }

  ctx.y += 9;
  ensure(ctx, 40);
  sectionHeading(ctx, "Terms & Conditions", LABEL_X, ctx.y, false);
  ctx.y += 12;
  for (const term of cfg.terms) {
    const lines = wrapText(`>> ${term}`, ctx.font, BODY_SIZE, TABLE_RIGHT - 63);
    ensure(ctx, lines.length * ROW_STEP);
    lines.forEach((l, i) => text(ctx, l, i === 0 ? 63 : 70, ctx.y + i * 9, {}));
    ctx.y += lines.length * ROW_STEP;
  }

  const noteLines = wrapText(cfg.taxNote, ctx.italic, NOTE_SIZE, TABLE_W);
  ensure(ctx, noteLines.length * 9.5 + 10);
  noteLines.forEach((l, i) => {
    text(ctx, l, TABLE_X, ctx.y + i * 9.5, {
      font: ctx.italic,
      size: NOTE_SIZE,
      align: "center",
      width: TABLE_W,
    });
  });
  ctx.y += (noteLines.length - 1) * 9.5;

  ctx.y += 23.5;
  ensure(ctx, 34);
  const issuerSign = cfg.issuerName.toUpperCase();
  const customerSign = customerName.toUpperCase();
  text(ctx, issuerSign, 48, ctx.y, { size: SIGN_SIZE });
  text(ctx, customerSign, SIGN_RIGHT_X, ctx.y, { size: SIGN_SIZE });
  ctx.y += 33.5;
  text(ctx, "Authorised Representative", 48, ctx.y, {});
  text(ctx, "Authorised Representative", SIGN_RIGHT_X, ctx.y, {});

  const totalPages = ctx.pages.length;
  ctx.pages.forEach((page, i) => {
    ctx.page = page;
    text(ctx, `Page ${i + 1} of ${totalPages}`, TABLE_RIGHT - 60, FOOTER_Y, {
      size: BODY_SIZE,
      align: "right",
      width: 60,
    });
  });

  return pdf.save();
}
