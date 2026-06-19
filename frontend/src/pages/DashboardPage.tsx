import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { STAGE_COLORS } from "../types";
import type { PurchaseOrder, ReferenceData, AppConfigData } from "../types";
import { fmtMoney, fmtNum } from "../utils";
import { computeDashboard, statusMix, totalRow, dashboardActiveYearOrders, type VolumeRow } from "../reports";
import { StatusDoughnut, AnnualSalesPanel, CapacityPanel, DashboardYearFilter } from "../components/DashboardCharts";
import PoDrawer from "../components/PoDrawer";
import PiApprovalNotice from "../components/PiApprovalNotice";
import CiApprovalNotice from "../components/CiApprovalNotice";
import StockingEmailNotice from "../components/StockingEmailNotice";
import { usePendingPiApprovals } from "../hooks/usePendingPiApprovals";
import { usePendingCiApprovals } from "../hooks/usePendingCiApprovals";
import { usePendingStockingEmails } from "../hooks/usePendingStockingEmails";
import { isManagerRole, isFinanceRole } from "../piApproval";
import { canMarkStockingEmailRole } from "../stockingEmail";
import { notifyPoUpdated } from "../poEvents";
import type { MasterData } from "../types";

const DASHBOARD_YEAR_KEY = "dashboard_year";

