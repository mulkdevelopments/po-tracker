import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import PoDrawer from "../components/PoDrawer";
import PiApprovalNotice from "../components/PiApprovalNotice";
import CiApprovalNotice from "../components/CiApprovalNotice";
import StockingEmailNotice from "../components/StockingEmailNotice";
import { usePendingPiApprovals } from "../hooks/usePendingPiApprovals";
import { usePendingCiApprovals } from "../hooks/usePendingCiApprovals";
import { usePendingStockingEmails } from "../hooks/usePendingStockingEmails";
import {
  isManagerRole,
  isFinanceRole,
  PI_PENDING_STATUS,
  PI_REJECTED_STATUS,
  CI_PENDING_STATUS,
  CI_REJECTED_STATUS,
  rejectedPiOrders,
  rejectedCiOrders,
  isOperationalAdminRole,
} from "../piApproval";
import { notifyPoUpdated } from "../poEvents";
import { canMarkStockingEmailRole } from "../stockingEmail";
import ResubmitTag from "../components/ResubmitTag";
import { STAGE_COLORS } from "../types";
import type { PurchaseOrder, MasterData } from "../types";
import { fmtMoney, fmtNum, fmtDate } from "../utils";
import { ListFilter, X } from "lucide-react";

type ColType = "text" | "int" | "num" | "money" | "date" | "status" | "bool" | "url";

interface Col {
  key: keyof PurchaseOrder;
  label: string;
  type: ColType;
  group: string;
}

// Exact column order from the "Order Summary" sheet of the Order Tracker workbook.
const COLUMNS: Col[] = [
  { key: "siNo", label: "SI No.", type: "int", group: "PO Received" },
  { key: "poNo", label: "PO #", type: "text", group: "PO Received" },
  { key: "rev", label: "Rev #", type: "int", group: "PO Received" },
  { key: "concat", label: "Concat", type: "text", group: "PO Received" },
  { key: "status", label: "Order Status", type: "status", group: "PO Received" },
  { key: "poDate", label: "Date Ordered (PO Date)", type: "date", group: "PO Received" },
  { key: "active", label: "Active", type: "bool", group: "PO Received" },
  { key: "skids", label: "Qty of Skids", type: "num", group: "PO Received" },
  { key: "stockingLocation", label: "Stocking Location", type: "text", group: "PO Received" },
  { key: "portOfDest", label: "Port of Destination", type: "text", group: "PO Received" },
  { key: "poValue", label: "PO Value $", type: "money", group: "PO Received" },
  { key: "totalM2", label: "Total M2", type: "num", group: "PO Received" },
  { key: "piNo", label: "PI #", type: "text", group: "PI Generated" },
  { key: "piDate", label: "PI Date", type: "date", group: "PI Generated" },
  { key: "poToPi", label: "PO to PI", type: "int", group: "PI Generated" },
  { key: "piValue", label: "PI Value (Gross)", type: "money", group: "PI Generated" },
  { key: "piApprovedDate", label: "PI Approved Date", type: "date", group: "PI Approved" },
  { key: "dpDate", label: "Downpayment Date", type: "date", group: "Downpayment / In Production" },
  { key: "piToDp", label: "PI to DP", type: "int", group: "Downpayment / In Production" },
  { key: "dpAmount", label: "Downpayment Amount Received", type: "money", group: "Downpayment / In Production" },
  { key: "productionEtc", label: "Production ETC (in Container)", type: "date", group: "Downpayment / In Production" },
  { key: "shippingEta", label: "Shipping ETA", type: "date", group: "Downpayment / In Production" },
  { key: "isf", label: "ISF", type: "text", group: "Container Loaded" },
  { key: "containerNo", label: "Container #", type: "text", group: "Container Loaded" },
  { key: "actualDeparture", label: "Actual Shipping Departure", type: "date", group: "Container Loaded" },
  { key: "dpToShip", label: "DP to Ship", type: "int", group: "Container Loaded" },
  { key: "ciNo", label: "Commercial Invoice #", type: "text", group: "CI sent" },
  { key: "ciDate", label: "Commercial Invoice Date", type: "date", group: "CI sent" },
  { key: "revisionSent", label: "Revision Sent?", type: "text", group: "CI sent" },
  { key: "freight", label: "Freight", type: "money", group: "CI sent" },
  { key: "inland", label: "Inland", type: "money", group: "CI sent" },
  { key: "ciValue", label: "Commercial Invoice Value (Net)", type: "money", group: "CI sent" },
  { key: "balanceDue", label: "Balance Due", type: "money", group: "CI sent" },
  { key: "ciApprovedDate", label: "CI Approved Date", type: "date", group: "CI approved" },
  { key: "bol", label: "BOL / SWBOL", type: "text", group: "BL" },
  { key: "shippingLine", label: "Shipping Line", type: "text", group: "BL" },
  { key: "shippingUrl", label: "Tracking URL", type: "url", group: "BL" },
  { key: "bpDate", label: "Balance Payment Date", type: "date", group: "Balance Payment Received" },
  { key: "ciToBp", label: "CI to BP", type: "int", group: "Balance Payment Received" },
  { key: "bpAmount", label: "Balance Amount Received", type: "money", group: "Balance Payment Received" },
  { key: "telexDate", label: "Telex / Seaway Release Date", type: "date", group: "Telex / Seaway Released" },
  { key: "bpToTelex", label: "Balance Payment to Telex", type: "int", group: "Telex / Seaway Released" },
  { key: "arrivalDate", label: "Actual Arrival at Port", type: "date", group: "Shipping Complete" },
];

