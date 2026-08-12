/** Company-specific order pipelines with grouped stages and substages. */

export type WorkflowCompany = "UFP" | "SYNERGY";

export interface WorkflowSubstage {
  id: string;
  label: string;
}

export interface WorkflowGroup {
  id: string;
  label: string;
  /** Substages in this group may be completed in any order */
  parallel?: boolean;
  substages: WorkflowSubstage[];
}

/** Groups that may run concurrently once the workflow gate is passed */
export const PARALLEL_BLOCK_GROUP_IDS = ["production", "shipping", "ci"] as const;

export const EXCEPTION_STATUSES = [
  "PI Rejected",
  "CI Rejected",
  "PO Revised",
  "PO Cancelled",
] as const;

const withParallel = (groups: WorkflowGroup[]): WorkflowGroup[] =>
  groups.map((g) =>
    PARALLEL_BLOCK_GROUP_IDS.includes(g.id as (typeof PARALLEL_BLOCK_GROUP_IDS)[number])
      ? { ...g, parallel: g.id !== "ci" ? true : false }
      : g,
  );

export const UFP_WORKFLOW: WorkflowGroup[] = withParallel([
  {
    id: "po",
    label: "Purchase Order",
    substages: [{ id: "PO Received", label: "Purchase Order Received" }],
  },
  {
    id: "planning",
    label: "Planning",
    substages: [{ id: "Planning", label: "Planning complete" }],
  },
  {
    // Request #19: Proforma Invoice and Downpayment are tracked as one stage.
    id: "pi",
    label: "Proforma Invoice & Downpayment",
    substages: [
      { id: "PI Generated", label: "Proforma Invoice Generated" },
      { id: "PI Approved", label: "Proforma Invoice Approved" },
      { id: "PI Sent", label: "Proforma Invoice Sent" },
      { id: "Downpayment Received", label: "Downpayment Received" },
    ],
  },
  {
    id: "production",
    label: "Production",
    substages: [
      { id: "Material Available", label: "Material Available Date" },
      { id: "In Production", label: "Production Start Date" },
      { id: "Production Complete", label: "Production Complete Date" },
    ],
  },
  {
    id: "shipping",
    label: "Shipping",
    substages: [
      { id: "Shipped from Factory", label: "Shipped from Factory" },
      { id: "BL", label: "BOL / SWBOL" },
      { id: "Container Loaded", label: "Departure from Port" },
    ],
  },
  {
    id: "ci",
    label: "Commercial Invoice",
    substages: [
      { id: "CI sent", label: "Commercial Invoice Generated" },
      { id: "CI approved", label: "Commercial Invoice Approved" },
      { id: "CI Released", label: "Commercial Invoice Sent" },
    ],
  },
  {
    id: "payment",
    label: "Balance Payment",
    substages: [{ id: "Balance Payment Received", label: "Balance Payment Received" }],
  },
  {
    id: "telex",
    label: "Seaway / Telex",
    substages: [{ id: "Telex / Seaway Released", label: "Seaway / Telex Released" }],
  },
  {
    id: "arrival",
    label: "Arrival",
    substages: [{ id: "Arrived", label: "Arrival at Port" }],
  },
]);

export const SYNERGY_WORKFLOW: WorkflowGroup[] = withParallel([
  {
    id: "po",
    label: "Purchase Order",
    substages: [{ id: "PO Received", label: "Purchase Order Received" }],
  },
  {
    id: "planning",
    label: "Planning",
    substages: [{ id: "Planning", label: "Planning complete" }],
  },
  {
    id: "production",
    label: "Production",
    substages: [
      { id: "Material Available", label: "Material Available Date" },
      { id: "In Production", label: "Production Start Date" },
      { id: "Production Complete", label: "Production Complete Date" },
    ],
  },
  {
    id: "shipping",
    label: "Shipping",
    substages: [
      { id: "Shipped from Factory", label: "Shipped from Factory" },
      { id: "BL", label: "BOL / SWBOL" },
      { id: "Container Loaded", label: "Departure from Port" },
    ],
  },
  {
    id: "ci",
    label: "Commercial Invoice",
    substages: [
      { id: "CI sent", label: "Commercial Invoice Generated" },
      { id: "CI approved", label: "Commercial Invoice Approved" },
      { id: "CI Released", label: "Commercial Invoice Sent" },
    ],
  },
  {
    id: "telex",
    label: "Seaway / Telex",
    substages: [{ id: "Telex / Seaway Released", label: "Seaway / Telex Released" }],
  },
  {
    id: "arrival",
    label: "Arrival",
    substages: [{ id: "Arrived", label: "Arrival at Port" }],
  },
  {
    id: "payment",
    label: "Balance Payment",
    substages: [{ id: "Balance Payment Received", label: "Balance Payment Received" }],
  },
]);

export function getWorkflow(company: WorkflowCompany): WorkflowGroup[] {
  return company === "SYNERGY" ? SYNERGY_WORKFLOW : UFP_WORKFLOW;
}

