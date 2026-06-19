import type { PurchaseOrder } from "./types";

export const PI_PENDING_STATUS = "PI Generated";
export const PI_REJECTED_STATUS = "PI Rejected";
export const CI_PENDING_STATUS = "CI sent";
export const CI_REJECTED_STATUS = "CI Rejected";

export function pendingPiApprovals(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((p) => p.active !== false && p.status === PI_PENDING_STATUS);
}

export function pendingCiApprovals(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((p) => p.active !== false && p.status === CI_PENDING_STATUS);
}

export function rejectedPiOrders(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((p) => p.active !== false && p.status === PI_REJECTED_STATUS);
}

export function rejectedCiOrders(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((p) => p.active !== false && p.status === CI_REJECTED_STATUS);
}

export function isManagerRole(role?: string | null): boolean {
  return role === "MANAGER";
}

export function isOperationalAdminRole(role?: string | null): boolean {
  return role === "SUPER_ADMIN" || role === "MAINTAINER";
}

export function canRejectPiRole(role?: string | null): boolean {
  return role === "MANAGER" || role === "SUPER_ADMIN";
}

export function isFinanceRole(role?: string | null): boolean {
  return role === "FINANCE";
}

export function canApproveCiRole(role?: string | null): boolean {
  return role === "FINANCE" || role === "SUPER_ADMIN";
}

export function canRejectCiRole(role?: string | null): boolean {
  return role === "FINANCE" || role === "SUPER_ADMIN";
}

export function canResubmitPiRole(role?: string | null): boolean {
  return isOperationalAdminRole(role);
}

export function canResubmitCiRole(role?: string | null): boolean {
  return isOperationalAdminRole(role);
}

export function resubmitTag(po: Pick<PurchaseOrder, "piResubmitCount" | "status">): string | null {
  const count = po.piResubmitCount ?? 0;
  if (count > 0 && po.status === PI_PENDING_STATUS) {
    return `Resubmit (${count})`;
  }
  return null;
}

export function ciResubmitTag(po: Pick<PurchaseOrder, "ciResubmitCount" | "status">): string | null {
  const count = po.ciResubmitCount ?? 0;
  if (count > 0 && po.status === CI_PENDING_STATUS) {
    return `Resubmit (${count})`;
  }
  return null;
}

/** Plain-language hint when the current user cannot advance to the next stage. */
export function waitingForStageMessage(nextStage: string): string {
  const messages: Record<string, string> = {
    "PI Generated": "The proforma invoice will be prepared next.",
    "PI Approved": "This PI is with the manager for approval.",
    "Downpayment Received": "Downpayment will be recorded by the finance team.",
    "In Production": "Production will be updated by the maintainer team.",
    "Production Complete": "A supervisor will confirm production and final quantities.",
    "Container Loaded": "Container details will be added by logistics.",
    "CI sent": "The commercial invoice will be issued by finance.",
    "CI approved": "This CI is with finance for approval.",
    BL: "BOL and shipping details will be added by logistics.",
    "Balance Payment Received": "Balance payment will be recorded by finance.",
    "Telex / Seaway Released": "Telex release will be handled by finance.",
    Arrived: "Arrival will be confirmed by logistics.",
  };
  return messages[nextStage] ?? "The next step will be handled by another team member.";
}