function readStoredYear(): number {
  const raw = localStorage.getItem(DASHBOARD_YEAR_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : new Date().getFullYear();
}

function shortLoc(l: string) {
  return l.split(",")[0];
}

function StatusDetailModal({
  status,
  pos,
  year,
  onClose,
  onSelectPo,
}: {
  status: string;
  pos: PurchaseOrder[];
  year: number;
  onClose: () => void;
  onSelectPo: (po: PurchaseOrder) => void;
}) {
  const matches = dashboardActiveYearOrders(pos, year).filter((p) => p.status === status);
  const totalValue = matches.reduce((s, p) => s + (Number(p.poValue) || 0), 0);
  const totalM2 = matches.reduce((s, p) => s + (Number(p.totalM2) || 0), 0);
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[720px] max-w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
          <div className="font-semibold">{status}</div>
          <div className="text-xs text-slate-500">{matches.length} orders · {fmtMoney(totalValue)} · {fmtNum(totalM2, 0)} m²</div>
          <button type="button" onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        <div className="overflow-auto">
          <table className="tbl w-full text-xs">
            <thead>
              <tr><th>PO #</th><th>Stocking Location</th><th>PO Date</th><th className="text-right">M²</th><th className="text-right">Value</th></tr>
            </thead>
            <tbody>
              {matches.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => onSelectPo(p)}
                >
                  <td className="font-mono font-semibold text-slate-900">{p.poNo}</td>
                  <td>{p.stockingLocation || "—"}</td>
                  <td>{p.poDate || "—"}</td>
                  <td className="text-right">{fmtNum(p.totalM2, 0)}</td>
                  <td className="text-right">{fmtMoney(p.poValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VolumeTable({ title, rows, year }: { title: string; rows: VolumeRow[]; year: number }) {
  const t = totalRow(rows);
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="font-semibold text-slate-900 mb-1">{title}</div>
      <div className="text-xs text-slate-500 mb-3">PO date {year}</div>
      <div className="overflow-x-auto">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Color</th>
              <th className="text-right">Sheets</th>
              <th className="text-right">MSF</th>
              <th className="text-right">M²</th>
              <th className="text-right">$</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className={r.isStandard ? "text-violet-700 font-medium" : ""}>{r.label}</td>
                <td className="text-right">{fmtNum(r.sheets, 0)}</td>
                <td className="text-right">{fmtNum(r.msf, 1)}</td>
                <td className="text-right">{fmtNum(r.m2, 0)}</td>
                <td className="text-right">{fmtMoney(r.value)}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-slate-50">
              <td>TOTALS</td>
              <td className="text-right">{fmtNum(t.sheets, 0)}</td>
              <td className="text-right">{fmtNum(t.msf, 1)}</td>
              <td className="text-right">{fmtNum(t.m2, 0)}</td>
              <td className="text-right">{fmtMoney(t.value)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, canEdit } = useAuth();
  const isManager = isManagerRole(user?.role);
  const isFinance = isFinanceRole(user?.role);
  const showStockingEmailQueue = canMarkStockingEmailRole(user?.role);
  const { pending: pendingPi } = usePendingPiApprovals(isManager);
  const { pending: pendingCi } = usePendingCiApprovals(isFinance);
  const { pending: pendingStockingEmail } = usePendingStockingEmails(!!showStockingEmailQueue);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [config, setConfig] = useState<AppConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(readStoredYear);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [master, setMaster] = useState<MasterData>({});

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.getOrders(), api.getReference(), api.getSettings()])
      .then(([o, r, settings]) => {
        setPos(o.pos);
        setRef(r);
        setConfig(r.config);
        setMaster(settings.master);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => setLoading(false));
  }, []);

  const setDashboardYear = (y: number) => {
    setYear(y);
    localStorage.setItem(DASHBOARD_YEAR_KEY, String(y));
  };

  const openPoFromStatusModal = (po: PurchaseOrder) => {
    setStatusDetail(null);
    setSelected(po);
  };

  if (loading) return <div className="text-slate-500">Loading dashboard…</div>;
  if (error || !ref) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        {error ?? "Failed to load dashboard data."}
      </div>
    );
  }

  const d = computeDashboard(pos, ref, year);
  const mix = statusMix(pos, year);
  const showFinance = user?.role === "FINANCE" || user?.role === "MANAGER" || user?.role === "MAINTAINER" || user?.role === "SUPER_ADMIN";
  const yearScope = `PO date in ${year} · Total PO includes inactive`;

  const stagePill = (s: string) => {
    const cls = STAGE_COLORS[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
  };

  return (
    <div className="space-y-6">
      {isManager && pendingPi.length > 0 && (
        <PiApprovalNotice pending={pendingPi} onOpenPo={(po) => setSelected(po)} />
      )}
      {isFinance && pendingCi.length > 0 && (
        <CiApprovalNotice pending={pendingCi} onOpenPo={(po) => setSelected(po)} />
      )}
      {showStockingEmailQueue && pendingStockingEmail.length > 0 && (
        <StockingEmailNotice pending={pendingStockingEmail} onOpenPo={(po) => setSelected(po)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{yearScope}</p>
        <DashboardYearFilter pos={pos} year={year} onYear={setDashboardYear} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          ["Total PO", String(d.kpis.activeCount), "text-slate-800"],
          ["Open Orders", String(d.kpis.openOrders), "text-blue-700"],
          ["Shipped", String(d.kpis.shipped), "text-indigo-700"],
          ["Arrived", String(d.kpis.arrived), "text-emerald-700"],
          ["Total PO Value", fmtMoney(d.kpis.totalValue), "text-violet-700"],
        ].map(([label, val, cls]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className={`text-2xl font-bold ${cls}`}>{val}</div>
          </div>
        ))}
      </div>

      {showFinance && <AnnualSalesPanel pos={pos} year={year} />}
      {showFinance && config && (
        <CapacityPanel pos={pos} year={year} config={config} canEditMaster={canEdit()} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-4">
          <div className="font-semibold text-slate-900 mb-1">Order Status by Stocking Location</div>
          <div className="text-xs text-slate-500 mb-3">{yearScope}</div>
          <div className="overflow-x-auto">
            <table className="tbl w-full text-xs">
              <thead>
                <tr>
                  <th>Stage</th>
                  {d.locations.map((l) => (
                    <th key={l} className="text-right">{shortLoc(l)}</th>
                  ))}
                  <th className="text-right">Totals</th>
                </tr>
              </thead>
              <tbody>
                {d.statusRows.map((row) => (
                  <tr key={row.stage} className="cursor-pointer" onClick={() => setStatusDetail(row.stage)}>
                    <td>{stagePill(row.stage)}</td>
                    {row.counts.map((c, i) => (
                      <td key={i} className={`text-right ${c ? "font-semibold" : "text-slate-300"}`}>{c || "—"}</td>
                    ))}
                    <td className="text-right font-semibold">{row.total}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td>TOTALS</td>
                  {d.totalsRow.counts.map((c, i) => (
                    <td key={i} className="text-right">{c || "—"}</td>
                  ))}
                  <td className="text-right">{d.totalsRow.total}</td>
                </tr>
                <tr className="border-t-2 border-slate-200">
                  <td className="text-emerald-700 font-medium">Arrived</td>
                  {d.arrivedRow.counts.map((c, i) => (
                    <td key={i} className={`text-right ${c ? "font-semibold" : "text-slate-300"}`}>{c || "—"}</td>
                  ))}
                  <td className="text-right font-semibold">{d.arrivedRow.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {d.summaryRows.map((s) => (
              <div key={s.label} className="border border-slate-200 rounded-md px-3 py-2 flex justify-between">
                <span className="text-sm text-slate-600">{s.label}</span>
                <span className="font-semibold">{s.total}</span>
              </div>
            ))}
          </div>
        </div>
        <StatusDoughnut data={mix} year={year} onSelect={setStatusDetail} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <VolumeTable title="Total Volume" rows={d.volumeTotal} year={year} />
        <VolumeTable title="Volume On Order (Not Shipped)" rows={d.volumeNotShipped} year={year} />
        <VolumeTable title="Volume Shipped" rows={d.volumeShipped} year={year} />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="font-semibold text-slate-900 mb-1">Cycle Times & Outstanding</div>
        <div className="text-xs text-slate-500 mb-3">{yearScope}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {d.cycle.map((c) => (
            <div key={c.title} className="border border-slate-200 rounded-md p-3">
              <div className="text-sm font-medium text-slate-800 mb-2">{c.title}</div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-bold text-slate-900">{c.avgDays ?? "—"}</span>
                <span className="text-xs text-slate-500">avg days</span>
              </div>
              <div className="space-y-1">
                {c.metrics.map((m) => (
                  <div key={m.label} className="flex justify-between text-xs">
                    <span className="text-slate-500">{m.label}</span>
                    <span className="font-semibold text-slate-800">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {statusDetail && (
        <StatusDetailModal
          status={statusDetail}
          pos={pos}
          year={year}
          onClose={() => setStatusDetail(null)}
          onSelectPo={openPoFromStatusModal}
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
            notifyPoUpdated();
          }}
          canEdit={canEdit()}
        />
      )}
    </div>
  );
}
