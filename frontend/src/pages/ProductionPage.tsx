import { useEffect, useMemo, useRef, useState } from "react";
import { ListFilter, X } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import PoDrawer from "../components/PoDrawer";
import { FilterPopover, type ColFilter } from "../components/ColumnFilter";
import type { PurchaseOrder, MasterData } from "../types";
import { fmtNum, fmtDate, dateSortKey } from "../utils";
import { resolveGrossInvoiceValue } from "../paymentFlags";
import { compareProductionOrder, hasNonStandardColors, isOnProductionBoard } from "../productionSchedule";

const STATUS_STYLES: Record<string, string> = {
  "UNDER PRODUCTION": "bg-blue-100 text-blue-700",
  "PRODUCTION COMPLETE": "bg-teal-100 text-teal-700",
  "CONTAINER BOOKED": "bg-violet-100 text-violet-700",
  "ON HOLD": "bg-red-100 text-red-700",
  SHIPPED: "bg-emerald-100 text-emerald-700",
};

type DateKey = "productionBegin" | "productionComplete" | "dispatchFromFactory";
type FlagKey = "productionBeginConfirmed" | "productionCompleteConfirmed" | "dispatchConfirmed";

const DATE_FLAGS: Record<DateKey, FlagKey> = {
  productionBegin: "productionBeginConfirmed",
  productionComplete: "productionCompleteConfirmed",
  dispatchFromFactory: "dispatchConfirmed",
};

type ColType = "text" | "num" | "money" | "date" | "status";

interface ProdCol {
  key: string;
  label: string;
  type: ColType;
  numeric?: boolean;
}

const COLUMNS: ProdCol[] = [
  { key: "poNo", label: "PO #", type: "text" },
  { key: "soNo", label: "SO #", type: "text" },
  { key: "stockingLocation", label: "Stocking Loc", type: "text" },
  { key: "totalM2", label: "M²", type: "num", numeric: true },
  { key: "poValue", label: "PO", type: "money", numeric: true },
  { key: "gross", label: "Gross", type: "money", numeric: true },
  { key: "standardColorsOnly", label: "Std Colors", type: "text" },
  { key: "allMaterialAvailable", label: "Material Avail.", type: "text" },
  { key: "productionBegin", label: "Prod. Begin", type: "date" },
  { key: "productionEtc", label: "Production ETC (in Container)", type: "date" },
  { key: "dispatchFromFactory", label: "Dispatch", type: "date" },
  { key: "productionStatus", label: "Status", type: "status" },
  { key: "productionNotes", label: "Notes", type: "text" },
];

function isUrgent(p: PurchaseOrder) {
  return (p.priority || "Standard") === "High";
}

function cellText(p: PurchaseOrder, col: ProdCol): string {
  if (col.key === "gross") {
    const n = resolveGrossInvoiceValue(p);
    return n == null ? "" : fmtNum(n, 2);
  }
  if (col.key === "poValue") return p.poValue == null ? "" : fmtNum(p.poValue, 2);
  if (col.key === "totalM2") return p.totalM2 == null ? "" : fmtNum(p.totalM2, 0);
  if (col.key === "allMaterialAvailable") return fmtDate(p.allMaterialAvailable);
  if (col.key === "productionEtc") {
    const raw = p.productionEtc || p.productionComplete;
    return raw ? fmtDate(raw) : "";
  }
  if (col.type === "date") {
    const raw = p[col.key as DateKey];
    return raw ? fmtDate(raw) : "";
  }
  const raw = p[col.key as keyof PurchaseOrder];
  if (raw == null || raw === "") return "";
  return String(raw);
}

