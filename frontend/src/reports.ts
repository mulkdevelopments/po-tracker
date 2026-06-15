import type { PurchaseOrder, ReferenceData } from "./types";

// The 8 real pipeline stages (the source treats "Arrived" as a derived overlay
// based on the arrival date, not a workflow status).
export const PIPELINE_STAGES = [
  "PO Received",
  "Proforma Invoice Sent",
  "Downpayment Received",
  "In Production",
  "Container Loaded",
  "Commercial Invoice Sent",
  "Balance Payment Received",
  "Telex / Seaway Released",
] as const;

const CONTAINER_LOADED_IDX = PIPELINE_STAGES.indexOf("Container Loaded");

function sidx(s: string): number {
  const i = PIPELINE_STAGES.indexOf(s as (typeof PIPELINE_STAGES)[number]);
  return i < 0 ? 0 : i;
}

const has = (v: unknown) => v != null && v !== "" && v !== "N/A";

// "Shipped" = container loaded onward; everything before is backlog / on-order.
export function isShipped(o: PurchaseOrder): boolean {
  return sidx(o.status) >= CONTAINER_LOADED_IDX;
}

function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return isFinite(d) ? Math.round(d) : null;
}

function avg(vals: (number | null)[]): number | null {
  const x = vals.filter((n): n is number => typeof n === "number" && isFinite(n));
  return x.length ? Math.round((x.reduce((a, b) => a + b, 0) / x.length) * 10) / 10 : null;
}

export interface VolumeRow {
  label: string;
  isStandard: boolean;
  sheets: number;
  msf: number;
  m2: number;
  value: number;
}

function volumeByColor(pos: PurchaseOrder[], colors: ReferenceData["colors"]): VolumeRow[] {
  const map = new Map<string, VolumeRow>();
  for (const c of colors) {
    map.set(c.code, {
      label: `${c.code} ${c.name ?? ""}`.trim(),
      isStandard: c.isStandard,
      sheets: 0,
      msf: 0,
      m2: 0,
      value: 0,
    });
  }
  for (const o of pos) {
    for (const l of o.lines) {
      const color = colors.find((c) => (l.color ?? "").startsWith(c.code));
      if (!color) continue;
      const row = map.get(color.code)!;
      row.sheets += Number(l.sheets) || 0;
      row.msf += Number(l.qtyMsf) || 0;
      row.m2 += Number(l.qtyM2) || 0;
      row.value += Number(l.extPo) || 0;
    }
  }
  return colors.map((c) => map.get(c.code)!);
}

export function totalRow(rows: VolumeRow[]): Omit<VolumeRow, "label" | "isStandard"> {
  return {
    sheets: rows.reduce((s, r) => s + r.sheets, 0),
    msf: rows.reduce((s, r) => s + r.msf, 0),
    m2: rows.reduce((s, r) => s + r.m2, 0),
    value: rows.reduce((s, r) => s + r.value, 0),
  };
}

export interface DashboardReport {
  kpis: { openOrders: number; shipped: number; arrived: number; activeCount: number; totalValue: number; totalM2: number };
  locations: string[];
  statusRows: { stage: string; counts: number[]; total: number }[];
  arrivedRow: { counts: number[]; total: number };
  totalsRow: { counts: number[]; total: number };
  summaryRows: { label: string; counts: number[]; total: number }[];
  volumeTotal: VolumeRow[];
  volumeNotShipped: VolumeRow[];
  volumeShipped: VolumeRow[];
  cycle: { title: string; avgDays: number | null; metrics: { label: string; value: string }[] }[];
}

