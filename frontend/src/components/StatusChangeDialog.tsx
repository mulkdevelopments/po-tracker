import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { MasterData, PurchaseOrder, ReferenceData } from "../types";
import { todayISO, addWeeksISO } from "../utils";
import { flatStageIds, getSubstageLabel, resolvePipelineStatus, type WorkflowCompany } from "../workflows";
import { getStageFieldDefs, STAGE_MILESTONE_KEYS, type StageFieldDef } from "../stageMilestones";
import { applyPortCharges } from "../portCharges";
import { expectedBalanceDue, shownBalanceDue } from "../paymentFlags";
import { matchStockingLocation } from "../stockingLocation";
import { autoShippingUrl } from "../shippingTracking";
import { derivedPlanningDate } from "../productionSchedule";
import { BusyLabel } from "./Skeleton";

function toStr(v: unknown): string {
  if (v == null || v === "N/A") return "";
  return String(v);
}

function draftFromPo(po: PurchaseOrder, master: MasterData): Record<string, string> {
  const rec = po as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const list of Object.values(getStageFieldDefs(master))) {
    for (const f of list) if (!(f.k in out)) out[f.k] = toStr(rec[f.k]);
  }
  return out;
}

function missingLabels(stageId: string, fields: Record<string, string>, defs: StageFieldDef[]): string[] {
  const auto = new Set(defs.filter((f) => f.auto).map((f) => f.k));
  const labels = new Map(defs.map((f) => [f.k, f.label]));
  return (STAGE_MILESTONE_KEYS[stageId] ?? [])
    .filter((k) => !auto.has(k) && !String(fields[k] ?? "").trim())
    .map((k) => labels.get(k) ?? k);
}

interface Props {
  po: PurchaseOrder;
  master: MasterData;
  onClose: () => void;
  onSaved: (po: PurchaseOrder) => void;
}

