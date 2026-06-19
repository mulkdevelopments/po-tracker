import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { fmtMoney, fmtNum } from "../utils";
import {
  computeMonthly,
  computeCapacity,
  availableYears,
  MONTH_NAMES,
  type StatusSlice,
} from "../reports";
import type { PurchaseOrder, AppConfigData } from "../types";

const STATUS_PALETTE = [
  "#64748b", "#f59e0b", "#eab308", "#fb923c", "#3b82f6",
  "#06b6d4", "#8b5cf6", "#6366f1", "#10b981", "#ec4899", "#ef4444",
];

export function StatusDoughnut({
  data,
  year,
  onSelect,
}: {
  data: StatusSlice[];
  year: number;
  onSelect: (status: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="font-semibold text-slate-900 mb-1">Status Mix</div>
      <div className="text-[11px] text-slate-400 mb-2">PO date {year} · click a slice for the PO list</div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="status"
            innerRadius={50}
            outerRadius={85}
            paddingAngle={2}
            onClick={(d: unknown) => {
              const slice = d as { status?: string };
              if (slice?.status) onSelect(slice.status);
            }}
            cursor="pointer"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={STATUS_PALETTE[i % STATUS_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className={`rounded-lg p-3 ${tone}`}>
      <div className="text-[11px] uppercase opacity-80">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-[11px] opacity-80">{sub}</div>}
    </div>
  );
}

export function DashboardYearFilter({
  pos,
  year,
  onYear,
}: {
  pos: PurchaseOrder[];
  year: number;
  onYear: (y: number) => void;
}) {
  const years = availableYears(pos);
  return (
    <div className="flex items-center justify-end gap-2">
      <label htmlFor="dashboard-year" className="text-sm text-slate-600">
        Year
      </label>
      <select
        id="dashboard-year"
        value={year}
        onChange={(e) => onYear(Number(e.target.value))}
        className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AnnualSalesPanel({ pos, year }: { pos: PurchaseOrder[]; year: number }) {
  const months = computeMonthly(pos, year);
  const totRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const totM2 = months.reduce((s, m) => s + m.m2, 0);
  const totContainers = months.reduce((s, m) => s + m.containers, 0);
  const totPaid = months.reduce((s, m) => s + m.paid, 0);
  const bestIdx = months.reduce((b, m, i, arr) => (m.revenue > arr[b].revenue ? i : b), 0);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="mb-3">
        <div className="font-semibold text-slate-900">Annual Sales — {year}</div>
        <div className="text-xs text-slate-500">Sum of Commercial Invoice value by CI date. HQ / Sales view.</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="YTD Revenue invoiced" value={fmtMoney(totRevenue)} tone="bg-violet-50 text-violet-900" />
        <Tile label="YTD M² invoiced" value={fmtNum(totM2, 0)} tone="bg-amber-50 text-amber-900" />
        <Tile label="YTD Containers shipped" value={String(totContainers)} tone="bg-blue-50 text-blue-900" />
        <Tile label="YTD Cash collected" value={fmtMoney(totPaid)} tone="bg-emerald-50 text-emerald-900" />
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" fontSize={11} />
          <YAxis yAxisId="rev" fontSize={11} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
          <YAxis yAxisId="m2" orientation="right" fontSize={11} />
          <YAxis yAxisId="ctr" hide />
          <Tooltip
            formatter={(value, name) => {
              const v = Number(value);
              const n = String(name);
              if (n === "Revenue ($)") return [fmtMoney(v), n];
              if (n === "M² invoiced") return [fmtNum(v, 0), n];
              return [String(value), n];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="rev" dataKey="revenue" name="Revenue ($)" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          <Bar yAxisId="m2" dataKey="m2" name="M² invoiced" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          <Line yAxisId="ctr" type="monotone" dataKey="containers" name="Containers shipped" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto mt-4">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Metric</th>
              {MONTH_NAMES.map((m, i) => (
                <th key={m} className={`text-right ${i === bestIdx ? "bg-violet-50" : ""}`}>{m}</th>
              ))}
              <th className="text-right">YTD</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-semibold">Revenue invoiced</td>
              {months.map((m, i) => (
                <td key={i} className={`text-right ${m.revenue ? "font-semibold" : "text-slate-300"} ${i === bestIdx ? "bg-violet-50" : ""}`}>
                  {m.revenue ? fmtMoney(m.revenue) : "—"}
                </td>
              ))}
              <td className="text-right font-bold">{fmtMoney(totRevenue)}</td>
            </tr>
            <tr>
              <td className="font-semibold">M² invoiced</td>
              {months.map((m, i) => (
                <td key={i} className={`text-right ${m.m2 ? "" : "text-slate-300"} ${i === bestIdx ? "bg-violet-50" : ""}`}>
                  {m.m2 ? fmtNum(m.m2, 0) : "—"}
                </td>
              ))}
              <td className="text-right font-bold">{fmtNum(totM2, 0)}</td>
            </tr>
            <tr>
              <td className="font-semibold">Containers shipped</td>
              {months.map((m, i) => (
                <td key={i} className={`text-right ${m.containers ? "" : "text-slate-300"} ${i === bestIdx ? "bg-violet-50" : ""}`}>
                  {m.containers || "—"}
                </td>
              ))}
              <td className="text-right font-bold">{totContainers}</td>
            </tr>
            <tr>
              <td>Cash collected</td>
              {months.map((m, i) => (
                <td key={i} className={`text-right ${m.paid ? "" : "text-slate-300"} ${i === bestIdx ? "bg-violet-50" : ""}`}>
                  {m.paid ? fmtMoney(m.paid) : "—"}
                </td>
              ))}
              <td className="text-right font-semibold">{fmtMoney(totPaid)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CapacityPanel({
  pos,
  year,
  config,
  canEditMaster,
}: {
  pos: PurchaseOrder[];
  year: number;
  config: AppConfigData;
  canEditMaster?: boolean;
}) {
  const c = {
    lines: Number(config.productionLines) || 2,
    m2PerLinePerDay: Number(config.m2PerLinePerDay) || 3000,
    m2PerContainer: Number(config.m2PerContainer) || 8300,
    workingDaysPerMonth: Number(config.workingDaysPerMonth) || 26,
  };
  const rows = computeCapacity(pos, year, c);
  const totalActual = rows.reduce((s, r) => s + r.containers, 0);
  const totalCapacity = rows.reduce((s, r) => s + r.capContainers, 0);
  const ytdUtil = totalCapacity ? (totalActual / totalCapacity) * 100 : 0;
  const m2PerMonth = c.lines * c.m2PerLinePerDay * c.workingDaysPerMonth;
  const containersPerMonth = c.m2PerContainer ? m2PerMonth / c.m2PerContainer : 0;
  const utilTone = ytdUtil >= 85 ? "bg-emerald-50 text-emerald-900" : ytdUtil >= 60 ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-900";

  const chartData = rows.map((r) => ({
    month: r.month,
    Actual: r.containers,
    Capacity: Math.round(r.capContainers * 10) / 10,
  }));

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div>
          <div className="font-semibold text-slate-900">Production — Actual vs Capacity ({year})</div>
          <div className="text-xs text-slate-500">Containers shipped per month vs theoretical capacity. Current month pro-rated to today.</div>
        </div>
        <span className="ml-auto text-[11px] bg-slate-100 text-slate-700 px-2 py-1 rounded-md">HQ / Sales view</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-sm">
        {([
          ["Production lines", c.lines],
          ["m² / line / day", fmtNum(c.m2PerLinePerDay, 0)],
          ["m² / container", fmtNum(c.m2PerContainer, 0)],
          ["Working days / month", c.workingDaysPerMonth],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-md bg-slate-50 border border-slate-100 px-2 py-1.5">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="font-medium text-slate-900">{value}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-500 mb-4">
        {canEditMaster ? (
          <>Capacity assumptions are configured in <Link to="/master" className="text-indigo-600 hover:underline">Master Data → Production Capacity</Link>.</>
        ) : (
          <>Capacity assumptions are configured in Master Data → Production Capacity.</>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="Monthly capacity" value={`${containersPerMonth.toFixed(1)} ctr`} sub={`${fmtNum(m2PerMonth, 0)} m²`} tone="bg-blue-50 text-blue-900" />
        <Tile label="YTD actual containers" value={String(totalActual)} tone="bg-emerald-50 text-emerald-900" />
        <Tile label="YTD theoretical capacity" value={`${totalCapacity.toFixed(1)} ctr`} tone="bg-amber-50 text-amber-900" />
        <Tile label="YTD utilization" value={`${ytdUtil.toFixed(1)}%`} sub={`${(totalCapacity - totalActual).toFixed(1)} ctr headroom`} tone={utilTone} />
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Capacity" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Actual" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
