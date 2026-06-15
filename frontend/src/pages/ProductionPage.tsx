import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import PoDrawer from "../components/PoDrawer";
import type { PurchaseOrder, MasterData } from "../types";
import { fmtNum, fmtDate } from "../utils";

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

  const load = async () => {
    const [{ pos: list }, settings] = await Promise.all([api.getOrders(), api.getSettings()]);
    setPos(list);
    setMaster(settings.master);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const isScheduled = (p: PurchaseOrder) =>
    !!(p.soNo || p.productionStatus || p.productionBegin || p.productionComplete || p.dispatchFromFactory);

  const rows = useMemo(() => {
    return pos.filter((p) => {
      if (onlyScheduled && !isScheduled(p)) return false;
      if (statusFilter && (p.productionStatus || "") !== statusFilter) return false;
      if (q) {
        const hay = `${p.poNo} ${p.soNo ?? ""} ${p.stockingLocation ?? ""} ${p.productionNotes ?? ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [pos, q, statusFilter, onlyScheduled]);

  const statusPill = (s?: string | null) => {
    if (!s) return <span className="text-slate-300">—</span>;
    const cls = STATUS_STYLES[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
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
          <span className="text-sm text-slate-500 ml-auto">{rows.length} orders</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                <th>PO #</th>
                <th>SO #</th>
                <th>Stocking Loc</th>
                <th className="text-right">M²</th>
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
                <tr key={p.id} className="cursor-pointer" onClick={() => setSelected(p)}>
                  <td className="font-mono font-semibold text-slate-900">
                    {p.poNo}{p.rev ? <span className="text-slate-400 ml-1">r{p.rev}</span> : null}
                  </td>
                  <td className="font-mono">{p.soNo || <span className="text-slate-300">—</span>}</td>
                  <td>{p.stockingLocation || "—"}</td>
                  <td className="text-right">{fmtNum(p.totalM2, 0)}</td>
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
                <tr><td colSpan={11} className="text-center text-slate-400 py-8">No production records match.</td></tr>
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
          canEdit={canEdit()}
        />
      )}
    </>
  );
}
