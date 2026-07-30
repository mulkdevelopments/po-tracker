import {
  STAGES,
  STAGE_OWNERS,
  PI_PENDING_STATUS,
  PI_REJECTED_STATUS,
  CI_PENDING_STATUS,
  CI_REJECTED_STATUS,
  hasReachedProductionComplete,
  hasReachedContainerLoaded,
  isAtOrAfterCiSent,
  getNextStage,
  workflowStageIndex,
  resolvePipelineStatus,
  type WorkflowCompany,
} from "./workflows.js";

export {
  STAGES,
  STAGE_OWNERS,
  PI_PENDING_STATUS,
  PI_REJECTED_STATUS,
  CI_PENDING_STATUS,
  CI_REJECTED_STATUS,
  getNextStage,
  getAllowedAdvanceStages,
  deriveStatusFromFields,
  workflowStageIndex,
  resolvePipelineStatus,
  getWorkflow,
  flatStageIds,
  getSubstageLabel,
  reportGroupLabel,
  hasReachedSubstage,
  isSubstageComplete,
  UFP_WORKFLOW,
  SYNERGY_WORKFLOW,
} from "./workflows.js";
export type { Stage, WorkflowCompany, WorkflowGroup, WorkflowSubstage } from "./workflows.js";

export const PAGES = [
  "dashboard",
  "orders",
  "production",
  "upload",
  "cynergy-forms",
  "items",
  "pricing",
  "master",
  "users",
] as const;

export type Page = (typeof PAGES)[number];

export const ASSIGNABLE_ROLES = ["MAINTAINER", "MANAGER", "FINANCE", "LOGISTICS", "SUPERVISOR", "VIEWER"] as const;

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  MAINTAINER: "Maintainer",
  MANAGER: "Manager",
  FINANCE: "Finance",
  LOGISTICS: "Logistics",
  SUPERVISOR: "Supervisor",
  VIEWER: "Viewer",
  HQ_SALES: "Finance",
  UAE_JEBEL_ALI: "Manager",
  UAE_SHARJAH: "Manager",
  UAE_ABU_DHABI: "Manager",
};

export const DEFAULT_RESTRICTED_BY_ROLE: Record<string, Page[]> = {
  MAINTAINER: ["users"],
  MANAGER: ["upload", "cynergy-forms", "pricing", "master", "users"],
  FINANCE: ["upload", "cynergy-forms", "pricing", "master", "users"],
  LOGISTICS: ["upload", "cynergy-forms", "pricing", "master", "users"],
  SUPERVISOR: ["upload", "cynergy-forms", "pricing", "master", "users"],
  VIEWER: ["upload", "cynergy-forms", "pricing", "master", "users"],
};

export function isOperationalAdmin(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "MAINTAINER";
}

export function canEditPo(role: string): boolean {
  return isOperationalAdmin(role);
}

export function canAccessPage(
  role: string,
  accessLevel: string,
  restrictedPages: string[],
  page: Page,
): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (restrictedPages.includes(page)) return false;
  const roleDefaults = DEFAULT_RESTRICTED_BY_ROLE[role] ?? [];
  if (roleDefaults.includes(page)) return false;
  return true;
}

export function canEditProductionActuals(role: string): boolean {
  return role === "SUPERVISOR" || role === "SUPER_ADMIN";
}

export function canEditProductionActualsForPo(
  role: string,
  status: string,
  company: WorkflowCompany = "UFP",
  po?: Record<string, unknown>,
): boolean {
  if (!hasReachedProductionComplete(company, status, po)) return false;
  if (role === "SUPER_ADMIN") return true;
  if (role === "SUPERVISOR") return !hasReachedContainerLoaded(company, status, po);
  return false;
}

export function canWrite(role: string, _accessLevel: string): boolean {
  return isOperationalAdmin(role);
}

export function canAdvanceStage(role: string, stage: string): boolean {
  if (role === "VIEWER") return false;
  if (role === "SUPER_ADMIN") return true;
  return (STAGE_OWNERS[stage] ?? []).includes(role);
}

export function canRejectPi(role: string): boolean {
  return role === "MANAGER" || role === "SUPER_ADMIN";
}

export function canRejectCi(role: string): boolean {
  return role === "FINANCE" || role === "SUPER_ADMIN";
}

export function canResubmitPi(role: string): boolean {
  return isOperationalAdmin(role);
}

export function canResubmitCi(role: string): boolean {
  return isOperationalAdmin(role);
}

export function canMarkStockingEmailSent(role: string): boolean {
  return isOperationalAdmin(role);
}

export function isAtOrAfterCiSentForPo(
  status: string,
  company: WorkflowCompany = "UFP",
  po?: Record<string, unknown>,
): boolean {
  return isAtOrAfterCiSent(company, status, po);
}

export function accessLevelForRole(role: string): "FULL" | "READ_ONLY" {
  return role === "MAINTAINER" ? "FULL" : "READ_ONLY";
}

export function canManageUsers(role: string): boolean {
  return role === "SUPER_ADMIN";
}

/** @deprecated use workflowStageIndex(company, status) */
export function legacyStageIndex(s: string): number {
  const i = STAGES.indexOf(s as (typeof STAGES)[number]);
  return i < 0 ? 0 : i;
}