export function computeDashboard(pos: PurchaseOrder[], ref: ReferenceData): DashboardReport {
  const active = pos.filter((p) => p.active !== false);
  const locations = ref.stockingLocations.map((l) => l.name);
  const countBy = (pred: (o: PurchaseOrder) => boolean) => locations.map((loc) => active.filter((o) => o.stockingLocation === loc && pred(o)).length);

  const statusRows = PIPELINE_STAGES.map((stage) => {
    const counts = countBy((o) => o.status === stage);
    return { stage, counts, total: counts.reduce((a, b) => a + b, 0) };
  });
  const arrivedCounts = countBy((o) => has(o.arrivalDate));
  const totalsCounts = locations.map((loc) => active.filter((o) => o.stockingLocation === loc).length);

  const openPred = (o: PurchaseOrder) => !isShipped(o);
  const shippedPred = (o: PurchaseOrder) => isShipped(o);
  const arrivedPred = (o: PurchaseOrder) => has(o.arrivalDate);
  const summaryRows = [
    { label: "Open Orders", counts: countBy(openPred), total: active.filter(openPred).length },
    { label: "Shipped", counts: countBy(shippedPred), total: active.filter(shippedPred).length },
    { label: "Arrived", counts: arrivedCounts, total: active.filter(arrivedPred).length },
  ];

  const notShippedOrders = active.filter((o) => !isShipped(o));
  const shippedOrders = active.filter((o) => isShipped(o));

  const cyc = (poDateA: keyof PurchaseOrder, poDateB: keyof PurchaseOrder) =>
    avg(active.map((o) => daysBetween(o[poDateA] as string, o[poDateB] as string)));
  const sumValue = (pred: (o: PurchaseOrder) => boolean, field: keyof PurchaseOrder) =>
    active.filter(pred).reduce((s, o) => s + (Number(o[field]) || 0), 0);
  const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const cycle = [
    {
      title: "Purchase Order → Proforma Invoice",
      avgDays: cyc("poDate", "piDate"),
      metrics: [{ label: "POs without PIs", value: String(active.filter((o) => !has(o.piNo)).length) }],
    },
    {
      title: "Proforma Invoice → Downpayment",
      avgDays: cyc("piDate", "dpDate"),
      metrics: [
        { label: "Unpaid PIs", value: String(active.filter((o) => has(o.piNo) && !has(o.dpDate)).length) },
        { label: "Unpaid Value", value: money(sumValue((o) => has(o.piNo) && !has(o.dpDate), "piValue")) },
      ],
    },
    {
      title: "Downpayment → Shipping Departure",
      avgDays: cyc("dpDate", "actualDeparture"),
      metrics: [{ label: "DP Received, Unshipped", value: String(active.filter((o) => has(o.dpDate) && !has(o.actualDeparture)).length) }],
    },
    {
      title: "Commercial Invoice → Balance Payment",
      avgDays: cyc("ciDate", "bpDate"),
      metrics: [
        { label: "Unpaid CIs", value: String(active.filter((o) => has(o.ciNo) && !has(o.bpDate)).length) },
        { label: "Unpaid Value", value: money(sumValue((o) => has(o.ciNo) && !has(o.bpDate), "balanceDue")) },
      ],
    },
    {
      title: "Balance Payment → Telex / Seaway Release",
      avgDays: cyc("bpDate", "telexDate"),
      metrics: [{ label: "Pending Telex / Seaway", value: String(active.filter((o) => has(o.bpDate) && !has(o.telexDate)).length) }],
    },
  ];

  return {
    kpis: {
      openOrders: summaryRows[0].total,
      shipped: summaryRows[1].total,
      arrived: summaryRows[2].total,
      activeCount: active.length,
      totalValue: active.reduce((s, o) => s + (Number(o.poValue) || 0), 0),
      totalM2: active.reduce((s, o) => s + (Number(o.totalM2) || 0), 0),
    },
    locations,
    statusRows,
    arrivedRow: { counts: arrivedCounts, total: active.filter(arrivedPred).length },
    totalsRow: { counts: totalsCounts, total: active.length },
    summaryRows,
    volumeTotal: volumeByColor(active, ref.colors),
    volumeNotShipped: volumeByColor(notShippedOrders, ref.colors),
    volumeShipped: volumeByColor(shippedOrders, ref.colors),
    cycle,
  };
}

export interface ItemRow {
  partNo: string;
  description: string;
  counts: number[];
  total: number;
}

export interface ItemsReport {
  locations: string[];
  backlog: ItemRow[];
  shipped: ItemRow[];
  backlogTotals: { counts: number[]; total: number };
  shippedTotals: { counts: number[]; total: number };
}

export function computeItems(pos: PurchaseOrder[], ref: ReferenceData): ItemsReport {
  const active = pos.filter((p) => p.active !== false);
  const locations = ref.stockingLocations.map((l) => l.name);
  const locIdx = new Map(locations.map((l, i) => [l, i]));

  const build = (orders: PurchaseOrder[]): ItemRow[] => {
    const rows = ref.products.map((p) => ({
      partNo: p.partNo,
      description: `${p.lengthIn != null ? `${p.lengthIn}" ` : ""}${p.colorName ?? ""}`.trim(),
      counts: locations.map(() => 0),
      total: 0,
    }));
    const byPart = new Map(rows.map((r) => [r.partNo, r]));
    for (const o of orders) {
      const li = locIdx.get(o.stockingLocation ?? "");
      if (li == null) continue;
      for (const l of o.lines) {
        const row = l.partNo ? byPart.get(l.partNo) : undefined;
        if (!row) continue;
        const n = Number(l.sheets) || 0;
        row.counts[li] += n;
        row.total += n;
      }
    }
    return rows;
  };

  const backlog = build(active.filter((o) => !isShipped(o)));
  const shipped = build(active.filter((o) => isShipped(o)));
  const totals = (rows: ItemRow[]) => ({
    counts: locations.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0)),
    total: rows.reduce((s, r) => s + r.total, 0),
  });

  return { locations, backlog, shipped, backlogTotals: totals(backlog), shippedTotals: totals(shipped) };
}

