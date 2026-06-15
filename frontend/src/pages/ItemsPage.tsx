import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { PurchaseOrder, ReferenceData } from "../types";
import { fmtNum } from "../utils";
import { computeItems, type ItemRow } from "../reports";

function shortLoc(l: string) {
  return l.split(",")[0];
}

function PivotTable({
  title,
  subtitle,
  locations,
  rows,
  totals,
  hideEmpty,
}: {
  title: string;
  subtitle: string;
  locations: string[];
  rows: ItemRow[];
  totals: { counts: number[]; total: number };
  hideEmpty: boolean;
}) {
  const shown = hideEmpty ? rows.filter((r) => r.total > 0) : rows;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{subtitle}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              {locations.map((l) => (
                <th key={l} className="text-right">{shortLoc(l)}</th>
              ))}
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.partNo}>
                <td className="font-mono text-slate-500">{r.partNo}</td>
                <td>{r.description}</td>
                {r.counts.map((c, i) => (
                  <td key={i} className={`text-right ${c ? "font-medium" : "text-slate-300"}`}>{c ? fmtNum(c, 0) : "—"}</td>
                ))}
                <td className="text-right font-semibold">{r.total ? fmtNum(r.total, 0) : "—"}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={2}>TOTALS</td>
              {totals.counts.map((c, i) => (
                <td key={i} className="text-right">{c ? fmtNum(c, 0) : "—"}</td>
              ))}
              <td className="text-right">{fmtNum(totals.total, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ItemsPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(true);

  useEffect(() => {
    Promise.all([api.getOrders(), api.getReference()]).then(([o, r]) => {
      setPos(o.pos);
      setRef(r);
      setLoading(false);
    });
  }, []);

  const report = useMemo(() => (ref ? computeItems(pos, ref) : null), [pos, ref]);

  if (loading || !report) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide items with zero sheets
        </label>
      </div>
      <PivotTable
        title="Backlog (Sheets)"
        subtitle="On order, not yet shipped · by stocking location"
        locations={report.locations}
        rows={report.backlog}
        totals={report.backlogTotals}
        hideEmpty={hideEmpty}
      />
      <PivotTable
        title="Shipped (Sheets)"
        subtitle="Container loaded onward · by stocking location"
        locations={report.locations}
        rows={report.shipped}
        totals={report.shippedTotals}
        hideEmpty={hideEmpty}
      />
    </div>
  );
}
