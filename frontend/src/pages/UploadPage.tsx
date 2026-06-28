import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { useCompany } from "../CompanyContext";
import { PO_SECTIONS, LINE_COLS } from "../poFields";
import type { ReferenceData } from "../types";
import {
  clearUploadDraft,
  draftHasContent,
  loadUploadDraft,
  saveUploadDraft,
} from "../uploadDraft";
import { extractSynergyPdfPages } from "../synergyPdf";
import { fmtMoney, fmtNum, todayISO } from "../utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type LineForm = Record<string, string>;
type Product = ReferenceData["products"][number];
type DuplicatePo = { id: number; poNo: string; rev: number; status?: string | null };
type SynergyBatchItem = {
  page: number;
  guess: Record<string, unknown>;
  selected: boolean;
  saved: boolean;
  duplicate: DuplicatePo | null;
};

// Header fields computed automatically on upload — shown read-only to cut manual entry.
const AUTO_FIELDS = new Set(["siNo", "concat", "poValue", "totalM2", "skids", "status"]);

const toStr = (v: unknown) => (v == null ? "" : String(v));

function skidsFromSheets(sheets: number | null, sheetsPerSkid: number): number | null {
  if (sheets == null || sheetsPerSkid <= 0) return null;
  return Math.ceil(sheets / sheetsPerSkid);
}

function summarizeLines(lines: LineForm[]) {
  const poValue = lines.reduce((s, l) => s + (Number(l.extPo) || 0), 0);
  const totalM2 = lines.reduce((s, l) => s + (Number(l.qtyM2) || 0), 0);
  const skids = lines.reduce((s, l) => s + (Number(l.skids) || 0), 0);
  return { poValue, totalM2, skids };
}

function blankForm(): Record<string, string> {
  const f: Record<string, string> = {};
  for (const sec of PO_SECTIONS) for (const fld of sec.fields) if (fld.type !== "bool") f[fld.k as string] = "";
  f.status = "PO Received";
  f.rev = "0";
  f.poDate = todayISO();
  f.notes = "";
  return f;
}

function lineToForm(l: Record<string, unknown>): LineForm {
  const row: LineForm = {};
  for (const c of LINE_COLS) row[c.k as string] = toStr(l[c.k as string]);
  return row;
}

function guessToPayload(g: Record<string, unknown>, siNo: number, orderActive: boolean): Record<string, unknown> {
  const gLines = (g.lines as Record<string, unknown>[]) || [];
  const lines = gLines.map(lineToForm);
  const totals = summarizeLines(lines);
  return {
    siNo: String(siNo),
    poNo: toStr(g.poNo),
    rev: toStr(g.rev ?? 0),
    poDate: toStr(g.poDate) || todayISO(),
    stockingLocation: toStr(g.stockingLocation),
    portOfDest: toStr(g.portOfDest),
    concat: toStr(g.concat) || (toStr(g.poNo) ? `${toStr(g.poNo)}-${toStr(g.rev ?? 0)}` : ""),
    poValue: g.poValue != null ? toStr(g.poValue) : totals.poValue ? String(Math.round(totals.poValue * 100) / 100) : "",
    totalM2: g.totalM2 != null ? toStr(g.totalM2) : totals.totalM2 ? String(Math.round(totals.totalM2 * 1000) / 1000) : "",
    skids: g.skids != null ? toStr(g.skids) : totals.skids ? String(totals.skids) : "",
    status: "PO Received",
    active: orderActive,
    lines: lines.map((l, idx) => ({ ...l, lineNo: l.lineNo || String(idx + 1) })),
  };
}

