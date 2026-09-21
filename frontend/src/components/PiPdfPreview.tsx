import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";

type Doc = { piNo?: string | null; poNo?: string | null };

type Props = {
  poId: number;
  piNo?: string | null;
  poNo?: string | null;
  /** Extra classes on the trigger button. */
  className?: string;
  /** Label on the trigger. Defaults to "Preview PI". */
  label?: string;
};

/**
 * Opens the proforma invoice in a full-screen preview so it can be checked
 * before anything is saved to disk. Download lives inside the preview.
 */
export default function PiPdfPreview({ poId, piNo, poNo, className, label = "Preview PI" }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("PI.pdf");
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      setUrl(null);
      setBlob(null);
      try {
        const doc: Doc = { piNo, poNo };
        const result = await api.fetchPiPdf(poId, doc);
        if (cancelled) {
          URL.revokeObjectURL(result.url);
          return;
        }
        objectUrl = result.url;
        setUrl(result.url);
        setFilename(result.filename);
        setBlob(result.blob);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PI PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, poId, piNo, poNo]);

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

              <div className="flex-1 bg-slate-100 min-h-0 relative">
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
                {url && !error && (
                  <iframe title={filename} src={url} className="w-full h-full border-0 bg-white" />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
