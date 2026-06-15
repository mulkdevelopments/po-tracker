import { useState } from "react";
import { STAGE_COLORS, STAGES, ROLE_LABELS } from "../types";
import { fmtMoney, fmtNum, fmtDate, stageIndex } from "../utils";
import type { PurchaseOrder, AuthUser, MasterData } from "../types";
import { canAdvanceStage, api } from "../api";
import { todayISO } from "../utils";
import { PO_SECTIONS as EDIT_SECTIONS, LINE_COLS } from "../poFields";

interface Props {
  po: PurchaseOrder;
  user: AuthUser;
  master: MasterData;
  onClose: () => void;
  onUpdated: (po: PurchaseOrder) => void;
  onDeleted?: (id: number) => void;
  canEdit: boolean;
}

const has = (v: unknown) => v != null && String(v).trim() !== "" && v !== "N/A";

// Milestone fields whose presence implies a pipeline stage.
const MILESTONE_KEYS = new Set([
  "piNo", "piDate", "dpDate", "dpAmount", "productionStart", "productionEtc",
  "containerNo", "bol", "actualDeparture", "ciNo", "ciDate", "bpDate", "bpAmount", "telexDate",
]);

// Derive the furthest reached pipeline stage from the populated fields.
function deriveStatus(f: Record<string, string>): string {
  if (has(f.telexDate)) return "Telex / Seaway Released";
  if (has(f.bpDate) || has(f.bpAmount)) return "Balance Payment Received";
  if (has(f.ciNo) || has(f.ciDate)) return "Commercial Invoice Sent";
  if (has(f.containerNo) || has(f.bol) || has(f.actualDeparture)) return "Container Loaded";
  if (has(f.productionStart) || has(f.productionEtc)) return "In Production";
  if (has(f.dpDate) || has(f.dpAmount)) return "Downpayment Received";
  if (has(f.piNo) || has(f.piDate)) return "Proforma Invoice Sent";
  return "PO Received";
}

function Field({ label, val }: { label: string; val: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{val ?? <span className="text-slate-300">—</span>}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded-md p-3">
      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2 text-sm">{children}</div>
    </div>
  );
}

type LineForm = Record<string, string>;

function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}

