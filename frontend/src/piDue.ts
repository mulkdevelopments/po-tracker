import type { PurchaseOrder } from "./types";
import { isPiDue, isPiSendCalendarDay, plannedProductionStart } from "./productionSchedule";
import { todayISO } from "./utils";

export function pendingPiDue(pos: PurchaseOrder[], asOf = todayISO()): PurchaseOrder[] {
  return pos.filter((p) => isPiDue(p, asOf));
}

export { isPiSendCalendarDay, plannedProductionStart, isPiDue };
