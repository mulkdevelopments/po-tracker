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
  const periods = ref.capacityPeriods ?? [];
  const empty = {
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
    label: "",
    productionLines: ref.config?.productionLines ?? 2,
    m2PerLinePerDay: ref.config?.m2PerLinePerDay ?? 3000,
    m2PerContainer: ref.config?.m2PerContainer ?? 8300,
    workingDaysPerMonth: ref.config?.workingDaysPerMonth ?? 26,
  };
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setDraft({ ...empty });
    setEditing("new");
  };
  const openEdit = (p: (typeof periods)[number]) => {
    setDraft({
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo ?? "",
      label: p.label ?? "",
      productionLines: p.productionLines,
      m2PerLinePerDay: p.m2PerLinePerDay,
      m2PerContainer: p.m2PerContainer,
      workingDaysPerMonth: p.workingDaysPerMonth,
    });
    setEditing(p.id);
  };

  const save = async () => {
    if (!draft.effectiveFrom.trim()) {
      alert("Effective from date is required");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo || null,
        label: draft.label || null,
        productionLines: Number(draft.productionLines),
        m2PerLinePerDay: Number(draft.m2PerLinePerDay),
        m2PerContainer: Number(draft.m2PerContainer),
        workingDaysPerMonth: Number(draft.workingDaysPerMonth),
      };
      if (editing === "new") await api.refCreate("capacity-periods", payload);
      else if (typeof editing === "number") await api.refUpdate("capacity-periods", editing, payload);
      // Keep AppConfig in sync with the latest open-ended / newest period for legacy readers
      await api.updateConfig({
        productionLines: payload.productionLines,
        m2PerLinePerDay: payload.m2PerLinePerDay,
        m2PerContainer: payload.m2PerContainer,
        workingDaysPerMonth: payload.workingDaysPerMonth,
      });
      setEditing(null);
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this capacity period?")) return;
    try {
      await api.refDelete("capacity-periods", id);
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">
        Capacity periods have effective dates. The dashboard uses the period that covers each month.
        Adding a new period closes the previous open period the day before the new start date.
      </p>
      <div className="overflow-x-auto border border-slate-200 rounded-md">
        <table className="tbl w-full text-xs">
          <thead>
            <tr>
              <th>Label</th>
              <th>From</th>
              <th>To</th>
              <th className="text-right">Lines</th>
              <th className="text-right">m²/line/day</th>
              <th className="text-right">m²/ctr</th>
              <th className="text-right">Days</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td>{p.label || "—"}</td>
                <td className="font-mono">{p.effectiveFrom}</td>
                <td className="font-mono">{p.effectiveTo || "open"}</td>
                <td className="text-right">{p.productionLines}</td>
                <td className="text-right">{p.m2PerLinePerDay}</td>
                <td className="text-right">{p.m2PerContainer}</td>
                <td className="text-right">{p.workingDaysPerMonth}</td>
                {canEdit && (
                  <td className="whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(p)} className="text-indigo-600 hover:underline mr-2">Edit</button>
                    <button type="button" onClick={() => void remove(p.id)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {periods.length === 0 && (
              <tr><td colSpan={canEdit ? 8 : 7} className="text-center text-slate-400 py-4">No capacity periods yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && editing == null && (
        <button type="button" onClick={openNew} className="text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50">
          + Add capacity period
        </button>
      )}

      {canEdit && editing != null && (
        <div className="border border-slate-200 rounded-md p-3 space-y-2 bg-slate-50">
          <div className="text-xs font-semibold text-slate-700">{editing === "new" ? "New period" : "Edit period"}</div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["label", "Label", "text"],
                ["effectiveFrom", "Effective from", "date"],
                ["effectiveTo", "Effective to (blank = open)", "date"],
                ["productionLines", "Production lines", "number"],
                ["m2PerLinePerDay", "m² per line per day", "number"],
                ["m2PerContainer", "m² per container", "number"],
                ["workingDaysPerMonth", "Working days / month", "number"],
              ] as const
            ).map(([k, label, type]) => (
              <label key={k} className="text-xs text-slate-600">
                {label}
                <input
                  type={type}
                  className="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 text-sm"
                  value={String(draft[k] ?? "")}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void save()} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
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
    paymentTolerancePct: Math.round((cfg?.paymentTolerancePct ?? 0.01) * 10000) / 100,
    paymentToleranceAbs: cfg?.paymentToleranceAbs ?? 1,
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
        paymentTolerancePct: draft.paymentTolerancePct / 100,
        paymentToleranceAbs: draft.paymentToleranceAbs,
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
    { k: "paymentTolerancePct", label: "Payment Tolerance", suffix: "%" },
    { k: "paymentToleranceAbs", label: "Payment Tolerance — Minimum", suffix: "$" },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 text-sm">
      <p className="text-xs text-slate-500">
        Payments within the tolerance (whichever of the two is larger) count as on target;
        anything outside it is flagged as an under- or overpayment.
      </p>
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

function PiEmailsCard({
  master,
  canEdit,
  onSaved,
}: {
  master: Record<string, unknown>;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const initial = typeof master.piInternalEmails === "string" ? master.piInternalEmails : "";
  const [emails, setEmails] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmails(typeof master.piInternalEmails === "string" ? master.piInternalEmails : "");
  }, [master]);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateSettings({
        master: { ...master, piInternalEmails: emails.trim() },
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
      <p className="text-sm text-slate-600">
        {emails.trim() || <span className="text-slate-400">No internal PI recipients configured.</span>}
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">
        Comma-separated internal emails for Proforma Invoice distribution (mailto from the PO drawer).
      </p>
      <input
        type="text"
        value={emails}
        onChange={(e) => setEmails(e.target.value)}
        placeholder="ops@example.com, finance@example.com"
        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save PI emails"}
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

      <Card title="PI internal emails">
        <PiEmailsCard master={master} canEdit={writable} onSaved={load} />
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