const NUMERIC_TYPES: ColType[] = ["int", "num", "money"];

function displayValue(col: Col, raw: unknown): string {
  if (raw == null || raw === "") return "";
  switch (col.type) {
    case "date":
      return fmtDate(String(raw));
    case "money":
      return fmtMoney(Number(raw));
    case "num":
      return fmtNum(Number(raw), 2);
    case "int":
      return String(raw);
    case "bool":
      return raw ? "Yes" : "No";
    default:
      return String(raw);
  }
}

interface ColFilter {
  search: string;
  selected: string[];
}

export default function OrdersPage() {
  const { user, canEdit, isSuperAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isManager = isManagerRole(user?.role);
  const isFinance = isFinanceRole(user?.role);
  const isMaintainer = isOperationalAdminRole(user?.role);
  const showStockingEmailQueue = canMarkStockingEmailRole(user?.role);
  const { pending: pendingPi, count: pendingPiCount } = usePendingPiApprovals(isManager);
  const { pending: pendingCi, count: pendingCiCount } = usePendingCiApprovals(isFinance);
  const {
    pending: pendingStockingEmail,
    count: pendingStockingEmailCount,
  } = usePendingStockingEmails(!!showStockingEmailQueue);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const rejectedPi = useMemo(() => rejectedPiOrders(pos), [pos]);
  const rejectedCi = useMemo(() => rejectedCiOrders(pos), [pos]);
  const [master, setMaster] = useState<MasterData>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const [stockingEmailFilterActive, setStockingEmailFilterActive] = useState(false);

  const load = async () => {
    const [{ pos: list }, settings] = await Promise.all([api.getOrders(), api.getSettings()]);
    setPos(list);
    setMaster(settings.master);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!pos.length) return;
    const state = location.state as {
      openPoId?: number;
      pendingPi?: boolean;
      pendingCi?: boolean;
      pendingStockingEmail?: boolean;
    } | null;
    if (!state?.openPoId && !state?.pendingPi && !state?.pendingCi && !state?.pendingStockingEmail) return;

    if (state.pendingPi) {
      setFilters({ status: { search: "", selected: [PI_PENDING_STATUS] } });
    }
    if (state.pendingCi) {
      setFilters({ status: { search: "", selected: [CI_PENDING_STATUS] } });
    }
    if (state.pendingStockingEmail) {
      setStockingEmailFilterActive(true);
    }
    if (state.openPoId) {
      const po = pos.find((p) => p.id === state.openPoId);
      if (po) setSelected(po);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [pos, location.state, location.pathname, navigate]);

  const pendingPiFilterActive =
    filters.status?.selected.length === 1 && filters.status.selected[0] === PI_PENDING_STATUS;

  const pendingCiFilterActive =
    filters.status?.selected.length === 1 && filters.status.selected[0] === CI_PENDING_STATUS;

  const rejectedPiFilterActive =
    filters.status?.selected.length === 1 && filters.status.selected[0] === PI_REJECTED_STATUS;

  const rejectedCiFilterActive =
    filters.status?.selected.length === 1 && filters.status.selected[0] === CI_REJECTED_STATUS;

  const applyPendingPiFilter = () => {
    setFilters({ status: { search: "", selected: [PI_PENDING_STATUS] } });
  };

  const applyPendingCiFilter = () => {
    setFilters({ status: { search: "", selected: [CI_PENDING_STATUS] } });
  };

  const applyRejectedPiFilter = () => {
    setFilters({ status: { search: "", selected: [PI_REJECTED_STATUS] } });
  };

  const applyRejectedCiFilter = () => {
    setFilters({ status: { search: "", selected: [CI_REJECTED_STATUS] } });
  };

  const applyPendingStockingEmailFilter = () => {
    setStockingEmailFilterActive(true);
  };

  const pendingStockingEmailIds = useMemo(
    () => new Set(pendingStockingEmail.map((p) => p.id)),
    [pendingStockingEmail],
  );

  const cellRaw = (p: PurchaseOrder, col: Col) => p[col.key];

  // Distinct values per column (computed from the full set, sorted).
  const distinctByCol = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      const set = new Set<string>();
      for (const p of pos) set.add(displayValue(col, cellRaw(p, col)));
      const arr = Array.from(set);
      arr.sort((a, b) => {
        if (a === "") return 1;
        if (b === "") return -1;
        if (NUMERIC_TYPES.includes(col.type)) {
          const na = Number(String(a).replace(/[^0-9.-]/g, ""));
          const nb = Number(String(b).replace(/[^0-9.-]/g, ""));
          if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        }
        return a.localeCompare(b);
      });
      map[col.key as string] = arr;
    }
    return map;
  }, [pos]);

  const rows = useMemo(() => {
    return pos.filter((p) => {
      if (stockingEmailFilterActive && !pendingStockingEmailIds.has(p.id)) return false;
      if (q) {
        const hay = COLUMNS.map((c) => displayValue(c, cellRaw(p, c))).join(" ").toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      for (const col of COLUMNS) {
        const f = filters[col.key as string];
        if (!f) continue;
        const disp = displayValue(col, cellRaw(p, col));
        if (f.selected.length && !f.selected.includes(disp)) return false;
        if (f.search && !disp.toLowerCase().includes(f.search.toLowerCase())) return false;
      }
      return true;
    });
  }, [pos, q, filters, stockingEmailFilterActive, pendingStockingEmailIds]);

  const activeFilterCount = Object.values(filters).filter(
    (f) => f.search || f.selected.length,
  ).length;

  const openFilter = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    if (openCol === key) {
      setOpenCol(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 300);
    setPopPos({ top: rect.bottom + 4, left: Math.max(8, left) });
    setOpenCol(key);
  };

  const setColFilter = (key: string, patch: Partial<ColFilter>) => {
    setFilters((prev) => {
      const cur = prev[key] ?? { search: "", selected: [] };
      const next = { ...cur, ...patch };
      if (!next.search && next.selected.length === 0) {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: next };
    });
  };

  const toggleValue = (key: string, value: string) => {
    const cur = filters[key]?.selected ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setColFilter(key, { selected: next });
  };

  const clearAll = () => {
    setFilters({});
    setQ("");
    setStockingEmailFilterActive(false);
  };

  const stagePill = (s: string) => {
    const cls = STAGE_COLORS[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
  };

  const handleDelete = async (e: React.MouseEvent, p: PurchaseOrder) => {
    e.stopPropagation();
    if (
      !confirm(
        `Permanently delete PO ${p.poNo}? This removes the order, all line items, and history. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteOrder(p.id);
      setPos((prev) => prev.filter((x) => x.id !== p.id));
      if (selected?.id === p.id) setSelected(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete order");
    }
  };

  const renderCell = (p: PurchaseOrder, col: Col) => {
    const raw = cellRaw(p, col);
    if (col.type === "status") {
      return (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {stagePill(String(raw ?? ""))}
          <ResubmitTag po={p} kind="pi" />
          <ResubmitTag po={p} kind="ci" />
        </span>
      );
    }
    if (col.type === "url") {
      const v = raw ? String(raw) : "";
      if (!v) return "";
      return (
        <a
          href={v}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-indigo-600 hover:underline"
        >
          link
        </a>
      );
    }
    const disp = displayValue(col, raw);
    if (col.key === "poNo") return <span className="font-mono font-semibold text-slate-900">{disp}</span>;
    return disp || <span className="text-slate-300">—</span>;
  };

  if (loading) return <div className="text-slate-500">Loading orders…</div>;

  return (
    <>
      {isManager && pendingPiCount > 0 && (
        <PiApprovalNotice pending={pendingPi} onOpenPo={setSelected} />
      )}
      {isFinance && pendingCiCount > 0 && (
        <CiApprovalNotice pending={pendingCi} onOpenPo={setSelected} />
      )}
      {showStockingEmailQueue && pendingStockingEmailCount > 0 && (
        <StockingEmailNotice pending={pendingStockingEmail} onOpenPo={setSelected} />
      )}

      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-3 flex items-center gap-3 border-b border-slate-200 flex-wrap">
          <input
            placeholder="Search all columns…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72"
          />
          {isMaintainer && rejectedPi.length > 0 && (
            <button
              type="button"
              onClick={applyRejectedPiFilter}
              className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 border ${
                rejectedPiFilterActive
                  ? "bg-red-100 border-red-400 text-red-900 font-medium"
                  : "border-red-300 text-red-800 hover:bg-red-50"
              }`}
            >
              Rejected PI ({rejectedPi.length})
            </button>
          )}
          {isMaintainer && rejectedCi.length > 0 && (
            <button
              type="button"
              onClick={applyRejectedCiFilter}
              className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 border ${
                rejectedCiFilterActive
                  ? "bg-red-100 border-red-400 text-red-900 font-medium"
                  : "border-red-300 text-red-800 hover:bg-red-50"
              }`}
            >
              Rejected CI ({rejectedCi.length})
            </button>
          )}
          {isManager && pendingPiCount > 0 && (
            <button
              type="button"
              onClick={applyPendingPiFilter}
              className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 border ${
                pendingPiFilterActive
                  ? "bg-amber-100 border-amber-400 text-amber-900 font-medium"
                  : "border-amber-300 text-amber-800 hover:bg-amber-50"
              }`}
            >
              Pending PI ({pendingPiCount})
            </button>
          )}
          {isFinance && pendingCiCount > 0 && (
            <button
              type="button"
              onClick={applyPendingCiFilter}
              className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 border ${
                pendingCiFilterActive
                  ? "bg-cyan-100 border-cyan-400 text-cyan-900 font-medium"
                  : "border-cyan-300 text-cyan-800 hover:bg-cyan-50"
              }`}
            >
              Pending CI ({pendingCiCount})
            </button>
          )}
          {showStockingEmailQueue && pendingStockingEmailCount > 0 && (
            <button
              type="button"
              onClick={applyPendingStockingEmailFilter}
              className={`flex items-center gap-1.5 text-sm rounded-md px-2.5 py-1.5 border ${
                stockingEmailFilterActive
                  ? "bg-violet-100 border-violet-400 text-violet-900 font-medium"
                  : "border-violet-300 text-violet-800 hover:bg-violet-50"
              }`}
            >
              Pending client emails ({pendingStockingEmailCount})
            </button>
          )}
          {(activeFilterCount > 0 || q || stockingEmailFilterActive) && (
            <button
              type="button"
              onClick={clearAll}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md px-2.5 py-1.5"
            >
              <X size={14} /> Clear {activeFilterCount > 0 ? `${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}` : "search"}
            </button>
          )}
          <span className="text-sm text-slate-500 ml-auto">
            {rows.length} of {pos.length} orders
          </span>
          {canEdit() && (
            <Link to="/upload" className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">
              + New PO
            </Link>
          )}
        </div>
        <div className="overflow-auto max-h-[calc(100dvh-220px)]">
          <table className="excel-grid">
            <thead>
              <tr>
                {COLUMNS.map((col) => {
                  const active = !!filters[col.key as string];
                  return (
                    <th key={col.key as string} className={active ? "col-filtered" : ""}>
                      <div className="th-inner">
                        <span className="th-label" title={col.label}>{col.label}</span>
                        <button
                          type="button"
                          className={`th-filter ${active ? "th-filter-active" : ""}`}
                          onClick={(e) => openFilter(e, col.key as string)}
                          aria-label={`Filter ${col.label}`}
                        >
                          <ListFilter size={13} />
                        </button>
                      </div>
                    </th>
                  );
                })}
                <th className="actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`cursor-pointer ${
                    isManager && p.status === PI_PENDING_STATUS
                      ? "bg-amber-50/80 hover:bg-amber-100/80"
                      : isFinance && p.status === CI_PENDING_STATUS
                        ? "bg-cyan-50/80 hover:bg-cyan-100/80"
                      : isMaintainer && p.status === PI_REJECTED_STATUS
                        ? "bg-red-50/80 hover:bg-red-100/80"
                        : isMaintainer && p.status === CI_REJECTED_STATUS
                          ? "bg-red-50/80 hover:bg-red-100/80"
                        : ""
                  }`}
                  onClick={() => setSelected(p)}
                >
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key as string}
                      className={NUMERIC_TYPES.includes(col.type) ? "text-right tabular-nums" : ""}
                    >
                      {renderCell(p, col)}
                    </td>
                  ))}
                  <td className="actions-col">
                    <div className="flex items-center justify-end gap-2">
                      {isSuperAdmin() && (
                        <button
                          type="button"
                          title="Delete order"
                          aria-label={`Delete PO ${p.poNo}`}
                          onClick={(e) => handleDelete(e, p)}
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <X size={15} />
                        </button>
                      )}
                      <span className="text-indigo-600 text-xs whitespace-nowrap">Open ›</span>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="text-center text-slate-400 py-8">
                    No orders match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openCol && popPos && (
        <FilterPopover
          col={COLUMNS.find((c) => (c.key as string) === openCol)!}
          values={distinctByCol[openCol] ?? []}
          filter={filters[openCol] ?? { search: "", selected: [] }}
          pos={popPos}
          onSearch={(s) => setColFilter(openCol, { search: s })}
          onToggle={(v) => toggleValue(openCol, v)}
          onSelectAll={() => setColFilter(openCol, { selected: [] })}
          onClear={() => setColFilter(openCol, { search: "", selected: [] })}
          onClose={() => setOpenCol(null)}
        />
      )}

      {selected && user && (
        <PoDrawer
          po={selected}
          user={user}
          master={master}
          onClose={() => setSelected(null)}
          onUpdated={(po) => {
            setPos((prev) => prev.map((x) => (x.id === po.id ? po : x)));
            setSelected(po);
            notifyPoUpdated();
          }}
          onDeleted={(id) => {
            setPos((prev) => prev.filter((x) => x.id !== id));
            setSelected(null);
          }}
          canEdit={canEdit()}
        />
      )}
    </>
  );
}

function FilterPopover({
  col,
  values,
  filter,
  pos,
  onSearch,
  onToggle,
  onSelectAll,
  onClear,
  onClose,
}: {
  col: Col;
  values: string[];
  filter: ColFilter;
  pos: { top: number; left: number };
  onSearch: (s: string) => void;
  onToggle: (v: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [valSearch, setValSearch] = useState("");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const shown = values.filter((v) =>
    valSearch ? (v || "(blank)").toLowerCase().includes(valSearch.toLowerCase()) : true,
  );

  return (
    <div
      ref={ref}
      className="filter-pop"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-semibold text-slate-700 mb-2 truncate">{col.label}</div>
      <input
        autoFocus
        placeholder="Contains…"
        value={filter.search}
        onChange={(e) => onSearch(e.target.value)}
        className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs mb-2"
      />
      <input
        placeholder="Find values…"
        value={valSearch}
        onChange={(e) => setValSearch(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs mb-1.5"
      />
      <div className="flex items-center justify-between text-[11px] text-indigo-600 mb-1">
        <button type="button" onClick={onSelectAll} className="hover:underline">
          Select all
        </button>
        <button type="button" onClick={onClear} className="hover:underline">
          Clear
        </button>
      </div>
      <div className="max-h-52 overflow-auto border border-slate-100 rounded-md">
        {shown.map((v) => {
          const checked = filter.selected.length === 0 || filter.selected.includes(v);
          return (
            <label key={v || "(blank)"} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={filter.selected.includes(v)}
                onChange={() => onToggle(v)}
              />
              <span className={`truncate ${!checked ? "text-slate-400" : ""}`}>{v || "(blank)"}</span>
            </label>
          );
        })}
        {shown.length === 0 && <div className="px-2 py-2 text-xs text-slate-400">No values</div>}
      </div>
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1 bg-slate-800 text-white rounded-md hover:bg-slate-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}