export default function UploadPage() {
  const { canEdit } = useAuth();
  const { company } = useCompany();
  const navigate = useNavigate();
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [form, setForm] = useState<Record<string, string>>(blankForm);
  const [active, setActive] = useState(true);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [status, setStatus] = useState("");
  const [duplicate, setDuplicate] = useState<DuplicatePo | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [synergyBatch, setSynergyBatch] = useState<SynergyBatchItem[]>([]);
  const [activeBatchPage, setActiveBatchPage] = useState<number | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);

  // Restore draft or fresh SI No. when the page (or company) loads.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    setDraftRestored(false);

    const draft = loadUploadDraft(company);
    const hasDraft = draft && draftHasContent(draft);

    if (hasDraft && draft) {
      setForm(draft.form);
      setLines(draft.lines);
      setActive(draft.active);
      setPasteText(draft.pasteText);
      setStatus(draft.status || "Restored your unsaved upload draft.");
      setDraftRestored(true);
    } else {
      setForm(blankForm());
      setLines([]);
      setActive(true);
      setPasteText("");
      setStatus("");
    }
    setSynergyBatch([]);
    setActiveBatchPage(null);

    Promise.all([api.getReference(), api.getUploadMeta()]).then(([r, meta]) => {
      if (cancelled) return;
      setRef(r);
      if (!hasDraft) {
        setForm((f) => ({
          ...f,
          siNo: String(meta.nextSiNo),
          poDate: f.poDate || todayISO(),
        }));
      }
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [company]);

  // Persist draft while navigating away or refreshing (same browser tab).
  useEffect(() => {
    if (!hydrated) return;
    const snapshot = { form, lines, pasteText };
    if (!draftHasContent(snapshot)) {
      clearUploadDraft(company);
      return;
    }
    saveUploadDraft(company, {
      form,
      lines,
      active,
      pasteText,
      status,
      savedAt: new Date().toISOString(),
    });
  }, [form, lines, active, pasteText, status, company, hydrated]);

  const discardDraft = async () => {
    clearUploadDraft(company);
    setDraftRestored(false);
    setForm(blankForm());
    setLines([]);
    setActive(true);
    setPasteText("");
    setStatus("");
    setDuplicate(null);
    setSynergyBatch([]);
    setActiveBatchPage(null);
    const meta = await api.getUploadMeta();
    setForm({
      ...blankForm(),
      siNo: String(meta.nextSiNo),
      poDate: todayISO(),
    });
  };

  const sheetsPerSkid = ref?.config?.sheetsPerSkid ?? 200;

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of ref?.products ?? []) m.set(p.partNo, p);
    return m;
  }, [ref]);

  const totals = useMemo(() => summarizeLines(lines), [lines]);

  // Keep derived header fields in sync with PO #, rev, and line totals.
  useEffect(() => {
    const rev = Math.round(Number(form.rev || 0)) || 0;
    const poNo = form.poNo.trim();
    setForm((f) => ({
      ...f,
      concat: poNo ? `${poNo}-${rev}` : "",
      poValue: totals.poValue ? String(Math.round(totals.poValue * 100) / 100) : "",
      totalM2: totals.totalM2 ? String(Math.round(totals.totalM2 * 1000) / 1000) : "",
      skids: totals.skids ? String(totals.skids) : "",
      status: "PO Received",
    }));
  }, [form.poNo, form.rev, totals.poValue, totals.totalM2, totals.skids]);

  const setField = (k: string, v: string) => {
    if (k === "stockingLocation") {
      const loc = ref?.stockingLocations.find((l) => l.name === v);
      setForm((f) => ({ ...f, stockingLocation: v, portOfDest: loc?.arrivalPort ?? f.portOfDest }));
      return;
    }
    setForm((f) => ({ ...f, [k]: v }));
  };

  const checkDuplicate = useCallback(async (poNo: string, revRaw: string) => {
    const trimmed = poNo.trim();
    if (!trimmed) {
      setDuplicate(null);
      return;
    }
    const rev = Math.round(Number(revRaw || 0)) || 0;
    try {
      const { exists, po } = await api.checkOrderExists(trimmed, rev);
      setDuplicate(exists && po ? po : null);
    } catch {
      setDuplicate(null);
    }
  }, []);

  useEffect(() => {
    void checkDuplicate(form.poNo, form.rev ?? "0");
  }, [form.poNo, form.rev, checkDuplicate]);

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
    const skids = skidsFromSheets(sheets, sheetsPerSkid);
    return {
      ...row,
      qtyM2: qtyM2 != null ? String(Math.round(qtyM2 * 1000) / 1000) : row.qtyM2,
      qtyMsf: qtyMsf != null ? String(Math.round(qtyMsf * 1000) / 1000) : row.qtyMsf,
      extPo: extPo != null ? String(Math.round(extPo * 100) / 100) : row.extPo,
      skids: skids != null ? String(skids) : row.skids,
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

  const applyGuess = (g: Record<string, unknown>, batchPage?: number) => {
    const gLines = (g.lines as Record<string, unknown>[]) || [];
    const computed = summarizeLines(gLines.map(lineToForm));
    setForm((f) => ({
      ...f,
      poNo: toStr(g.poNo) || f.poNo,
      rev: g.rev != null ? toStr(g.rev) : f.rev,
      poDate: toStr(g.poDate) || f.poDate || todayISO(),
      stockingLocation: toStr(g.stockingLocation) || f.stockingLocation,
      portOfDest: toStr(g.portOfDest) || f.portOfDest,
      concat: toStr(g.concat) || f.concat,
      poValue: g.poValue != null ? toStr(g.poValue) : (computed.poValue ? String(computed.poValue) : f.poValue),
      totalM2: g.totalM2 != null ? toStr(g.totalM2) : (computed.totalM2 ? String(computed.totalM2) : f.totalM2),
      skids: g.skids != null ? toStr(g.skids) : (computed.skids ? String(computed.skids) : f.skids),
      status: "PO Received",
    }));
    setLines(gLines.map(lineToForm));
    if (batchPage != null) setActiveBatchPage(batchPage);
    const matched = Number(g.matchedCount) || 0;
    const pageNote = batchPage != null ? ` (page ${batchPage})` : "";
    setStatus(
      `Decoded ${gLines.length} line(s)${matched ? `, ${matched} matched to catalog` : ""}${pageNote}. Review below.`,
    );
  };

  const checkBatchDuplicates = async (items: SynergyBatchItem[]): Promise<SynergyBatchItem[]> =>
    Promise.all(
      items.map(async (item) => {
        const poNo = toStr(item.guess.poNo).trim();
        if (!poNo) return { ...item, duplicate: null };
        try {
          const rev = Math.round(Number(item.guess.rev ?? 0)) || 0;
          const { exists, po } = await api.checkOrderExists(poNo, rev);
          return { ...item, duplicate: exists && po ? po : null };
        } catch {
          return { ...item, duplicate: null };
        }
      }),
    );

  const loadSynergyBatch = async (pages: string[], usedOcr: boolean) => {
    const { pos } = await api.decodeSynergyPages(pages);
    const items: SynergyBatchItem[] = pos.map((guess, i) => ({
      page: Number(guess.page) || i + 1,
      guess,
      selected: true,
      saved: false,
      duplicate: null,
    }));
    const withDupes = await checkBatchDuplicates(items);
    setSynergyBatch(withDupes);
    const first = withDupes.find((b) => !b.duplicate) ?? withDupes[0];
    if (first) {
      const meta = await api.getUploadMeta();
      setForm((f) => ({ ...f, siNo: String(meta.nextSiNo) }));
      applyGuess(first.guess, first.page);
    }
    const matched = withDupes.reduce((s, b) => s + (Number(b.guess.matchedCount) || 0), 0);
    const dupes = withDupes.filter((b) => b.duplicate).length;
    setStatus(
      `${usedOcr ? "OCR + decode" : "Decode"}: ${withDupes.length} PO(s) from ${pages.length} page(s), ${matched} catalog match(es)${dupes ? `, ${dupes} already in tracker` : ""}.`,
    );
  };

  const loadBatchItem = (item: SynergyBatchItem) => {
    if (activeBatchPage != null && activeBatchPage !== item.page) {
      setSynergyBatch(mergeEditorIntoBatch(synergyBatch));
    }
    applyGuess(item.guess, item.page);
  };

  const mergeEditorIntoBatch = (batch: SynergyBatchItem[]): SynergyBatchItem[] => {
    if (activeBatchPage == null) return batch;
    return batch.map((item) =>
      item.page === activeBatchPage
        ? {
            ...item,
            guess: {
              ...item.guess,
              poNo: form.poNo,
              rev: Number(form.rev || 0),
              poDate: form.poDate,
              stockingLocation: form.stockingLocation,
              portOfDest: form.portOfDest,
              concat: form.concat,
              poValue: form.poValue ? Number(form.poValue) : null,
              totalM2: form.totalM2 ? Number(form.totalM2) : null,
              skids: form.skids ? Number(form.skids) : null,
              lines: lines.map((l) => ({ ...l })),
              matchedCount: lines.filter((l) => l.partNo?.trim()).length,
            },
          }
        : item,
    );
  };

  const saveSelectedBatch = async () => {
    const batch = mergeEditorIntoBatch(synergyBatch);
    setSynergyBatch(batch);
    const pending = batch.filter((b) => b.selected && !b.saved && !b.duplicate);
    if (!pending.length) {
      alert("No POs selected to save (or all are duplicates/already saved).");
      return;
    }
    setBatchSaving(true);
    try {
      let siNo = Number(form.siNo) || (await api.getUploadMeta()).nextSiNo;
      const savedPages = new Set<number>();
      for (const item of pending) {
        const payload = guessToPayload(item.guess, siNo, active);
        await api.createOrder(payload);
        savedPages.add(item.page);
        siNo += 1;
      }
      const updated = batch.map((b) => (savedPages.has(b.page) ? { ...b, saved: true, selected: false } : b));
      setSynergyBatch(updated);
      setStatus(`Saved ${savedPages.size} PO(s) to the tracker.`);
      if (savedPages.size === batch.length) {
        clearUploadDraft(company);
        navigate("/orders");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save batch");
    } finally {
      setBatchSaving(false);
    }
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
    setSynergyBatch([]);
    setActiveBatchPage(null);
    try {
      if (company === "SYNERGY" && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        const { pages, usedOcr } = await extractSynergyPdfPages(file, setStatus);
        if (!pages.some((p) => p.trim())) {
          setStatus("Could not extract any text from the PDF. Enter POs manually below.");
          return;
        }
        await loadSynergyBatch(pages, usedOcr);
        return;
      }

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
    if (duplicate) {
      alert(`PO ${duplicate.poNo}${duplicate.rev ? ` (rev ${duplicate.rev})` : ""} already exists. Open it in Order Summary to update it.`);
      return;
    }
    setSaving(true);
    try {
      if (activeBatchPage != null) setSynergyBatch(mergeEditorIntoBatch(synergyBatch));
      const payload: Record<string, unknown> = { ...form, active };
      if (!form.poValue) payload.poValue = totals.poValue || null;
      if (!form.totalM2) payload.totalM2 = totals.totalM2 || null;
      if (!form.skids) payload.skids = totals.skids || null;
      payload.lines = lines.map((l, idx) => ({ ...l, lineNo: l.lineNo || String(idx + 1) }));
      await api.createOrder(payload);
      if (activeBatchPage != null) {
        setSynergyBatch((prev) =>
          prev.map((b) => (b.page === activeBatchPage ? { ...b, saved: true, selected: false } : b)),
        );
      }
      clearUploadDraft(company);
      const remaining = synergyBatch.filter((b) => !b.saved && b.page !== activeBatchPage).length;
      if (synergyBatch.length && remaining > 0) {
        setStatus(`PO saved. ${remaining} more in batch — review and save the rest.`);
        setSaving(false);
        return;
      }
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
        <div className="text-lg font-semibold mb-1">Maintainer access required</div>
        <div className="text-sm text-slate-500">Only Maintainers can upload and create new POs.</div>
      </div>
    );
  }

  const renderField = (k: string, type?: string, options?: string[]) => {
    const readOnly = AUTO_FIELDS.has(k);
    const readOnlyCls = "w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm bg-slate-50 text-slate-600";
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
        <input
          type="text"
          readOnly
          value={form.status}
          className={readOnlyCls}
          title="New uploads always start at PO Received"
        />
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
    if (readOnly) {
      return (
        <input
          type="text"
          readOnly
          value={form[k] ?? ""}
          className={readOnlyCls}
          title="Auto-filled"
        />
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
          {company === "SYNERGY" ? (
            <>
              Drop a Cynergy ORDER FORM PDF (scanned/handwritten). Each page is OCR’d using fixed form zones
              (date, PO #, description column, quantity column) for better accuracy. Review and save each PO.
            </>
          ) : (
            <>
              Drop a PO (PDF). Typed PDFs are read directly; scanned/image PDFs are run through OCR. Recognized part numbers are auto-filled from the catalog — SI No., totals, skids, and concat are computed for you. Your work is kept as a draft if you switch pages before saving.
            </>
          )}
        </div>
        {draftRestored && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 flex flex-wrap items-center gap-2">
            <span>Unsaved upload draft restored — you can continue editing.</span>
            <button
              type="button"
              onClick={() => void discardDraft()}
              className="text-xs px-2 py-1 rounded border border-blue-300 hover:bg-blue-100"
            >
              Discard draft
            </button>
          </div>
        )}
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
              onClick={async () => {
                if (company === "SYNERGY") {
                  const { pos } = await api.decodeSynergyPages([pasteText]);
                  if (pos.length === 1) applyGuess(pos[0]);
                  else await loadSynergyBatch([pasteText], false);
                } else {
                  const { guess } = await api.decodeText(pasteText);
                  applyGuess(guess);
                }
              }}
              className="mt-2 px-3 py-1.5 text-sm rounded-md border border-slate-300 disabled:opacity-50">
              Decode pasted text
            </button>
          </div>
        </div>
        {status && !duplicate && <div className="text-xs text-slate-600 mt-3">{status}</div>}
        {synergyBatch.length > 0 && (
          <div className="mt-4 border border-teal-200 rounded-lg overflow-hidden">
            <div className="bg-teal-50 px-3 py-2 flex flex-wrap items-center gap-2 border-b border-teal-200">
              <span className="text-sm font-medium text-teal-900">
                Batch: {synergyBatch.length} PO(s) from PDF
              </span>
              <button
                type="button"
                disabled={batchSaving}
                onClick={() => setSynergyBatch((prev) => prev.map((b) => ({ ...b, selected: !b.saved && !b.duplicate })))}
                className="text-xs px-2 py-1 rounded border border-teal-300 hover:bg-teal-100"
              >
                Select all saveable
              </button>
              <button
                type="button"
                disabled={batchSaving}
                onClick={() => void saveSelectedBatch()}
                className="ml-auto text-xs px-3 py-1.5 rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {batchSaving ? "Saving…" : "Save selected POs"}
              </button>
            </div>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left w-8"></th>
                    <th className="px-2 py-1.5 text-left">Page</th>
                    <th className="px-2 py-1.5 text-left">PO #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-right">Lines</th>
                    <th className="px-2 py-1.5 text-right">Matched</th>
                    <th className="px-2 py-1.5 text-right">m²</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {synergyBatch.map((item) => {
                    const g = item.guess;
                    const lineCount = ((g.lines as unknown[]) || []).length;
                    const matched = Number(g.matchedCount) || 0;
                    const isActive = activeBatchPage === item.page;
                    let rowStatus = "Ready";
                    if (item.saved) rowStatus = "Saved";
                    else if (item.duplicate) rowStatus = "Duplicate";
                    else if (!toStr(g.poNo).trim()) rowStatus = "Missing PO #";
                    return (
                      <tr
                        key={item.page}
                        className={`border-t border-slate-100 ${isActive ? "bg-teal-50/80" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={item.saved || !!item.duplicate}
                            onChange={(e) =>
                              setSynergyBatch((prev) =>
                                prev.map((b) => (b.page === item.page ? { ...b, selected: e.target.checked } : b)),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono">{item.page}</td>
                        <td className="px-2 py-1.5 font-mono">{toStr(g.poNo) || "—"}</td>
                        <td className="px-2 py-1.5">{toStr(g.poDate) || "—"}</td>
                        <td className="px-2 py-1.5 text-right">{lineCount}</td>
                        <td className="px-2 py-1.5 text-right">{matched}/{lineCount}</td>
                        <td className="px-2 py-1.5 text-right">{fmtNum(Number(g.totalM2) || 0, 0)}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              rowStatus === "Saved"
                                ? "text-emerald-700"
                                : rowStatus === "Duplicate"
                                  ? "text-amber-700"
                                  : rowStatus === "Missing PO #"
                                    ? "text-red-600"
                                    : "text-slate-600"
                            }
                          >
                            {rowStatus}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => loadBatchItem(item)}
                            className="text-teal-700 hover:underline"
                          >
                            {isActive ? "Editing" : "Review"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {duplicate && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="font-medium">This PO already exists in the tracker.</div>
            <div className="mt-1">
              PO <span className="font-mono font-semibold">{duplicate.poNo}</span>
              {duplicate.rev ? <span className="text-amber-800"> rev {duplicate.rev}</span> : null}
              {duplicate.status ? <span className="text-amber-800"> · {duplicate.status}</span> : null}
            </div>
            <div className="mt-2 text-xs text-amber-800">
              Upload was decoded, but saving is blocked to prevent a duplicate.{" "}
              <Link to="/orders" className="font-medium underline hover:text-amber-950">
                Open Order Summary
              </Link>{" "}
              to view or edit the existing PO.
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="font-semibold">Purchase Order details</div>
          <div className="ml-auto text-xs text-slate-500 text-right">
            <div>SI #{form.siNo || "—"} · {form.concat || "—"}</div>
            <div>{lines.length} lines · {fmtNum(totals.totalM2, 0)} m² · {fmtMoney(totals.poValue)} · {totals.skids || 0} skids</div>
          </div>
        </div>

        {PO_SECTIONS.map((sec, si) => (
          <details key={sec.title} open={si === 0} className="border border-slate-200 rounded-md mb-3">
            <summary className="px-3 py-2 text-xs font-semibold text-slate-600 uppercase cursor-pointer bg-slate-50">{sec.title}</summary>
            <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-3">
              {sec.fields.map((fld) => (
                <div key={fld.k as string}>
                  <label className="text-[11px] text-slate-500 block mb-0.5">
                    {fld.label}
                    {AUTO_FIELDS.has(fld.k as string) ? <span className="text-slate-400"> (auto)</span> : null}
                  </label>
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
          {(draftHasContent({ form, lines, pasteText }) || draftRestored) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void discardDraft()}
              className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Discard draft
            </button>
          )}
          <button type="button" disabled={saving || batchSaving || !!duplicate} onClick={save} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {duplicate ? "PO already exists" : saving ? "Saving…" : synergyBatch.length ? "Save current PO" : "Save PO to tracker"}
          </button>
        </div>
      </div>
    </div>
  );
}
