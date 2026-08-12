import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { useCompany } from "../CompanyContext";
import { currentProductPrice } from "../productPricing";
import type { Company } from "../companies";
import type {
  PriceListVersionSummary,
  PricingParseResult,
  PricingPreviewRow,
  ReferenceData,
} from "../types";
import { fmtDim, fmtPrice, todayISO } from "../utils";

type CatalogVals = {
  partNo: string;
  custPartNo?: string | null;
  vendorPartNo?: string | null;
  itemType?: string | null;
  surface?: string | null;
  construction?: string | null;
  thickness?: string | null;
  widthIn?: number | null;
  widthMm?: number | null;
  lengthIn?: number | null;
  lengthMm?: number | null;
  description?: string | null;
  colorName?: string | null;
  vendorColorCode?: string | null;
  shortColorName?: string | null;
  pricePerSqft?: number | null;
  pricePerM2?: number | null;
  pricePerMsq?: number | null;
  pricePerSheet?: number | null;
};

type Tab = "live" | "previous" | "upload";

/**
 * UFP keys its catalogue on short product codes; Cynergy keys it on the full item
 * description (`2MM ACM 49" x 96" ASC 0069 GLOSSY WHITE`), because most of its items
 * have no product code. Either way, footer notes from the sheet are not products.
 */
function isCatalogPartNo(partNo: string, company: Company) {
  const t = partNo.trim();
  if (!t) return false;
  if (/^note\b/i.test(t)) return false;
  if (/cif|inland transit|ocean transit|accordingly/i.test(t)) return false;
  if (company === "SYNERGY" && /^\d+(\.\d+)?\s*MM\b/i.test(t)) return t.length <= 120;
  if (t.length > 32) return false;
  if (t.split(/\s+/).length > 4) return false;
  return true;
}

