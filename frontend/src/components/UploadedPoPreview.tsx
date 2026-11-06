import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type UploadedSource = {
  name: string;
  kind: "pdf" | "text";
  bytes?: ArrayBuffer;
  text?: string;
};

export default function UploadedPoPreview({
  source,
  focusPage,
}: {
  source: UploadedSource;
  focusPage?: number | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setPaneWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || source.kind !== "pdf" || !source.bytes || paneWidth < 40) return;
    let cancelled = false;
    setError(null);
    const task = pdfjsLib.getDocument({ data: source.bytes.slice(0) });
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const pdf = await task.promise;
          if (cancelled) return;
          host.replaceChildren();
          const maxWidth = Math.max(160, paneWidth - 24);
          for (let i = 1; i <= pdf.numPages; i++) {
            if (cancelled) return;
            const page = await pdf.getPage(i);
            const unscaled = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2, maxWidth / unscaled.width) });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.className = "bg-white shadow-sm max-w-full h-auto";
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport, canvas }).promise;
            if (cancelled) return;
            const wrap = document.createElement("div");
            wrap.dataset.page = String(i);
            wrap.className = "flex justify-center";
            wrap.appendChild(canvas);
            host.appendChild(wrap);
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not show this PDF");
        }
      })();
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void task.destroy();
    };
  }, [source, paneWidth]);

  useEffect(() => {
    if (!focusPage) return;
    const scroller = scrollerRef.current;
    const page = scroller?.querySelector<HTMLElement>(`[data-page="${focusPage}"]`);
    page?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusPage, source]);

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="text-sm font-semibold text-slate-900">Uploaded PO</div>
          <div className="truncate text-xs text-slate-500">{source.name}</div>
        </div>
        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
          {source.kind === "text" ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-800">{source.text}</pre>
          ) : (
            <div ref={hostRef} className="space-y-3" />
          )}
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
