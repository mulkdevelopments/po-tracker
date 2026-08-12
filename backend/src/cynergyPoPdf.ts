/**
 * PDF acknowledgement of a Cynergy PO form submission (request log #28).
 *
 * Deliberately simple and self-contained — it is a receipt of what the submitter typed,
 * not a commercial document, so it uses the standard fonts and no branding assets.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface CynergySubmissionLine {
  lineNo?: number;
  description?: string | null;
  partNo?: string | null;
  color?: string | null;
  size?: string | null;
  widthIn?: number | null;
  lengthIn?: number | null;
  sheets?: number | null;
  notes?: string | null;
}

export interface CynergySubmissionForPdf {
  id: number;
  poNo: string;
  poDate?: string | null;
  stockingLocation?: string | null;
  portOfDest?: string | null;
  notes?: string | null;
  submitterName?: string | null;
  submitterEmail?: string | null;
  submitterPhone?: string | null;
  lines: CynergySubmissionLine[];
  createdAt?: Date | string | null;
}

const MARGIN = 48;
const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.45, 0.47, 0.52);
const RULE = rgb(0.85, 0.86, 0.88);

type Ctx = { page: PDFPage; y: number; font: PDFFont; bold: PDFFont; width: number };

function text(ctx: Ctx, value: string, x: number, size: number, bold = false, color = INK) {
  ctx.page.drawText(value, { x, y: ctx.y, size, font: bold ? ctx.bold : ctx.font, color });
}

function truncate(font: PDFFont, value: string, size: number, maxWidth: number): string {
  let out = value;
  while (out.length > 1 && font.widthOfTextAtSize(out, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.length < value.length ? `${out.slice(0, -1)}…` : out;
}

function sizeLabel(l: CynergySubmissionLine): string {
  if (l.size?.trim()) return l.size.trim();
  if (l.widthIn && l.lengthIn) return `${l.widthIn}" x ${l.lengthIn}"`;
  return "—";
}

export async function generateCynergyPoPdf(sub: CynergySubmissionForPdf): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const ctx: Ctx = { page, y: height - MARGIN, font, bold, width };
  const right = width - MARGIN;

  text(ctx, "Purchase order received", MARGIN, 18, true);
  ctx.y -= 16;
  text(ctx, "Cynergy — Mulk International", MARGIN, 10, false, MUTED);
  ctx.y -= 24;

  const rows: [string, string][] = [
    ["PO number", sub.poNo || "—"],
    ["Order date", sub.poDate || "—"],
    ["Stocking location", sub.stockingLocation || "—"],
    ["Port of arrival", sub.portOfDest || "—"],
    ["Submitted by", sub.submitterName || "—"],
    ["Email", sub.submitterEmail || "—"],
    ["Phone", sub.submitterPhone || "—"],
    ["Reference", `#${sub.id}`],
  ];
  for (const [label, value] of rows) {
    text(ctx, label, MARGIN, 9, false, MUTED);
    text(ctx, truncate(font, value, 10, right - MARGIN - 150), MARGIN + 150, 10);
    ctx.y -= 16;
  }

  ctx.y -= 8;
  page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: right, y: ctx.y }, color: RULE });
  ctx.y -= 18;
  text(ctx, "Line items", MARGIN, 11, true);
  ctx.y -= 18;

  const cols = [MARGIN, MARGIN + 26, MARGIN + 250, MARGIN + 370, right - 60];
  for (const [i, header] of ["#", "Item", "Colour", "Size", "Sheets"].entries()) {
    text(ctx, header, cols[i], 9, true, MUTED);
  }
  ctx.y -= 6;
  page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: right, y: ctx.y }, color: RULE });
  ctx.y -= 15;

  let totalSheets = 0;
  for (const [i, l] of sub.lines.entries()) {
    if (ctx.y < MARGIN + 80) {
      page = doc.addPage([595.28, 841.89]);
      ctx.page = page;
      ctx.y = height - MARGIN;
    }
    totalSheets += Number(l.sheets) || 0;
    text(ctx, String(l.lineNo ?? i + 1), cols[0], 9);
    text(ctx, truncate(font, l.description || l.partNo || "—", 9, cols[2] - cols[1] - 8), cols[1], 9);
    text(ctx, truncate(font, l.color || "—", 9, cols[3] - cols[2] - 8), cols[2], 9);
    text(ctx, truncate(font, sizeLabel(l), 9, cols[4] - cols[3] - 8), cols[3], 9);
    text(ctx, String(l.sheets ?? "—"), cols[4], 9);
    ctx.y -= 14;
  }

  ctx.y -= 4;
  page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: right, y: ctx.y }, color: RULE });
  ctx.y -= 15;
  text(ctx, "Total sheets", cols[3], 9, true);
  text(ctx, String(totalSheets), cols[4], 9, true);
  ctx.y -= 26;

  if (sub.notes?.trim()) {
    text(ctx, "Notes", MARGIN, 9, true, MUTED);
    ctx.y -= 14;
    text(ctx, truncate(font, sub.notes.trim(), 9, right - MARGIN), MARGIN, 9);
    ctx.y -= 20;
  }

  text(
    ctx,
    "This is an acknowledgement of receipt. The order is reviewed before it enters the tracker.",
    MARGIN,
    8,
    false,
    MUTED,
  );

  return Buffer.from(await doc.save());
}
