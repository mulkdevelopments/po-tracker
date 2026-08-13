/**
 * Our price list is the only thing that prices an order. The rate and amounts printed on the
 * customer PO are stored alongside (custUnitMsf / custExtPo / custPoTotal) so an operator gets
 * told when the customer has ordered at a stale or wrong price.
 */

import { fmtMoney } from "./utils";

/** A $/MSF rate is only flagged when it differs by more than a cent. */
export const UNIT_TOLERANCE = 0.01;
/** Line and order amounts are only flagged past a dollar. */
export const AMOUNT_TOLERANCE = 1;

type Loose = number | string | null | undefined;

type LineLike = {
  lineNo?: Loose;
  partNo?: Loose;
  unitMsf?: Loose;
  extPo?: Loose;
  custUnitMsf?: Loose;
  custExtPo?: Loose;
};

export type PriceMismatch = {
  lineNo: number | null;
  partNo: string | null;
  poUnit: number | null;
  ourUnit: number | null;
  poAmount: number | null;
  ourAmount: number | null;
};

function num(v: Loose): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Non-null when the customer PO priced this line differently to our table. */
export function linePriceMismatch(line: LineLike): PriceMismatch | null {
  const poUnit = num(line.custUnitMsf);
  const ourUnit = num(line.unitMsf);
  const poAmount = num(line.custExtPo);
  const ourAmount = num(line.extPo);
  const unitOff =
    poUnit != null && ourUnit != null && Math.abs(poUnit - ourUnit) > UNIT_TOLERANCE;
  const amountOff =
    poAmount != null && ourAmount != null && Math.abs(poAmount - ourAmount) > AMOUNT_TOLERANCE;
  if (!unitOff && !amountOff) return null;
  const partNo = line.partNo == null || line.partNo === "" ? null : String(line.partNo);
  return { lineNo: num(line.lineNo), partNo, poUnit, ourUnit, poAmount, ourAmount };
}

export function linePriceMismatches(lines: LineLike[]): PriceMismatch[] {
  const out: PriceMismatch[] = [];
  lines.forEach((l, idx) => {
    const m = linePriceMismatch(l);
    if (m) out.push({ ...m, lineNo: m.lineNo ?? idx + 1 });
  });
  return out;
}

export type TotalMismatch = { poTotal: number; ourTotal: number; variance: number };

/** Non-null when the total printed on the PO disagrees with the value we priced. */
export function poTotalMismatch(po: {
  poValue?: Loose;
  custPoTotal?: Loose;
}): TotalMismatch | null {
  const poTotal = num(po.custPoTotal);
  const ourTotal = num(po.poValue);
  if (poTotal == null || ourTotal == null) return null;
  const variance = poTotal - ourTotal;
  if (Math.abs(variance) <= AMOUNT_TOLERANCE) return null;
  return { poTotal, ourTotal, variance };
}

/** e.g. "Line 2 · 601234 — PO $18.50/MSF vs ours $19.63/MSF · PO $2,450.00 vs ours $2,600.00" */
export function describeMismatch(m: PriceMismatch): string {
  const head = ["Line " + (m.lineNo ?? "?"), m.partNo].filter(Boolean).join(" · ");
  const parts: string[] = [];
  if (
    m.poUnit != null &&
    m.ourUnit != null &&
    Math.abs(m.poUnit - m.ourUnit) > UNIT_TOLERANCE
  ) {
    parts.push(`PO ${fmtMoney(m.poUnit)}/MSF vs ours ${fmtMoney(m.ourUnit)}/MSF`);
  }
  if (
    m.poAmount != null &&
    m.ourAmount != null &&
    Math.abs(m.poAmount - m.ourAmount) > AMOUNT_TOLERANCE
  ) {
    parts.push(`PO ${fmtMoney(m.poAmount)} vs ours ${fmtMoney(m.ourAmount)}`);
  }
  return `${head} — ${parts.join(" · ")}`;
}
