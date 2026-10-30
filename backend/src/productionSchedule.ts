/** Autocalculate planned production dates from row order, material date, and capacity. */

export type CapacityConfig = {
  lines: number;
  m2PerLinePerDay: number;
  m2PerContainer: number;
  workingDaysPerMonth: number;
};

export type CapacityPeriodLike = {
  effectiveFrom: string;
  effectiveTo?: string | null;
  productionLines: number;
  m2PerLinePerDay: number;
  m2PerContainer: number;
  workingDaysPerMonth: number;
};

export type SchedulePo = {
  id: number;
  active?: boolean | null;
  priority?: string | null;
  productionSequence?: number | null;
  allMaterialAvailable?: string | null;
  totalM2?: number | null;
  productionStatus?: string | null;
  status?: string | null;
  productionBegin?: string | null;
  productionComplete?: string | null;
  productionStart?: string | null;
  productionEtc?: string | null;
  productionBeginConfirmed?: boolean | null;
  productionCompleteConfirmed?: boolean | null;
  dispatchConfirmed?: boolean | null;
  soNo?: string | null;
  dispatchFromFactory?: string | null;
  poDate?: string | null;
  standardColorsOnly?: string | null;
};

/** Sequence numbers are spaced so a row can be slotted between two others by hand. */
export const SEQUENCE_STEP = 10;

export type LeadTimes = { standard: number; nonStandard: number };

export type ScheduleUpdate = {
  id: number;
  productionBegin: string;
  productionComplete: string;
  dispatchFromFactory: string;
  productionStart: string;
  productionEtc: string;
  planningDate: string;
  writeBegin: boolean;
  writeComplete: boolean;
  writeDispatch: boolean;
};

export type ScheduleMode = "fill" | "replan";

const TERMINAL_PROD = new Set(["PRODUCTION COMPLETE", "SHIPPED"]);
const TERMINAL_STATUS = new Set(["Arrived", "Telex / Seaway Release", "Closed", "Cancelled"]);

function isEffectiveOn(from: string | null | undefined, to: string | null | undefined, onISO: string): boolean {
  if (from && from > onISO) return false;
  if (to && to < onISO) return false;
  return true;
}

export function capacityConfigForDate(
  periods: CapacityPeriodLike[],
  onISO: string,
  fallback: CapacityConfig,
): CapacityConfig {
  const hit = [...periods]
    .filter((p) => isEffectiveOn(p.effectiveFrom, p.effectiveTo, onISO))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (hit) {
    return {
      lines: hit.productionLines,
      m2PerLinePerDay: hit.m2PerLinePerDay,
      m2PerContainer: hit.m2PerContainer,
      workingDaysPerMonth: hit.workingDaysPerMonth,
    };
  }
  return fallback;
}