// ---------- Status mix (for the doughnut chart) ----------
export interface StatusSlice {
  status: string;
  count: number;
}

export function statusMix(pos: PurchaseOrder[]): StatusSlice[] {
  const active = pos.filter((p) => p.active !== false);
  return PIPELINE_STAGES.map((status) => ({
    status,
    count: active.filter((o) => o.status === status).length,
  })).filter((s) => s.count > 0);
}

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- Annual sales (monthly) ----------
export interface MonthMetric {
  month: string;
  revenue: number;
  m2: number;
  containers: number;
  m2Shipped: number;
  orders: number;
  paid: number;
}

const yearOf = (s?: string | null): number | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getFullYear();
};
const monthOf = (s?: string | null): number | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getMonth();
};

export function availableYears(pos: PurchaseOrder[]): number[] {
  const ys = new Set<number>([new Date().getFullYear()]);
  for (const p of pos) {
    for (const d of [p.poDate, p.ciDate, p.actualDeparture, p.bpDate]) {
      const y = yearOf(d);
      if (y) ys.add(y);
    }
  }
  return Array.from(ys).sort((a, b) => b - a);
}

export function computeMonthly(pos: PurchaseOrder[], year: number): MonthMetric[] {
  const months: MonthMetric[] = MONTH_NAMES.map((m) => ({
    month: m, revenue: 0, m2: 0, containers: 0, m2Shipped: 0, orders: 0, paid: 0,
  }));
  for (const p of pos.filter((o) => o.active !== false)) {
    // Revenue + invoiced M²: prefer CI date/value, fallback to PO date/value.
    const invDate = p.ciDate || p.poDate;
    const invValue = Number(p.ciValue) || Number(p.poValue) || 0;
    if (yearOf(invDate) === year) {
      const mi = monthOf(invDate)!;
      months[mi].revenue += invValue;
      months[mi].m2 += Number(p.totalM2) || 0;
      months[mi].orders += 1;
    }
    // Containers + m² shipped from origin: by actual departure.
    if (yearOf(p.actualDeparture) === year) {
      const mi = monthOf(p.actualDeparture)!;
      months[mi].containers += 1;
      months[mi].m2Shipped += Number(p.totalM2) || 0;
    }
    // Cash collected: balance + downpayment received this year.
    for (const [dk, ak] of [["bpDate", "bpAmount"], ["dpDate", "dpAmount"]] as const) {
      if (yearOf(p[dk] as string) === year) {
        months[monthOf(p[dk] as string)!].paid += Number(p[ak]) || 0;
      }
    }
  }
  return months;
}

// ---------- Capacity vs actual ----------
export interface CapacityConfig {
  lines: number;
  m2PerLinePerDay: number;
  m2PerContainer: number;
  workingDaysPerMonth: number;
}

export interface CapacityMonth extends MonthMetric {
  workingDays: number;
  capM2: number;
  capContainers: number;
  utilCon: number;
}

function monthWorkingDays(year: number, monthIdx: number, workingDays: number): number {
  const today = new Date();
  if (year !== today.getFullYear() || monthIdx !== today.getMonth()) return workingDays;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  return Math.max(1, Math.round(workingDays * (today.getDate() / daysInMonth)));
}

export function computeCapacity(pos: PurchaseOrder[], year: number, c: CapacityConfig): CapacityMonth[] {
  return computeMonthly(pos, year).map((m, i) => {
    const wd = monthWorkingDays(year, i, c.workingDaysPerMonth);
    const capM2 = c.lines * c.m2PerLinePerDay * wd;
    const capContainers = c.m2PerContainer ? capM2 / c.m2PerContainer : 0;
    return {
      ...m,
      workingDays: wd,
      capM2,
      capContainers,
      utilCon: capContainers ? (m.containers / capContainers) * 100 : 0,
    };
  });
}
