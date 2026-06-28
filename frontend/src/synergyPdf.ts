import * as pdfjsLib from "pdfjs-dist";
import { ocrSynergyPageCanvas, RENDER_SCALE } from "./synergyOcr";

async function renderPageCanvas(page: pdfjsLib.PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

/** Zone-based OCR for each page of a Cynergy ORDER FORM PDF. */
export async function ocrSynergyPdfPages(
  file: File,
  onProgress?: (message: string) => void,
): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const Tesseract = (await import("tesseract.js")).default;
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(`OCR… ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  const pageTexts: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`OCR page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const canvas = await renderPageCanvas(page);
      const text = await ocrSynergyPageCanvas(worker, canvas);
      pageTexts.push(text);
    }
  } finally {
    await worker.terminate();
  }
  return pageTexts;
}

/** Try text layer first; fall back to per-page zone OCR for image-only PDFs. */
export async function extractSynergyPdfPages(
  file: File,
  onProgress?: (message: string) => void,
): Promise<{ pages: string[]; usedOcr: boolean }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pageTexts: string[] = [];
  let totalChars = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ").trim();
    pageTexts.push(text);
    totalChars += text.replace(/\s/g, "").length;
  }

  if (totalChars >= 40) {
    return { pages: pageTexts, usedOcr: false };
  }

  onProgress?.(`No text layer — OCR ${pdf.numPages} page(s)…`);
  const ocrPages = await ocrSynergyPdfPages(file, onProgress);
  return { pages: ocrPages, usedOcr: true };
}
