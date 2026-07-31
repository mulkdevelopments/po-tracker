import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, canEditPo, type CynergyFormSubmission } from "../api";
import { useAuth } from "../AuthContext";
import { useCompany } from "../CompanyContext";

type Filter = "PENDING" | "ALL" | "IMPORTED" | "REJECTED";

function statusLabel(status: CynergyFormSubmission["status"]) {
  if (status === "IMPORTED") return "Completed";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function statusBadge(status: CynergyFormSubmission["status"]) {
  const map: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800",
    IMPORTED: "bg-emerald-100 text-emerald-800",
    REJECTED: "bg-rose-100 text-rose-800",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-700"}`}>
      {statusLabel(status)}
    </span>
  );
}

export default function CynergyFormsPage() {
  const { user } = useAuth();
  const { setCompany } = useCompany();
  const canImport = user ? canEditPo(user) : false;
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [rows, setRows] = useState<CynergyFormSubmission[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<CynergyFormSubmission | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.listCynergyForms(filter === "ALL" ? undefined : filter);
      setRows(data.submissions);
      setPendingCount(data.pendingCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onImport(id: number) {
    if (!canImport) return;
    if (!confirm("Import this submission into the Cynergy tracker as a new PO?")) return;
    setBusyId(id);
    setError("");
    try {
      const { po } = await api.importCynergyForm(id);
      setCompany("SYNERGY");
      await load();
      setSelected(null);
      if (confirm(`Imported as PO ${po.poNo}. Open Order Summary?`)) {
        window.location.href = "/orders";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(id: number) {
    if (!canImport) return;
    const reason = prompt("Reject reason (optional):") ?? undefined;
    setBusyId(id);
    setError("");
    try {
      await api.rejectCynergyForm(id, reason || undefined);
      await load();
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: number) {
    if (!canImport) return;
    if (
      !confirm(
        "Delete this form submission? Imported tracker POs are not deleted — only the form record.",
      )
    ) {
      return;
    }
    setBusyId(id);
    setError("");
    try {
      await api.deleteCynergyForm(id);
      await load();
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onDeleteAll() {
    if (!canImport) return;
    const scope =
      filter === "ALL"
        ? "ALL form submissions"
        : filter === "IMPORTED"
          ? "all Completed form submissions"
          : `all ${filter.charAt(0) + filter.slice(1).toLowerCase()} form submissions`;
    if (
      !confirm(
        `Delete ${scope}? This cannot be undone. Imported tracker POs are kept.`,
      )
    ) {
      return;
    }
    if (!confirm("Type-confirm: permanently delete these form records?")) return;
    setBusyId(-1);
    setError("");
    try {
      const { deleted } = await api.deleteAllCynergyForms(filter === "ALL" ? undefined : filter);
      await load();
      setSelected(null);
      if (deleted === 0) setError("No submissions to delete in this view.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete all failed");
    } finally {
      setBusyId(null);
    }
  }

  const lines = Array.isArray(selected?.lines) ? selected!.lines : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cynergy form submissions</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Review web-form POs here. Import creates a Cynergy tracker order; reject leaves it out of the tracker.
            {pendingCount > 0 ? ` ${pendingCount} pending.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button
              type="button"
              disabled={busyId !== null || loading || rows.length === 0}
              onClick={() => void onDeleteAll()}
              className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {busyId === -1 ? "Deleting…" : filter === "ALL" ? "Delete all forms" : "Delete all in view"}
            </button>
          )}
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
            {(["PENDING", "ALL", "IMPORTED", "REJECTED"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-sm rounded-md ${
                  filter === f ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f === "ALL" ? "All" : f === "IMPORTED" ? "Completed" : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
      )}

      {!canImport && (
        <div className="text-sm text-slate-500">Only Maintainers can import, reject, or delete submissions.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Submitter</th>
                <th className="px-3 py-2">Lines</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    No submissions in this view.
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                      selected?.id === s.id ? "bg-indigo-50/60" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-slate-500">{s.id}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{s.poNo}</td>
                    <td className="px-3 py-2">{s.poDate || "—"}</td>
                    <td className="px-3 py-2">
                      <div>{s.submitterName || "—"}</div>
                      {s.submitterEmail && <div className="text-xs text-slate-400">{s.submitterEmail}</div>}
                    </td>
                    <td className="px-3 py-2">{Array.isArray(s.lines) ? s.lines.length : 0}</td>
                    <td className="px-3 py-2">{statusBadge(s.status)}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 h-fit sticky top-4">
          {!selected ? (
            <p className="text-sm text-slate-400">Select a submission to review.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold text-slate-900">PO {selected.poNo}</div>
                  <div className="text-xs text-slate-500">Form #{selected.id}</div>
                </div>
                {statusBadge(selected.status)}
              </div>
              <p className="text-sm text-slate-600">{selected.poDate || "—"}</p>
              {selected.notes && <p className="text-sm text-slate-700">{selected.notes}</p>}
              {selected.rejectReason && (
                <div className="rounded-md bg-rose-50 px-2 py-1.5 text-sm text-rose-800">
                  Rejected: {selected.rejectReason}
                </div>
              )}
              {selected.importedPoId && (
                <div className="text-sm text-emerald-700">
                  Imported as tracker PO id {selected.importedPoId}.{" "}
                  <Link to="/orders" className="underline" onClick={() => setCompany("SYNERGY")}>
                    Open orders
                  </Link>
                </div>
              )}
              <ul className="space-y-2 max-h-64 overflow-auto border-t border-slate-100 pt-3">
                {lines.map((l, i) => (
                  <li key={i} className="rounded-md bg-slate-50 px-2 py-1.5 text-sm">
                    <div className="font-medium text-slate-800">{l.description}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {l.sheets} sheets
                      {l.partNo ? ` · ${l.partNo}` : ""}
                      {l.color ? ` · ${l.color}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
              {selected.status === "PENDING" && canImport && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busyId === selected.id}
                    onClick={() => void onImport(selected.id)}
                    className="flex-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busyId === selected.id ? "Working…" : "Import to tracker"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === selected.id}
                    onClick={() => void onReject(selected.id)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
              {canImport && (
                <button
                  type="button"
                  disabled={busyId === selected.id}
                  onClick={() => void onDelete(selected.id)}
                  className="w-full rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {busyId === selected.id ? "Deleting…" : "Delete form"}
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
