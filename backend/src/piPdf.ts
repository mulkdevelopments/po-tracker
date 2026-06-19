import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type RGB, type PDFImage } from "pdf-lib";
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

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const FOOTER_H = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_H - FOOTER_H - 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BLUE = rgb(0.18, 0.45, 0.75);
const GRAY_BG = rgb(0.93, 0.94, 0.95);
const BORDER = rgb(0.75, 0.75, 0.75);
const MUTED = rgb(0.35, 0.35, 0.35);

const COLS = {
  sno: { x: MARGIN, w: 22 },
  desc: { x: MARGIN + 22, w: 168 },
  uom: { x: MARGIN + 190, w: 26 },
  width: { x: MARGIN + 216, w: 34 },
  length: { x: MARGIN + 250, w: 34 },
  sheet: { x: MARGIN + 284, w: 38 },
  m2: { x: MARGIN + 322, w: 48 },
  rate: { x: MARGIN + 370, w: 44 },
  total: { x: MARGIN + 414, w: CONTENT_W - 414 },
};

function assetBytes(name: string): Uint8Array | null {
  const p = path.join(ASSETS, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

function yTop(y: number): number {
  return PAGE_H - y;
}

function fmtPiDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()}/${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function lineDescription(line: PoLine): string {
  const color = (line.color || "").trim();
  const m = color.match(/^([A-Z]{2,4})\s+(\d+)\s+(.+)$/i);
  const thickness = line.size?.match(/(\d+\s*MM)/i)?.[1]?.replace(/\s+/g, "") || "2MM";
  if (m) return `${m[1]} ${m[2]}-${titleCase(m[3])} ${thickness} PE Monocoat`;
  if (color) return `${color} ${thickness} PE Monocoat`;
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
  const words = text.split(/\s+/).filter(Boolean);
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

function wrapParagraph(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) out.push(...wrapText(para.trim(), font, size, maxWidth));
  return out.length ? out : [""];
}

type Align = "left" | "center" | "right";

interface Layout {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  pages: PDFPage[];
  issuerAddress: string;
}

function addPage(layout: Layout): void {
  layout.page = layout.pdf.addPage([PAGE_W, PAGE_H]);
  layout.pages.push(layout.page);
  layout.y = 50;
}

function ensureSpace(layout: Layout, needed: number): void {
  if (layout.y + needed > BOTTOM_LIMIT) addPage(layout);
}

function drawText(
  layout: Layout,
  text: string,
  x: number,
  yFromTop: number,
  font: PDFFont,
  size: number,
  color: RGB = rgb(0, 0, 0),
  align: Align = "left",
  maxWidth?: number,
) {
  let tx = x;
  if (align === "right" && maxWidth != null) tx = x + maxWidth - font.widthOfTextAtSize(text, size);
  else if (align === "center" && maxWidth != null) tx = x + (maxWidth - font.widthOfTextAtSize(text, size)) / 2;
  layout.page.drawText(text, { x: tx, y: yTop(yFromTop), size, font, color });
}

function drawLines(
  layout: Layout,
  lines: string[],
  x: number,
  yFromTop: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  color?: RGB,
  align: Align = "left",
  colWidth?: number,
) {
  lines.forEach((line, i) => {
    drawText(layout, line, x, yFromTop + i * lineHeight, font, size, color, align, colWidth);
  });
}

function drawHLine(layout: Layout, yFromTop: number) {
  layout.page.drawLine({
    start: { x: MARGIN, y: yTop(yFromTop) },
    end: { x: MARGIN + CONTENT_W, y: yTop(yFromTop) },
    thickness: 0.4,
    color: BORDER,
  });
}

function drawTableBorder(layout: Layout, top: number, height: number) {
  layout.page.drawRectangle({
    x: MARGIN,
    y: yTop(top + height),
    width: CONTENT_W,
    height,
    borderColor: BORDER,
    borderWidth: 0.5,
  });
}

function colXs(): number[] {
  return [
    COLS.sno.x, COLS.desc.x, COLS.uom.x, COLS.width.x, COLS.length.x,
    COLS.sheet.x, COLS.m2.x, COLS.rate.x, COLS.total.x, MARGIN + CONTENT_W,
  ];
}

function drawColLines(layout: Layout, top: number, height: number) {
  for (const x of colXs()) {
    layout.page.drawLine({
      start: { x, y: yTop(top) },
      end: { x, y: yTop(top + height) },
      thickness: 0.3,
      color: BORDER,
    });
  }
}

function drawMetaRow(
  layout: Layout,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
) {
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 10;
  if (leftLabel) {
    drawText(layout, leftLabel, leftX, layout.y, layout.bold, 8, MUTED);
    drawLines(layout, wrapText(leftValue, layout.font, 9, CONTENT_W / 2 - 20), leftX, layout.y + 10, layout.font, 9, 11);
  }
  if (rightLabel) {
    drawText(layout, rightLabel, rightX, layout.y, layout.bold, 8, MUTED);
    drawLines(layout, wrapText(rightValue, layout.font, 9, CONTENT_W / 2 - 30), rightX, layout.y + 10, layout.font, 9, 11);
  }
  layout.y += 34;
}

function drawTableHeader(layout: Layout) {
  ensureSpace(layout, 36);
  const top = layout.y;
  const h = 32;
  layout.page.drawRectangle({ x: MARGIN, y: yTop(top + h), width: CONTENT_W, height: h, color: GRAY_BG });
  drawTableBorder(layout, top, h);
  drawColLines(layout, top, h);

  const hy = top + 8;
  drawText(layout, "S.No", COLS.sno.x, hy + 6, layout.bold, 7, rgb(0, 0, 0), "center", COLS.sno.w);
  drawText(layout, "Description", COLS.desc.x + 3, hy + 6, layout.bold, 7);
  drawText(layout, "UOM", COLS.uom.x, hy + 6, layout.bold, 7, rgb(0, 0, 0), "center", COLS.uom.w);
  drawText(layout, "Size", COLS.width.x, hy, layout.bold, 7, rgb(0, 0, 0), "center", COLS.width.w + COLS.length.w);
  drawText(layout, "Width", COLS.width.x, hy + 10, layout.font, 6, MUTED, "center", COLS.width.w);
  drawText(layout, "Length", COLS.length.x, hy + 10, layout.font, 6, MUTED, "center", COLS.length.w);
  drawText(layout, "Quantity", COLS.sheet.x, hy, layout.bold, 7, rgb(0, 0, 0), "center", COLS.sheet.w + COLS.m2.w);
  drawText(layout, "Sheet", COLS.sheet.x, hy + 10, layout.font, 6, MUTED, "center", COLS.sheet.w);
  drawText(layout, "M2", COLS.m2.x, hy + 10, layout.font, 6, MUTED, "center", COLS.m2.w);
  drawText(layout, "Rate", COLS.rate.x, hy + 6, layout.bold, 7, rgb(0, 0, 0), "center", COLS.rate.w);
  drawText(layout, "Total", COLS.total.x, hy + 6, layout.bold, 7, rgb(0, 0, 0), "center", COLS.total.w);
  layout.y = top + h;
}

function drawTableRow(
  layout: Layout,
  cells: {
    sno?: string;
    desc: string;
    uom?: string;
    width?: string;
    length?: string;
    sheet?: string;
    m2?: string;
    rate?: string;
    total?: string;
    bold?: boolean;
  },
) {
  const f = cells.bold ? layout.bold : layout.font;
  const descLines = wrapText(cells.desc, f, 7, COLS.desc.w - 6);
  const rowH = Math.max(descLines.length, 1) * 10 + 8;
  ensureSpace(layout, rowH + 2);

  const top = layout.y;
  drawTableBorder(layout, top, rowH);
  drawColLines(layout, top, rowH);

  const ty = top + 6;
  if (cells.sno) drawText(layout, cells.sno, COLS.sno.x, ty, f, 7, rgb(0, 0, 0), "center", COLS.sno.w);
  drawLines(layout, descLines, COLS.desc.x + 3, ty, f, 7, 10);
  if (cells.uom) drawText(layout, cells.uom, COLS.uom.x, ty, f, 7, rgb(0, 0, 0), "center", COLS.uom.w);
  if (cells.width) drawText(layout, cells.width, COLS.width.x, ty, f, 7, rgb(0, 0, 0), "right", COLS.width.w - 3);
  if (cells.length) drawText(layout, cells.length, COLS.length.x, ty, f, 7, rgb(0, 0, 0), "right", COLS.length.w - 3);
  if (cells.sheet) drawText(layout, cells.sheet, COLS.sheet.x, ty, f, 7, rgb(0, 0, 0), "right", COLS.sheet.w - 3);
  if (cells.m2) drawText(layout, cells.m2, COLS.m2.x, ty, f, 7, rgb(0, 0, 0), "right", COLS.m2.w - 3);
  if (cells.rate) drawText(layout, cells.rate, COLS.rate.x, ty, f, 7, rgb(0, 0, 0), "right", COLS.rate.w - 3);
  if (cells.total) drawText(layout, cells.total, COLS.total.x, ty, f, 7, rgb(0, 0, 0), "right", COLS.total.w - 3);
  layout.y = top + rowH;
}

function drawPageFooter(layout: Layout, pageIndex: number, totalPages: number, footerImg: PDFImage | null) {
  if (footerImg) {
    const fw = 100;
    const fh = (footerImg.height / footerImg.width) * fw;
    layout.page.drawImage(footerImg, { x: PAGE_W - fw - 8, y: FOOTER_H - 8, width: fw, height: fh });
  }
  drawText(layout, layout.issuerAddress, MARGIN, PAGE_H - 14, layout.font, 7, BLUE);
  drawText(layout, `Page ${pageIndex} of ${totalPages}`, PAGE_W - MARGIN - 60, PAGE_H - 14, layout.font, 7, MUTED);
}

export async function generatePiPdf(
  po: PoForPi,
  company: Company,
  master?: unknown,
): Promise<Uint8Array> {
  const cfg = resolvePiDocument(company, master);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = assetBytes("pi-logo.png");
  const footerBytes = assetBytes("pi-footer.png");
  const logoImg = logoBytes ? await pdf.embedPng(logoBytes) : null;
  const footerImg = footerBytes ? await pdf.embedPng(footerBytes) : null;

  const firstPage = pdf.addPage([PAGE_W, PAGE_H]);
  const layout: Layout = {
    pdf,
    page: firstPage,
    y: 48,
    font,
    bold,
    pages: [firstPage],
    issuerAddress: cfg.issuerAddress,
  };

  if (logoImg) {
    const scale = 0.5;
    layout.page.drawImage(logoImg, {
      x: MARGIN,
      y: yTop(layout.y + logoImg.height * scale),
      width: logoImg.width * scale,
      height: logoImg.height * scale,
    });
  }

  const titleW = bold.widthOfTextAtSize("Proforma Invoice", 15);
  drawText(layout, "Proforma Invoice", (PAGE_W - titleW) / 2, layout.y + 52, bold, 15);
  const issuerW = bold.widthOfTextAtSize(cfg.issuerName, 10);
  drawText(layout, cfg.issuerName, PAGE_W - MARGIN - issuerW, layout.y + 8, bold, 10, BLUE);

  layout.y = 108;
  const projectName = `PO ${po.poNo}${po.portOfDest ? ` - ${po.portOfDest} Port` : ""}`;
  drawMetaRow(layout, "Customer Details", cfg.customerName, "PI Number", po.piNo || "—");
  drawMetaRow(layout, "Customer TRN", cfg.customerTrn || "—", "Date", fmtPiDate(po.piDate));
  drawMetaRow(layout, "Project Name", projectName, "Currency", cfg.currency);
  drawMetaRow(layout, "", "", "Sales Person", cfg.salesPerson);
  layout.y += 8;

  drawTableHeader(layout);
  drawTableRow(layout, { desc: cfg.productCategory, bold: true });

  let totalSheets = 0;
  let totalM2 = 0;
  let grossTotal = 0;

  for (const line of po.lines) {
    const total = lineTotal(line);
    const sheets = Number(line.sheets) || 0;
    const m2 = Number(line.qtyM2) || 0;
    totalSheets += sheets;
    totalM2 += m2;
    grossTotal += total;

    drawTableRow(layout, {
      sno: String(line.lineNo),
      desc: lineDescription(line),
      uom: "M2",
      width: line.widthMm != null ? String(line.widthMm) : "",
      length: line.lengthMm != null ? String(line.lengthMm) : "",
      sheet: sheets ? String(sheets) : "",
      m2: m2 ? fmtMoney(m2) : "",
      rate: line.unitM2 != null ? fmtMoney(Number(line.unitM2)) : "",
      total: fmtMoney(total),
    });
  }

  const netTotal = po.piValue != null ? Number(po.piValue) : grossTotal;
  drawTableRow(layout, {
    desc: "Gross Total",
    sheet: String(totalSheets),
    m2: fmtMoney(totalM2),
    total: fmtMoney(grossTotal),
    bold: true,
  });
  drawTableRow(layout, { desc: "Net Total", total: fmtMoney(netTotal), bold: true });
  layout.y += 14;

  ensureSpace(layout, 40);
  drawText(layout, "Amount In Words", MARGIN, layout.y, bold, 8);
  const wordLines = wrapText(amountInWords(netTotal), font, 9, CONTENT_W);
  drawLines(layout, wordLines, MARGIN, layout.y + 12, font, 9, 12);
  layout.y += 12 + wordLines.length * 12 + 8;

  for (const [label, value] of [
    ["Payment Terms", cfg.paymentTerms],
    ["Incoterms", cfg.incoterms],
    ["Partial Delivery", cfg.partialDelivery],
    ["Shipment Mode", cfg.shipmentMode],
  ] as const) {
    ensureSpace(layout, 16);
    drawText(layout, `${label}:`, MARGIN, layout.y, bold, 8);
    drawText(layout, value, MARGIN + 92, layout.y, font, 8);
    layout.y += 14;
  }
  layout.y += 8;

  ensureSpace(layout, 80);
  drawText(layout, "Bank Details", MARGIN, layout.y, bold, 9, BLUE);
  layout.y += 14;
  for (const line of [
    `Bank Name: ${cfg.bankName}`,
    `Account Title: ${cfg.accountTitle}`,
    `A/C No: ${cfg.accountNo}`,
    `Swift Code & Currency: ${cfg.swift}`,
    `IBAN: ${cfg.iban}`,
    `Bank Address: ${cfg.bankAddress}`,
  ]) {
    ensureSpace(layout, 12);
    drawText(layout, line, MARGIN, layout.y, font, 7.5);
    layout.y += 11;
  }
  layout.y += 8;

  ensureSpace(layout, 40);
  drawText(layout, "Terms & Conditions", MARGIN, layout.y, bold, 9, BLUE);
  layout.y += 14;
  for (const term of cfg.terms) {
    const lines = wrapParagraph(`• ${term}`, font, 7, CONTENT_W - 4);
    ensureSpace(layout, lines.length * 10 + 4);
    drawLines(layout, lines, MARGIN, layout.y, font, 7, 10);
    layout.y += lines.length * 10 + 2;
  }
  layout.y += 4;

  const taxLines = wrapParagraph(cfg.taxNote, font, 6.5, CONTENT_W);
  ensureSpace(layout, taxLines.length * 9 + 20);
  drawLines(layout, taxLines, MARGIN, layout.y, font, 6.5, 9, MUTED);
  layout.y += taxLines.length * 9 + 24;

  ensureSpace(layout, 70);
  const sigY = layout.y;
  drawText(layout, "Authorised Representative", MARGIN, sigY, font, 8);
  drawHLine(layout, sigY + 36);
  drawText(layout, cfg.issuerName, MARGIN, sigY + 42, font, 7, MUTED);
  const rightSig = MARGIN + CONTENT_W / 2 + 16;
  drawText(layout, "Authorised Representative", rightSig, sigY, font, 8);
  layout.page.drawLine({
    start: { x: rightSig, y: yTop(sigY + 36) },
    end: { x: MARGIN + CONTENT_W, y: yTop(sigY + 36) },
    thickness: 0.4,
    color: BORDER,
  });
  drawText(layout, cfg.customerName, rightSig, sigY + 42, font, 7, MUTED);

  const totalPages = layout.pages.length;
  layout.pages.forEach((p, i) => {
    layout.page = p;
    drawPageFooter(layout, i + 1, totalPages, footerImg);
  });

  return pdf.save();
}
