import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as pdfjsLib from "pdfjs-dist";
import { api } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Doc = { piNo?: string | null; poNo?: string | null };

type Props = {
  poId: number;
  piNo?: string | null;
  poNo?: string | null;
  company?: "UFP" | "SYNERGY";
  /** Extra classes on the trigger button. */
  className?: string;
  /** Label on the trigger. Defaults to "Preview PI". */
  label?: string;
};

/**
 * Opens the proforma invoice in a preview so it can be checked before anything
 * is saved to disk. Pages are drawn with PDF.js — the browser's own viewer
 * leaves these letterhead PDFs blank when they are shown from a blob URL.
 */
export default function PiPdfPreview({ poId, piNo, poNo, company, className, label = "Preview PI" }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState("PI.pdf");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setBlob(null);
      setBytes(null);
      try {
        const doc: Doc = { piNo, poNo };
        const result = await api.fetchPiPdf(poId, doc, company);
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        URL.revokeObjectURL(result.url);
        setFilename(result.filename);
        setBlob(result.blob);
        setBytes(await result.blob.arrayBuffer());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PI PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, poId, piNo, poNo, company]);

  useEffect(() => {
    const host = hostRef.current;
    if (!open || !bytes || !host) return;
    let cancelled = false;
    const task = pdfjsLib.getDocument({ data: bytes.slice(0) });

    (async () => {
      try {
        const pdf = await task.promise;
        if (cancelled) return;
        host.replaceChildren();
        const maxWidth = Math.max(320, host.clientWidth - 32);
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const unscaled = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, maxWidth / unscaled.width) });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "bg-white shadow-md max-w-full h-auto";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (cancelled) return;
          const wrap = document.createElement("div");
          wrap.className = "flex justify-center";
          wrap.appendChild(canvas);
          host.appendChild(wrap);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not render the PDF");
      }
    })();

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [open, bytes]);

  const close = () => setOpen(false);

  const download = () => {
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  return (
    <>
      <button
        type="button"
        disabled={loading && open}
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
        }
      >
        {open && loading ? "Preparing…" : label}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3 sm:p-6"
            onClick={close}
            role="presentation"
          >
            <div
              className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[min(92dvh,960px)] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Proforma invoice preview"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">Proforma invoice</div>
                  <div className="text-xs text-slate-500 truncate">{filename}</div>
                </div>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!blob || loading}
                    onClick={download}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-50"
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-slate-200 min-h-0 relative overflow-auto">
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">
                    Preparing PDF…
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 max-w-md text-center">
                      {error}
                    </div>
                  </div>
                )}
                <div ref={hostRef} className={`p-4 space-y-4 ${error ? "hidden" : ""}`} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
