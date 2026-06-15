export const STAGES = [
  "PO Received",
  "Proforma Invoice Sent",
  "Downpayment Received",
  "In Production",
  "Container Loaded",
  "Commercial Invoice Sent",
  "Balance Payment Received",
  "Telex / Seaway Released",
  "Arrived",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_OWNERS: Record<string, string[]> = {
  "PO Received": ["HQ_SALES", "SUPER_ADMIN"],
  "Proforma Invoice Sent": ["HQ_SALES", "SUPER_ADMIN"],
  "Downpayment Received": ["HQ_SALES", "SUPER_ADMIN"],
  "In Production": ["UAE_JEBEL_ALI", "UAE_SHARJAH", "UAE_ABU_DHABI", "SUPER_ADMIN"],
  "Container Loaded": ["UAE_JEBEL_ALI", "UAE_SHARJAH", "UAE_ABU_DHABI", "SUPER_ADMIN"],
  "Commercial Invoice Sent": ["HQ_SALES", "SUPER_ADMIN"],
  "Balance Payment Received": ["HQ_SALES", "SUPER_ADMIN"],
  "Telex / Seaway Released": ["HQ_SALES", "SUPER_ADMIN"],
  "Arrived": ["LOGISTICS", "HQ_SALES", "SUPER_ADMIN"],
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

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HQ_SALES: "HQ / Sales",
  UAE_JEBEL_ALI: "UAE – Jebel Ali",
  UAE_SHARJAH: "UAE – Sharjah",
  UAE_ABU_DHABI: "UAE – Abu Dhabi",
  LOGISTICS: "Logistics",
  VIEWER: "Viewer",
};

export const DEFAULT_RESTRICTED_BY_ROLE: Record<string, Page[]> = {
  VIEWER: ["upload", "users"],
  LOGISTICS: ["upload", "pricing", "master", "users"],
  UAE_JEBEL_ALI: ["upload", "pricing", "master", "users"],
  UAE_SHARJAH: ["upload", "pricing", "master", "users"],
  UAE_ABU_DHABI: ["upload", "pricing", "master", "users"],
};

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

export function canWrite(
  role: string,
  accessLevel: string,
): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (accessLevel === "READ_ONLY") return false;
  return accessLevel === "FULL" || accessLevel === "READ_WRITE";
}

export function canAdvanceStage(role: string, stage: string): boolean {
  if (role === "SUPER_ADMIN") return true;
  return (STAGE_OWNERS[stage] ?? []).includes(role);
}

export function canManageUsers(role: string): boolean {
  return role === "SUPER_ADMIN";
}