export default function StatusChangeDialog({ po, master, onClose, onSaved }: Props) {
  const company: WorkflowCompany = po.company === "SYNERGY" ? "SYNERGY" : "UFP";
  const stages = useMemo(() => flatStageIds(company), [company]);
  const start = stages.indexOf(resolvePipelineStatus(po.status));
  const [index, setIndex] = useState(start < 0 ? 0 : start);
  const [fields, setFields] = useState<Record<string, string>>(() => draftFromPo(po, master));
  const [shippingLines, setShippingLines] = useState<ReferenceData["shippingLines"]>([]);
  const [stockingLocations, setStockingLocations] = useState<ReferenceData["stockingLocations"]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageId = stages[index] ?? stages[0];
  const defs = getStageFieldDefs(master)[stageId] ?? [];
  const label = getSubstageLabel(company, stageId);
  const missing = missingLabels(stageId, fields, defs);

  useEffect(() => {
    let cancelled = false;
    void api.getReference(po.company).then((ref) => {
      if (cancelled) return;
      setShippingLines(ref.shippingLines ?? []);
      setStockingLocations(ref.stockingLocations ?? []);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [po.company]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (stageId !== "PI Approved" || fields.piNo?.trim() || po.piNo?.trim()) return;
    let cancelled = false;
    void api.getNextDocNo("pi", po.id, po.company).then(({ value }) => {
      if (cancelled) return;
      setFields((prev) => (prev.piNo?.trim() ? prev : { ...prev, piNo: value }));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stageId, po.id, po.company, po.piNo, fields.piNo]);

  const setField = (key: string, value: string) => {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "ciValue" || key === "freight" || key === "inland" || key === "dpAmount") {
        const due = expectedBalanceDue({
          ...next,
          dpAmount: next.dpAmount || po.dpAmount,
        });
        next.balanceDue = due == null ? "" : String(due);
      }
      if (key === "stockingLocation") {
        const loc = matchStockingLocation(stockingLocations, value);
        if (loc) next.stockingLocation = loc.name;
      }
      if (stageId === "BL" && (key === "bol" || key === "shippingLine")) {
        const url = autoShippingUrl(shippingLines, next.shippingLine ?? "", next.bol ?? "");
        if (url) next.shippingUrl = url;
      }
      return next;
    });
  };

  const fillAuto = async () => {
    const next = { ...fields };
    for (const f of defs) {
      if (f.autoDate && !next[f.k]) next[f.k] = todayISO();
      if (f.def != null && f.def !== "" && !next[f.k]) next[f.k] = String(f.def);
    }
    if (stageId === "Planning") {
      const derived = derivedPlanningDate(po, master.leadDays);
      if (derived) next.planningDate = derived;
      if (!next.stockingLocation && po.stockingLocation) next.stockingLocation = po.stockingLocation;
      if (!next.productionSite) {
        next.productionSite = po.productionSite || master.defaultProductionSite || master.uaeSites?.[0] || "";
      }
    }
    if (stageId === "PI Generated" || stageId === "PI Approved") {
      if (!next.piNo) {
        const { value } = await api.getNextDocNo("pi", po.id, po.company);
        next.piNo = value;
      }
    }
    if (stageId === "PI Generated") {
      if (!next.piDate) next.piDate = todayISO();
      if (!next.piValue && (po.piValue != null || po.poValue != null)) {
        next.piValue = String(po.piValue ?? po.poValue);
      }
    }
    if (stageId === "Downpayment Received" && !next.dpAmount) {
      const base = Number(next.piValue || po.piValue || po.poValue);
      const pct = master.downpaymentPct ?? 0.5;
      if (Number.isFinite(base)) next.dpAmount = String(Math.round(base * pct * 100) / 100);
    }
    if (stageId === "In Production") {
      if (!next.productionStart) next.productionStart = todayISO();
      if (!next.productionSite) {
        next.productionSite = po.productionSite || master.defaultProductionSite || master.uaeSites?.[0] || "";
      }
      if (!next.productionEtc) {
        next.productionEtc = addWeeksISO(next.productionStart || todayISO(), master.productionEtcWeeks ?? 12);
      }
    }
    if (stageId === "CI sent") {
      if (!next.ciNo) {
        const { value } = await api.getNextDocNo("ci", po.id, po.company);
        next.ciNo = value;
      }
      if (!next.ciDate) next.ciDate = todayISO();
      if (!next.ciValue && (po.piValue != null || po.poValue != null)) {
        next.ciValue = String(po.piValue ?? po.poValue);
      }
      const charged = applyPortCharges({
        ...next,
        portOfDest: po.portOfDest ?? "",
        dpAmount: next.dpAmount || toStr(po.dpAmount),
      });
      next.freight = charged.freight ?? "";
      next.inland = charged.inland ?? "";
      next.balanceDue = charged.balanceDue ?? "";
    }
    if (stageId === "Balance Payment Received" && !next.bpAmount) {
      const due = shownBalanceDue(po);
      if (due != null) next.bpAmount = String(due);
    }
    if (stageId === "BL") {
      const url = autoShippingUrl(shippingLines, next.shippingLine ?? "", next.bol ?? "");
      if (url) next.shippingUrl = url;
    }
    setFields(next);
  };

  const save = async () => {
    if (missing.length) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { status: stageId };
      for (const f of defs) payload[f.k] = fields[f.k] ?? "";
      const { po: updated } = await api.updateOrder(po.id, payload, po.company);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this status");
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-change-title"
        className="flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div id="status-change-title" className="font-semibold text-slate-900">
            PO {po.poNo}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Choose a status and fill its fields. It is saved only when every required field is filled.
          </p>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
          <label className="block text-xs text-slate-500">
            Status
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
              value={stageId}
              onChange={(e) => setIndex(stages.indexOf(e.target.value))}
            >
              {stages.map((id) => (
                <option key={id} value={id}>
                  {getSubstageLabel(company, id)}
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs font-medium text-slate-500">
            {index + 1} of {stages.length} · {label}
          </div>

          {defs.length === 0 ? (
            <p className="text-sm text-slate-600">This status has no extra fields.</p>
          ) : (
            defs.map((f) => (
              <label key={f.k} className="block text-xs text-slate-500">
                {f.label}
                {f.auto ? (
                  <input
                    readOnly
                    value={fields[f.k] ?? ""}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
                  />
                ) : f.type === "select" ? (
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    value={fields[f.k] ?? ""}
                    onChange={(e) => setField(f.k, e.target.value)}
                  >
                    <option value="">—</option>
                    {(f.k === "stockingLocation"
                      ? stockingLocations.map((l) => l.name)
                      : f.k === "shippingLine"
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
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "url" ? "url" : "text"}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={fields[f.k] ?? ""}
                    onChange={(e) => setField(f.k, e.target.value)}
                  />
                )}
              </label>
            ))
          )}

          {missing.length > 0 && (
            <p className="text-xs text-amber-800">Still needed: {missing.join(", ")}</p>
          )}
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => void fillAuto()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Auto values
          </button>
          <button
            type="button"
            disabled={index >= stages.length - 1}
            onClick={() => setIndex((i) => Math.min(stages.length - 1, i + 1))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || missing.length > 0}
              onClick={() => void save()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              <BusyLabel busy={saving} className="h-3 w-10">Save</BusyLabel>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