export function flatSubstages(company: WorkflowCompany): WorkflowSubstage[] {
  return getWorkflow(company).flatMap((g) => g.substages);
}

export function flatStageIds(company: WorkflowCompany): string[] {
  return flatSubstages(company).map((s) => s.id);
}

export const ALL_SUBSTAGE_IDS = [
  ...new Set([
    ...flatStageIds("UFP"),
    ...flatStageIds("SYNERGY"),
    ...EXCEPTION_STATUSES,
  ]),
] as const;

export const STAGES = ALL_SUBSTAGE_IDS.filter(
  (s) => !(EXCEPTION_STATUSES as readonly string[]).includes(s),
) as readonly string[];

export type Stage = (typeof STAGES)[number];

export function resolvePipelineStatus(status: string): string {
  if (status === "PI Rejected") return "PI Generated";
  if (status === "CI Rejected") return "CI sent";
  return status;
}

const hasField = (v: unknown) => v != null && String(v).trim() !== "" && v !== "N/A";

/** Whether milestone fields for a substage are populated */
export function isSubstageComplete(
  po: Record<string, unknown>,
  stageId: string,
): boolean {
  switch (stageId) {
    case "PO Received":
      return true;
    case "Planning":
      return hasField(po.planningDate);
    case "PI Generated":
      return hasField(po.piNo) && hasField(po.piDate);
    case "PI Approved":
      return hasField(po.piApprovedDate);
    case "PI Sent":
      return hasField(po.piSent);
    case "Downpayment Received":
      return hasField(po.dpDate) || hasField(po.dpAmount);
    case "Material Available":
      return hasField(po.allMaterialAvailable);
    case "In Production":
      return hasField(po.productionStart) || hasField(po.productionEtc);
    case "Production Complete":
      return hasField(po.productionComplete);
    case "Shipped from Factory":
      return hasField(po.dispatchFromFactory);
    case "BL":
      return hasField(po.bol) || hasField(po.shippingLine);
    case "Container Loaded":
      return hasField(po.containerNo) || hasField(po.actualDeparture);
    case "CI sent":
      return hasField(po.ciNo) || hasField(po.ciDate);
    case "CI approved":
      return hasField(po.ciApprovedDate);
    case "CI Released":
      return hasField(po.revisionSent);
    case "Balance Payment Received":
      return hasField(po.bpDate) || hasField(po.bpAmount);
    case "Telex / Seaway Released":
      return hasField(po.telexDate);
    case "Arrived":
      return hasField(po.arrivalDate);
    default:
      return false;
  }
}

export function isGroupComplete(
  po: Record<string, unknown>,
  group: WorkflowGroup,
): boolean {
  return group.substages.every((s) => isSubstageComplete(po, s.id));
}

function parallelGateStageId(company: WorkflowCompany): string {
  return company === "SYNERGY" ? "Planning" : "Downpayment Received";
}

export function isPastParallelGate(company: WorkflowCompany, po: Record<string, unknown>): boolean {
  return isSubstageComplete(po, parallelGateStageId(company));
}

/** Next stage only — pipeline advances one step at a time in order */
export function getAllowedAdvanceStages(
  company: WorkflowCompany,
  po: Record<string, unknown>,
): string[] {
  const workflow = getWorkflow(company);
  for (const group of workflow) {
    for (const sub of group.substages) {
      if (!isSubstageComplete(po, sub.id)) {
        return [sub.id];
      }
    }
  }
  return [];
}

export function workflowStageIndex(company: WorkflowCompany, status: string): number {
  const resolved = resolvePipelineStatus(status);
  const ids = flatStageIds(company);
  const idx = ids.indexOf(resolved);
  return idx < 0 ? 0 : idx;
}

/** Primary next stage (first allowed) — for simple UI fallbacks */
export function groupAllowedStagesByGroup(
  company: WorkflowCompany,
  stageIds: string[],
): { group: WorkflowGroup; stages: string[] }[] {
  const workflow = getWorkflow(company);
  const out: { group: WorkflowGroup; stages: string[] }[] = [];
  for (const group of workflow) {
    const stages = stageIds.filter((id) => group.substages.some((s) => s.id === id));
    if (stages.length > 0) out.push({ group, stages });
  }
  return out;
}

export function pipelineProgressPercent(company: WorkflowCompany, po: Record<string, unknown>): number {
  const ids = flatStageIds(company);
  if (ids.length === 0) return 0;
  const done = ids.filter((id) => isSubstageComplete(po, id)).length;
  return Math.round((done / ids.length) * 100);
}

/** Groups that are in progress (show substage detail) */
/** Groups that are in progress (show substage detail) */
export function getActiveWorkflowGroups(
  company: WorkflowCompany,
  po: Record<string, unknown>,
): WorkflowGroup[] {
  const workflow = getWorkflow(company);
  for (const group of workflow) {
    if (!isGroupComplete(po, group)) return [group];
  }
  return [];
}

