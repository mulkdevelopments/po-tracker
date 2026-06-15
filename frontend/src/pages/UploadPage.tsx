import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { PO_SECTIONS, LINE_COLS } from "../poFields";
import type { ReferenceData } from "../types";
import { fmtMoney, fmtNum } from "../utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type LineForm = Record<string, string>;
type Product = ReferenceData["products"][number];

const toStr = (v: unknown) => (v == null ? "" : String(v));

function blankForm(): Record<string, string> {
  const f: Record<string, string> = {};
  for (const sec of PO_SECTIONS) for (const fld of sec.fields) if (fld.type !== "bool") f[fld.k as string] = "";
  f.status = "PO Received";
  f.notes = "";
  return f;
}

function lineToForm(l: Record<string, unknown>): LineForm {
  const row: LineForm = {};
  for (const c of LINE_COLS) row[c.k as string] = toStr(l[c.k as string]);
  return row;
}

export default function UploadPage() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [form, setForm] = useState<Record<string, string>>(blankForm());
  const [active, setActive] = useState(true);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    api.getReference().then(setRef);
  }, []);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of ref?.products ?? []) m.set(p.partNo, p);
    return m;
  }, [ref]);

  const totals = useMemo(() => {
    const poValue = lines.reduce((s, l) => s + (Number(l.extPo) || 0), 0);
    const totalM2 = lines.reduce((s, l) => s + (Number(l.qtyM2) || 0), 0);
    const skids = lines.reduce((s, l) => s + (Number(l.skids) || 0), 0);
    return { poValue, totalM2, skids };
  }, [lines]);

  const setField = (k: string, v: string) => {
    if (k === "stockingLocation") {
      const loc = ref?.stockingLocations.find((l) => l.name === v);
      setForm((f) => ({ ...f, stockingLocation: v, portOfDest: loc?.arrivalPort ?? f.portOfDest }));
      return;
    }
    setForm((f) => ({ ...f, [k]: v }));
  };

  // Recompute derived line numbers (m²/MSF/value) from sheets + product/dims.
  const computeLine = (row: LineForm): LineForm => {
    const product = row.partNo ? productMap.get(row.partNo) : undefined;
    const wMm = product?.widthMm ?? (row.widthMm ? Number(row.widthMm) : null);
    const lMm = product?.lengthMm ?? (row.lengthMm ? Number(row.lengthMm) : null);
    const wIn = product?.widthIn ?? null;
    const lIn = product?.lengthIn ?? null;
    const sheets = row.sheets !== "" ? Number(row.sheets) : null;
    const m2PerSheet = wMm && lMm ? (wMm * lMm) / 1_000_000 : null;
    const sqftPerSheet = wIn && lIn ? (wIn * lIn) / 144 : null;
    const qtyM2 = sheets != null && m2PerSheet != null ? sheets * m2PerSheet : null;
    const qtyMsf = sheets != null && sqftPerSheet != null ? (sheets * sqftPerSheet) / 1000 : null;
    const pps = product?.pricePerSheet ?? null;
    const ppm2 = product?.pricePerM2 ?? (row.unitM2 ? Number(row.unitM2) : null);
    let extPo: number | null = null;
    if (sheets != null && pps != null) extPo = sheets * pps;
    else if (qtyM2 != null && ppm2 != null) extPo = qtyM2 * ppm2;
    return {
      ...row,
      qtyM2: qtyM2 != null ? String(Math.round(qtyM2 * 1000) / 1000) : row.qtyM2,
      qtyMsf: qtyMsf != null ? String(Math.round(qtyMsf * 1000) / 1000) : row.qtyMsf,
      extPo: extPo != null ? String(Math.round(extPo * 100) / 100) : row.extPo,
    };
  };

  const fillFromProduct = (row: LineForm, product: Product): LineForm => ({
    ...row,
    custPartNo: toStr(product.custPartNo),
    size: [product.thickness, product.widthIn ? `${product.widthIn}"` : "", product.lengthIn ? `x ${product.lengthIn}"` : "", product.construction].filter(Boolean).join(" "),
    widthMm: toStr(product.widthMm),
    lengthMm: toStr(product.lengthMm),
    color: `${product.vendorColorCode ?? ""} ${product.colorName ?? ""}`.trim(),
    unitMsf: toStr(product.pricePerMsq),
    unitM2: toStr(product.pricePerM2),
    leadTime: toStr(product.leadTimeDays),
  });

  // Update a line cell; auto-fill from the catalog the moment a matching
  // part # is entered, and recompute derived numbers live.
  const setLineVal = (i: number, k: string, v: string) =>
    setLines((prev) =>
      prev.map((row, idx) => {
        if (idx !== i) return row;
        let next: LineForm = { ...row, [k]: v };
        if (k === "partNo") {
          const product = productMap.get(v.trim());
          if (product) next = fillFromProduct(next, product);
        }
        if (["partNo", "sheets", "widthMm", "lengthMm", "unitM2"].includes(k)) next = computeLine(next);
        return next;
      }),
    );

  const applyProduct = (i: number) =>
    setLines((prev) =>
      prev.map((row, idx) => {
        if (idx !== i) return row;
        const product = productMap.get(row.partNo.trim());
        return product ? computeLine(fillFromProduct(row, product)) : computeLine(row);
      }),
    );

  const recompute = (i: number) =>
    setLines((prev) => prev.map((row, idx) => (idx === i ? computeLine(row) : row)));

  const addLine = () => setLines((prev) => [...prev, { lineNo: String(prev.length + 1) }]);
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const applyGuess = (g: Record<string, unknown>) => {
    setForm((f) => ({
      ...f,
      poNo: toStr(g.poNo) || f.poNo,
      poDate: toStr(g.poDate) || f.poDate,
      stockingLocation: toStr(g.stockingLocation) || f.stockingLocation,
      portOfDest: toStr(g.portOfDest) || f.portOfDest,
    }));
    const gLines = (g.lines as Record<string, unknown>[]) || [];
    setLines(gLines.map(lineToForm));
    const matched = Number(g.matchedCount) || 0;
    setStatus(`Decoded ${gLines.length} line(s)${matched ? `, ${matched} matched to catalog` : ""}.`);
  };

  const extractPdfText = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    if (text.replace(/\s/g, "").length >= 40) return text;

    // Image-only PDF → OCR fallback (first 3 pages).
    setStatus("No text layer found — running OCR (this can take a moment)…");
    const Tesseract = (await import("tesseract.js")).default;
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (m: { status: string; progress: number }) =>
        m.status === "recognizing text" && setStatus(`OCR… ${Math.round(m.progress * 100)}%`),
    });
    let ocr = "";
    const pages = Math.min(pdf.numPages, 3);
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await worker.recognize(canvas);
      ocr += data.text + "\n";
    }
    await worker.terminate();
    return ocr;
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setStatus(`Reading ${file.name}…`);
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }
      if (!text.trim()) {
        setStatus("Could not extract any text from the file. Enter the PO manually below.");
        return;
      }
      const { guess } = await api.decodeText(text);
      applyGuess(guess);
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form.poNo.trim()) {
      alert("PO number is required");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form, active };
      if (!form.poValue) payload.poValue = totals.poValue || null;
      if (!form.totalM2) payload.totalM2 = totals.totalM2 || null;
      if (!form.skids) payload.skids = totals.skids || null;
      payload.lines = lines.map((l, idx) => ({ ...l, lineNo: l.lineNo || String(idx + 1) }));
      await api.createOrder(payload);
      navigate("/orders");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create PO");
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit()) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
        <div className="text-lg font-semibold mb-1">Uploading is restricted</div>
        <div className="text-sm text-slate-500">Your account has read-only access.</div>
      </div>
    );
  }

  const renderField = (k: string, type?: string, options?: string[]) => {
    if (k === "active") {
      return (
        <select value={active ? "Yes" : "No"} onChange={(e) => setActive(e.target.value === "Yes")} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option>Yes</option>
          <option>No</option>
        </select>
      );
    }
    if (k === "status") {
      return (
        <select value={form.status} onChange={(e) => setField("status", e.target.value)} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {(options ?? []).map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    }
    if (k === "stockingLocation") {
      return (
        <select value={form.stockingLocation} onChange={(e) => setField("stockingLocation", e.target.value)} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">—</option>
          {(ref?.stockingLocations ?? []).map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
      );
    }
    if (k === "shippingLine") {
      return (
        <select value={form.shippingLine} onChange={(e) => setField("shippingLine", e.target.value)} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">—</option>
          {(ref?.shippingLines ?? []).map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
      );
    }
    if (type === "select") {
      return (
        <select value={form[k] ?? ""} onChange={(e) => setField(k, e.target.value)} className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {(options ?? []).map((o) => <option key={o} value={o}>{o || "—"}</option>)}
        </select>
      );
    }
    return (
      <input
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        value={form[k] ?? ""}
        onChange={(e) => setField(k, e.target.value)}
        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="font-semibold mb-1">Upload a Purchase Order</div>
        <div className="text-sm text-slate-500 mb-4">
          Drop a PO (PDF). Typed PDFs are read directly; scanned/image PDFs are run through OCR. Recognized part numbers are auto-filled from the catalog. Review and edit below, then save.
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <label className="flex-1 block border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500 hover:bg-slate-50 cursor-pointer">
            <div className="text-3xl mb-2">⬆</div>
            <div>Drag PO here or click to browse</div>
            <input type="file" accept="application/pdf,.pdf,.txt" className="hidden" disabled={busy}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <div className="flex-1">
            <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              className="w-full border border-slate-300 rounded-md p-2 text-xs font-mono" placeholder="…or paste raw PO text here" />
            <button type="button" disabled={busy || !pasteText.trim()}
              onClick={async () => { const { guess } = await api.decodeText(pasteText); applyGuess(guess); }}
              className="mt-2 px-3 py-1.5 text-sm rounded-md border border-slate-300 disabled:opacity-50">
              Decode pasted text
            </button>
          </div>
        </div>
        {status && <div className="text-xs text-slate-600 mt-3">{status}</div>}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="font-semibold">Purchase Order details</div>
          <div className="ml-auto text-xs text-slate-500">
            {lines.length} lines · {fmtNum(totals.totalM2, 0)} m² · {fmtMoney(totals.poValue)} · {totals.skids || 0} skids
          </div>
        </div>

        {PO_SECTIONS.map((sec, si) => (
          <details key={sec.title} open={si === 0} className="border border-slate-200 rounded-md mb-3">
            <summary className="px-3 py-2 text-xs font-semibold text-slate-600 uppercase cursor-pointer bg-slate-50">{sec.title}</summary>
            <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-3">
              {sec.fields.map((fld) => (
                <div key={fld.k as string}>
                  <label className="text-[11px] text-slate-500 block mb-0.5">{fld.label}</label>
                  {renderField(fld.k as string, fld.type, fld.options)}
                </div>
              ))}
            </div>
          </details>
        ))}

        <div className="border border-slate-200 rounded-md p-3 mt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-500 uppercase">Line Items ({lines.length})</div>
            <button type="button" onClick={addLine} className="text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50">+ Add line</button>
          </div>
          <div className="text-[11px] text-slate-400 mb-2">Enter a Part # and tab out — the catalog fills color, size, prices and lead time, and computes m²/value.</div>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  {LINE_COLS.map((c) => <th key={c.k as string} className="text-left px-1 py-1 text-slate-500 font-medium whitespace-nowrap">{c.label}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((row, i) => (
                  <tr key={i}>
                    {LINE_COLS.map((c) => (
                      <td key={c.k as string} className="p-0.5">
                        <input
                          className={`border border-slate-200 rounded px-1 py-1 text-xs ${c.w || "w-24"}`}
                          value={row[c.k as string] ?? ""}
                          onChange={(e) => setLineVal(i, c.k as string, e.target.value)}
                          onBlur={() => (c.k === "partNo" ? applyProduct(i) : c.k === "sheets" ? recompute(i) : undefined)}
                        />
                      </td>
                    ))}
                    <td className="p-0.5">
                      <button type="button" onClick={() => removeLine(i)} className="text-red-500 hover:text-red-700 px-1" title="Remove line">×</button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={LINE_COLS.length + 1} className="text-center text-slate-400 py-4">No lines yet — upload a PO or click “+ Add line”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" disabled={saving} onClick={save} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save PO to tracker"}
          </button>
        </div>
      </div>
    </div>
  );
}
