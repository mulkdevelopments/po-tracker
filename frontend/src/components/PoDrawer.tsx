import { useEffect, useMemo, useState } from "react";
import { STAGE_COLORS, STAGES } from "../types";
import type { PurchaseOrder, AuthUser, MasterData, PoLine, ReferenceData } from "../types";
import { canAdvanceStage, canEditProductionActualsForPo, canManageUsers, api } from "../api";
import { fmtMoney, fmtNum, fmtDate, stageIndex, todayISO, addWeeksISO } from "../utils";
import { PO_SECTIONS as EDIT_SECTIONS, LINE_COLS } from "../poFields";
import {
  PI_PENDING_STATUS,
  PI_REJECTED_STATUS,
  CI_PENDING_STATUS,
  CI_REJECTED_STATUS,
  canRejectPiRole,
  canResubmitPiRole,
  canRejectCiRole,
  canResubmitCiRole,
  waitingForStageMessage,
} from "../piApproval";
import { notifyPoUpdated } from "../poEvents";
import { autoShippingUrl } from "../shippingTracking";
import ResubmitTag from "./ResubmitTag";
import { ProductionCompleteTrigger, ProductionActualsEditTrigger } from "./ProductionCompleteAdvance";
import StockingEmailQueue from "./StockingEmailQueue";
function lineHasActuals(l: PoLine) {
  return l.actualQtyM2 != null || l.actualSheets != null || l.actualSkids != null;
}

function actualCellClass(actual: number | null | undefined, ordered: number | null | undefined) {
  if (actual == null || ordered == null) return "";
  if (actual >= ordered) return "bg-emerald-50 text-emerald-800 border border-emerald-200";
  return "bg-red-50 text-red-800 border border-red-200";
}

