import type { PurchaseOrder } from "./types";
import { isAtOrAfterCiSent, resolvePipelineStatus, type WorkflowCompany } from "./workflows";
import { fmtDate, fmtMoney } from "./utils";

export function isAtOrAfterCiSentPo(po: PurchaseOrder): boolean {
  const company = (po.company ?? "UFP") as WorkflowCompany;
  return isAtOrAfterCiSent(company, resolvePipelineStatus(po.status), po as unknown as Record<string, unknown>);
}

export function pendingStockingEmails(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((p) => p.active !== false && isAtOrAfterCiSentPo(p) && !p.stockingEmailSentAt);
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
