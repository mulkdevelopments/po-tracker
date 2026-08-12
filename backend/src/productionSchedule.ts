/** Autocalculate planned production dates from priority, sequence, material date, and capacity. */

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
  poDate?: string | null;
  standardColorsOnly?: string | null;
};

export type LeadTimes = { standard: number; nonStandard: number };

export type ScheduleUpdate = {
  id: number;
  productionBegin: string;
  productionComplete: string;
  productionStart: string;
  productionEtc: string;
  planningDate: string;
};

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
  const pa = (a.priority || "Standard") === "High" ? 0 : 1;
  const pb = (b.priority || "Standard") === "High" ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const sa = a.productionSequence ?? 999999;
  const sb = b.productionSequence ?? 999999;
  if (sa !== sb) return sa - sb;
  const ma = parseISODate(a.allMaterialAvailable) || "9999-12-31";
  const mb = parseISODate(b.allMaterialAvailable) || "9999-12-31";
  if (ma !== mb) return ma.localeCompare(mb);
  return a.id - b.id;
}

export function isInSchedulePool(p: SchedulePo): boolean {
  if (p.active === false) return false;
  if (!p.allMaterialAvailable?.trim()) return false;
  if (p.productionStatus && TERMINAL_PROD.has(p.productionStatus)) return false;
  if (p.status && TERMINAL_STATUS.has(p.status)) return false;
  return true;
}

/**
 * Assign production begin/complete (and sync workflow start/ETC) walking a shared capacity calendar.
 */
export function recalculateProductionDates(
  pos: SchedulePo[],
  periods: CapacityPeriodLike[],
  fallback: CapacityConfig,
  todayISO: string,
  leadTimes: LeadTimes = DEFAULT_LEAD_TIMES,
): ScheduleUpdate[] {
  const today = parseISODate(todayISO) ?? new Date().toISOString().slice(0, 10);
  const pool = pos.filter(isInSchedulePool).sort(compareProductionOrder);
  const updates: ScheduleUpdate[] = [];
  let cursor = today;

  for (const po of pool) {
    // Material field may be a date ("2026-01-15") or a flag ("Yes" / "OLD STOCK")
    const material = parseISODate(po.allMaterialAvailable) ?? today;
    let start = nextWorkingDay(maxISO(cursor, material));
    const m2 = Math.max(0, Number(po.totalM2) || 0);
    const cfg = capacityConfigForDate(periods, start, fallback);
    const daily = Math.max(1, cfg.lines * cfg.m2PerLinePerDay);
    let remaining = m2 > 0 ? m2 : daily; // at least one day if no m2
    let day = start;
    let lastWorked = start;
    let guard = 0;

    while (remaining > 0 && guard++ < 10000) {
      day = nextWorkingDay(day);
      remaining -= daily;
      lastWorked = day;
      if (remaining > 0) day = addDaysISO(day, 1);
    }

    updates.push({
      id: po.id,
      productionBegin: start,
      productionComplete: lastWorked,
      productionStart: start,
      productionEtc: lastWorked,
      planningDate: derivedPlanningDate({ ...po, productionStart: start }, leadTimes) ?? start,
    });

    // Next PO starts the working day after this one finishes (sequential factory)
    cursor = addDaysISO(lastWorked, 1);
  }

  return updates;
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