function changeBadge(change: PricingPreviewRow["change"]) {
  if (change === "new") return "bg-sky-50 text-sky-700";
  if (change === "changed") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function specLine(p: CatalogVals) {
  return [p.itemType, p.surface, p.construction, p.thickness, p.description].filter(Boolean).join(" · ");
}

function sizeBits(p: CatalogVals) {
  const inch = [fmtDim(p.widthIn), fmtDim(p.lengthIn)].filter(Boolean).join(" × ");
  const mm = [fmtDim(p.widthMm), fmtDim(p.lengthMm)].filter(Boolean).join(" × ");
  return { inch: inch ? `${inch} in` : "", mm: mm ? `${mm} mm` : "" };
}

const LIST_COL_COUNT = 8;

/** Cynergy's key column holds a full item description, so it needs more room. */
function catalogColgroup(company: Company) {
  const isCynergy = company === "SYNERGY";
  return (
    <colgroup>
      <col style={{ width: isCynergy ? "28%" : "16%" }} />
      <col style={{ width: isCynergy ? "14%" : "18%" }} />
      <col style={{ width: isCynergy ? "12%" : "20%" }} />
      <col style={{ width: isCynergy ? "14%" : "14%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "8%" }} />
      <col style={{ width: "8%" }} />
    </colgroup>
  );
}

function catalogThs(company: Company) {
  return [
    <th key="product">{company === "SYNERGY" ? "Full Item Description" : "Product"}</th>,
    <th key="color">Color</th>,
    <th key="specs">Specs</th>,
    <th key="size">Size</th>,
    <th key="sqft" className="num">
      $/sqft
    </th>,
    <th key="m2" className="num">
      $/m²
    </th>,
    <th key="msq" className="num">
      $/MSQ
    </th>,
    <th key="sheet" className="num">
      $/sheet
    </th>,
  ];
}

/** Cynergy's product code is optional metadata; UFP's is the key. */
function productCodes(item: CatalogVals) {
  return [item.vendorPartNo, item.custPartNo].filter(Boolean).join(" · ");
}

function catalogTds(item: CatalogVals, lead?: ReactNode) {
  const size = sizeBits(item);
  const codes = productCodes(item);
  return [
    <td key="product">
      <div className="flex items-start gap-1.5">
        {lead}
        <div className="min-w-0">
          <div className="font-mono font-medium text-slate-900">{item.partNo}</div>
          {codes ? <div className="font-mono text-[11px] text-slate-500">{codes}</div> : null}
        </div>
      </div>
    </td>,
    <td key="color">
      <div>{item.colorName || "—"}</div>
      {item.vendorColorCode ? <div className="font-mono text-[11px] text-slate-500">{item.vendorColorCode}</div> : null}
      {item.shortColorName ? <div className="text-[11px] text-slate-500">{item.shortColorName}</div> : null}
    </td>,
    <td key="specs" className="text-slate-600">
      {specLine(item) || "—"}
    </td>,
    <td key="size" className="text-slate-600">
      {size.inch ? <div>{size.inch}</div> : null}
      {size.mm ? <div>{size.mm}</div> : null}
      {!size.inch && !size.mm ? "—" : null}
    </td>,
    <td key="sqft" className="num">
      {fmtPrice(item.pricePerSqft, 2)}
    </td>,
    <td key="m2" className="num">
      {fmtPrice(item.pricePerM2, 2)}
    </td>,
    <td key="msq" className="num">
      {fmtPrice(item.pricePerMsq, 2)}
    </td>,
    <td key="sheet" className="num">
      {fmtPrice(item.pricePerSheet, 4)}
    </td>,
  ];
}

type HistoryLine = {
  id: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  pricePerSqft: number | null;
  pricePerM2: number | null;
  pricePerMsq: number | null;
  pricePerSheet: number | null;
};

function PriceHistory({ history }: { history: HistoryLine[] }) {
  if (!history.length) return <div className="text-[11px] text-slate-500">No dated versions yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-slate-400">
            <th className="text-left font-medium py-1 pr-3 whitespace-nowrap">Effective</th>
            <th className="text-right font-medium py-1 px-2 whitespace-nowrap">$/sqft</th>
            <th className="text-right font-medium py-1 px-2 whitespace-nowrap">$/m²</th>
            <th className="text-right font-medium py-1 px-2 whitespace-nowrap">$/MSQ</th>
            <th className="text-right font-medium py-1 px-2 whitespace-nowrap">$/sheet</th>
            <th className="text-left font-medium py-1 pl-2 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-t border-slate-200/80 text-slate-700">
              <td className="py-1.5 pr-3 font-mono text-slate-600 whitespace-nowrap">
                {h.effectiveFrom} → {h.effectiveTo || "open"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtPrice(h.pricePerSqft, 2)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtPrice(h.pricePerM2, 2)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtPrice(h.pricePerMsq, 2)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{fmtPrice(h.pricePerSheet, 4)}</td>
              <td className="py-1.5 pl-2 whitespace-nowrap">
                {!h.effectiveTo ? (
                  <span className="text-emerald-700 font-medium">current</span>
                ) : (
                  <span className="text-slate-400">past</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CatalogListItem({
  item,
  lead,
  history,
  open,
}: {
  item: CatalogVals;
  lead?: ReactNode;
  history?: HistoryLine[];
  open?: boolean;
}) {
  const size = sizeBits(item);
  const specs = specLine(item);
  const codes = productCodes(item);
  return (
    <div className="px-3 py-3 border-b border-slate-100 last:border-b-0">
      <div className="flex items-start gap-2 min-w-0">
        {lead}
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold text-slate-900 break-words">{item.partNo}</div>
          {codes ? <div className="font-mono text-[11px] text-slate-500">{codes}</div> : null}
        </div>
      </div>
      <div className="mt-1 text-sm text-slate-800">
        {item.colorName || "—"}
        {item.vendorColorCode ? <span className="ml-2 font-mono text-[11px] text-slate-500">{item.vendorColorCode}</span> : null}
      </div>
      {specs || size.inch || size.mm ? (
        <div className="mt-0.5 text-xs text-slate-500">
          {[specs, size.inch, size.mm].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-slate-400">$/sqft</span>
          <span className="tabular-nums font-medium">{fmtPrice(item.pricePerSqft, 2) || "—"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-400">$/m²</span>
          <span className="tabular-nums font-medium">{fmtPrice(item.pricePerM2, 2) || "—"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-400">$/MSQ</span>
          <span className="tabular-nums font-medium">{fmtPrice(item.pricePerMsq, 2) || "—"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-400">$/sheet</span>
          <span className="tabular-nums font-medium">{fmtPrice(item.pricePerSheet, 4) || "—"}</span>
        </div>
      </div>
      {open && history ? (
        <div className="mt-2 rounded-md bg-slate-50 p-2">
          <PriceHistory history={history} />
        </div>
      ) : null}
    </div>
  );
}

export default function PricingPage() {
  const { canEdit } = useAuth();
  const { company } = useCompany();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("live");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedPastId, setSelectedPastId] = useState<number | null>(null);
  const [pastDetail, setPastDetail] = useState<Awaited<ReturnType<typeof api.getPriceList>>["version"] | null>(null);
  const [pastLoading, setPastLoading] = useState(false);

  const [parseResult, setParseResult] = useState<PricingParseResult | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [previewRows, setPreviewRows] = useState<PricingPreviewRow[]>([]);
  const [applyMode, setApplyMode] = useState<"live" | "historical">("live");
  const [applyLabel, setApplyLabel] = useState("");
  const [applyFrom, setApplyFrom] = useState(todayISO());
  const [applyTo, setApplyTo] = useState("");
  const [applyNote, setApplyNote] = useState("");
  const [parsing, setParsing] = useState(false);

  const load = async () => {
    const r = await api.getReference();
    setRef(r);
    setLoading(false);
  };
  useEffect(() => {
    setLoading(true);
    setRef(null);
    setSelectedPastId(null);
    setPastDetail(null);
    setExpanded(null);
    setParseResult(null);
    setPreviewRows([]);
    load().catch((e) => alert(e instanceof Error ? e.message : "Load failed"));
  }, [company]);

  const writable = canEdit();
  const today = todayISO();
  const priceLists = ref?.priceLists ?? [];
  const liveList = priceLists.find((v) => v.status === "LIVE") ?? null;
  const pastLists = priceLists.filter((v) => v.status === "PAST");

  useEffect(() => {
    if (tab !== "previous") return;
    if (selectedPastId == null && pastLists[0]) setSelectedPastId(pastLists[0].id);
  }, [tab, selectedPastId, pastLists]);

  useEffect(() => {
    if (tab !== "previous" || selectedPastId == null) {
      setPastDetail(null);
      return;
    }
    setPastLoading(true);
    api
      .getPriceList(selectedPastId)
      .then((r) => setPastDetail(r.version))
      .catch((e) => alert(e instanceof Error ? e.message : "Failed to load price list"))
      .finally(() => setPastLoading(false));
  }, [tab, selectedPastId]);

  const rows = useMemo(() => {
    const products = (ref?.products ?? []).filter((p) => isCatalogPartNo(p.partNo, company));
    if (!q) return products;
    const s = q.toLowerCase();
    return products.filter((p) =>
      [p.partNo, p.custPartNo, p.colorName, p.vendorColorCode, p.description].some((v) =>
        (v ?? "").toLowerCase().includes(s),
      ),
    );
  }, [ref, q, company]);

  const pastRows = useMemo(() => {
    const list = (pastDetail?.prices ?? []).filter((line) => isCatalogPartNo(line.product.partNo, company));
    if (!q) return list;
    const s = q.toLowerCase();
    return list.filter((line) =>
      [line.product.partNo, line.product.custPartNo, line.product.colorName, line.product.vendorColorCode, line.product.description].some(
        (v) => (v ?? "").toLowerCase().includes(s),
      ),
    );
  }, [pastDetail, q, company]);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setParsing(true);
    try {
      const result = await api.parsePricingExcel(file);
      setParseResult(result);
      const first = result.sheets[0];
      if (!first) {
        alert("No pricing sheets found. Sheet names should include “Pricing”.");
        return;
      }
      selectSheet(result, first.name);
      setTab("upload");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const selectSheet = (result: PricingParseResult, name: string) => {
    const sheet = result.sheets.find((s) => s.name === name);
    if (!sheet) return;
    setSheetName(name);
    setPreviewRows(sheet.rows.map((r) => ({ ...r })));
    const looksOld = /old|end/i.test(name);
    setApplyMode(looksOld ? "historical" : "live");
    setApplyLabel(name);
    setApplyFrom(sheet.guessedEffectiveFrom || todayISO());
    setApplyTo(sheet.guessedEffectiveTo || "");
    setApplyNote("");
  };

  const updatePreviewCell = (idx: number, key: keyof PricingPreviewRow, value: string) => {
    setPreviewRows((prev) => {
      const next = [...prev];
      const row = { ...next[idx] };
      if (
        key === "partNo" ||
        key === "custPartNo" ||
        key === "vendorPartNo" ||
        key === "colorName" ||
        key === "vendorColorCode" ||
        key === "shortColorName" ||
        key === "description"
      ) {
        (row as Record<string, unknown>)[key] = value;
      } else {
        (row as Record<string, unknown>)[key] = value === "" ? null : Number(value);
      }
      next[idx] = row;
      return next;
    });
  };

  const removePreviewRow = (idx: number) => {
    setPreviewRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const applyPreview = async () => {
    if (!previewRows.length) {
      alert("No rows to apply");
      return;
    }
    if (!applyLabel.trim() || !applyFrom.trim()) {
      alert("Label and effective from date are required");
      return;
    }
    if (applyMode === "historical" && !applyTo.trim()) {
      alert("Effective to date is required for historical (old) price lists");
      return;
    }
    const msg =
      applyMode === "live"
        ? `Apply ${previewRows.length} rows as the new LIVE pricing table from ${applyFrom}?\n\nAll listed items get new effective dates (even unchanged prices). Existing PO/invoice line amounts stay stamped and will not change.`
        : `Import ${previewRows.length} rows as PAST pricing (${applyFrom} → ${applyTo})?\n\nCurrent live prices are not changed. Existing invoices keep their stamped rates.`;
    if (!confirm(msg)) return;

    setSaving(true);
    try {
      const result = await api.applyPriceList({
        mode: applyMode,
        label: applyLabel.trim(),
        effectiveFrom: applyFrom,
        effectiveTo: applyMode === "historical" ? applyTo : null,
        sourceSheet: sheetName || null,
        sourceFile: parseResult?.fileName || null,
        note: applyNote || null,
        rows: previewRows.map((r) => ({
          partNo: r.partNo,
          custPartNo: r.custPartNo,
          vendorPartNo: r.vendorPartNo,
          itemType: r.itemType,
          surface: r.surface,
          construction: r.construction,
          thickness: r.thickness,
          widthIn: r.widthIn,
          widthMm: r.widthMm,
          lengthIn: r.lengthIn,
          lengthMm: r.lengthMm,
          description: r.description,
          colorName: r.colorName,
          vendorColorCode: r.vendorColorCode,
          shortColorName: r.shortColorName,
          pricePerSqft: r.pricePerSqft,
          pricePerM2: r.pricePerM2,
          pricePerMsq: r.pricePerMsq,
          pricePerSheet: r.pricePerSheet,
        })),
      });
      await load();
      setParseResult(null);
      setPreviewRows([]);
      setTab(applyMode === "live" ? "live" : "previous");
      if (applyMode === "historical") setSelectedPastId(result.version.id);
      alert(
        `Applied “${result.version.label}”: ${result.stats.total} rows (${result.stats.created} new products, ${result.stats.updated} price changes, ${result.stats.unchanged} same price with new dates).`,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !ref) return <div className="text-slate-500">Loading…</div>;

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md border ${
        tab === id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="font-semibold text-slate-900">Pricing Table</div>
            <div className="flex gap-1.5 flex-wrap">
              {tabBtn("live", "Live")}
              {tabBtn("previous", "Previous")}
              {writable && tabBtn("upload", "Upload Excel")}
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto min-w-0">
            {(tab === "live" || tab === "previous") && (
              <input
                placeholder="Search part #, color, code…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-full sm:w-64 min-w-0"
              />
            )}
            <span className="text-sm text-slate-500 shrink-0">
              {tab === "live" && `${rows.length} products`}
              {tab === "previous" && (pastDetail ? `${pastRows.length} products` : `${pastLists.length} past tables`)}
              {tab === "upload" && (previewRows.length ? `${previewRows.length} preview rows` : "Choose a workbook")}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {tab === "previous" && (
          <div className="px-3 py-3 border-b border-slate-100 flex flex-wrap items-end gap-3">
            <div className="w-full min-w-0 flex-1">
              <label className="text-[11px] text-slate-500 block mb-0.5">Price list</label>
              <select
                value={selectedPastId ?? ""}
                onChange={(e) => setSelectedPastId(e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
              >
                {pastLists.length === 0 && <option value="">No previous lists</option>}
                {pastLists.map((v: PriceListVersionSummary) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.effectiveTo ? ` · ${v.effectiveFrom} → ${v.effectiveTo}` : ` · from ${v.effectiveFrom}`}
                    {v._count ? ` · ${v._count.prices}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {liveList && (
              <button type="button" onClick={() => setTab("live")} className="text-sm text-indigo-600 hover:underline pb-1.5">
                View live list
              </button>
            )}
          </div>
        )}
      </div>

      {tab === "live" && (
        <div className="mt-3 bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="xl:hidden">
            {rows.map((p) => {
              const cur = currentProductPrice(p, today);
              const history = [...(p.prices ?? [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
              const catalog: CatalogVals = {
                ...p,
                pricePerSqft: cur?.pricePerSqft ?? p.pricePerSqft,
                pricePerM2: cur?.pricePerM2 ?? p.pricePerM2,
                pricePerMsq: cur?.pricePerMsq ?? p.pricePerMsq,
                pricePerSheet: cur?.pricePerSheet ?? p.pricePerSheet,
              };
              const open = expanded === p.id;
              return (
                <CatalogListItem
                  key={p.id}
                  item={catalog}
                  history={history}
                  open={open}
                  lead={
                    <button
                      type="button"
                      title="Price history"
                      onClick={() => setExpanded(open ? null : p.id)}
                      className="text-slate-400 hover:text-indigo-600 shrink-0 leading-none mt-0.5"
                    >
                      {open ? "▾" : "▸"}
                    </button>
                  }
                />
              );
            })}
          </div>
          <div className="hidden xl:block">
            <table className="tbl pricing-list text-xs">
              {catalogColgroup(company)}
              <thead>
                <tr>{catalogThs(company)}</tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const cur = currentProductPrice(p, today);
                  const history = [...(p.prices ?? [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
                  const catalog: CatalogVals = {
                    ...p,
                    pricePerSqft: cur?.pricePerSqft ?? p.pricePerSqft,
                    pricePerM2: cur?.pricePerM2 ?? p.pricePerM2,
                    pricePerMsq: cur?.pricePerMsq ?? p.pricePerMsq,
                    pricePerSheet: cur?.pricePerSheet ?? p.pricePerSheet,
                  };
                  const open = expanded === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr>
                        {catalogTds(
                          catalog,
                          <button
                            type="button"
                            title="Price history"
                            onClick={() => setExpanded(open ? null : p.id)}
                            className="text-slate-400 hover:text-indigo-600 shrink-0 leading-none mt-0.5"
                          >
                            {open ? "▾" : "▸"}
                          </button>,
                        )}
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={LIST_COL_COUNT} className="bg-slate-50 text-[11px] text-slate-600">
                            <PriceHistory history={history} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "previous" && (
        <div className="mt-3 bg-white rounded-lg border border-slate-200 overflow-hidden">
          {pastLoading && <div className="p-4 text-slate-500 text-sm">Loading…</div>}
          {!pastLoading && pastLists.length === 0 && <div className="p-4 text-sm text-slate-500">No previous price lists yet.</div>}
          {!pastLoading && pastDetail && (
            <>
              <div className="xl:hidden">
                {pastRows.map((line) => (
                  <CatalogListItem
                    key={line.id}
                    item={{
                      ...line.product,
                      pricePerSqft: line.pricePerSqft,
                      pricePerM2: line.pricePerM2,
                      pricePerMsq: line.pricePerMsq,
                      pricePerSheet: line.pricePerSheet,
                    }}
                  />
                ))}
              </div>
              <div className="hidden xl:block">
                <table className="tbl pricing-list text-xs">
                  {catalogColgroup(company)}
                  <thead>
                    <tr>{catalogThs(company)}</tr>
                  </thead>
                  <tbody>
                    {pastRows.map((line) => (
                      <tr key={line.id}>
                        {catalogTds({
                          ...line.product,
                          pricePerSqft: line.pricePerSqft,
                          pricePerM2: line.pricePerM2,
                          pricePerMsq: line.pricePerMsq,
                          pricePerSheet: line.pricePerSheet,
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "upload" && writable && (
        <div className="mt-3 bg-white rounded-lg border border-slate-200 p-3 sm:p-4 space-y-4">
          {!parseResult && (
            <div className="border border-dashed border-slate-300 rounded-lg p-8 text-center">
              <div className="text-sm text-slate-700 mb-2">Choose an Order Tracker workbook</div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {parsing ? "Reading workbook…" : "Choose Excel file"}
              </button>
            </div>
          )}

          {parseResult && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-slate-500 block mb-0.5">Sheet</label>
                  <select
                    value={sheetName}
                    onChange={(e) => selectSheet(parseResult, e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    {parseResult.sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.summary.total})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-0.5">Apply as</label>
                  <select
                    value={applyMode}
                    onChange={(e) => setApplyMode(e.target.value as "live" | "historical")}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="live">New LIVE price list</option>
                    <option value="historical">Historical / old price list</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-0.5">Label</label>
                  <input
                    value={applyLabel}
                    onChange={(e) => setApplyLabel(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 block mb-0.5">Effective from</label>
                  <input
                    type="date"
                    value={applyFrom}
                    onChange={(e) => setApplyFrom(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
                {applyMode === "historical" && (
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-0.5">Effective to</label>
                    <input
                      type="date"
                      value={applyTo}
                      onChange={(e) => setApplyTo(e.target.value)}
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-slate-500 block mb-0.5">Note (optional)</label>
                  <input
                    value={applyNote}
                    onChange={(e) => setApplyNote(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  />
                </div>
              </div>

              <div className="text-xs text-slate-600 flex flex-wrap gap-2">
                <span>
                  File: <span className="font-medium">{parseResult.fileName}</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded ${changeBadge("new")}`}>
                  {previewRows.filter((r) => r.change === "new").length} new
                </span>
                <span className={`px-1.5 py-0.5 rounded ${changeBadge("changed")}`}>
                  {previewRows.filter((r) => r.change === "changed").length} changed
                </span>
                <span className={`px-1.5 py-0.5 rounded ${changeBadge("unchanged")}`}>
                  {previewRows.filter((r) => r.change === "unchanged").length} unchanged
                </span>
              </div>

              <div className="border border-slate-200 rounded-md overflow-hidden">
                <div className="xl:hidden divide-y divide-slate-100">
                  {previewRows.map((r, idx) => {
                    const size = sizeBits(r);
                    return (
                      <div key={`${r.partNo}-${idx}`} className={`p-3 space-y-2 ${r.change === "changed" ? "bg-amber-50/40" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${changeBadge(r.change)}`}>
                            {r.change}
                          </span>
                          <button type="button" onClick={() => removePreviewRow(idx)} className="text-[11px] text-red-600 hover:underline">
                            Remove
                          </button>
                        </div>
                        <input
                          value={r.partNo}
                          onChange={(e) => updatePreviewCell(idx, "partNo", e.target.value)}
                          className="w-full border border-slate-200 rounded px-2 py-1.5 font-mono text-sm"
                        />
                        {r.custPartNo ? <div className="font-mono text-[11px] text-slate-500">{r.custPartNo}</div> : null}
                        <input
                          value={r.colorName ?? ""}
                          onChange={(e) => updatePreviewCell(idx, "colorName", e.target.value)}
                          className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
                        />
                        {r.vendorColorCode ? <div className="font-mono text-[11px] text-slate-500">{r.vendorColorCode}</div> : null}
                        <div className="text-xs text-slate-500">
                          {[specLine(r), size.inch, size.mm].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[10px] text-slate-400">
                            $/sqft
                            <input
                              type="number"
                              step="0.01"
                              value={r.pricePerSqft ?? ""}
                              onChange={(e) => updatePreviewCell(idx, "pricePerSqft", e.target.value)}
                              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-right tabular-nums"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            $/m²
                            <input
                              type="number"
                              step="0.01"
                              value={r.pricePerM2 ?? ""}
                              onChange={(e) => updatePreviewCell(idx, "pricePerM2", e.target.value)}
                              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-right tabular-nums"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            $/MSQ
                            <input
                              type="number"
                              step="0.01"
                              value={r.pricePerMsq ?? ""}
                              onChange={(e) => updatePreviewCell(idx, "pricePerMsq", e.target.value)}
                              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-right tabular-nums"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            $/sheet
                            <input
                              type="number"
                              step="0.0001"
                              value={r.pricePerSheet ?? ""}
                              onChange={(e) => updatePreviewCell(idx, "pricePerSheet", e.target.value)}
                              className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1.5 text-sm text-right tabular-nums"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden xl:block overflow-x-auto">
                  <table className="tbl pricing-list text-xs">
                    <thead>
                      <tr>
                        <th>Change</th>
                        {catalogThs(company)}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, idx) => {
                        const size = sizeBits(r);
                        return (
                          <tr key={`${r.partNo}-${idx}`} className={r.change === "changed" ? "bg-amber-50/40" : undefined}>
                            <td>
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${changeBadge(r.change)}`}>
                                {r.change}
                              </span>
                            </td>
                            <td>
                              <input
                                value={r.partNo}
                                onChange={(e) => updatePreviewCell(idx, "partNo", e.target.value)}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 font-mono"
                              />
                              {r.custPartNo ? <div className="font-mono text-[11px] text-slate-500 mt-0.5">{r.custPartNo}</div> : null}
                            </td>
                            <td>
                              <input
                                value={r.colorName ?? ""}
                                onChange={(e) => updatePreviewCell(idx, "colorName", e.target.value)}
                                className="w-full border border-slate-200 rounded px-1.5 py-1"
                              />
                              {r.vendorColorCode ? (
                                <div className="font-mono text-[11px] text-slate-500 mt-0.5">{r.vendorColorCode}</div>
                              ) : null}
                            </td>
                            <td className="text-slate-600">{specLine(r) || "—"}</td>
                            <td className="text-slate-600">
                              {size.inch ? <div>{size.inch}</div> : null}
                              {size.mm ? <div>{size.mm}</div> : null}
                              {!size.inch && !size.mm ? "—" : null}
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                value={r.pricePerSqft ?? ""}
                                onChange={(e) => updatePreviewCell(idx, "pricePerSqft", e.target.value)}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 text-right tabular-nums"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                value={r.pricePerM2 ?? ""}
                                onChange={(e) => updatePreviewCell(idx, "pricePerM2", e.target.value)}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 text-right tabular-nums"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                value={r.pricePerMsq ?? ""}
                                onChange={(e) => updatePreviewCell(idx, "pricePerMsq", e.target.value)}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 text-right tabular-nums"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.0001"
                                value={r.pricePerSheet ?? ""}
                                onChange={(e) => updatePreviewCell(idx, "pricePerSheet", e.target.value)}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 text-right tabular-nums"
                              />
                            </td>
                            <td>
                              <button type="button" onClick={() => removePreviewRow(idx)} className="text-red-600 hover:underline">
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setParseResult(null);
                    setPreviewRows([]);
                  }}
                  className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !previewRows.length}
                  onClick={applyPreview}
                  className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm bg-emerald-600 text-white rounded-md disabled:opacity-50"
                >
                  {saving ? "Applying…" : applyMode === "live" ? "Apply as live table" : "Import as previous table"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