function ActualQtyCell({
  actual,
  ordered,
  decimals,
}: {
  actual: number | null | undefined;
  ordered: number | null | undefined;
  decimals: number;
}) {
  if (actual == null) return <span className="text-slate-300">—</span>;
  const cls = actualCellClass(actual, ordered);
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded ${cls}`}>{fmtNum(actual, decimals)}</span>
  );
}

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
  "piNo", "piDate", "piApprovedDate", "dpDate", "dpAmount", "productionStart", "productionEtc",
  "productionComplete", "containerNo", "actualDeparture", "ciNo", "ciDate", "ciApprovedDate",
  "bol", "shippingLine", "shippingUrl", "bpDate", "bpAmount", "telexDate",
]);

function resolvePipelineStatus(status: string): string {
  if (status === PI_REJECTED_STATUS) return PI_PENDING_STATUS;
  if (status === CI_REJECTED_STATUS) return CI_PENDING_STATUS;
  return status;
}

function pipelineStepIndex(status: string): number {
  if (status === PI_REJECTED_STATUS) return STAGES.indexOf(PI_PENDING_STATUS);
  if (status === CI_REJECTED_STATUS) return STAGES.indexOf(CI_PENDING_STATUS);
  return stageIndex(status, STAGES);
}

// Derive the furthest reached pipeline stage from the populated fields.
function deriveStatus(f: Record<string, string>): string {
  if (has(f.telexDate)) return "Telex / Seaway Released";
  if (has(f.bpDate) || has(f.bpAmount)) return "Balance Payment Received";
  if (has(f.bol) || has(f.shippingLine)) return "BL";
  if (has(f.ciApprovedDate)) return "CI approved";
  if (has(f.ciNo) || has(f.ciDate)) return "CI sent";
  if (has(f.containerNo) || has(f.actualDeparture)) return "Container Loaded";
  if (has(f.productionComplete)) return "Production Complete";
  if (has(f.productionStart) || has(f.productionEtc)) return "In Production";
  if (has(f.dpDate) || has(f.dpAmount)) return "Downpayment Received";
  if (has(f.piApprovedDate)) return "PI Approved";
  if (has(f.piNo) || has(f.piDate)) return "PI Generated";
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
  const pipelineStatus = resolvePipelineStatus(po.status);
  const nextStage = STAGES[stageIndex(pipelineStatus, STAGES) + 1];
  const canStep =
    po.status !== PI_REJECTED_STATUS &&
    po.status !== CI_REJECTED_STATUS &&
    nextStage &&
    canAdvanceStage(user, nextStage);
  const canEditProductionActualsPo = canEditProductionActualsForPo(user, pipelineStatus);
  const canDeletePo = canManageUsers(user);
  const showRejectPi = canRejectPiRole(user.role) && po.status === PI_PENDING_STATUS;
  const showResubmitPi = canResubmitPiRole(user.role) && po.status === PI_REJECTED_STATUS;
  const showRejectCi = canRejectCiRole(user.role) && po.status === CI_PENDING_STATUS;
  const showResubmitCi = canResubmitCiRole(user.role) && po.status === CI_REJECTED_STATUS;

  const editSections = useMemo(
    () =>
      EDIT_SECTIONS.map((sec) => ({
        ...sec,
        fields: sec.fields.map((fld) =>
          fld.k === "productionSite"
            ? { ...fld, type: "select" as const, options: master.uaeSites ?? [] }
            : fld,
        ),
      })),
    [master.uaeSites],
  );

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [autoStatus, setAutoStatus] = useState(true);
  const [stockingLocations, setStockingLocations] = useState<{ name: string; email: string | null }[]>([]);

  useEffect(() => {
    api.getReference().then((ref) => setStockingLocations(ref.stockingLocations));
  }, []);

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
    if (
      !confirm(
        `Permanently delete PO ${po.poNo}? This removes the order, all line items, and history. This cannot be undone.`,
      )
    ) {
      return;
    }
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
    for (const sec of editSections) {
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
        if (l.id != null) row.id = String(l.id);
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
      payload.lines = lines.map((l, idx) => {
        const lineNo = l.lineNo === "" ? idx + 1 : Number(l.lineNo);
        const row: Record<string, unknown> = {
          ...l,
          lineNo,
        };
        if (l.id !== "" && l.id != null) row.id = Number(l.id);
        else delete row.id;
        return row;
      });
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
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            {!editing && (
              <>
                {stagePill(po.status)}
                <ResubmitTag po={po} kind="pi" />
                <ResubmitTag po={po} kind="ci" />
              </>
            )}
            {canEdit && !editing && (
              <button
                type="button"
                onClick={startEdit}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50 font-medium"
              >
                Edit
              </button>
            )}
            {canDeletePo && onDeleted && !editing && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50 font-medium disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
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
            {editSections.map((sec) => (
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
                const cur = pipelineStepIndex(po.status);
                const cls = i < cur ? "done" : i === cur ? "current" : "";
                return (
                  <div key={s} className={`pipeline-step ${cls}`}>
                    {s}
                  </div>
                );
              })}
            </div>

            {po.status === PI_REJECTED_STATUS && po.piRejectedNote && (
              <div className="px-6 pt-4">
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase text-red-700 mb-1">PI rejected — manager note</div>
                  <p className="text-red-900 whitespace-pre-wrap">{po.piRejectedNote}</p>
                </div>
              </div>
            )}

            {po.status === CI_REJECTED_STATUS && po.ciRejectedNote && (
              <div className="px-6 pt-4">
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase text-red-700 mb-1">CI rejected — finance note</div>
                  <p className="text-red-900 whitespace-pre-wrap">{po.ciRejectedNote}</p>
                </div>
              </div>
            )}

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
              {(() => {
                const showActuals =
                  !!po.productionComplete || po.lines.some(lineHasActuals);
                const showLineNotes = po.lines.some((l) => l.actualNotes?.trim());
                return (
              <div className="border border-slate-200 rounded-md overflow-x-auto">
                <table className="tbl w-full table-fixed min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="w-8">#</th>
                      <th className="w-[14%]">Part #</th>
                      <th className="w-[12%]">Size</th>
                      <th className="w-[12%]">Color</th>
                      <th className="text-right w-14">Sheets</th>
                      <th className="text-right w-14">M²</th>
                      {showActuals && (
                        <>
                          <th className="text-right w-16">Actual sheets</th>
                          <th className="text-right w-14">Actual M²</th>
                          <th className="text-right w-14">Actual skids</th>
                        </>
                      )}
                      {showLineNotes && <th className="w-[22%]">Line notes</th>}
                      <th className="text-right w-16">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lines.map((l) => {
                      const lineNote = l.actualNotes?.trim();
                      return (
                      <tr key={l.lineNo}>
                        <td>{l.lineNo}</td>
                        <td className="font-mono truncate" title={l.partNo ?? undefined}>{l.partNo}</td>
                        <td className="truncate" title={l.size ?? undefined}>{l.size}</td>
                        <td className="truncate" title={l.color ?? undefined}>{l.color}</td>
                        <td className="text-right">{fmtNum(l.sheets, 0)}</td>
                        <td className="text-right">{fmtNum(l.qtyM2, 2)}</td>
                        {showActuals && (
                          <>
                            <td className="text-right">
                              <ActualQtyCell actual={l.actualSheets} ordered={l.sheets} decimals={0} />
                            </td>
                            <td className="text-right">
                              <ActualQtyCell actual={l.actualQtyM2} ordered={l.qtyM2} decimals={2} />
                            </td>
                            <td className="text-right">
                              {l.actualSkids != null ? (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200">
                                  {fmtNum(l.actualSkids, 0)}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </>
                        )}
                        {showLineNotes && (
                          <td className="text-slate-600">
                            {lineNote ? (
                              <span
                                className="block line-clamp-2 break-all text-[11px] leading-snug"
                                title={lineNote}
                              >
                                {lineNote}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                        <td className="text-right">{fmtMoney(l.extPo)}</td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
                );
              })()}
            </div>

            <div className="px-6 pb-4 grid grid-cols-2 gap-4">
              <Section title="PI Generated">
                <Field label="PI #" val={po.piNo} />
                <Field label="PI Date" val={po.piDate} />
                <Field label="PI Value" val={fmtMoney(po.piValue)} />
                <Field label="PI Approved" val={po.piApprovedDate ? fmtDate(po.piApprovedDate) : null} />
                {po.piNo && (
                  <div className="mt-2">
                    <PiPdfDownload poId={po.id} />
                  </div>
                )}
              </Section>
              <Section title="Downpayment">
                <Field label="DP Date" val={po.dpDate} />
                <Field label="DP Amount" val={fmtMoney(po.dpAmount)} />
              </Section>
              <Section title="Production">
                <Field label="Site" val={po.productionSite} />
                <Field label="Start" val={po.productionStart} />
                <Field label="ETC" val={po.productionEtc} />
                <Field label="Complete" val={po.productionComplete} />
                {po.productionNotes && (
                  <div className="col-span-2">
                    <Field label="Quality notes" val={po.productionNotes} />
                  </div>
                )}
              </Section>
              <Section title="Container & Shipping">
                <Field label="Container #" val={po.containerNo} />
                <Field label="ETD" val={po.actualDeparture} />
                <Field label="ETA" val={po.shippingEta} />
                <Field label="ISF" val={po.isf} />
              </Section>
              <Section title="BL">
                <Field label="BOL / SWBOL" val={po.bol} />
                <Field label="Shipping line" val={po.shippingLine} />
                <Field
                  label="Tracking"
                  val={
                    po.shippingUrl ? (
                      <a
                        href={po.shippingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline break-all"
                      >
                        {po.shippingUrl}
                      </a>
                    ) : null
                  }
                />
              </Section>
              <Section title="CI sent">
                <Field label="CI #" val={po.ciNo} />
                <Field label="CI Date" val={po.ciDate} />
                <Field label="CI Value" val={fmtMoney(po.ciValue)} />
                <Field label="Balance due" val={fmtMoney(po.balanceDue)} />
                <Field label="CI Approved" val={po.ciApprovedDate ? fmtDate(po.ciApprovedDate) : null} />
              </Section>
            </div>

            <StockingEmailQueue
              po={po}
              user={user}
              locations={stockingLocations}
              onUpdated={onUpdated}
            />

            <div className="px-6 pb-4">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">History</div>
              <div className="border border-slate-200 rounded-md p-3 text-xs max-h-40 overflow-y-auto bg-slate-50">
                {po.history.map((h) => (
                  <div key={h.id} className="flex justify-between gap-3 py-0.5">
                    <span>
                      <b>{h.stage}</b> — {h.note || ""}
                    </span>
                    <span className="text-slate-500">
                      {h.at} · {h.user?.name || "—"}
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
          ) : (
            <>
              {showResubmitPi && (
                <ResubmitPiButton
                  po={po}
                  onUpdated={(updated) => {
                    onUpdated(updated);
                    notifyPoUpdated();
                  }}
                />
              )}
              {showResubmitCi && (
                <ResubmitCiButton
                  po={po}
                  onUpdated={(updated) => {
                    onUpdated(updated);
                    notifyPoUpdated();
                  }}
                />
              )}
              {showRejectPi && canStep && nextStage === "PI Approved" && (
                <RejectPiButton
                  po={po}
                  onUpdated={(updated) => {
                    onUpdated(updated);
                    notifyPoUpdated();
                  }}
                />
              )}
              {showRejectCi && canStep && nextStage === "CI approved" && (
                <RejectCiButton
                  po={po}
                  onUpdated={(updated) => {
                    onUpdated(updated);
                    notifyPoUpdated();
                  }}
                />
              )}
              {!editing && canEditProductionActualsPo && (
                <ProductionActualsEditTrigger
                  po={po}
                  onUpdated={(updated) => {
                    onUpdated(updated);
                    notifyPoUpdated();
                  }}
                />
              )}
              {canStep ? (
                nextStage === "Production Complete" ? (
                  <ProductionCompleteTrigger
                    po={po}
                    onUpdated={(updated) => {
                      onUpdated(updated);
                      notifyPoUpdated();
                    }}
                  />
                ) : (
                  <AdvanceButton po={po} nextStage={nextStage} master={master} onUpdated={onUpdated} />
                )
              ) : po.status === PI_REJECTED_STATUS ? (
                <span className="text-xs text-slate-500">
                  {showResubmitPi
                    ? "Update PI fields if needed, then resubmit for manager approval."
                    : "PI rejected — awaiting maintainer fixes."}
                </span>
              ) : po.status === CI_REJECTED_STATUS ? (
                <span className="text-xs text-slate-500">
                  {showResubmitCi
                    ? "Update CI fields if needed, then resubmit for finance approval."
                    : "CI rejected — awaiting maintainer fixes."}
                </span>
              ) : nextStage ? (
                <span className="text-sm text-slate-600">{waitingForStageMessage(nextStage)}</span>
              ) : (
                <span className="text-sm text-emerald-700">Order complete · Arrived {po.arrivalDate || ""}</span>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function advanceVal(v: unknown): string {
  if (v == null || v === "" || v === "N/A") return "";
  return String(v);
}

function buildInitialAdvanceFields(
  po: PurchaseOrder,
  nextStage: string,
  master: MasterData,
  defs: { k: string; def?: string | number }[],
): Record<string, string> {
  const rec = po as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of defs) {
    const existing = advanceVal(rec[f.k]);
    if (existing) out[f.k] = existing;
    else if (f.def != null && f.def !== "") out[f.k] = String(f.def);
  }

  if (nextStage === "PI Generated") {
    if (!out.piDate) out.piDate = todayISO();
    if (!out.piValue && po.poValue != null) out.piValue = String(po.poValue);
  }
  if (nextStage === "PI Approved") {
    if (!out.piApprovedDate) out.piApprovedDate = todayISO();
  }
  if (nextStage === "Downpayment Received") {
    if (!out.dpDate) out.dpDate = todayISO();
    if (!out.dpAmount) {
      if (po.dpAmount != null) out.dpAmount = String(po.dpAmount);
      else {
        const base = po.piValue ?? po.poValue;
        const pct = master.downpaymentPct ?? 0.5;
        if (base != null) {
          out.dpAmount = String(Math.round(Number(base) * pct * 100) / 100);
        }
      }
    }
  }
  if (nextStage === "In Production") {
    if (!out.productionStart) out.productionStart = todayISO();
    if (!out.productionSite) {
      if (po.productionSite) out.productionSite = advanceVal(po.productionSite);
      else {
        out.productionSite =
          master.defaultProductionSite ?? master.uaeSites?.[0] ?? "";
      }
    }
    if (!out.productionEtc) {
      const weeks = master.productionEtcWeeks ?? 12;
      const start = out.productionStart || po.productionStart || todayISO();
      if (po.productionEtc) out.productionEtc = advanceVal(po.productionEtc);
      else out.productionEtc = addWeeksISO(start, weeks);
    }
  }
  if (nextStage === "Container Loaded") {
    if (!out.actualDeparture) out.actualDeparture = todayISO();
    if (!out.shippingEta && po.shippingEta) out.shippingEta = advanceVal(po.shippingEta);
  }
  if (nextStage === "CI sent") {
    if (!out.ciDate) out.ciDate = todayISO();
    if (!out.freight && master.freight != null) out.freight = String(master.freight);
    if (!out.inland && master.inland != null) out.inland = String(master.inland);
    if (!out.ciValue && po.piValue != null) out.ciValue = String(po.piValue);
    else if (!out.ciValue && po.poValue != null) out.ciValue = String(po.poValue);
    if (!out.balanceDue && po.balanceDue != null) out.balanceDue = String(po.balanceDue);
    else if (!out.balanceDue && out.ciValue && po.dpAmount != null) {
      out.balanceDue = String(Math.round((Number(out.ciValue) - Number(po.dpAmount)) * 100) / 100);
    }
  }
  if (nextStage === "CI approved") {
    if (!out.ciApprovedDate) out.ciApprovedDate = todayISO();
  }
  if (nextStage === "Balance Payment Received") {
    if (!out.bpDate) out.bpDate = todayISO();
    if (!out.bpAmount && po.balanceDue != null) out.bpAmount = String(po.balanceDue);
    else if (!out.bpAmount && po.bpAmount != null) out.bpAmount = String(po.bpAmount);
  }
  if (nextStage === "Telex / Seaway Released") {
    if (!out.telexDate) out.telexDate = todayISO();
  }
  if (nextStage === "Arrived") {
    if (!out.arrivalDate) out.arrivalDate = todayISO();
    if (!out.shippingEta && po.shippingEta) out.shippingEta = advanceVal(po.shippingEta);
  }

  return out;
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
  const [shippingLines, setShippingLines] = useState<ReferenceData["shippingLines"]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const applyBlTrackingUrl = (
    draft: Record<string, string>,
    lines: ReferenceData["shippingLines"],
  ): Record<string, string> => {
    const bol = draft.bol ?? "";
    const line = draft.shippingLine ?? "";
    if (!bol.trim() || !line.trim()) return draft;
    const url = autoShippingUrl(lines, line, bol);
    return url ? { ...draft, shippingUrl: url } : draft;
  };

  const updateBlField = (key: string, value: string) => {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      if (nextStage !== "BL") return next;
      if (key === "bol" || key === "shippingLine") {
        return applyBlTrackingUrl(next, shippingLines);
      }
      return next;
    });
  };

  const stageFieldDefs: Record<string, { k: string; label: string; type: string; options?: string[]; def?: string | number; autoNo?: boolean; autoDate?: boolean }[]> = {
    "PI Generated": [
      { k: "piNo", label: "PI Number", type: "text", autoNo: true },
      { k: "piDate", label: "PI Date", type: "date", autoDate: true },
      { k: "piValue", label: "PI Value (USD)", type: "number" },
    ],
    "PI Approved": [
      { k: "piApprovedDate", label: "Approval Date", type: "date", autoDate: true },
    ],
    "Downpayment Received": [
      { k: "dpDate", label: "DP Date", type: "date", autoDate: true },
      { k: "dpAmount", label: "DP Amount (USD)", type: "number" },
    ],
    "In Production": [
      { k: "productionSite", label: "Production site", type: "select", options: master.uaeSites || [] },
      { k: "productionStart", label: "Production start", type: "date", autoDate: true },
      { k: "productionEtc", label: "Production ETC", type: "date" },
    ],
    "Container Loaded": [
      { k: "containerNo", label: "Container #", type: "text" },
      { k: "actualDeparture", label: "ETD", type: "date" },
      { k: "shippingEta", label: "ETA", type: "date" },
    ],
    "CI sent": [
      { k: "ciNo", label: "CI Number", type: "text", autoNo: true },
      { k: "ciDate", label: "CI Date", type: "date", autoDate: true },
      { k: "freight", label: "Freight", type: "number", def: master.freight },
      { k: "inland", label: "Inland", type: "number", def: master.inland },
      { k: "ciValue", label: "CI Value (USD)", type: "number" },
      { k: "balanceDue", label: "Balance due (USD)", type: "number" },
    ],
    "CI approved": [
      { k: "ciApprovedDate", label: "Approval Date", type: "date", autoDate: true },
    ],
    BL: [
      { k: "bol", label: "BOL / SWBOL #", type: "text" },
      { k: "shippingLine", label: "Shipping line", type: "select" },
      { k: "shippingUrl", label: "Tracking URL", type: "url" },
    ],
    "Balance Payment Received": [
      { k: "bpDate", label: "BP Date", type: "date", autoDate: true },
      { k: "bpAmount", label: "BP Amount (USD)", type: "number" },
    ],
    "Telex / Seaway Released": [
      { k: "telexDate", label: "Telex release date", type: "date", autoDate: true },
    ],
    Arrived: [
      { k: "arrivalDate", label: "Actual arrival", type: "date", autoDate: true },
      { k: "shippingEta", label: "Confirmed ETA", type: "date" },
    ],
  };

  const defs = stageFieldDefs[nextStage] || [];

  const regenDocNo = async (field: "piNo" | "ciNo") => {
    const type = field === "piNo" ? "pi" : "ci";
    const { value } = await api.getNextDocNo(type, po.id);
    setFields((prev) => ({ ...prev, [field]: value }));
  };

  const openDialog = async () => {
    setLoading(true);
    try {
      let lineCatalog: ReferenceData["shippingLines"] = [];
      if (nextStage === "BL") {
        const ref = await api.getReference();
        lineCatalog = ref.shippingLines ?? [];
        setShippingLines(lineCatalog);
      }

      const initial = buildInitialAdvanceFields(po, nextStage, master, defs);
      if (nextStage === "PI Generated" && !initial.piNo) {
        const { value } = await api.getNextDocNo("pi", po.id);
        initial.piNo = value;
      }
      if (nextStage === "CI sent" && !initial.ciNo) {
        const { value } = await api.getNextDocNo("ci", po.id);
        initial.ciNo = value;
      }
      for (const f of defs) {
        if (f.autoDate) initial[f.k] = todayISO();
      }
      if (nextStage === "In Production" && !po.productionEtc && !initial.productionEtc) {
        const weeks = master.productionEtcWeeks ?? 12;
        initial.productionEtc = addWeeksISO(initial.productionStart || todayISO(), weeks);
      }
      if (nextStage === "BL") {
        if (!initial.shippingLine && lineCatalog.length === 1) {
          initial.shippingLine = lineCatalog[0].name;
        }
        const withUrl = applyBlTrackingUrl(initial, lineCatalog);
        Object.assign(initial, withUrl);
      }
      setFields(initial);
      setNote("");
      setOpen(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to prepare advance form");
    } finally {
      setLoading(false);
    }
  };

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

  const approvePi = nextStage === "PI Approved";
  const approveCi = nextStage === "CI approved";
  const isApproval = approvePi || approveCi;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void openDialog()}
        disabled={loading}
        className={`px-4 py-2 text-white text-sm rounded-md disabled:opacity-50 ${
          isApproval ? "bg-green-600 hover:bg-green-700" : "bg-indigo-600 hover:bg-indigo-700"
        }`}
      >
        {loading ? "Preparing…" : approvePi ? "Approve PI" : approveCi ? "Approve CI" : `Advance → ${nextStage}`}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-full">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">
          {approvePi ? "Approve PI" : approveCi ? "Approve CI" : `Advance to: ${nextStage}`}
        </div>
        <div className="p-5 space-y-3">
          {approvePi && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
              <div className="text-xs font-semibold uppercase text-slate-500 mb-1">PI details</div>
              <div>
                <span className="text-slate-500">PI #:</span> {po.piNo || "—"}
              </div>
              <div>
                <span className="text-slate-500">PI Date:</span> {po.piDate || "—"}
              </div>
              <div>
                <span className="text-slate-500">PI Value:</span> {po.piValue != null ? fmtMoney(po.piValue) : "—"}
              </div>
            </div>
          )}
          {approveCi && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
              <div className="text-xs font-semibold uppercase text-slate-500 mb-1">CI details</div>
              <div>
                <span className="text-slate-500">CI #:</span> {po.ciNo || "—"}
              </div>
              <div>
                <span className="text-slate-500">CI Date:</span> {po.ciDate || "—"}
              </div>
              <div>
                <span className="text-slate-500">CI Value:</span> {po.ciValue != null ? fmtMoney(po.ciValue) : "—"}
              </div>
              <div>
                <span className="text-slate-500">Balance due:</span> {po.balanceDue != null ? fmtMoney(po.balanceDue) : "—"}
              </div>
            </div>
          )}
          {defs.map((f) => (
            <div key={f.k}>
              <label className="text-xs text-slate-500 flex items-center justify-between gap-2">
                <span>
                  {f.label}
                  {f.autoNo ? <span className="text-slate-400"> (auto)</span> : null}
                  {f.autoDate ? <span className="text-slate-400"> (today)</span> : null}
                  {nextStage === "BL" && f.k === "shippingUrl" ? (
                    <span className="text-slate-400"> (auto from BOL + line)</span>
                  ) : null}
                </span>
                {f.autoNo && (f.k === "piNo" || f.k === "ciNo") && (
                  <button
                    type="button"
                    onClick={() => void regenDocNo(f.k as "piNo" | "ciNo")}
                    className="text-[10px] text-indigo-600 hover:underline"
                  >
                    Regenerate
                  </button>
                )}
                {nextStage === "BL" && f.k === "shippingUrl" && fields.bol && fields.shippingLine && (
                  <button
                    type="button"
                    onClick={() => setFields((prev) => applyBlTrackingUrl(prev, shippingLines))}
                    className="text-[10px] text-indigo-600 hover:underline"
                  >
                    Regenerate
                  </button>
                )}
              </label>
              {f.type === "select" ? (
                <select
                  className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                  value={fields[f.k] ?? ""}
                  onChange={(e) =>
                    nextStage === "BL" && f.k === "shippingLine"
                      ? updateBlField(f.k, e.target.value)
                      : setFields({ ...fields, [f.k]: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {(nextStage === "BL" && f.k === "shippingLine"
                    ? shippingLines.map((l) => l.name)
                    : f.options || []
                  ).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.autoDate ? (
                <input
                  type="text"
                  readOnly
                  value={fields[f.k] ?? todayISO()}
                  className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm bg-slate-50 text-slate-700"
                  title="Set to today's date"
                />
              ) : (
                <input
                  type={f.type}
                  className={`w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm ${f.autoNo ? "font-mono bg-slate-50" : ""} ${nextStage === "BL" && f.k === "shippingUrl" ? "font-mono text-xs" : ""}`}
                  value={fields[f.k] ?? ""}
                  onChange={(e) =>
                    nextStage === "BL" && (f.k === "bol" || f.k === "shippingLine")
                      ? updateBlField(f.k, e.target.value)
                      : setFields({ ...fields, [f.k]: e.target.value })
                  }
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
            className={`px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 ${
              isApproval ? "bg-green-600" : "bg-indigo-600"
            }`}
          >
            {saving ? "Saving…" : approvePi ? "Approve PI" : approveCi ? "Approve CI" : "Save & advance"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectPiButton({
  po,
  onUpdated,
}: {
  po: PurchaseOrder;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      alert("Please enter a reason for rejecting this PI.");
      return;
    }
    setSaving(true);
    try {
      const { po: updated } = await api.rejectPi(po.id, trimmed);
      onUpdated(updated);
      setOpen(false);
      setNote("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reject PI");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-red-300 text-red-700 text-sm rounded-md hover:bg-red-50"
      >
        Reject PI
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-full">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold text-red-800">Reject PI</div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600">
            PO <span className="font-mono font-semibold">{po.poNo}</span> · PI {po.piNo || "—"}
          </p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Reason for rejection (required)</label>
            <textarea
              required
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain what needs to be corrected…"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end">
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit rejection"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResubmitPiButton({
  po,
  onUpdated,
}: {
  po: PurchaseOrder;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { po: updated } = await api.resubmitPi(po.id, note.trim() || undefined);
      onUpdated(updated);
      setOpen(false);
      setNote("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to resubmit PI");
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
        Resubmit for approval
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-full">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">Resubmit for approval</div>
        <div className="p-5 space-y-3">
          {po.piRejectedNote && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <div className="text-xs font-semibold uppercase text-red-700 mb-1">Manager feedback</div>
              {po.piRejectedNote}
            </div>
          )}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Note (optional)</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was fixed before resubmitting…"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end">
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Resubmit for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectCiButton({
  po,
  onUpdated,
}: {
  po: PurchaseOrder;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = note.trim();
    if (!trimmed) {
      alert("Please enter a reason for rejecting this CI.");
      return;
    }
    setSaving(true);
    try {
      const { po: updated } = await api.rejectCi(po.id, trimmed);
      onUpdated(updated);
      setOpen(false);
      setNote("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reject CI");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-red-300 text-red-700 text-sm rounded-md hover:bg-red-50"
      >
        Reject CI
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-full">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold text-red-800">Reject CI</div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600">
            PO <span className="font-mono font-semibold">{po.poNo}</span> · CI {po.ciNo || "—"}
          </p>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Reason for rejection (required)</label>
            <textarea
              required
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain what needs to be corrected…"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end">
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit rejection"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResubmitCiButton({
  po,
  onUpdated,
}: {
  po: PurchaseOrder;
  onUpdated: (po: PurchaseOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { po: updated } = await api.resubmitCi(po.id, note.trim() || undefined);
      onUpdated(updated);
      setOpen(false);
      setNote("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to resubmit CI");
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
        Resubmit CI for approval
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-full">
        <div className="px-5 py-3 border-b border-slate-200 font-semibold">Resubmit CI for approval</div>
        <div className="p-5 space-y-3">
          {po.ciRejectedNote && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <div className="text-xs font-semibold uppercase text-red-700 mb-1">Finance feedback</div>
              {po.ciRejectedNote}
            </div>
          )}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Note (optional)</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was fixed before resubmitting…"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex gap-2 justify-end">
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Resubmit for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PiPdfDownload({ poId }: { poId: number }) {
  const [loading, setLoading] = useState(false);

  const download = async () => {
    setLoading(true);
    try {
      await api.downloadPiPdf(poId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to download PI PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => void download()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50"
    >
      {loading ? "Preparing…" : "Download PI PDF"}
    </button>
  );
}
