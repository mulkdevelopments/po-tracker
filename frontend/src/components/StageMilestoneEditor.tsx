import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { MasterData, PurchaseOrder, ReferenceData } from "../types";
import { todayISO, addWeeksISO } from "../utils";
import {
  deriveStatusFromFields,
  getSubstageLabel,
  EXCEPTION_STATUSES,
  type WorkflowCompany,
} from "../workflows";
import { autoShippingUrl } from "../shippingTracking";
import { getStageFieldDefs, STAGE_MILESTONE_KEYS, type StageFieldDef } from "../stageMilestones";
import { notifyPoUpdated } from "../poEvents";

function toStr(v: unknown): string {
  if (v == null || v === "N/A") return "";
  return String(v);
}

function loadFields(po: PurchaseOrder, defs: StageFieldDef[]): Record<string, string> {
  const rec = po as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of defs) out[f.k] = toStr(rec[f.k]);
  return out;
}

interface Props {
  po: PurchaseOrder;
  stageId: string;
  master: MasterData;
  company: WorkflowCompany;
  onClose: () => void;
  onUpdated: (po: PurchaseOrder) => void;
}

export default function StageMilestoneEditor({
  po,
  stageId,
  master,
  company,
  onClose,
  onUpdated,
}: Props) {
  const defs = getStageFieldDefs(master)[stageId] ?? [];
  const label = getSubstageLabel(company, stageId);
  const [fields, setFields] = useState<Record<string, string>>(() => loadFields(po, defs));
  const [shippingLines, setShippingLines] = useState<ReferenceData["shippingLines"]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(stageId === "BL");
  const [updateStatus, setUpdateStatus] = useState(
    !(EXCEPTION_STATUSES as readonly string[]).includes(po.status),
  );

  useEffect(() => {
    if (stageId !== "BL") return;
    let cancelled = false;
    void api
      .getReference()
      .then((ref) => {
        if (!cancelled) setShippingLines(ref.shippingLines ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stageId]);

  const applyBlTrackingUrl = (draft: Record<string, string>) => {
    const bol = draft.bol ?? "";
    const line = draft.shippingLine ?? "";
    if (!bol.trim() || !line.trim()) return draft;
    const url = autoShippingUrl(shippingLines, line, bol);
    return url ? { ...draft, shippingUrl: url } : draft;
  };

  const setField = (key: string, value: string) => {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      if (stageId === "BL" && (key === "bol" || key === "shippingLine")) {
        return applyBlTrackingUrl(next);
      }
      return next;
    });
  };

  const fillDefaults = async () => {
    const next = { ...fields };
    for (const f of defs) {
      if (f.autoDate && !next[f.k]) next[f.k] = todayISO();
      if (f.def != null && f.def !== "" && !next[f.k]) next[f.k] = String(f.def);
    }
    if (stageId === "PI Generated" && !next.piNo) {
      const { value } = await api.getNextDocNo("pi", po.id);
      next.piNo = value;
    }
    if (stageId === "CI sent" && !next.ciNo) {
      const { value } = await api.getNextDocNo("ci", po.id);
      next.ciNo = value;
    }
    if (stageId === "In Production" && !next.productionEtc) {
      const weeks = master.productionEtcWeeks ?? 12;
      next.productionEtc = addWeeksISO(next.productionStart || todayISO(), weeks);
    }
    if (stageId === "Downpayment Received" && !next.dpAmount) {
      const base = po.piValue ?? po.poValue;
      const pct = master.downpaymentPct ?? 0.5;
      if (base != null) next.dpAmount = String(Math.round(Number(base) * pct * 100) / 100);
    }
    if (stageId === "Planning" && !next.stockingLocation && po.stockingLocation) {
      next.stockingLocation = po.stockingLocation;
    }
    if (stageId === "Planning" && !next.productionSite) {
      next.productionSite =
        po.productionSite || master.defaultProductionSite || master.uaeSites?.[0] || "";
    }
    setFields(stageId === "BL" ? applyBlTrackingUrl(next) : next);
  };

  const clearStep = () => {
    const cleared: Record<string, string> = { ...fields };
    for (const f of defs) cleared[f.k] = "";
    for (const k of STAGE_MILESTONE_KEYS[stageId] ?? []) cleared[k] = "";
    setFields(cleared);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...fields };
      if (updateStatus) {
        const merged = { ...(po as unknown as Record<string, unknown>), ...fields };
        payload.status = deriveStatusFromFields(merged, company);
      }
      const { po: updated } = await api.updateOrder(po.id, payload);
      onUpdated(updated);
      notifyPoUpdated();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save step");
    } finally {
      setSaving(false);
    }
  };

  const regenDocNo = async (field: "piNo" | "ciNo") => {
    const { value } = await api.getNextDocNo(field === "piNo" ? "pi" : "ci", po.id);
    setField(field, value);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-full my-auto max-h-[min(90dvh,900px)] flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="font-semibold text-slate-900">{label}</div>
          <p className="text-xs text-slate-500 mt-0.5">
            Add or clear details for this step without waiting for the next advance.
          </p>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            defs.map((f) => (
              <div key={f.k}>
                <label className="text-xs text-slate-500 flex items-center justify-between gap-2 mb-0.5">
                  <span>{f.label}</span>
                  {f.autoNo && (f.k === "piNo" || f.k === "ciNo") && (
                    <button
                      type="button"
                      onClick={() => void regenDocNo(f.k as "piNo" | "ciNo")}
                      className="text-[10px] text-indigo-600 hover:underline"
                    >
                      Regenerate
                    </button>
                  )}
                  {stageId === "BL" && f.k === "shippingUrl" && fields.bol && fields.shippingLine && (
                    <button
                      type="button"
                      onClick={() => setFields((prev) => applyBlTrackingUrl(prev))}
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
                    onChange={(e) => setField(f.k, e.target.value)}
                  >
                    <option value="">—</option>
                    {(stageId === "BL" && f.k === "shippingLine"
                      ? shippingLines.map((l) => l.name)
                      : f.options || []
                    ).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={
                      f.type === "number"
                        ? "number"
                        : f.type === "date"
                          ? "date"
                          : f.type === "url"
                            ? "url"
                            : "text"
                    }
                    className={`w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm ${f.autoNo || f.k === "shippingUrl" ? "font-mono" : ""}`}
                    value={fields[f.k] ?? ""}
                    onChange={(e) => setField(f.k, e.target.value)}
                  />
                )}
              </div>
            ))
          )}

          <label className="flex items-center gap-2 text-xs text-slate-600 pt-1">
            <input
              type="checkbox"
              checked={updateStatus}
              onChange={(e) => setUpdateStatus(e.target.checked)}
            />
            Update order status from milestones
          </label>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap gap-2 justify-between shrink-0">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void fillDefaults()}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Fill defaults
            </button>
            <button
              type="button"
              onClick={clearStep}
              className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50"
            >
              Clear step
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void save()}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
