/** Client-side mirrors of production schedule helpers (keep in sync with backend/src/productionSchedule.ts). */

export type CapacityConfig = {
  lines: number;
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
  soNo?: string | null;
  productionBegin?: string | null;
  productionComplete?: string | null;
  dispatchFromFactory?: string | null;
};

const TERMINAL_PROD = new Set(["PRODUCTION COMPLETE", "SHIPPED"]);
const TERMINAL_STATUS = new Set(["Arrived", "Telex / Seaway Release", "Closed", "Cancelled"]);

function parseISODate(raw: string | null | undefined, fallback?: string): string | null {
  const s = (raw ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback ?? null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return fallback ?? null;
  return s;
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

export function isInSchedulePool(p: SchedulePo): boolean {
  if (p.active === false) return false;
  if (!p.allMaterialAvailable?.trim()) return false;
  if (p.productionStatus && TERMINAL_PROD.has(p.productionStatus)) return false;
  if (p.status && TERMINAL_STATUS.has(p.status)) return false;
  return true;
}

export function plannedProductionStart(p: {
  productionStart?: string | null;
  productionBegin?: string | null;
}): string | null {
  return parseISODate(p.productionStart) ?? parseISODate(p.productionBegin);
}

export type LeadTimes = { standard: number; nonStandard: number };

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

function addDaysISO(iso: string, days: number): string {
  const base = parseISODate(iso);
  if (!base) return iso;
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
