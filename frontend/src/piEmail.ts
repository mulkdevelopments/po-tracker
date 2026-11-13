import type { PurchaseOrder } from "./types";
import { plannedProductionStart } from "./productionSchedule";
import { fmtDate } from "./utils";

export function parsePiInternalEmails(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export function buildPiMailto(po: PurchaseOrder, to: string[], filename?: string): string {
  const start = plannedProductionStart(po);
  const subject = `Proforma Invoice — PO ${po.poNo}${po.piNo ? ` / PI ${po.piNo}` : ""}`;
  const attachHint = filename
    ? `Please find the Proforma Invoice attached (${filename}). If it is not attached yet, add the PDF that was just downloaded.`
    : "Please find the Proforma Invoice for review (PDF downloaded from PO Tracker — attach to this email).";
  const body = [
    "Team,",
    "",
    attachHint,
    "",
    `PO Number: ${po.poNo}`,
    `Rev: ${po.rev ?? 0}`,
    `PI Number: ${po.piNo || "—"}`,
    `PI Date: ${po.piDate ? fmtDate(po.piDate) : "—"}`,
    `Planned production start: ${start ? fmtDate(start) : "—"}`,
    `Stocking location: ${po.stockingLocation || "—"}`,
    `PO value: ${po.poValue != null ? po.poValue : "—"}`,
    "",
    "Regards,",
  ].join("\n");

  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  const toList = to.map((addr) => encodeURIComponent(addr)).join(",");
  return `mailto:${toList}?${params.toString()}`;
}

export function canMarkPiEmailRole(role: string | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "MAINTAINER";
}
