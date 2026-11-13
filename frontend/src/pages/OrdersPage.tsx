import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import PoDrawer from "../components/PoDrawer";
import StatusChangeDialog from "../components/StatusChangeDialog";
import { BusyLabel, TableSkeleton } from "../components/Skeleton";
import { usePendingStockingEmails } from "../hooks/usePendingStockingEmails";
import {
  seesPiApprovals,
  seesCiApprovals,
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
import { pendingPiDue } from "../piDue";
import ResubmitTag from "../components/ResubmitTag";
import { STAGE_COLORS } from "../types";
import { ALL_SUBSTAGE_IDS } from "../workflows";
import type { PurchaseOrder, MasterData } from "../types";
import { fmtMoney, fmtNum, fmtDate, dateSortKey, todayISO } from "../utils";
import { ListFilter } from "lucide-react";
import { FilterPopover, type ColFilter } from "../components/ColumnFilter";
import {
  balancePaymentFlag,
  downpaymentFlag,
  paymentTolerance,
  shownBalanceDue,
} from "../paymentFlags";

type ColType = "text" | "int" | "num" | "money" | "date" | "status" | "bool" | "url";

interface Col {
  key: keyof PurchaseOrder;
  label: string;
  type: ColType;
  group: string;
  tone?: "production" | "finance";
}

/** Stay visible while the order table scrolls sideways, through Order Status. */
const FROZEN_KEYS = ["poNo", "poDate", "status"];

const COLUMNS: Col[] = [
  { key: "poNo", label: "PO #", type: "text", group: "PO Received" },
  { key: "poDate", label: "PO Date", type: "date", group: "PO Received" },
  { key: "status", label: "Order Status", type: "status", group: "PO Received" },
  { key: "skids", label: "Qty of Skids", type: "num", group: "PO Received" },
  { key: "stockingLocation", label: "Stocking Location", type: "text", group: "PO Received" },
  { key: "portOfDest", label: "Port of Destination", type: "text", group: "PO Received" },
  { key: "priority", label: "Priority", type: "text", group: "PO Received" },
  { key: "totalM2", label: "Total M2", type: "num", group: "PO Received" },
  { key: "piNo", label: "PI #", type: "text", group: "PI Generated", tone: "finance" },
  { key: "piDate", label: "PI Date", type: "date", group: "PI Generated", tone: "finance" },
  { key: "poValue", label: "PO Value $ (sq ft)", type: "money", group: "PO Received", tone: "finance" },
  { key: "piValue", label: "PI Value (Gross)", type: "money", group: "PI Generated", tone: "finance" },
  { key: "piApprovedDate", label: "PI Approved Date", type: "date", group: "PI Approved", tone: "finance" },
  { key: "soNo", label: "SO #", type: "text", group: "Production", tone: "production" },
  { key: "allMaterialAvailable", label: "Material Avail.", type: "date", group: "Production", tone: "production" },
  { key: "productionBegin", label: "Prod. Begin", type: "date", group: "Production", tone: "production" },
  { key: "productionEtc", label: "Production ETC", type: "date", group: "Production", tone: "production" },
  { key: "dispatchFromFactory", label: "Dispatch", type: "date", group: "Production", tone: "production" },
  { key: "productionStatus", label: "Production Status", type: "text", group: "Production", tone: "production" },
  { key: "productionNotes", label: "Production Notes", type: "text", group: "Production", tone: "production" },
  { key: "shippingEta", label: "Shipping ETA", type: "date", group: "Downpayment / In Production" },
  { key: "isf", label: "ISF", type: "text", group: "Container Loaded" },
  { key: "containerNo", label: "Container #", type: "text", group: "Container Loaded" },
  { key: "actualDeparture", label: "Actual Shipping Departure", type: "date", group: "Container Loaded" },
  { key: "bol", label: "BOL / SWBOL", type: "text", group: "BL" },
  { key: "shippingLine", label: "Shipping Line", type: "text", group: "BL" },
  { key: "shippingUrl", label: "Tracking URL", type: "url", group: "BL" },
  { key: "arrivalDate", label: "Actual Arrival at Port", type: "date", group: "Shipping Complete" },
  { key: "rev", label: "Rev #", type: "int", group: "PO Received" },
  { key: "dpDate", label: "Downpayment Date", type: "date", group: "Downpayment / In Production", tone: "finance" },
  { key: "dpAmount", label: "Downpayment Amount Received", type: "money", group: "Downpayment / In Production", tone: "finance" },
  { key: "ciNo", label: "Commercial Invoice #", type: "text", group: "CI sent", tone: "finance" },
  { key: "ciDate", label: "Commercial Invoice Date", type: "date", group: "CI sent", tone: "finance" },
  { key: "revisionSent", label: "Revision Sent?", type: "text", group: "CI sent", tone: "finance" },
  { key: "freight", label: "Freight", type: "money", group: "CI sent", tone: "finance" },
  { key: "inland", label: "Inland", type: "money", group: "CI sent", tone: "finance" },
  { key: "ciValue", label: "Commercial Invoice Value (Net)", type: "money", group: "CI sent", tone: "finance" },
  { key: "balanceDue", label: "Balance Due", type: "money", group: "CI sent", tone: "finance" },
  { key: "ciApprovedDate", label: "CI Approved Date", type: "date", group: "CI approved", tone: "finance" },
  { key: "bpDate", label: "Balance Payment Date", type: "date", group: "Balance Payment Received", tone: "finance" },
  { key: "bpAmount", label: "Balance Amount Received", type: "money", group: "Balance Payment Received", tone: "finance" },
  { key: "telexDate", label: "Telex / Seaway Release Date", type: "date", group: "Telex / Seaway Released", tone: "finance" },
];

const NUMERIC_TYPES: ColType[] = ["int", "num", "money"];
const TOGGLE_KEYS = new Set(["isf", "revisionSent"]);

function flagOn(value: unknown) {
  return value != null && String(value).trim() !== "";
}

function numericFromCell(col: Col, raw: unknown, draft?: string): number | null {
  if (!NUMERIC_TYPES.includes(col.type)) return null;
  const src = draft !== undefined ? draft : raw;
  if (src == null || src === "") return null;
  const n = typeof src === "number" ? src : Number(String(src).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}


function FlagSwitch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-emerald-500" : "bg-slate-300"
      } disabled:cursor-default disabled:opacity-60`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

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

type CellAddr = { id: number; key: string };

function selectionBounds(
  list: PurchaseOrder[],
  a: CellAddr,
  b: CellAddr,
): { rMin: number; rMax: number; cMin: number; cMax: number } | null {
  const r1 = list.findIndex((row) => row.id === a.id);
  const r2 = list.findIndex((row) => row.id === b.id);
  const c1 = COLUMNS.findIndex((c) => (c.key as string) === a.key);
  const c2 = COLUMNS.findIndex((c) => (c.key as string) === b.key);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return null;
  return {
    rMin: Math.min(r1, r2),
    rMax: Math.max(r1, r2),
    cMin: Math.min(c1, c2),
    cMax: Math.max(c1, c2),
  };
}

function draftBaseline(col: Col, raw: unknown): string {
  if (col.type === "bool") return raw ? "Yes" : "No";
  if (raw == null || raw === "") return "";
  if (col.type === "date") return String(raw).slice(0, 10);
  if (col.type === "money" || col.type === "num" || col.type === "int") {
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : "";
  }
  return String(raw);
}

function coerceCell(col: Col, value: string): unknown {
  const v = value.trim();
  if (col.type === "bool") {
    if (/^(y|yes|true|1)$/i.test(v)) return true;
    if (/^(n|no|false|0)$/i.test(v) || v === "") return false;
    throw new Error(`${col.label} must be Yes or No`);
  }
  if (col.key === "priority") {
    if (!v || /^standard$/i.test(v)) return "Standard";
    if (/^high$/i.test(v)) return "High";
    throw new Error("Priority must be Standard or High");
  }
  if (col.key === "poNo" && !v) throw new Error("PO # is required");
  if (col.key === "status" && !v) throw new Error("Order status is required");
  if (col.type === "int" || col.type === "num" || col.type === "money") {
    if (!v) return null;
    const n = Number(v.replace(/[$,]/g, ""));
    if (!Number.isFinite(n)) throw new Error(`${col.label} must be a number`);
    return col.type === "int" ? Math.round(n) : n;
  }
  return v || null;
}

function mergeDraft(
  src: Record<number, Record<string, string>>,
  id: number,
  key: string,
  value: string,
  base: string,
) {
  const row = { ...(src[id] || {}) };
  if (value === base) delete row[key];
  else row[key] = value;
  const next = { ...src };
  if (Object.keys(row).length) next[id] = row;
  else delete next[id];
  return next;
}

/** Worst payment variance for a row — under beats over so underpayments stay red. */
function paymentRowAlert(
  p: PurchaseOrder,
  master: MasterData,
): { kind: "under" | "over"; title: string } | null {
  const tol = paymentTolerance(master);
  const flags = [
    downpaymentFlag(p, master.downpaymentPct ?? 0.5, tol),
    balancePaymentFlag(p, tol),
  ].filter((f): f is NonNullable<typeof f> => !!f && f.kind !== "ok");
  if (!flags.length) return null;
  const under = flags.find((f) => f.kind === "under");
  const pick = under ?? flags[0];
  const title = flags
    .map((f) => `${f.label}: expected ${fmtMoney(f.expected)}, variance ${fmtMoney(f.variance)}`)
    .join(" · ");
  return { kind: pick.kind as "under" | "over", title };
}

export default function OrdersPage() {
  const { user, canEdit } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isManager = seesPiApprovals(user);
  const isFinance = seesCiApprovals(user);
  const isMaintainer = isOperationalAdminRole(user?.role);
  const showStockingEmailQueue = canMarkStockingEmailRole(user?.role);
  const { pending: pendingStockingEmail } = usePendingStockingEmails(!!showStockingEmailQueue);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const rejectedPi = useMemo(() => rejectedPiOrders(pos), [pos]);
  const rejectedCi = useMemo(() => rejectedCiOrders(pos), [pos]);
  const piDueList = useMemo(() => pendingPiDue(pos), [pos]);
  const [master, setMaster] = useState<MasterData>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [statusPo, setStatusPo] = useState<PurchaseOrder | null>(null);
  const { orderQuery: q, setOrderQuery: setQ, setOrderStats, clearOrdersRef } = useOutletContext<{
    orderQuery: string;
    setOrderQuery: (q: string) => void;
    setOrderStats: (stats: { shown: number; total: number; canClear: boolean } | null) => void;
    clearOrdersRef: { current: (() => void) | null };
  }>();
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const filterOpenerRef = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const [activeCell, setActiveCell] = useState<CellAddr | null>(null);
  const [rangeEnd, setRangeEnd] = useState<CellAddr | null>(null);
  const [rangeDragging, setRangeDragging] = useState(false);
  const [editingCell, setEditingCell] = useState(false);
  const [editText, setEditText] = useState("");
  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});
  const [gridSaving, setGridSaving] = useState(false);
  const editTextRef = useRef("");
  const editingRef = useRef(false);
  const activeRef = useRef<CellAddr | null>(null);
  const rangeDraggingRef = useRef(false);
  const draftsRef = useRef(drafts);
  const posRef = useRef(pos);
  const rowsRef = useRef<PurchaseOrder[]>([]);
  activeRef.current = activeCell;
  draftsRef.current = drafts;
  posRef.current = pos;
  editingRef.current = editingCell;
  rangeDraggingRef.current = rangeDragging;
  const [stockingEmailFilterActive, setStockingEmailFilterActive] = useState(false);
  const [piDueFilterActive, setPiDueFilterActive] = useState(false);

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
      pendingPiDue?: boolean;
    } | null;
    if (
      !state?.openPoId &&
      !state?.pendingPi &&
      !state?.pendingCi &&
      !state?.pendingStockingEmail &&
      !state?.pendingPiDue
    ) {
      return;
    }

    if (state.pendingPi) {
      setFilters({ status: { search: "", selected: [PI_PENDING_STATUS] } });
      setStockingEmailFilterActive(false);
      setPiDueFilterActive(false);
    } else if (state.pendingCi) {
      setFilters({ status: { search: "", selected: [CI_PENDING_STATUS] } });
      setStockingEmailFilterActive(false);
      setPiDueFilterActive(false);
    } else if (state.pendingStockingEmail) {
      setFilters({});
      setStockingEmailFilterActive(true);
      setPiDueFilterActive(false);
    } else if (state.pendingPiDue) {
      setFilters({});
      setPiDueFilterActive(true);
      setStockingEmailFilterActive(false);
    }
    if (state.openPoId) {
      const po = pos.find((p) => p.id === state.openPoId);
      if (po) setSelected(po);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [pos, location.state, location.pathname, navigate]);

  const rejectedPiFilterActive =
    filters.status?.selected.length === 1 && filters.status.selected[0] === PI_REJECTED_STATUS;

  const rejectedCiFilterActive =
    filters.status?.selected.length === 1 && filters.status.selected[0] === CI_REJECTED_STATUS;

  const applyRejectedPiFilter = () => {
    setFilters({ status: { search: "", selected: [PI_REJECTED_STATUS] } });
  };

  const applyRejectedCiFilter = () => {
    setFilters({ status: { search: "", selected: [CI_REJECTED_STATUS] } });
  };

  const pendingStockingEmailIds = useMemo(
    () => new Set(pendingStockingEmail.map((p) => p.id)),
    [pendingStockingEmail],
  );

  const pendingPiDueIds = useMemo(() => new Set(piDueList.map((p) => p.id)), [piDueList]);

  const cellRaw = (p: PurchaseOrder, col: Col) => {
    if (col.key === "balanceDue") return shownBalanceDue(p);
    if (col.key === "priority") return p.priority || "Standard";
    return p[col.key];
  };

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
        if (col.type === "date") return dateSortKey(a).localeCompare(dateSortKey(b));
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
      if (piDueFilterActive && !pendingPiDueIds.has(p.id)) return false;
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
    }).sort((a, b) => {
      const ah = (a.priority || "Standard") === "High" ? 0 : 1;
      const bh = (b.priority || "Standard") === "High" ? 0 : 1;
      return ah - bh;
    });
  }, [pos, q, filters, stockingEmailFilterActive, pendingStockingEmailIds, piDueFilterActive, pendingPiDueIds]);

  const activeFilterCount = Object.values(filters).filter(
    (f) => f.search || f.selected.length,
  ).length;

  const placeFilter = (el: HTMLElement, key: string) => {
    filterOpenerRef.current = el as HTMLButtonElement;
    const rect = el.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 300);
    setPopPos({ top: rect.bottom + 4, left: Math.max(8, left) });
    setOpenCol(key);
  };

  const openFilter = (el: HTMLElement, key: string) => {
    if (openCol === key) {
      setOpenCol(null);
      return;
    }
    placeFilter(el, key);
  };

  const closeFilter = (restoreFocus = false) => {
    setOpenCol(null);
    if (restoreFocus) {
      const el = filterOpenerRef.current;
      requestAnimationFrame(() => el?.focus());
    }
  };

  useLayoutEffect(() => {
    const table = gridRef.current;
    if (!table) return;
    const measure = () => {
      const cells = table.querySelectorAll<HTMLElement>("thead th.freeze");
      let left = 0;
      cells.forEach((cell, i) => {
        table.style.setProperty(`--freeze-${i}`, `${left}px`);
        left += cell.offsetWidth;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return () => observer.disconnect();
  }, [rows.length, loading]);

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
    setPiDueFilterActive(false);
  };
  clearOrdersRef.current = clearAll;

  const canClear = activeFilterCount > 0 || !!q || stockingEmailFilterActive || piDueFilterActive;
  useEffect(() => {
    setOrderStats({ shown: rows.length, total: pos.length, canClear });
  }, [rows.length, pos.length, canClear, setOrderStats]);
  useEffect(() => () => setOrderStats(null), [setOrderStats]);

  const stagePill = (s: string) => {
    const cls = STAGE_COLORS[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
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
    if (col.key === "priority") {
      const v = String(raw || "Standard");
      const high = v === "High";
      return (
        <span
          className={`stage-pill ${high ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
        >
          {v}
        </span>
      );
    }
    if (TOGGLE_KEYS.has(col.key as string)) {
      const key = col.key as "isf" | "revisionSent";
      return (
        <FlagSwitch
          on={flagOn(raw)}
          disabled={!canEdit()}
          onToggle={() => void toggleFlag(p, key)}
        />
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

  rowsRef.current = rows;

  const cellBase = (p: PurchaseOrder, col: Col) =>
    draftsRef.current[p.id]?.[col.key as string] ?? draftBaseline(col, cellRaw(p, col));

  const commitActive = () => {
    const cell = activeRef.current;
    if (!editingRef.current || !cell) return;
    const p = posRef.current.find((row) => row.id === cell.id);
    const col = COLUMNS.find((c) => (c.key as string) === cell.key);
    editingRef.current = false;
    setEditingCell(false);
    if (!p || !col) return;
    const next = mergeDraft(
      draftsRef.current,
      cell.id,
      cell.key,
      editTextRef.current,
      draftBaseline(col, cellRaw(p, col)),
    );
    draftsRef.current = next;
    setDrafts(next);
  };

  const clearRange = () => setRangeEnd(null);

  const moveActive = (dRow: number, dCol: number) => {
    const cell = activeRef.current;
    if (!cell) return;
    const list = rowsRef.current;
    const ri = list.findIndex((row) => row.id === cell.id);
    const ci = COLUMNS.findIndex((c) => (c.key as string) === cell.key);
    if (ri < 0 || ci < 0) return;
    const row = list[Math.max(0, Math.min(list.length - 1, ri + dRow))];
    const col = COLUMNS[Math.max(0, Math.min(COLUMNS.length - 1, ci + dCol))];
    if (!row || !col) return;
    const next = { id: row.id, key: col.key as string };
    activeRef.current = next;
    setActiveCell(next);
    clearRange();
    requestAnimationFrame(() => gridWrapRef.current?.focus({ preventScroll: true }));
  };

  const startRangeAt = (addr: CellAddr, extend: boolean) => {
    if (extend && activeRef.current) {
      setRangeEnd(addr);
      return;
    }
    commitActive();
    activeRef.current = addr;
    setActiveCell(addr);
    setRangeEnd(addr);
  };

  useEffect(() => {
    const endDrag = () => {
      if (!rangeDraggingRef.current) return;
      rangeDraggingRef.current = false;
      setRangeDragging(false);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const rangeStats = useMemo(() => {
    if (!activeCell || !rangeEnd) return null;
    const bounds = selectionBounds(rows, activeCell, rangeEnd);
    if (!bounds) return null;
    const cellCount = (bounds.rMax - bounds.rMin + 1) * (bounds.cMax - bounds.cMin + 1);
    if (cellCount <= 1) return null;
    const nums: number[] = [];
    for (let ri = bounds.rMin; ri <= bounds.rMax; ri++) {
      const row = rows[ri];
      if (!row) continue;
      for (let ci = bounds.cMin; ci <= bounds.cMax; ci++) {
        const col = COLUMNS[ci];
        if (!col) continue;
        const n = numericFromCell(col, cellRaw(row, col), drafts[row.id]?.[col.key as string]);
        if (n != null) nums.push(n);
      }
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      cellCount,
      numCount: nums.length,
      sum,
      avg: nums.length ? sum / nums.length : null,
    };
  }, [activeCell, rangeEnd, rows, drafts]);

  const beginEdit = (p: PurchaseOrder, col: Col, seed?: string) => {
    if (!canEdit()) return;
    if (col.type === "status") {
      setStatusPo(p);
      return;
    }
    if (col.key === "priority") return;
    if (TOGGLE_KEYS.has(col.key as string)) return;
    commitActive();
    const key = col.key as string;
    const text = seed !== undefined ? seed : cellBase(p, col);
    const next = { id: p.id, key };
    editTextRef.current = text;
    editingRef.current = true;
    activeRef.current = next;
    setEditText(text);
    setActiveCell(next);
    setEditingCell(true);
  };

  const togglePriority = async (p: PurchaseOrder) => {
    if (!canEdit()) return;
    const next = (p.priority || "Standard") === "High" ? "Standard" : "High";
    setPos((prev) => prev.map((row) => (row.id === p.id ? { ...row, priority: next } : row)));
    try {
      const { po } = await api.updateOrder(p.id, { priority: next }, p.company);
      setPos((prev) => prev.map((row) => (row.id === po.id ? po : row)));
      if (selected?.id === po.id) setSelected(po);
      notifyPoUpdated();
    } catch (e) {
      setPos((prev) => prev.map((row) => (row.id === p.id ? p : row)));
      alert(e instanceof Error ? e.message : "Could not update priority");
    }
  };

  const toggleFlag = async (p: PurchaseOrder, key: "isf" | "revisionSent") => {
    if (!canEdit()) return;
    const on = flagOn(p[key]);
    const next = on ? null : key === "revisionSent" ? todayISO() : "Yes";
    setPos((prev) => prev.map((row) => (row.id === p.id ? { ...row, [key]: next } : row)));
    try {
      const { po } = await api.updateOrder(p.id, { [key]: next }, p.company);
      setPos((prev) => prev.map((row) => (row.id === po.id ? po : row)));
      if (selected?.id === po.id) setSelected(po);
      notifyPoUpdated();
    } catch (e) {
      setPos((prev) => prev.map((row) => (row.id === p.id ? p : row)));
      alert(e instanceof Error ? e.message : "Could not update this field");
    }
  };

  const revertGrid = () => {
    editingRef.current = false;
    editTextRef.current = "";
    draftsRef.current = {};
    setEditingCell(false);
    setEditText("");
    setDrafts({});
  };

  const saveGrid = async () => {
    commitActive();
    const pending = draftsRef.current;
    if (!Object.keys(pending).length) return;
    setGridSaving(true);
    const updated: PurchaseOrder[] = [];
    const failed: Record<number, Record<string, string>> = { ...pending };
    try {
      for (const idStr of Object.keys(pending)) {
        const id = Number(idStr);
        const p = posRef.current.find((row) => row.id === id);
        if (!p) continue;
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(pending[id])) {
          const col = COLUMNS.find((c) => (c.key as string) === key);
          if (!col) continue;
          patch[key] = coerceCell(col, value);
        }
        const { po } = await api.updateOrder(id, patch, p.company);
        updated.push(po);
        delete failed[id];
      }
      if (updated.length) notifyPoUpdated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      if (updated.length) {
        setPos((prev) => prev.map((row) => updated.find((po) => po.id === row.id) ?? row));
        setSelected((cur) => (cur ? updated.find((po) => po.id === cur.id) ?? cur : cur));
      }
      draftsRef.current = failed;
      setDrafts(failed);
      setGridSaving(false);
      requestAnimationFrame(() => gridWrapRef.current?.focus({ preventScroll: true }));
    }
  };

  useEffect(() => {
    if (!Object.keys(drafts).length && !editingCell) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [drafts, editingCell]);

  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    if (openCol) return;
    const target = e.target as HTMLElement;
    if (target.closest(".cell-editor, .th-filter, input, textarea, select, a")) return;
    const cell = activeRef.current;
    if (!cell) return;
    const p = rowsRef.current.find((row) => row.id === cell.id);
    const col = COLUMNS.find((c) => (c.key as string) === cell.key);
    if (!p || !col) return;
    if ((e.key === "s" || e.key === "S") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveGrid();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1, 0);
    } else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      moveActive(0, 1);
    } else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      moveActive(0, -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      moveActive(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === "F2") {
      e.preventDefault();
      beginEdit(p, col);
    } else if ((e.key === "Delete" || e.key === "Backspace") && canEdit()) {
      e.preventDefault();
      const next = mergeDraft(draftsRef.current, p.id, col.key as string, "", draftBaseline(col, cellRaw(p, col)));
      draftsRef.current = next;
      setDrafts(next);
    } else if (e.key === "Escape") {
      setActiveCell(null);
      activeRef.current = null;
      clearRange();
    } else if (canEdit() && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      beginEdit(p, col, e.key);
    }
  };

  const onEditorKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "s" || e.key === "S") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveGrid();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      editingRef.current = false;
      setEditingCell(false);
      requestAnimationFrame(() => gridWrapRef.current?.focus({ preventScroll: true }));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitActive();
      moveActive(e.shiftKey ? -1 : 1, 0);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      commitActive();
      moveActive(0, e.shiftKey ? -1 : 1);
    }
  };

  const pendingEditDirty = (() => {
    if (!editingCell || !activeCell) return false;
    const p = pos.find((row) => row.id === activeCell.id);
    const col = COLUMNS.find((c) => (c.key as string) === activeCell.key);
    if (!p || !col) return false;
    return editText !== cellBase(p, col);
  })();
  const gridDirty = Object.keys(drafts).length > 0 || pendingEditDirty;
  const stockingOptions = master.stockingLocations ?? [];
  const portOptions = Array.from(new Set(Object.values(master.portsOfEntry ?? {}).filter(Boolean)));
  const rangeBox =
    activeCell && rangeEnd ? selectionBounds(rows, activeCell, rangeEnd) : null;

  if (loading) return <TableSkeleton rows={16} toolbar={false} fill />;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        {(gridDirty || (isMaintainer && (rejectedPi.length > 0 || rejectedCi.length > 0))) && (
        <div className="p-3 flex items-center gap-3 border-b border-slate-200 flex-wrap">
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
          {gridDirty && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={revertGrid}
                disabled={gridSaving}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50 font-medium disabled:opacity-50"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={() => void saveGrid()}
                disabled={gridSaving}
                className="px-3 py-1.5 text-sm border border-indigo-600 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:opacity-50"
              >
                <BusyLabel busy={gridSaving} className="h-3 w-10">Save</BusyLabel>
              </button>
            </div>
          )}
        </div>
        )}
        <div
          ref={gridWrapRef}
          tabIndex={0}
          onKeyDown={onGridKeyDown}
          className={`min-h-0 flex-1 overflow-auto outline-none${rangeDragging ? " select-none" : ""}`}
          onScroll={() => {
            if (openCol) closeFilter(false);
          }}
          onPointerDown={(e) => {
            pointerDown.current = { x: e.clientX, y: e.clientY };
          }}
          onClickCapture={(e) => {
            const start = pointerDown.current;
            pointerDown.current = null;
            if (!start) return;
            if (Math.abs(e.clientX - start.x) > 5 || Math.abs(e.clientY - start.y) > 5) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <table className="excel-grid" ref={gridRef}>
            <thead>
              <tr>
                {COLUMNS.map((col) => {
                  const active = !!filters[col.key as string];
                  const freezeAt = FROZEN_KEYS.indexOf(col.key as string);
                  const freezeClass =
                    freezeAt < 0
                      ? ""
                      : `freeze freeze-${freezeAt}${freezeAt === FROZEN_KEYS.length - 1 ? " freeze-last" : ""}`;
                  return (
                    <th
                      key={col.key as string}
                      className={`${col.tone === "production" ? "th-production" : col.tone === "finance" ? "th-finance" : "th-order"} ${freezeClass}${active ? " col-filtered" : ""}`}
                    >
                      <div className="th-inner">
                        <span className="th-label" title={col.label}>{col.label}</span>
                        <button
                          type="button"
                          className={`th-filter ${active ? "th-filter-active" : ""}`}
                          aria-label={`Filter ${col.label}`}
                          aria-haspopup="dialog"
                          aria-expanded={openCol === (col.key as string)}
                          aria-keyshortcuts="Alt+ArrowDown Meta+ArrowDown"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFilter(e.currentTarget, col.key as string);
                          }}
                          onKeyDown={(e) => {
                            if ((e.altKey || e.metaKey) && e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (openCol !== (col.key as string)) {
                                placeFilter(e.currentTarget, col.key as string);
                              }
                            }
                          }}
                        >
                          <ListFilter size={13} />
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, rowIndex) => {
                const payAlert = paymentRowAlert(p, master);
                const rowTone = payAlert
                  ? payAlert.kind === "under"
                    ? "pay-under"
                    : "pay-over"
                  : isManager && p.status === PI_PENDING_STATUS
                    ? "row-pending-pi"
                    : isFinance && p.status === CI_PENDING_STATUS
                      ? "row-pending-ci"
                      : isMaintainer && p.status === PI_REJECTED_STATUS
                        ? "row-rejected"
                        : isMaintainer && p.status === CI_REJECTED_STATUS
                          ? "row-rejected"
                          : "";
                return (
                  <tr
                    key={p.id}
                    className={rowTone}
                    title={payAlert?.title}
                  >
                    {COLUMNS.map((col, colIndex) => {
                      const key = col.key as string;
                      const freezeAt = FROZEN_KEYS.indexOf(key);
                      const freezeClass =
                        freezeAt < 0
                          ? ""
                          : `freeze freeze-${freezeAt}${freezeAt === FROZEN_KEYS.length - 1 ? " freeze-last" : ""}`;
                      const draft = drafts[p.id]?.[key];
                      const isActive = activeCell?.id === p.id && activeCell.key === key;
                      const inRange = !!(
                        rangeBox &&
                        rowIndex >= rangeBox.rMin &&
                        rowIndex <= rangeBox.rMax &&
                        colIndex >= rangeBox.cMin &&
                        colIndex <= rangeBox.cMax &&
                        (rangeBox.rMax > rangeBox.rMin || rangeBox.cMax > rangeBox.cMin)
                      );
                      const isEditing = isActive && editingCell && canEdit();
                      const listId =
                        col.type === "bool"
                            ? "cell-bool"
                            : col.type === "status"
                              ? "cell-status"
                              : col.key === "stockingLocation"
                                ? "cell-stocking"
                                : col.key === "portOfDest"
                                  ? "cell-port"
                                  : undefined;
                      const shown = (() => {
                        if (draft === undefined) return renderCell(p, col);
                        if (col.type === "status") {
                          return (
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              {stagePill(draft)}
                              <ResubmitTag po={p} kind="pi" />
                              <ResubmitTag po={p} kind="ci" />
                            </span>
                          );
                        }
                        if (col.key === "priority") {
                          const high = draft === "High";
                          return (
                            <span className={`stage-pill ${high ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
                              {draft || "Standard"}
                            </span>
                          );
                        }
                        if (TOGGLE_KEYS.has(key)) {
                          return (
                            <FlagSwitch
                              on={flagOn(draft)}
                              disabled={!canEdit()}
                              onToggle={() => void toggleFlag(p, key as "isf" | "revisionSent")}
                            />
                          );
                        }
                        if (col.type === "url") {
                          if (!draft) return "";
                          return (
                            <a href={draft} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-600 hover:underline">
                              link
                            </a>
                          );
                        }
                        const raw = col.type === "money" || col.type === "num" || col.type === "int"
                          ? (draft === "" ? null : Number(draft.replace(/[$,]/g, "")))
                          : draft;
                        const disp = col.type === "bool" ? draft : displayValue(col, raw);
                        if (col.key === "poNo") return <span className="font-mono font-semibold text-slate-900">{disp}</span>;
                        return disp || <span className="text-slate-300">—</span>;
                      })();
                      return (
                      <td
                        key={key}
                        className={`${freezeClass}${col.tone === "finance" ? " td-finance" : ""}${NUMERIC_TYPES.includes(col.type) ? " text-right tabular-nums" : ""}${isActive ? " cell-active" : ""}${inRange ? " cell-range" : ""}${draft !== undefined ? " cell-dirty" : ""}${isEditing ? " cell-editing" : ""}${key === "poNo" || key === "status" || key === "priority" || TOGGLE_KEYS.has(key) ? " cursor-pointer" : canEdit() ? " cursor-cell" : ""}`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          if ((e.target as HTMLElement).closest("a, button, input, .cell-editor, .stage-pill")) return;
                          if (editingRef.current) return;
                          if (e.shiftKey && activeRef.current) {
                            setRangeEnd({ id: p.id, key });
                            return;
                          }
                          rangeDraggingRef.current = true;
                          setRangeDragging(true);
                          startRangeAt({ id: p.id, key }, false);
                        }}
                        onPointerEnter={() => {
                          if (!rangeDraggingRef.current) return;
                          setRangeEnd({ id: p.id, key });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (key === "isf" || key === "revisionSent") {
                            void toggleFlag(p, key);
                            return;
                          }
                          if (key === "priority") {
                            void togglePriority(p);
                            return;
                          }
                          if (key === "status") {
                            commitActive();
                            const next = { id: p.id, key };
                            activeRef.current = next;
                            setActiveCell(next);
                            clearRange();
                            if (canEdit()) setStatusPo(p);
                            return;
                          }
                          if (key === "poNo") {
                            commitActive();
                            const next = { id: p.id, key };
                            activeRef.current = next;
                            setActiveCell(next);
                            clearRange();
                            setSelected(p);
                            gridWrapRef.current?.focus({ preventScroll: true });
                            return;
                          }
                          if (e.shiftKey) {
                            gridWrapRef.current?.focus({ preventScroll: true });
                            return;
                          }
                          if (canEdit() && activeRef.current?.id === p.id && activeRef.current.key === key && !inRange) {
                            beginEdit(p, col);
                            return;
                          }
                          commitActive();
                          const next = { id: p.id, key };
                          activeRef.current = next;
                          setActiveCell(next);
                          setRangeEnd(next);
                          gridWrapRef.current?.focus({ preventScroll: true });
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (key === "status") {
                            if (canEdit()) setStatusPo(p);
                            return;
                          }
                          if (key === "priority" || TOGGLE_KEYS.has(key)) return;
                          if (key === "poNo" || !canEdit()) return;
                          clearRange();
                          beginEdit(p, col);
                        }}
                      >
                        {isEditing ? (
                          <input
                            className="cell-editor"
                            autoFocus
                            list={listId}
                            type={col.type === "date" ? "date" : "text"}
                            inputMode={NUMERIC_TYPES.includes(col.type) ? "decimal" : undefined}
                            value={editText}
                            aria-label={col.label}
                            onChange={(e) => {
                              editTextRef.current = e.target.value;
                              setEditText(e.target.value);
                            }}
                            onBlur={commitActive}
                            onKeyDown={onEditorKeyDown}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                          />
                        ) : shown}
                      </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center text-slate-400 py-8">
                    No orders match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <datalist id="cell-bool">
            <option value="Yes" />
            <option value="No" />
          </datalist>
          <datalist id="cell-status">
            {ALL_SUBSTAGE_IDS.map((stage) => (
              <option key={stage} value={stage} />
            ))}
          </datalist>
          <datalist id="cell-stocking">
            {stockingOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id="cell-port">
            {portOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        {rangeStats && (
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-700"
            role="status"
            aria-live="polite"
          >
            <span className="text-slate-500">{rangeStats.cellCount} cells</span>
            {rangeStats.numCount > 0 ? (
              <>
                <span>
                  <span className="text-slate-500">Sum </span>
                  <span className="font-semibold text-slate-900">
                    {rangeStats.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </span>
                <span>
                  <span className="text-slate-500">Count </span>
                  <span className="font-medium">{rangeStats.numCount}</span>
                </span>
                {rangeStats.avg != null && (
                  <span>
                    <span className="text-slate-500">Avg </span>
                    <span className="font-medium">
                      {rangeStats.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500">No numeric values in selection</span>
            )}
          </div>
        )}
      </div>

      {openCol && popPos && (
        <FilterPopover
          label={COLUMNS.find((c) => (c.key as string) === openCol)!.label}
          values={distinctByCol[openCol] ?? []}
          filter={filters[openCol] ?? { search: "", selected: [] }}
          pos={popPos}
          onSearch={(s) => setColFilter(openCol, { search: s })}
          onToggle={(v) => toggleValue(openCol, v)}
          onSelectAll={() => setColFilter(openCol, { selected: [] })}
          onClear={() => setColFilter(openCol, { search: "", selected: [] })}
          onClose={() => closeFilter(false)}
          onEscape={() => closeFilter(true)}
        />
      )}

      {statusPo && (
        <StatusChangeDialog
          po={statusPo}
          master={master}
          onClose={() => setStatusPo(null)}
          onSaved={(updated) => {
            setPos((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            setDrafts((prev) => {
              const row = prev[updated.id];
              if (!row?.status) return prev;
              const nextRow = { ...row };
              delete nextRow.status;
              const next = { ...prev };
              if (Object.keys(nextRow).length) next[updated.id] = nextRow;
              else delete next[updated.id];
              draftsRef.current = next;
              return next;
            });
            setStatusPo(null);
            notifyPoUpdated();
          }}
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
            setDrafts((prev) => {
              if (!prev[po.id]) return prev;
              const next = { ...prev };
              delete next[po.id];
              draftsRef.current = next;
              return next;
            });
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
