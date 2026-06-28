/** Cynergy ORDER FORM — hybrid OCR: full-page baseline + optional zone boost. */

export const RENDER_SCALE = 2.5;

export const SYNERGY_ZONES = {
  orderDate: { left: 0.52, top: 0.205, width: 0.42, height: 0.055 },
  poNumber: { left: 0.52, top: 0.305, width: 0.42, height: 0.07 },
  table: { left: 0.07, top: 0.385, width: 0.85, height: 0.5 },
  tableDesc: { left: 0.07, top: 0.385, width: 0.58, height: 0.5 },
  tableQty: { left: 0.68, top: 0.385, width: 0.24, height: 0.5 },
} as const;

type Zone = { left: number; top: number; width: number; height: number };

type OcrWorker = {
  setParameters: (params: Record<string, string | number>) => Promise<unknown>;
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
};

function cropCanvas(source: HTMLCanvasElement, zone: Zone, pad = 0.008): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const left = Math.max(0, Math.floor((zone.left - pad) * w));
  const top = Math.max(0, Math.floor((zone.top - pad) * h));
  const width = Math.min(w - left, Math.ceil((zone.width + pad * 2) * w));
  const height = Math.min(h - top, Math.ceil((zone.height + pad * 2) * h));
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, left, top, width, height, 0, 0, width, height);
  return out;
}

/** Mild contrast boost — avoids destroying thin pen strokes. */
function mildEnhance(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d")!;
  const { width, height } = source;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.min(255, Math.max(0, (g - 40) * (255 / 175)));
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

async function ocrImage(
  worker: OcrWorker,
  canvas: HTMLCanvasElement,
  psm: number,
  whitelist?: string,
): Promise<string> {
  const params: Record<string, string | number> = {
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  };
  if (whitelist) params.tessedit_char_whitelist = whitelist;
  else params.tessedit_char_whitelist = "";
  await worker.setParameters(params);
  const { data } = await worker.recognize(canvas);
  return data.text.trim();
}

function linesFromText(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseQtyToken(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 10 || n > 99999) return null;
  return n;
}

export function zipTableColumns(descText: string, qtyText: string): string[] {
  const skip = (l: string) => /^(?:description|quantity)$/i.test(l);
  const descLines = linesFromText(descText).filter((l) => !skip(l));
  const qtyLines = linesFromText(qtyText).filter((l) => !skip(l) && /\d/.test(l));
  const rows: string[] = [];
  const n = Math.max(descLines.length, qtyLines.length);

  for (let i = 0; i < n; i++) {
    const desc = descLines[i] ?? "";
    const qtyRaw = qtyLines[i] ?? "";
    if (!desc && !qtyRaw) continue;
    const qty = parseQtyToken(qtyRaw);
    const inline = desc.match(/^(.+?)\s+(\d{2,5})$/);
    if (inline) {
      rows.push(`LINE: ${inline[1].trim()} | ${inline[2]}`);
    } else if (desc && qty != null) {
      rows.push(`LINE: ${desc} | ${qty}`);
    } else if (desc && /\d/.test(desc)) {
      rows.push(`LINE: ${desc}`);
    }
  }
  return rows;
}

function tableRowsFromText(tableText: string): string[] {
  return linesFromText(tableText)
    .filter((l) => /\d/.test(l) && !/description|quantity|order\s*form|cyn/i.test(l))
    .map((l) => {
      const m = l.match(/^(.+?)\s+(\d{2,5})$/);
      return m ? `LINE: ${m[1].trim()} | ${m[2]}` : `LINE: ${l}`;
    });
}

function pickDate(...candidates: string[]): string {
  for (const c of candidates) {
    const m = c.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    if (m) return m[1];
  }
  return "";
}

function pickPo(...candidates: string[]): string {
  for (const c of candidates) {
    const m = c.match(/(?:P\.?\s*O\.?\s*)?(?:Cynergy\s+)?(\d{4}[-\s]\d+)/i);
    if (m) return `Cynergy ${m[1].replace(/\s+/g, "-")}`;
  }
  return "";
}

export function buildStructuredPageText(parts: {
  orderDate: string;
  poNumber: string;
  tableRows: string[];
  fullOcr: string;
}): string {
  const lines = ["@SYNERGY_PAGE@"];
  if (parts.orderDate) lines.push(`ORDER_DATE: ${parts.orderDate}`);
  if (parts.poNumber) lines.push(`PO_NO: ${parts.poNumber}`);
  for (const row of parts.tableRows) lines.push(row);
  lines.push("FULL_OCR:", parts.fullOcr.trim());
  return lines.join("\n");
}

/** Full-page OCR first; zone passes only when header/table still empty. */
export async function ocrSynergyPageCanvas(
  worker: OcrWorker,
  pageCanvas: HTMLCanvasElement,
): Promise<string> {
  const fullOcr = await ocrImage(worker, pageCanvas, 6);

  let orderDate = pickDate(fullOcr);
  let poNumber = pickPo(fullOcr);
  let tableRows = tableRowsFromText(fullOcr);

  const needsZones = !poNumber || !orderDate || tableRows.length === 0;
  if (needsZones) {
    const enhanced = mildEnhance(pageCanvas);
    if (!orderDate) {
      const zoneDate = await ocrImage(worker, cropCanvas(enhanced, SYNERGY_ZONES.orderDate), 7);
      orderDate = pickDate(zoneDate, fullOcr) || zoneDate;
    }
    if (!poNumber) {
      const zonePo = await ocrImage(worker, cropCanvas(enhanced, SYNERGY_ZONES.poNumber), 7);
      poNumber = pickPo(zonePo, fullOcr) || zonePo;
    }
    if (tableRows.length === 0) {
      const zoneTable = await ocrImage(worker, cropCanvas(enhanced, SYNERGY_ZONES.table), 6);
      const zoneDesc = await ocrImage(worker, cropCanvas(enhanced, SYNERGY_ZONES.tableDesc), 6);
      const zoneQty = await ocrImage(worker, cropCanvas(enhanced, SYNERGY_ZONES.tableQty), 7, "0123456789");
      const zoneCandidates = [
        ...zipTableColumns(zoneDesc, zoneQty),
        ...tableRowsFromText(zoneTable),
      ];
      const seen = new Set(tableRows.map((r) => r.toLowerCase()));
      for (const row of zoneCandidates) {
        const key = row.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tableRows.push(row);
      }
    }
  }

  return buildStructuredPageText({ orderDate, poNumber, tableRows, fullOcr });
}