function parseISODate(raw: string | null | undefined, fallback?: string): string | null {
  const s = (raw ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback ?? null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return fallback ?? null;
  return s;
}

function addDaysISO(iso: string, days: number): string {
  const base = parseISODate(iso);
  if (!base) throw new Error(`Invalid date: ${iso}`);
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const base = parseISODate(iso);
  if (!base) return false;
  const d = new Date(`${base}T12:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function nextWorkingDay(iso: string): string {
  let cur = parseISODate(iso) ?? iso;
  let guard = 0;
  while (isWeekend(cur) && guard++ < 14) cur = addDaysISO(cur, 1);
  return cur;
}

function maxISO(a: string, b: string): string {
  return a >= b ? a : b;
}

export function compareProductionOrder(a: SchedulePo, b: SchedulePo): number {
  const sa = a.productionSequence ?? 999999;
  const sb = b.productionSequence ?? 999999;
  if (sa !== sb) return sa - sb;
  const ma = parseISODate(a.allMaterialAvailable) || "9999-12-31";
  const mb = parseISODate(b.allMaterialAvailable) || "9999-12-31";
  if (ma !== mb) return ma.localeCompare(mb);
  return a.id - b.id;
}

/** Orders the production board lists — anything with a production field filled in. */
export function isOnProductionBoard(p: SchedulePo): boolean {
  return !!(
    p.soNo ||
    p.productionStatus ||
    p.productionBegin ||
    p.productionComplete ||
    p.dispatchFromFactory ||
    p.allMaterialAvailable ||
    p.productionSequence != null
  );
}

/**
 * Number the production board 10, 20, 30… in the order it is displayed.
 *
 * Because `compareProductionOrder` reads the existing sequence first, running
 * this again keeps the order the operator sees and only re-spaces the numbers.
 * Returns just the orders whose number changes.
 */
export function numberProductionSequence(
  pos: SchedulePo[],
): { id: number; productionSequence: number }[] {
  const board = pos.filter(isOnProductionBoard).sort(compareProductionOrder);
  const changed: { id: number; productionSequence: number }[] = [];
  board.forEach((p, idx) => {
    const productionSequence = (idx + 1) * SEQUENCE_STEP;
    if ((p.productionSequence ?? null) !== productionSequence) {
      changed.push({ id: p.id, productionSequence });
    }
  });
  return changed;
}

export function isInSchedulePool(p: SchedulePo): boolean {
  if (p.active === false) return false;
  if (!p.allMaterialAvailable?.trim()) return false;
  if (p.productionStatus && TERMINAL_PROD.has(p.productionStatus)) return false;
  if (p.status && TERMINAL_STATUS.has(p.status)) return false;
  return true;
}

function blankDate(value: string | null | undefined): boolean {
  return !parseISODate(value);
}

function dateIsLocked(mode: ScheduleMode, confirmed: boolean | null | undefined, value: string | null | undefined): boolean {
  if (blankDate(value)) return false;
  if (mode === "fill") return true;
  return !!confirmed;
}

/**
 * Assign production begin, then completion two days after that start and dispatch
 * three days after completion. Fill mode only proposes dates that are still empty.
 * Replan keeps a start date that has been marked correct and rebuilds the other two from it.
 */
export function recalculateProductionDates(
  pos: SchedulePo[],
  _periods: CapacityPeriodLike[],
  _fallback: CapacityConfig,
  todayISO: string,
  leadTimes: LeadTimes = DEFAULT_LEAD_TIMES,
  mode: ScheduleMode = "replan",
): ScheduleUpdate[] {
  const today = parseISODate(todayISO) ?? new Date().toISOString().slice(0, 10);
  const pool = pos.filter(isInSchedulePool).sort(compareProductionOrder);
  const updates: ScheduleUpdate[] = [];
  let cursor = today;

  for (const po of pool) {
    const beginLocked = dateIsLocked(mode, po.productionBeginConfirmed, po.productionBegin);
    const completeLocked = mode === "fill" && !blankDate(po.productionComplete);
    const dispatchLocked = mode === "fill" && !blankDate(po.dispatchFromFactory);
    const material = parseISODate(po.allMaterialAvailable) ?? today;
    const start = beginLocked
      ? parseISODate(po.productionBegin)!
      : nextWorkingDay(maxISO(cursor, material));
    const lastWorked = completeLocked ? parseISODate(po.productionComplete)! : addDaysISO(start, 2);
    const dispatch = dispatchLocked ? parseISODate(po.dispatchFromFactory)! : addDaysISO(lastWorked, 3);
    const writeBegin = !beginLocked && parseISODate(po.productionBegin) !== start;
    const writeComplete = !completeLocked && parseISODate(po.productionComplete) !== lastWorked;
    const writeDispatch = !dispatchLocked && parseISODate(po.dispatchFromFactory) !== dispatch;

    if (writeBegin || writeComplete || writeDispatch) {
      updates.push({
        id: po.id,
        productionBegin: start,
        productionComplete: lastWorked,
        dispatchFromFactory: dispatch,
        productionStart: start,
        productionEtc: lastWorked,
        planningDate: derivedPlanningDate({ ...po, productionStart: start }, leadTimes) ?? start,
        writeBegin,
        writeComplete,
        writeDispatch,
      });
    }

    const next = addDaysISO(lastWorked, 1);
    if (next > cursor) cursor = next;
  }

  return updates;
}

const MANUAL_PROD_STATUS = new Set(["ON HOLD", "CONTAINER BOOKED"]);
const BLOCKED_ORDER_STATUS = new Set(["PI Rejected", "CI Rejected", "PO Revised", "PO Cancelled", "Cancelled", "Closed"]);
const PROD_STATUS_RANK: Record<string, number> = {
  "UNDER PRODUCTION": 1,
  "PRODUCTION COMPLETE": 2,
  SHIPPED: 3,
};

export type ProductionProgress = {
  productionStatus?: string;
  status?: string;
};

/**
 * Move production status, and the order-summary status, forward once a correct
 * date has been reached. Tentative dates and future dates do not move status.
 * On hold / container booked, and rejected or cancelled orders, are left as they are.
 */
export function productionProgressUpdate(
  po: SchedulePo,
  todayISO: string,
  stageIndex: (status: string) => number,
): ProductionProgress | null {
  if (BLOCKED_ORDER_STATUS.has(po.status || "")) return null;
  if (MANUAL_PROD_STATUS.has(po.productionStatus || "")) return null;
  const today = parseISODate(todayISO) ?? todayISO.slice(0, 10);
  const reached = (date: string | null | undefined, confirmed: boolean | null | undefined) => {
    const d = parseISODate(date);
    return !!confirmed && !!d && d <= today;
  };

  let targetProd: string | null = null;
  let targetStatus: string | null = null;
  if (reached(po.dispatchFromFactory, po.dispatchConfirmed)) {
    targetProd = "SHIPPED";
    targetStatus = "Shipped from Factory";
  } else if (reached(po.productionComplete, po.productionCompleteConfirmed)) {
    targetProd = "PRODUCTION COMPLETE";
    targetStatus = "Production Complete";
  } else if (reached(po.productionBegin, po.productionBeginConfirmed)) {
    targetProd = "UNDER PRODUCTION";
    targetStatus = "In Production";
  }
  if (!targetProd || !targetStatus) return null;

  const data: ProductionProgress = {};
  const curProd = PROD_STATUS_RANK[po.productionStatus || ""] ?? 0;
  if (PROD_STATUS_RANK[targetProd] > curProd) data.productionStatus = targetProd;
  if (stageIndex(targetStatus) > stageIndex(po.status || "")) data.status = targetStatus;
  return data.productionStatus || data.status ? data : null;
}

export function plannedProductionStart(p: {
  productionStart?: string | null;
  productionBegin?: string | null;
}): string | null {
  return parseISODate(p.productionStart) ?? parseISODate(p.productionBegin);
}

export const DEFAULT_LEAD_TIMES: LeadTimes = { standard: 45, nonStandard: 90 };

/** "No" / "N" means the order contains non-standard colours and uses the longer lead time. */
function usesStandardLeadTime(standardColorsOnly: string | null | undefined): boolean {
  const v = String(standardColorsOnly ?? "").trim();
  if (!v) return true;
  return !/^(no|n|non|non-standard|nonstandard|false)$/i.test(v);
}

/**
 * Planning date is derived, not typed: planning must be finished by the lead-time
 * cut-off for the scheduled production start (standard vs non-standard colours),
 * and never before the order itself was placed.
 */
export function derivedPlanningDate(
  p: {
    poDate?: string | null;
    productionStart?: string | null;
    productionBegin?: string | null;
    standardColorsOnly?: string | null;
  },
  leadTimes: LeadTimes = DEFAULT_LEAD_TIMES,
): string | null {
  const start = plannedProductionStart(p);
  if (!start) return null;
  const lead = usesStandardLeadTime(p.standardColorsOnly)
    ? leadTimes.standard
    : leadTimes.nonStandard;
  const cutoff = addDaysISO(start, -Math.max(0, Number(lead) || 0));
  const poDate = parseISODate(p.poDate);
  return poDate && cutoff < poDate ? poDate : cutoff;
}

export function addWeeksISO(iso: string, weeks: number): string {
  const base = parseISODate(iso);
  if (!base) return iso;
  return addDaysISO(base, weeks * 7);
}

export function isPiSendCalendarDay(iso: string): boolean {
  const base = parseISODate(iso);
  if (!base) return false;
  const day = Number(base.slice(8, 10));
  return day === 1 || day === 15;
}

/** PI due when planned start is within 14 weeks and PI not yet marked sent. */
export function isPiDue(
  p: {
    active?: boolean | null;
    piSent?: string | null;
    productionStart?: string | null;
    productionBegin?: string | null;
  },
  todayISO: string,
  weeksBefore = 14,
): boolean {
  if (p.active === false) return false;
  if (p.piSent?.trim()) return false;
  const start = plannedProductionStart(p);
  if (!start) return false;
  const today = parseISODate(todayISO) ?? todayISO.slice(0, 10);
  const windowStart = addWeeksISO(start, -weeksBefore);
  return today >= windowStart;
}