export default function PoDrawer({ po, user, master, onClose, onUpdated, onDeleted, canEdit }: Props) {
  const nextStage = STAGES[stageIndex(po.status, STAGES) + 1];
  const canStep = nextStage && canAdvanceStage(user, nextStage) && canEdit;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [autoStatus, setAutoStatus] = useState(true);

  // Update a header field; auto-advance the status when a milestone field
  // changes (unless the user has taken manual control of the status).
  const updateField = (k: string, v: string) => {
    setForm((prev) => {
      const next = { ...prev, [k]: v };
      if (autoStatus && MILESTONE_KEYS.has(k)) next.status = deriveStatus(next);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!confirm(`Delete PO ${po.poNo}? This permanently removes the order and its line items.`)) return;
    setDeleting(true);
    try {
      await api.deleteOrder(po.id);
      onDeleted?.(po.id);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete order");
      setDeleting(false);
    }
  };

  const startEdit = () => {
    const f: Record<string, string> = {};
    for (const sec of EDIT_SECTIONS) {
      for (const fld of sec.fields) {
        if (fld.type === "bool") continue;
        f[fld.k as string] = toStr(po[fld.k]);
      }
    }
    f.notes = toStr(po.notes);
    setForm(f);
    setActive(po.active);
    setLines(
      po.lines.map((l) => {
        const row: LineForm = {};
        for (const c of LINE_COLS) row[c.k as string] = toStr(l[c.k]);
        return row;
      }),
    );
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form, active };
      payload.lines = lines.map((l, idx) => ({
        ...l,
        lineNo: l.lineNo === "" ? idx + 1 : l.lineNo,
      }));
      const { po: updated } = await api.updateOrder(po.id, payload);
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const addLine = () =>
    setLines((prev) => [...prev, { lineNo: String(prev.length + 1) }]);
  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  const setLineVal = (i: number, k: string, v: string) =>
    setLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  const stagePill = (s: string) => {
    const cls = STAGE_COLORS[s] || "bg-slate-100 text-slate-700";
    return <span className={`stage-pill ${cls}`}>{s}</span>;
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={editing ? undefined : onClose} />
      <aside className="fixed top-0 right-0 h-full w-[860px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 z-10">
          <div>
            <div className="text-xs text-slate-500">PO Number</div>
            <div className="font-mono font-bold text-lg">
              {po.poNo}
              <span className="text-sm text-slate-400 ml-2">rev {po.rev || 0}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!editing && stagePill(po.status)}
            {canEdit && !editing && (
              <>
                <button
                  type="button"
                  onClick={startEdit}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50 font-medium"
                >
                  Edit
                </button>
                {onDeleted && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleDelete}
                    className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50 font-medium disabled:opacity-50"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                )}
              </>
            )}
            {editing && <span className="text-sm font-medium text-indigo-600">Editing all fields</span>}
            <button
              type="button"
              onClick={editing ? () => setEditing(false) : onClose}
              className="text-slate-400 hover:text-slate-700 text-xl"
            >
              ×
            </button>
          </div>
        </div>

        {editing ? (
          <div className="px-6 py-5 space-y-4">
            {EDIT_SECTIONS.map((sec) => (
              <div key={sec.title} className="border border-slate-200 rounded-md p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">{sec.title}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {sec.fields.map((fld) => (
                    <div key={fld.k as string}>
                      <label className="text-[11px] text-slate-500 block mb-0.5">{fld.label}</label>
                      {fld.type === "bool" ? (
                        <select
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          value={active ? "Yes" : "No"}
                          onChange={(e) => setActive(e.target.value === "Yes")}
                        >
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      ) : fld.type === "select" ? (
                        <>
                          <select
                            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                            value={form[fld.k as string] ?? ""}
                            onChange={(e) => {
                              if (fld.k === "status") setAutoStatus(false);
                              setForm({ ...form, [fld.k as string]: e.target.value });
                            }}
                          >
                            {(fld.options || []).map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                          {fld.k === "status" && (
                            <label className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                              <input
                                type="checkbox"
                                checked={autoStatus}
                                onChange={(e) => {
                                  setAutoStatus(e.target.checked);
                                  if (e.target.checked) setForm((prev) => ({ ...prev, status: deriveStatus(prev) }));
                                }}
                              />
                              Auto-set from milestones
                            </label>
                          )}
                        </>
                      ) : (
                        <input
                          type={fld.type === "number" ? "number" : fld.type === "date" ? "date" : "text"}
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          value={form[fld.k as string] ?? ""}
                          onChange={(e) => updateField(fld.k as string, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="border border-slate-200 rounded-md p-3">
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Notes</label>
              <textarea
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="border border-slate-200 rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">Line Items ({lines.length})</div>
                <button
                  type="button"
                  onClick={addLine}
                  className="text-xs px-2 py-1 border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  + Add line
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      {LINE_COLS.map((c) => (
                        <th key={c.k as string} className="text-left px-1 py-1 text-slate-500 font-medium whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((row, i) => (
                      <tr key={i}>
                        {LINE_COLS.map((c) => (
                          <td key={c.k as string} className="p-0.5">
                            <input
                              className={`border border-slate-200 rounded px-1 py-1 text-xs ${c.w || "w-24"}`}
                              value={row[c.k as string] ?? ""}
                              onChange={(e) => setLineVal(i, c.k as string, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="p-0.5">
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="text-red-500 hover:text-red-700 px-1"
                            title="Remove line"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 pt-4 flex">
              {STAGES.map((s) => {
                const i = STAGES.indexOf(s);
                const cur = stageIndex(po.status, STAGES);
                const cls = i < cur ? "done" : i === cur ? "current" : "";
                return (
                  <div key={s} className={`pipeline-step ${cls}`}>
                    {s}
                  </div>
                );
              })}
            </div>

            <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Stocking location" val={po.stockingLocation} />
              <Field label="Port of destination" val={po.portOfDest} />
              <Field label="PO Date" val={fmtDate(po.poDate)} />
              <Field label="Active" val={po.active ? "Yes" : "No"} />
              <Field label="Total M²" val={fmtNum(po.totalM2, 2)} />
              <Field label="Skids" val={po.skids} />
              <Field label="PO Value" val={fmtMoney(po.poValue)} />
              <Field label="Production site" val={po.productionSite || "—"} />
            </div>

            <div className="px-6 pb-4">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Line items ({po.lines.length})
              </div>
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Part #</th>
                      <th>Size</th>
                      <th>Color</th>
                      <th className="text-right">Sheets</th>
                      <th className="text-right">M²</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lines.map((l) => (
                      <tr key={l.lineNo}>
                        <td>{l.lineNo}</td>
                        <td className="font-mono">{l.partNo}</td>
                        <td>{l.size}</td>
                        <td>{l.color}</td>
                        <td className="text-right">{fmtNum(l.sheets, 0)}</td>
                        <td className="text-right">{fmtNum(l.qtyM2, 2)}</td>
                        <td className="text-right">{fmtMoney(l.extPo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 pb-4 grid grid-cols-2 gap-4">
              <Section title="Proforma Invoice">
                <Field label="PI #" val={po.piNo} />
                <Field label="PI Date" val={po.piDate} />
                <Field label="PI Value" val={fmtMoney(po.piValue)} />
              </Section>
              <Section title="Downpayment">
                <Field label="DP Date" val={po.dpDate} />
                <Field label="DP Amount" val={fmtMoney(po.dpAmount)} />
              </Section>
              <Section title="Production">
                <Field label="Site" val={po.productionSite} />
                <Field label="Start" val={po.productionStart} />
                <Field label="ETC" val={po.productionEtc} />
              </Section>
              <Section title="Container & Shipping">
                <Field label="Container #" val={po.containerNo} />
                <Field label="BOL" val={po.bol} />
                <Field label="Shipping line" val={po.shippingLine} />
                <Field label="Actual Departure" val={po.actualDeparture} />
              </Section>
            </div>

            <div className="px-6 pb-4">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">History</div>
              <div className="border border-slate-200 rounded-md p-3 text-xs max-h-40 overflow-y-auto bg-slate-50">
                {po.history.map((h) => (
                  <div key={h.id} className="flex justify-between gap-3 py-0.5">
                    <span>
                      <b>{h.stage}</b> — {h.note || ""}
                    </span>
                    <span className="text-slate-500">
                      {h.at} · {ROLE_LABELS[h.byRole || ""] || h.byRole}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-2">
          {editing ? (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : canStep ? (
            <AdvanceButton po={po} nextStage={nextStage} master={master} onUpdated={onUpdated} />
          ) : nextStage ? (
            <span className="text-xs text-slate-500">
              Next stage <b>{nextStage}</b> requires a different role.
            </span>
          ) : (
            <span className="text-sm text-emerald-700">Order complete · Arrived {po.arrivalDate || ""}</span>
          )}
        </div>
      </aside>
    </>
  );
}

function AdvanceButton({
  po,
  nextStage,
  master,
  onUpdated,
}: {
  po: PurchaseOrder;
  nextStage: string;
  master: MasterData;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const stageFieldDefs: Record<string, { k: string; label: string; type: string; options?: string[]; def?: string | number }[]> = {
    "Proforma Invoice Sent": [
      { k: "piNo", label: "PI Number", type: "text" },
      { k: "piDate", label: "PI Date", type: "date", def: todayISO() },
      { k: "piValue", label: "PI Value (USD)", type: "number" },
    ],
    "Downpayment Received": [
      { k: "dpDate", label: "DP Date", type: "date", def: todayISO() },
      { k: "dpAmount", label: "DP Amount (USD)", type: "number" },
    ],
    "In Production": [
      { k: "productionSite", label: "Production site", type: "select", options: master.uaeSites || [] },
      { k: "productionStart", label: "Production start", type: "date", def: todayISO() },
      { k: "productionEtc", label: "Production ETC", type: "date" },
    ],
    "Container Loaded": [
      { k: "containerNo", label: "Container #", type: "text" },
      { k: "bol", label: "BOL / SWBOL #", type: "text" },
      { k: "shippingLine", label: "Shipping line", type: "text" },
      { k: "actualDeparture", label: "Actual departure", type: "date", def: todayISO() },
    ],
    "Commercial Invoice Sent": [
      { k: "ciNo", label: "CI Number", type: "text" },
      { k: "ciDate", label: "CI Date", type: "date", def: todayISO() },
      { k: "freight", label: "Freight", type: "number", def: master.freight },
      { k: "inland", label: "Inland", type: "number", def: master.inland },
      { k: "ciValue", label: "CI Value (USD)", type: "number" },
      { k: "balanceDue", label: "Balance due (USD)", type: "number" },
    ],
    "Balance Payment Received": [
      { k: "bpDate", label: "BP Date", type: "date", def: todayISO() },
      { k: "bpAmount", label: "BP Amount (USD)", type: "number" },
    ],
    "Telex / Seaway Released": [
      { k: "telexDate", label: "Telex release date", type: "date", def: todayISO() },
    ],
    Arrived: [
      { k: "arrivalDate", label: "Actual arrival", type: "date", def: todayISO() },
      { k: "shippingEta", label: "Confirmed ETA", type: "date" },
    ],
  };

  const defs = stageFieldDefs[nextStage] || [];

  const submit = async () => {
    setSaving(true);
    try {
      const { po: updated } = await api.advanceOrder(po.id, {
        nextStage,
        fields,
        note,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to advance");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
      >
        Advance → {nextStage}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-full">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">Advance to: {nextStage}</div>
        <div className="p-5 space-y-3">
          {defs.map((f) => (
            <div key={f.k}>
              <label className="text-xs text-slate-500">{f.label}</label>
              {f.type === "select" ? (
                <select
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  value={fields[f.k] ?? String((po as unknown as Record<string, unknown>)[f.k] ?? f.def ?? "")}
                  onChange={(e) => setFields({ ...fields, [f.k]: e.target.value })}
                >
                  <option value="">—</option>
                  {(f.options || []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type}
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  defaultValue={String((po as unknown as Record<string, unknown>)[f.k] ?? f.def ?? "")}
                  onChange={(e) => setFields({ ...fields, [f.k]: e.target.value })}
                />
              )}
            </div>
          ))}
          <input
            placeholder="Optional note…"
            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end">
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50"
          >
            Save & advance
          </button>
        </div>
      </div>
    </div>
  );
}
