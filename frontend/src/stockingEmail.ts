import { STAGES, type PurchaseOrder } from "./types";
import { CI_PENDING_STATUS, CI_REJECTED_STATUS, PI_REJECTED_STATUS, PI_PENDING_STATUS } from "./piApproval";
import { fmtDate, fmtMoney } from "./utils";

function resolvePipelineStatus(status: string): string {
  if (status === PI_REJECTED_STATUS) return PI_PENDING_STATUS;
  if (status === CI_REJECTED_STATUS) return CI_PENDING_STATUS;
  return status;
}

export function isAtOrAfterCiSent(po: PurchaseOrder): boolean {
  const resolved = resolvePipelineStatus(po.status);
  const idx = STAGES.indexOf(resolved as (typeof STAGES)[number]);
  if (idx < 0) return false;
  return idx >= STAGES.indexOf(CI_PENDING_STATUS);
}

export function pendingStockingEmails(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((p) => p.active !== false && isAtOrAfterCiSent(p) && !p.stockingEmailSentAt);
}

export function canMarkStockingEmailRole(role: string | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "MAINTAINER";
}

export function stockingLocationEmail(
  po: PurchaseOrder,
  locations: { name: string; email: string | null }[],
): string | null {
  const loc = po.stockingLocation?.trim();
  if (!loc) return null;
  return locations.find((l) => l.name === loc)?.email?.trim() || null;
}

export function buildStockingMailto(po: PurchaseOrder, to: string): string {
  const subject = `Shipment update — PO ${po.poNo}${po.ciNo ? ` / CI ${po.ciNo}` : ""}`;
  const body = [
    "Dear team,",
    "",
    "Please find shipment details for your order:",
    "",
    `PO Number: ${po.poNo}`,
    `Rev: ${po.rev ?? 0}`,
    `Client: ${po.stockingLocation || "—"}`,
    `Port of Destination: ${po.portOfDest || "—"}`,
    `Commercial Invoice: ${po.ciNo || "—"}${po.ciDate ? ` (${fmtDate(po.ciDate)})` : ""}`,
    `CI Value: ${po.ciValue != null ? fmtMoney(po.ciValue) : "—"}`,
    `Container: ${po.containerNo || "—"}`,
    `BOL: ${po.bol || "—"}`,
    `Shipping Line: ${po.shippingLine || "—"}`,
    `ETD: ${po.actualDeparture ? fmtDate(po.actualDeparture) : "—"}`,
    `ETA: ${po.shippingEta ? fmtDate(po.shippingEta) : "—"}`,
    "",
    "Regards,",
  ].join("\n");

  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
}
