import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { ReferenceData, PiDocumentSettings } from "../types";
import { fmtNum, isValidEmail } from "../utils";
import { DEFAULT_PI_DOCUMENT, piDocumentFromMaster } from "../piDocument";

type Row = { id: number; [k: string]: unknown };
type ColType = "text" | "number" | "bool" | "email";
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
    const payload = { ...draft };
    for (const c of columns) {
      if (c.type !== "email") continue;
      const raw = String(payload[c.k] ?? "").trim();
      if (!raw) {
        payload[c.k] = "";
        continue;
      }
      if (!isValidEmail(raw)) {
        alert(`Enter a valid email address for ${c.label}.`);
        return;
      }
      payload[c.k] = raw;
    }
    setBusy(true);
    try {
      if (adding) await api.refCreate(entity, payload);
      else if (editId != null) await api.refUpdate(entity, editId, payload);
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
        type={c.type === "number" ? "number" : c.type === "email" ? "email" : "text"}
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
                      {c.type === "bool"
                        ? (r[c.k] ? "Yes" : "No")
                        : c.type === "number"
                          ? (r[c.k] != null ? fmtNum(r[c.k] as number, 0) : "—")
                          : c.type === "email" && r[c.k]
                            ? <a href={`mailto:${r[c.k]}`} className="text-indigo-600 hover:underline">{String(r[c.k])}</a>
                            : (r[c.k] as string) || "—"}
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

function ProductionCapacityCard({ ref, canEdit, onSaved }: { ref: ReferenceData; canEdit: boolean; onSaved: () => Promise<void> }) {
  const cfg = ref.config;
  const [draft, setDraft] = useState({
    productionLines: cfg?.productionLines ?? 2,
    m2PerLinePerDay: cfg?.m2PerLinePerDay ?? 3000,
    m2PerContainer: cfg?.m2PerContainer ?? 8300,
    workingDaysPerMonth: cfg?.workingDaysPerMonth ?? 26,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateConfig({
        productionLines: draft.productionLines,
        m2PerLinePerDay: draft.m2PerLinePerDay,
        m2PerContainer: draft.m2PerContainer,
        workingDaysPerMonth: draft.workingDaysPerMonth,
      });
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const m2PerMonth = draft.productionLines * draft.m2PerLinePerDay * draft.workingDaysPerMonth;
  const containersPerMonth = draft.m2PerContainer ? m2PerMonth / draft.m2PerContainer : 0;

  const fields: { k: keyof typeof draft; label: string; suffix?: string }[] = [
    { k: "productionLines", label: "Production lines" },
    { k: "m2PerLinePerDay", label: "m² per line per day", suffix: "m²" },
    { k: "m2PerContainer", label: "m² per container", suffix: "m²" },
    { k: "workingDaysPerMonth", label: "Working days per month", suffix: "days" },
  ];

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">
        Drives the Dashboard <b className="text-slate-700">Production — Actual vs Capacity</b> chart. Theoretical capacity =
        lines × m²/line/day × working days; containers = m²/month ÷ m²/container.
      </p>
      <div className="grid grid-cols-1 gap-2">
        {fields.map((f) => (
          <div key={f.k} className="flex items-center justify-between gap-2">
            <span className="text-slate-600">{f.label}</span>
            {canEdit ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={f.k === "workingDaysPerMonth" ? 1 : 0}
                  value={draft[f.k]}
                  onChange={(e) => setDraft({ ...draft, [f.k]: Number(e.target.value) })}
                  className="w-28 border border-slate-300 rounded px-2 py-1 text-sm text-right"
                />
                {f.suffix && <span className="text-xs text-slate-400 w-10">{f.suffix}</span>}
              </div>
            ) : (
              <b>{draft[f.k]}{f.suffix ? ` ${f.suffix}` : ""}</b>
            )}
          </div>
        ))}
      </div>
      <div className="rounded-md bg-blue-50 text-blue-900 px-3 py-2 text-xs">
        <b>Preview:</b> {containersPerMonth.toFixed(1)} containers/month ({fmtNum(m2PerMonth, 0)} m²)
      </div>
      {canEdit && (
        <button type="button" disabled={busy} onClick={save} className="self-end px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md disabled:opacity-50">
          {busy ? "Saving…" : "Save capacity settings"}
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

type PiDocumentDraft = PiDocumentSettings & { termsText?: string };

const DEFAULT_PRODUCTION_SITES = ["UAE - Hamriya", "UAE - Jerf"];

function productionFromMaster(master: Record<string, unknown>) {
  const sites =
    Array.isArray(master.uaeSites) && master.uaeSites.length
      ? (master.uaeSites as string[])
      : [...DEFAULT_PRODUCTION_SITES];
  const defaultSite =
    typeof master.defaultProductionSite === "string" && master.defaultProductionSite
      ? master.defaultProductionSite
      : sites[0] ?? DEFAULT_PRODUCTION_SITES[0];
  const etcWeeks = typeof master.productionEtcWeeks === "number" ? master.productionEtcWeeks : 12;
  return { sites, defaultSite, etcWeeks };
}

function ProductionSitesCard({
  master,
  canEdit,
  onSaved,
}: {
  master: Record<string, unknown>;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const initial = productionFromMaster(master);
  const [sitesText, setSitesText] = useState(initial.sites.join("\n"));
  const [defaultSite, setDefaultSite] = useState(initial.defaultSite);
  const [etcWeeks, setEtcWeeks] = useState(initial.etcWeeks);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = productionFromMaster(master);
    setSitesText(p.sites.join("\n"));
    setDefaultSite(p.defaultSite);
    setEtcWeeks(p.etcWeeks);
  }, [master]);

  const siteList = sitesText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const save = async () => {
    if (!siteList.length) {
      alert("Add at least one production site.");
      return;
    }
    setBusy(true);
    try {
      const def = siteList.includes(defaultSite) ? defaultSite : siteList[0];
      await api.updateSettings({
        master: {
          ...master,
          uaeSites: siteList,
          defaultProductionSite: def,
          productionEtcWeeks: etcWeeks,
        },
      });
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <ul className="list-disc pl-5 text-sm space-y-1">
        {siteList.map((s) => (
          <li key={s}>
            {s}
            {s === defaultSite ? " (default)" : ""}
          </li>
        ))}
        <li className="list-none text-xs text-slate-400 mt-2">
          Production ETC defaults to {etcWeeks} weeks after start date.
        </li>
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Sites shown when advancing a PO to In Production. One site name per line.
      </p>
      <label className="block text-sm">
        <span className="text-slate-600 text-xs">Production sites</span>
        <textarea
          rows={4}
          value={sitesText}
          onChange={(e) => setSitesText(e.target.value)}
          className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono"
        />
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-slate-600 text-xs">Default site</span>
          <select
            value={siteList.includes(defaultSite) ? defaultSite : siteList[0] ?? ""}
            onChange={(e) => setDefaultSite(e.target.value)}
            className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          >
            {siteList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 text-xs">Production ETC offset (weeks from start)</span>
          <input
            type="number"
            min={1}
            value={etcWeeks}
            onChange={(e) => setEtcWeeks(Number(e.target.value) || 12)}
            className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save production sites"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={`block text-sm ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-slate-600 text-xs">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function PiDocumentCard({
  master,
  canEdit,
  onSaved,
}: {
  master: Record<string, unknown>;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<PiDocumentDraft>(() => ({
    ...piDocumentFromMaster(master),
    termsText: (piDocumentFromMaster(master).terms ?? DEFAULT_PI_DOCUMENT.terms ?? []).join("\n"),
  }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const doc = piDocumentFromMaster(master);
    setDraft({
      ...doc,
      termsText: (doc.terms ?? DEFAULT_PI_DOCUMENT.terms ?? []).join("\n"),
    });
  }, [master]);

  const set = (k: keyof PiDocumentSettings, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const terms = (draft.termsText ?? "")
        .split("\n")
        .map((t: string) => t.trim())
        .filter(Boolean);
      const { termsText: _termsText, ...rest } = draft;
      await api.updateSettings({
        master: { ...master, piDocument: { ...rest, terms } },
      });
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const termsText = draft.termsText ?? "";

  if (!canEdit) {
    return (
      <div className="text-sm text-slate-600 space-y-1">
        <div><b>Issuer:</b> {draft.issuerName}</div>
        <div><b>Customer:</b> {draft.customerName}</div>
        <div><b>Bank:</b> {draft.bankName}</div>
        <div className="text-xs text-slate-400 mt-2">Maintainers can edit PI document defaults here.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        These values appear on downloaded Proforma Invoice PDFs. Per-order fields (PI #, date, line items) still come from each PO.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Issuer company name" value={draft.issuerName ?? ""} onChange={(v) => set("issuerName", v)} wide />
        <Field label="Issuer address (page footer)" value={draft.issuerAddress ?? ""} onChange={(v) => set("issuerAddress", v)} wide />
        <Field label="Customer name" value={draft.customerName ?? ""} onChange={(v) => set("customerName", v)} />
        <Field label="Customer TRN" value={draft.customerTrn ?? ""} onChange={(v) => set("customerTrn", v)} />
        <Field label="Sales person" value={draft.salesPerson ?? ""} onChange={(v) => set("salesPerson", v)} />
        <Field label="Currency" value={draft.currency ?? ""} onChange={(v) => set("currency", v)} />
        <Field label="Product category (table heading)" value={draft.productCategory ?? ""} onChange={(v) => set("productCategory", v)} wide />
        <Field label="Payment terms" value={draft.paymentTerms ?? ""} onChange={(v) => set("paymentTerms", v)} />
        <Field label="Incoterms" value={draft.incoterms ?? ""} onChange={(v) => set("incoterms", v)} />
        <Field label="Partial delivery" value={draft.partialDelivery ?? ""} onChange={(v) => set("partialDelivery", v)} />
        <Field label="Shipment mode" value={draft.shipmentMode ?? ""} onChange={(v) => set("shipmentMode", v)} />
        <Field label="Bank name" value={draft.bankName ?? ""} onChange={(v) => set("bankName", v)} />
        <Field label="Account title" value={draft.accountTitle ?? ""} onChange={(v) => set("accountTitle", v)} />
        <Field label="Account number" value={draft.accountNo ?? ""} onChange={(v) => set("accountNo", v)} />
        <Field label="Swift / currency" value={draft.swift ?? ""} onChange={(v) => set("swift", v)} />
        <Field label="IBAN" value={draft.iban ?? ""} onChange={(v) => set("iban", v)} wide />
        <Field label="Bank address" value={draft.bankAddress ?? ""} onChange={(v) => set("bankAddress", v)} wide />
      </div>
      <label className="block text-sm md:col-span-2">
        <span className="text-slate-600 text-xs">Terms & conditions (one per line)</span>
        <textarea
          rows={4}
          value={termsText}
          onChange={(e) => setDraft((d) => ({ ...d, termsText: e.target.value }))}
          className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm font-mono"
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600 text-xs">Tax / legal note</span>
        <textarea
          rows={3}
          value={draft.taxNote ?? ""}
          onChange={(e) => set("taxNote", e.target.value)}
          className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save PI document settings"}
      </button>
    </div>
  );
}

export default function MasterPage() {
  const { canEdit } = useAuth();
  const [ref, setRef] = useState<ReferenceData | null>(null);
  const [master, setMaster] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [r, settings] = await Promise.all([api.getReference(), api.getSettings()]);
    setRef(r);
    setMaster((settings.master ?? {}) as Record<string, unknown>);
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

      <Card title="Production Capacity">
        <ProductionCapacityCard ref={ref} canEdit={writable} onSaved={load} />
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
            { k: "email", label: "Email", type: "email" },
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

      <Card title="Production Sites">
        <ProductionSitesCard master={master} canEdit={writable} onSaved={load} />
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

      <Card title="Proforma Invoice (PI) Document" wide>
        <PiDocumentCard master={master} canEdit={writable} onSaved={load} />
      </Card>
    </div>
  );
}