export default function ProductionPage() {
  const { user, canEdit } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [master, setMaster] = useState<MasterData>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [q, setQ] = useState("");
  const [onlyScheduled, setOnlyScheduled] = useState(true);
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
  const [openCol, setOpenCol] = useState<string | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const dragged = useRef(false);
  const filterOpenerRef = useRef<HTMLButtonElement | null>(null);
  const writable = canEdit();

  const load = async () => {
    const [{ pos: list }, settings] = await Promise.all([api.getOrders(), api.getSettings()]);
    setPos(list);
    setMaster(settings.master);
    setLoading(false);
    return list;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled || !writable) return;
      try {
        const filled = await api.recalculateProduction("fill");
        if (!cancelled) setPos(filled.pos);
      } catch {
        /* The board still shows the saved rows. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [writable]);

  const board = useMemo(() => {
    return pos.filter((p) => {
      if (onlyScheduled && !isOnProductionBoard(p)) return false;
      if (q) {
        const hay = `${p.poNo} ${p.soNo ?? ""} ${p.stockingLocation ?? ""} ${p.productionNotes ?? ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [pos, q, onlyScheduled]);

  const distinctByCol = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      const set = new Set<string>();
      for (const p of board) set.add(cellText(p, col));
      const arr = Array.from(set);
      arr.sort((a, b) => {
        if (a === "") return 1;
        if (b === "") return -1;
        if (col.type === "date") return dateSortKey(a).localeCompare(dateSortKey(b));
        if (col.numeric) {
          const na = Number(String(a).replace(/[^0-9.-]/g, ""));
          const nb = Number(String(b).replace(/[^0-9.-]/g, ""));
          if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        }
        return a.localeCompare(b);
      });
      map[col.key] = arr;
    }
    return map;
  }, [board]);

  const rows = useMemo(() => {
    const filtered = board.filter((p) => {
      for (const col of COLUMNS) {
        const f = filters[col.key];
        if (!f) continue;
        const disp = cellText(p, col);
        if (f.selected.length && !f.selected.includes(disp)) return false;
        if (f.search && !disp.toLowerCase().includes(f.search.toLowerCase())) return false;
      }
      return true;
    });
    return [...filtered].sort(compareProductionOrder);
  }, [board, filters]);

  const activeFilterCount = Object.values(filters).filter((f) => f.search || f.selected.length).length;

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

  const statusPill = (s?: string | null) => {
    if (!s) return <span className="text-slate-300">—</span>;
    const cls = STATUS_STYLES[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
  };

  const persistOrder = async (ordered: PurchaseOrder[]) => {
    setBusy(true);
    try {
      const { pos: updated } = await api.reorderProduction(
        ordered.map((p) => p.id),
        ordered.filter(isUrgent).map((p) => p.id),
      );
      const byId = new Map(updated.map((p) => [p.id, p]));
      setPos((prev) => prev.map((p) => byId.get(p.id) ?? p));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reorder failed");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onDropOn = async (targetId: number) => {
    if (dragId == null || dragId === targetId || !writable) {
      setDragId(null);
      return;
    }
    const list = [...rows];
    const from = list.findIndex((p) => p.id === dragId);
    const to = list.findIndex((p) => p.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const above = to > 0 ? list[to - 1] : null;
    list[to] = { ...moved, priority: !above || isUrgent(above) ? "High" : "Standard" };
    setPos((prev) => {
      const seqMap = new Map(list.map((p, i) => [p.id, { seq: (i + 1) * 10, priority: p.priority }]));
      return prev.map((p) => {
        const hit = seqMap.get(p.id);
        return hit ? { ...p, productionSequence: hit.seq, priority: hit.priority ?? p.priority } : p;
      });
    });
    await persistOrder(list);
  };

  const confirmDate = async (p: PurchaseOrder, flag: FlagKey, value: boolean, extra?: Record<string, unknown>) => {
    if (!writable) return;
    setBusy(true);
    try {
      const { po } = await api.updateOrder(p.id, { [flag]: value, ...extra });
      setPos((prev) => prev.map((x) => (x.id === po.id ? po : x)));
      setSelected((cur) => (cur?.id === po.id ? po : cur));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update the date");
    } finally {
      setBusy(false);
    }
  };

  const recalculate = async () => {
    if (
      !confirm(
        "Recalculate the schedule? Completion is 2 days after the production start, and dispatch is 3 days after completion. A start date marked correct is kept.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { pos: list, updatedCount, statusCount } = await api.recalculateProduction("replan");
      setPos(list);
      alert(`Updated dates on ${updatedCount} order(s)${statusCount ? ` · status moved on ${statusCount}` : ""}.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Recalculate failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-slate-500">Loading production schedule…</div>;

  const openColumn = COLUMNS.find((c) => c.key === openCol);

  return (
    <>
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-3 flex items-center gap-3 border-b border-slate-200 flex-wrap">
          <input
            placeholder="Search PO#, SO#, location, notes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72"
          />
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={onlyScheduled} onChange={(e) => setOnlyScheduled(e.target.checked)} />
            Only scheduled
          </label>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md px-2.5 py-1.5"
            >
              <X size={14} /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
            </button>
          )}
          {writable && (
            <button
              type="button"
              disabled={busy}
              onClick={recalculate}
              className="px-3 py-1.5 text-sm rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
            >
              Recalculate schedule
            </button>
          )}
          <span className="text-sm text-slate-500 ml-auto">{rows.length} orders</span>
        </div>
        <div className="px-3 py-1.5 text-[11px] text-slate-500 border-b border-slate-100 bg-slate-50">
          Unshipped rows are yellow. Drag a row to the top to mark it urgent. Yellow dates are tentative and green dates are correct.
          {" "}Command+Down or Option+Down opens a column filter, arrows move the selection, and Esc closes it.
          {writable ? " Click a date to switch it." : ""} A rose PO # uses non-standard colours.
        </div>
        <div
          className="overflow-x-auto"
          onScroll={() => {
            if (openCol) closeFilter(false);
          }}
        >
          <table className="tbl prod-grid w-full text-xs">
            <thead>
              <tr>
                {writable && <th className="w-8"></th>}
                {COLUMNS.map((col) => {
                  const active = !!filters[col.key];
                  return (
                    <th key={col.key} className={`${col.key === "productionEtc" ? "min-w-[200px]" : ""} ${active ? "col-filtered" : ""}`}>
                      <div className="th-inner">
                        <span className="th-label" title={col.label}>{col.label}</span>
                        <button
                          type="button"
                          className={`th-filter ${active ? "th-filter-active" : ""}`}
                          aria-label={`Filter ${col.label}`}
                          aria-haspopup="dialog"
                          aria-expanded={openCol === col.key}
                          aria-keyshortcuts="Alt+ArrowDown Meta+ArrowDown"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFilter(e.currentTarget, col.key);
                          }}
                          onKeyDown={(e) => {
                            if ((e.altKey || e.metaKey) && e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (openCol !== col.key) placeFilter(e.currentTarget, col.key);
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
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`cursor-pointer ${(p.productionStatus || "") !== "SHIPPED" ? "row-not-shipped" : ""} ${isUrgent(p) ? "row-urgent" : ""} ${dragId === p.id ? "opacity-50" : ""}`}
                  draggable={writable}
                  onDragStart={(e) => {
                    if (!writable) return;
                    dragged.current = true;
                    setDragId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (!writable || dragId == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void onDropOn(p.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    window.setTimeout(() => {
                      dragged.current = false;
                    }, 0);
                  }}
                  onClick={() => {
                    if (dragged.current) {
                      dragged.current = false;
                      return;
                    }
                    setSelected(p);
                  }}
                >
                  {writable && (
                    <td className="text-slate-400 text-center select-none" title="Drag to reorder" onClick={(e) => e.stopPropagation()}>
                      ⋮⋮
                    </td>
                  )}
                  {COLUMNS.map((col) => {
                    if (col.type === "date") {
                      const isEtc = col.key === "productionEtc";
                      const key = (isEtc ? "productionComplete" : col.key) as DateKey;
                      const raw = isEtc ? p.productionEtc || p.productionComplete : p[key];
                      const confirmed = !!p[DATE_FLAGS[key]];
                      return (
                        <td
                          key={col.key}
                          className={raw ? (confirmed ? "date-correct" : "date-tentative") : ""}
                          title={
                            raw
                              ? confirmed
                                ? "Correct date. Click to mark it tentative."
                                : "Tentative date. Click to mark it correct."
                              : undefined
                          }
                          onClick={(e) => {
                            if (!writable || !raw) return;
                            e.stopPropagation();
                            void confirmDate(
                              p,
                              DATE_FLAGS[key],
                              !confirmed,
                              isEtc && !p.productionEtc ? { productionEtc: raw } : undefined,
                            );
                          }}
                        >
                          {raw ? fmtDate(raw) : <span className="text-slate-300">—</span>}
                        </td>
                      );
                    }
                    if (col.key === "poNo") {
                      const nonStd = hasNonStandardColors(p.standardColorsOnly);
                      return (
                        <td key={col.key} className="font-mono">
                          <span className={nonStd ? "po-nonstandard" : "font-semibold text-slate-900"} title={nonStd ? "Non-standard colours" : undefined}>
                            {p.poNo}
                            {p.rev ? <span className={nonStd ? "ml-1" : "text-slate-400 ml-1"}>r{p.rev}</span> : null}
                          </span>
                        </td>
                      );
                    }
                    if (col.key === "productionStatus") return <td key={col.key}>{statusPill(p.productionStatus)}</td>;
                    if (col.key === "productionNotes") {
                      return (
                        <td key={col.key} className="max-w-[220px] truncate" title={p.productionNotes || ""}>
                          {p.productionNotes || ""}
                        </td>
                      );
                    }
                    const text = cellText(p, col);
                    return (
                      <td key={col.key} className={col.numeric ? "text-right tabular-nums" : col.key === "soNo" ? "font-mono" : ""}>
                        {text || <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + (writable ? 1 : 0)} className="text-center text-slate-400 py-8">
                    No production records match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openCol && popPos && openColumn && (
        <FilterPopover
          label={openColumn.label}
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

      {selected && user && (
        <PoDrawer
          po={selected}
          user={user}
          master={master}
          onClose={() => setSelected(null)}
          onUpdated={(po) => { setPos((prev) => prev.map((x) => (x.id === po.id ? po : x))); setSelected(po); }}
          onDeleted={(id) => { setPos((prev) => prev.filter((x) => x.id !== id)); setSelected(null); }}
          canEdit={writable}
        />
      )}
    </>
  );
}
