import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { ReferenceData } from "../types";
import { fmtNum } from "../utils";

type Row = { id: number; [k: string]: unknown };
type ColType = "text" | "number" | "bool";
interface Column {
  k: string;
  label: string;
  type: ColType;
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-4 ${wide ? "md:col-span-2" : ""}`}>
      <div className="font-semibold mb-3 text-slate-800">{title}</div>
      {children}
    </div>
  );
}

function EditableTable({
  title,
  entity,
  rows,
  columns,
  canEdit,
  onChange,
}: {
  title: string;
  entity: string;
  rows: Row[];
  columns: Column[];
  canEdit: boolean;
  onChange: () => Promise<void>;
}) {
  const blank = () => Object.fromEntries(columns.map((c) => [c.k, c.type === "bool" ? false : ""]));
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const startEdit = (r: Row) => {
    setAdding(false);
    setEditId(r.id);
    setDraft(Object.fromEntries(columns.map((c) => [c.k, c.type === "bool" ? !!r[c.k] : r[c.k] == null ? "" : String(r[c.k])])));
  };
  const startAdd = () => { setEditId(null); setAdding(true); setDraft(blank()); };
  const cancel = () => { setEditId(null); setAdding(false); };

  const setField = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      if (adding) await api.refCreate(entity, draft);
      else if (editId != null) await api.refUpdate(entity, editId, draft);
      await onChange();
      cancel();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Row) => {
    if (!confirm(`Delete this ${title.replace(/s$/, "").toLowerCase()}?`)) return;
    try {
      await api.refDelete(entity, r.id);
      await onChange();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const cellInput = (c: Column) => {
    if (c.type === "bool") {
      return (
        <select
          value={draft[c.k] ? "Yes" : "No"}
          onChange={(e) => setField(c.k, e.target.value === "Yes")}
          className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
        >
          <option>Yes</option>
          <option>No</option>
        </select>
      );
    }
    return (
      <input
        type={c.type === "number" ? "number" : "text"}
        value={String(draft[c.k] ?? "")}
        onChange={(e) => setField(c.k, e.target.value)}
        className="w-full border border-slate-300 rounded px-1 py-1 text-xs"
      />
    );
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.k} className={c.type === "number" ? "text-right" : ""}>{c.label}</th>
              ))}
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) =>
                  editId === r.id ? (
                    <td key={c.k}>{cellInput(c)}</td>
                  ) : (
                    <td key={c.k} className={c.type === "number" ? "text-right" : ""}>
                      {c.type === "bool" ? (r[c.k] ? "Yes" : "No") : c.type === "number" ? (r[c.k] != null ? fmtNum(r[c.k] as number, 0) : "—") : (r[c.k] as string) || "—"}
                    </td>
                  ),
                )}
                {canEdit && (
                  <td className="text-right whitespace-nowrap">
                    {editId === r.id ? (
                      <>
                        <button type="button" disabled={busy} onClick={save} className="text-indigo-600 hover:underline mr-2">Save</button>
                        <button type="button" onClick={cancel} className="text-slate-500 hover:underline">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => startEdit(r)} className="text-indigo-600 hover:underline mr-2">Edit</button>
                        <button type="button" onClick={() => remove(r)} className="text-red-600 hover:underline">Delete</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {adding && (
              <tr className="bg-indigo-50/40">
                {columns.map((c) => (
                  <td key={c.k}>{cellInput(c)}</td>
                ))}
                <td className="text-right whitespace-nowrap">
                  <button type="button" disabled={busy} onClick={save} className="text-indigo-600 hover:underline mr-2">Add</button>
                  <button type="button" onClick={cancel} className="text-slate-500 hover:underline">Cancel</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && !adding && (
        <button type="button" onClick={startAdd} className="mt-2 text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50">
          + Add
        </button>
      )}
    </div>
  );
}

function ConfigCard({ ref, canEdit, onSaved }: { ref: ReferenceData; canEdit: boolean; onSaved: () => Promise<void> }) {
  const cfg = ref.config;
  const [draft, setDraft] = useState({
    sheetsPerSkid: cfg?.sheetsPerSkid ?? 200,
    downpaymentPct: Math.round((cfg?.downpaymentPct ?? 0.5) * 100),
    containerMaxM2: cfg?.containerMaxM2 ?? 8600,
    leadTimeStandard: cfg?.leadTimeStandard ?? 45,
    leadTimeNonStandard: cfg?.leadTimeNonStandard ?? 90,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateConfig({
        sheetsPerSkid: draft.sheetsPerSkid,
        downpaymentPct: draft.downpaymentPct / 100,
        containerMaxM2: draft.containerMaxM2,
        leadTimeStandard: draft.leadTimeStandard,
        leadTimeNonStandard: draft.leadTimeNonStandard,
      });
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const fields: { k: keyof typeof draft; label: string; suffix?: string }[] = [
    { k: "sheetsPerSkid", label: "Sheets per Skid" },
    { k: "downpaymentPct", label: "Downpayment", suffix: "%" },
    { k: "containerMaxM2", label: "Container Max", suffix: "m²" },
    { k: "leadTimeStandard", label: "Lead Time — Standard", suffix: "days" },
    { k: "leadTimeNonStandard", label: "Lead Time — Non-Standard", suffix: "days" },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 text-sm">
      {fields.map((f) => (
        <div key={f.k} className="flex items-center justify-between gap-2">
          <span className="text-slate-600">{f.label}</span>
          {canEdit ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={draft[f.k]}
                onChange={(e) => setDraft({ ...draft, [f.k]: Number(e.target.value) })}
                className="w-24 border border-slate-300 rounded px-2 py-1 text-sm text-right"
              />
              {f.suffix && <span className="text-xs text-slate-400 w-8">{f.suffix}</span>}
            </div>
          ) : (
            <b>{draft[f.k]}{f.suffix ? ` ${f.suffix}` : ""}</b>
          )}
        </div>
      ))}
      {canEdit && (
        <button type="button" disabled={busy} onClick={save} className="mt-1 self-end px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md disabled:opacity-50">
          {busy ? "Saving…" : "Save defaults"}
        </button>
      )}
    </div>
  );
}

export default function MasterPage() {
  const { canEdit } = useAuth();
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const r = await api.getReference();
    setRef(r);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading || !ref) return <div className="text-slate-500">Loading…</div>;
  const writable = canEdit();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card title="OTC Process Stages">
        <ol className="list-decimal pl-5 text-sm space-y-1">
          {ref.stages.map((s) => (
            <li key={s.id}>{s.name}</li>
          ))}
        </ol>
        <div className="text-[11px] text-slate-400 mt-2">Fixed workflow stages.</div>
      </Card>

      <Card title="Defaults & Constants">
        <ConfigCard ref={ref} canEdit={writable} onSaved={load} />
      </Card>

      <Card title="Sailing Times (Days) — Ports">
        <div className="text-xs text-slate-500 mb-2">
          Departure Port: <b className="text-slate-700">{ref.config?.originPort || "—"}</b>
        </div>
        <EditableTable
          title="Ports"
          entity="ports"
          rows={ref.ports as unknown as Row[]}
          columns={[
            { k: "name", label: "Destination Port", type: "text" },
            { k: "sailingDays", label: "Sailing Days", type: "number" },
            { k: "freight", label: "Freight", type: "number" },
            { k: "inland", label: "Inland", type: "number" },
          ]}
          canEdit={writable}
          onChange={load}
        />
      </Card>

      <Card title="Ports of Entry — Stocking Locations">
        <EditableTable
          title="Locations"
          entity="locations"
          rows={ref.stockingLocations as unknown as Row[]}
          columns={[
            { k: "name", label: "Stocking Location", type: "text" },
            { k: "arrivalPort", label: "Arrival Port", type: "text" },
          ]}
          canEdit={writable}
          onChange={load}
        />
      </Card>

      <Card title="Shipping Lines">
        <EditableTable
          title="Shipping Lines"
          entity="shipping-lines"
          rows={ref.shippingLines as unknown as Row[]}
          columns={[
            { k: "name", label: "Shipping Line", type: "text" },
            { k: "trackingUrl", label: "Tracking URL", type: "text" },
          ]}
          canEdit={writable}
          onChange={load}
        />
      </Card>

      <Card title={`Colors (${ref.colors.length})`} wide>
        <EditableTable
          title="Colors"
          entity="colors"
          rows={ref.colors as unknown as Row[]}
          columns={[
            { k: "name", label: "Color", type: "text" },
            { k: "code", label: "Vendor Code", type: "text" },
            { k: "isStandard", label: "Standard?", type: "bool" },
          ]}
          canEdit={writable}
          onChange={load}
        />
      </Card>
    </div>
  );
}
