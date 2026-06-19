import { resubmitTag, ciResubmitTag } from "../piApproval";
import type { PurchaseOrder } from "../types";

export default function ResubmitTag({
  po,
  kind = "pi",
}: {
  po: Pick<PurchaseOrder, "piResubmitCount" | "ciResubmitCount" | "status">;
  kind?: "pi" | "ci";
}) {
  const label = kind === "ci" ? ciResubmitTag(po) : resubmitTag(po);
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800 border border-orange-200">
      {label}
    </span>
  );
}
