import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import PoDrawer from "../components/PoDrawer";
import type { PurchaseOrder, MasterData } from "../types";
import { fmtNum, fmtDate, fmtMoney } from "../utils";
import { resolveGrossInvoiceValue } from "../paymentFlags";
import { compareProductionOrder } from "../productionSchedule";

const STATUS_STYLES: Record<string, string> = {
  "UNDER PRODUCTION": "bg-blue-100 text-blue-700",
  "PRODUCTION COMPLETE": "bg-teal-100 text-teal-700",
  "CONTAINER BOOKED": "bg-violet-100 text-violet-700",
  "ON HOLD": "bg-red-100 text-red-700",
  SHIPPED: "bg-emerald-100 text-emerald-700",
};

const PROD_STATUSES = ["UNDER PRODUCTION", "PRODUCTION COMPLETE", "CONTAINER BOOKED", "ON HOLD", "SHIPPED"];

export default function ProductionPage() {
  const { user, canEdit } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [master, setMaster] = useState<MasterData>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [onlyScheduled, setOnlyScheduled] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const writable = canEdit();

  const load = async () => {
    const [{ pos: list }, settings] = await Promise.all([api.getOrders(), api.getSettings()]);
    setPos(list);
    setMaster(settings.master);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const isScheduled = (p: PurchaseOrder) =>
    !!(
      p.soNo ||
      p.productionStatus ||
      p.productionBegin ||
      p.productionComplete ||
      p.dispatchFromFactory ||
      p.allMaterialAvailable ||
      p.productionSequence != null
    );

  const rows = useMemo(() => {
    const filtered = pos.filter((p) => {
      if (onlyScheduled && !isScheduled(p)) return false;
      if (statusFilter && (p.productionStatus || "") !== statusFilter) return false;
      if (q) {
        const hay = `${p.poNo} ${p.soNo ?? ""} ${p.stockingLocation ?? ""} ${p.productionNotes ?? ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    return [...filtered].sort(compareProductionOrder);
  }, [pos, q, statusFilter, onlyScheduled]);

  const statusPill = (s?: string | null) => {
    if (!s) return <span className="text-slate-300">—</span>;
    const cls = STATUS_STYLES[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
  };

  const persistOrder = async (ordered: PurchaseOrder[]) => {
    setBusy(true);
    try {
      const { pos: updated } = await api.reorderProduction(ordered.map((p) => p.id));
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
    // Optimistic local sequence for display
    setPos((prev) => {
      const seqMap = new Map(list.map((p, i) => [p.id, (i + 1) * 10]));
      return prev.map((p) => (seqMap.has(p.id) ? { ...p, productionSequence: seqMap.get(p.id)! } : p));
    });
    await persistOrder(list);
  };

  const saveSeq = async (p: PurchaseOrder, raw: string) => {
    const n = raw.trim() === "" ? null : Math.round(Number(raw));
    if (raw.trim() !== "" && !Number.isFinite(n)) return;
    if (n === (p.productionSequence ?? null)) return;
    setBusy(true);
    try {
      const { po } = await api.updateOrder(p.id, { productionSequence: n });
      setPos((prev) => prev.map((x) => (x.id === po.id ? po : x)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update sequence");
    } finally {
      setBusy(false);
    }
  };

  const recalculate = async () => {
    if (
      !confirm(
        "Recalculate planned production dates from priority, sequence, material availability, and capacity? Existing begin/complete dates for eligible POs will be overwritten.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { pos: list, updatedCount } = await api.recalculateProduction();
      setPos(list);
      alert(`Updated ${updatedCount} order(s).`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Recalculate failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-slate-500">Loading production schedule…</div>;

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
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
            <option value="">All statuses</option>
            {PROD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={onlyScheduled} onChange={(e) => setOnlyScheduled(e.target.checked)} />
            Only scheduled
          </label>
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
        {writable && (
          <div className="px-3 py-1.5 text-[11px] text-slate-500 border-b border-slate-100 bg-slate-50">
            Drag rows to reprioritize within the list, or edit Seq. High priority sorts first. Recalculate uses material date + capacity.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                {writable && <th className="w-8"></th>}
                <th className="w-14">Seq</th>
                <th>PO #</th>
                <th>Priority</th>
                <th>SO #</th>
                <th>Stocking Loc</th>
                <th className="text-right">M²</th>
                <th className="text-right">PO $</th>
                <th className="text-right">Gross $</th>
                <th>Std Colors</th>
                <th>Material Avail.</th>
                <th>Prod. Begin</th>
                <th>Prod. Complete</th>
                <th>Dispatch</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`cursor-pointer ${dragId === p.id ? "opacity-50 bg-indigo-50" : ""}`}
                  draggable={writable}
                  onDragStart={(e) => {
                    if (!writable) return;
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
                  onDragEnd={() => setDragId(null)}
                  onClick={() => setSelected(p)}
                >
                  {writable && (
                    <td className="text-slate-400 text-center select-none" title="Drag to reorder" onClick={(e) => e.stopPropagation()}>
                      ⋮⋮
                    </td>
                  )}
                  <td onClick={(e) => e.stopPropagation()}>
                    {writable ? (
                      <input
                        type="number"
                        defaultValue={p.productionSequence ?? ""}
                        key={`${p.id}-${p.productionSequence ?? ""}`}
                        className="w-14 border border-slate-300 rounded px-1 py-0.5 text-right tabular-nums"
                        disabled={busy}
                        onBlur={(e) => void saveSeq(p, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : (
                      <span className="tabular-nums">{p.productionSequence ?? "—"}</span>
                    )}
                  </td>
                  <td className="font-mono font-semibold text-slate-900">
                    {p.poNo}{p.rev ? <span className="text-slate-400 ml-1">r{p.rev}</span> : null}
                  </td>
                  <td>
                    <span
                      className={`stage-pill ${(p.priority || "Standard") === "High" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
                    >
                      {p.priority || "Standard"}
                    </span>
                  </td>
                  <td className="font-mono">{p.soNo || <span className="text-slate-300">—</span>}</td>
                  <td>{p.stockingLocation || "—"}</td>
                  <td className="text-right">{fmtNum(p.totalM2, 0)}</td>
                  <td className="text-right">{fmtMoney(p.poValue)}</td>
                  <td className="text-right">{fmtMoney(resolveGrossInvoiceValue(p))}</td>
                  <td>{p.standardColorsOnly || <span className="text-slate-300">—</span>}</td>
                  <td>{p.allMaterialAvailable || <span className="text-slate-300">—</span>}</td>
                  <td>{fmtDate(p.productionBegin) || <span className="text-slate-300">—</span>}</td>
                  <td>{fmtDate(p.productionComplete) || <span className="text-slate-300">—</span>}</td>
                  <td>{fmtDate(p.dispatchFromFactory) || <span className="text-slate-300">—</span>}</td>
                  <td>{statusPill(p.productionStatus)}</td>
                  <td className="max-w-[220px] truncate" title={p.productionNotes || ""}>{p.productionNotes || ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={writable ? 16 : 15} className="text-center text-slate-400 py-8">
                    No production records match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