export function getNextStage(company: WorkflowCompany, status: string, po?: Record<string, unknown>): string | undefined {
  if (po) {
    const allowed = getAllowedAdvanceStages(company, po);
    return allowed[0];
  }
  const resolved = resolvePipelineStatus(status);
  const ids = flatStageIds(company);
  const idx = ids.indexOf(resolved);
  if (idx < 0 || idx >= ids.length - 1) return undefined;
  return ids[idx + 1];
}

export function getSubstageLabel(company: WorkflowCompany, stageId: string): string {
  for (const group of getWorkflow(company)) {
    const sub = group.substages.find((s) => s.id === stageId);
    if (sub) return sub.label;
  }
  return stageId;
}

export function getGroupForStage(company: WorkflowCompany, stageId: string): WorkflowGroup | undefined {
  return getWorkflow(company).find((g) => g.substages.some((s) => s.id === stageId));
}

export function reportGroupLabel(company: WorkflowCompany, status: string): string {
  const resolved = resolvePipelineStatus(status);
  const group = getGroupForStage(company, resolved);
  return group?.label ?? resolved;
}

export function hasReachedSubstage(
  company: WorkflowCompany,
  status: string,
  targetId: string,
  po?: Record<string, unknown>,
): boolean {
  if (po && isSubstageComplete(po, targetId)) return true;
  return workflowStageIndex(company, status) >= workflowStageIndex(company, targetId);
}

export const STAGE_OWNERS: Record<string, string[]> = {
  "PO Received": ["MAINTAINER", "SUPER_ADMIN"],
  Planning: ["MAINTAINER", "SUPER_ADMIN"],
  "PI Generated": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "PI Approved": ["MANAGER", "SUPER_ADMIN"],
  "PI Sent": ["MAINTAINER", "FINANCE", "SUPER_ADMIN"],
  "Downpayment Received": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "Material Available": ["SUPERVISOR", "MAINTAINER", "SUPER_ADMIN"],
  "In Production": ["MAINTAINER", "SUPER_ADMIN"],
  "Production Complete": ["SUPERVISOR", "SUPER_ADMIN"],
  "Shipped from Factory": ["SUPERVISOR", "MAINTAINER", "SUPER_ADMIN"],
  "Container Loaded": ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
  "CI sent": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "CI approved": ["FINANCE", "SUPER_ADMIN"],
  "CI Released": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  BL: ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
  "Balance Payment Received": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "Telex / Seaway Released": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  Arrived: ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
};

export const PI_PENDING_STATUS = "PI Generated";
export const PI_REJECTED_STATUS = "PI Rejected";
export const CI_PENDING_STATUS = "CI sent";
export const CI_REJECTED_STATUS = "CI Rejected";

export function hasReachedProductionComplete(
  company: WorkflowCompany,
  status: string,
  po?: Record<string, unknown>,
): boolean {
  return hasReachedSubstage(company, status, "Production Complete", po);
}

export function hasReachedContainerLoaded(
  company: WorkflowCompany,
  status: string,
  po?: Record<string, unknown>,
): boolean {
  return hasReachedSubstage(company, status, "Container Loaded", po);
}

export function isAtOrAfterCiSent(
  company: WorkflowCompany,
  status: string,
  po?: Record<string, unknown>,
): boolean {
  return hasReachedSubstage(company, status, CI_PENDING_STATUS, po);
}

/** Infer pipeline status from populated PO fields (used for auto-status in PoDrawer). */
export function deriveStatusFromFields(
  f: Record<string, unknown>,
  company: WorkflowCompany,
): string {
  if (hasField(f.arrivalDate)) return "Arrived";
  if (company === "SYNERGY") {
    if (hasField(f.bpDate) || hasField(f.bpAmount)) return "Balance Payment Received";
    if (hasField(f.telexDate)) return "Telex / Seaway Released";
  } else {
    if (hasField(f.telexDate)) return "Telex / Seaway Released";
    if (hasField(f.bpDate) || hasField(f.bpAmount)) return "Balance Payment Received";
  }
  if (hasField(f.revisionSent)) return "CI Released";
  if (hasField(f.ciApprovedDate)) return "CI approved";
  if (hasField(f.ciNo) || hasField(f.ciDate)) return "CI sent";
  if (hasField(f.actualDeparture) || hasField(f.containerNo)) return "Container Loaded";
  if (hasField(f.bol) || hasField(f.shippingLine)) return "BL";
  if (hasField(f.dispatchFromFactory)) return "Shipped from Factory";
  if (hasField(f.productionComplete)) return "Production Complete";
  if (hasField(f.productionStart) || hasField(f.productionEtc)) return "In Production";
  if (hasField(f.allMaterialAvailable)) return "Material Available";
  if (company === "UFP" && (hasField(f.dpDate) || hasField(f.dpAmount))) return "Downpayment Received";
  if (company === "UFP" && hasField(f.piSent)) return "PI Sent";
  if (company === "UFP" && hasField(f.piApprovedDate)) return "PI Approved";
  if (company === "UFP" && (hasField(f.piNo) || hasField(f.piDate))) return "PI Generated";
  if (hasField(f.planningDate)) return "Planning";
  return "PO Received";
}
