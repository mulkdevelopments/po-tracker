export const STAGES = [
  "PO Received",
  "PI Generated",
  "PI Approved",
  "Downpayment Received",
  "In Production",
  "Production Complete",
  "Container Loaded",
  "CI sent",
  "CI approved",
  "BL",
  "Balance Payment Received",
  "Telex / Seaway Released",
  "Arrived",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_OWNERS: Record<string, string[]> = {
  "PO Received": ["MAINTAINER", "SUPER_ADMIN"],
  "PI Generated": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "PI Approved": ["MANAGER", "SUPER_ADMIN"],
  "Downpayment Received": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "In Production": ["MAINTAINER", "SUPER_ADMIN"],
  "Production Complete": ["SUPERVISOR", "SUPER_ADMIN"],
  "Container Loaded": ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
  "CI sent": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "CI approved": ["FINANCE", "SUPER_ADMIN"],
  BL: ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
  "Balance Payment Received": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "Telex / Seaway Released": ["FINANCE", "MAINTAINER", "SUPER_ADMIN"],
  "Arrived": ["LOGISTICS", "MAINTAINER", "SUPER_ADMIN"],
};

export const PAGES = [
  "dashboard",
  "orders",
  "production",
  "upload",
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
  MANAGER: ["upload", "pricing", "master", "users"],
  FINANCE: ["upload", "pricing", "master", "users"],
  LOGISTICS: ["upload", "pricing", "master", "users"],
  SUPERVISOR: ["upload", "pricing", "master", "users"],
  VIEWER: ["upload", "pricing", "master", "users"],
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

export function hasReachedProductionComplete(status: string): boolean {
  const target = STAGES.indexOf("Production Complete");
  if (target < 0) return false;
  const current = STAGES.indexOf(status as Stage);
  return current >= target;
}

export function hasReachedContainerLoaded(status: string): boolean {
  const target = STAGES.indexOf("Container Loaded");
  if (target < 0) return false;
  const current = STAGES.indexOf(status as Stage);
  return current >= target;
}

export function canEditProductionActualsForPo(role: string, status: string): boolean {
  if (!hasReachedProductionComplete(status)) return false;
  if (role === "SUPER_ADMIN") return true;
  if (role === "SUPERVISOR") return !hasReachedContainerLoaded(status);
  return false;
}

export function canWrite(
  role: string,
  _accessLevel: string,
): boolean {
  return isOperationalAdmin(role);
}

export function canAdvanceStage(role: string, stage: string): boolean {
  if (role === "VIEWER") return false;
  if (role === "SUPER_ADMIN") return true;
  return (STAGE_OWNERS[stage] ?? []).includes(role);
}

export const PI_PENDING_STATUS = "PI Generated";
export const PI_REJECTED_STATUS = "PI Rejected";
export const CI_PENDING_STATUS = "CI sent";
export const CI_REJECTED_STATUS = "CI Rejected";

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

function resolvePipelineStatus(status: string): string {
  if (status === PI_REJECTED_STATUS) return PI_PENDING_STATUS;
  if (status === CI_REJECTED_STATUS) return CI_PENDING_STATUS;
  return status;
}

export function isAtOrAfterCiSent(status: string): boolean {
  const resolved = resolvePipelineStatus(status);
  const idx = STAGES.indexOf(resolved as (typeof STAGES)[number]);
  if (idx < 0) return false;
  return idx >= STAGES.indexOf(CI_PENDING_STATUS);
}

export function accessLevelForRole(role: string): "FULL" | "READ_ONLY" {
  return role === "MAINTAINER" ? "FULL" : "READ_ONLY";
}

export function canManageUsers(role: string): boolean {
  return role === "SUPER_ADMIN";
}
