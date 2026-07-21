import type { PurchaseOrder } from "./types";

export type PaymentFlagKind = "under" | "over" | "ok";

export interface PaymentFlag {
  kind: PaymentFlagKind;
  label: string;
  expected: number;
  actual: number;
  variance: number;
}

const TOLERANCE_PCT = 0.01; // 1%
const TOLERANCE_ABS = 1; // $1

function nearlyEqual(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= Math.max(TOLERANCE_ABS, Math.abs(b) * TOLERANCE_PCT);
}

function flagPayment(actual: number, expected: number, underLabel: string, overLabel: string): PaymentFlag {
  const variance = Math.round((actual - expected) * 100) / 100;
  if (nearlyEqual(actual, expected)) {
    return { kind: "ok", label: "On target", expected, actual, variance };
  }
  if (actual < expected) {
    return { kind: "under", label: underLabel, expected, actual, variance };
  }
  return { kind: "over", label: overLabel, expected, actual, variance };
}

/** Expected DP = (PI value or PO value) × downpayment % */
export function expectedDownpayment(
  po: Pick<PurchaseOrder, "piValue" | "poValue" | "grossInvoiceValue">,
  downpaymentPct = 0.5,
): number | null {
  const base = po.piValue ?? po.grossInvoiceValue ?? po.poValue;
  if (base == null || Number.isNaN(Number(base))) return null;
  return Math.round(Number(base) * downpaymentPct * 100) / 100;
}

/** Flag DP once an amount is recorded */
export function downpaymentFlag(
  po: Pick<PurchaseOrder, "dpAmount" | "dpDate" | "piValue" | "poValue" | "grossInvoiceValue">,
  downpaymentPct = 0.5,
): PaymentFlag | null {
  if (po.dpAmount == null && !po.dpDate) return null;
  if (po.dpAmount == null) return null;
  const expected = expectedDownpayment(po, downpaymentPct);
  if (expected == null) return null;
  return flagPayment(Number(po.dpAmount), expected, "Underpayment", "Overpayment");
}

/** Flag balance payment once BP amount is recorded */
export function balancePaymentFlag(
  po: Pick<PurchaseOrder, "bpAmount" | "bpDate" | "balanceDue">,
): PaymentFlag | null {
  if (po.bpAmount == null && !po.bpDate) return null;
  if (po.bpAmount == null) return null;
  const expected = po.balanceDue;
  if (expected == null || Number.isNaN(Number(expected))) return null;
  return flagPayment(Number(po.bpAmount), Number(expected), "Underpayment", "Overpayment");
}

export function sumLineExtInv(lines: { extInv?: number | null; qtyM2?: number | null; unitM2?: number | null }[]): number {
  return Math.round(
    lines.reduce((s, l) => {
      if (l.extInv != null && !Number.isNaN(Number(l.extInv))) return s + Number(l.extInv);
      const qty = Number(l.qtyM2);
      const unit = Number(l.unitM2);
      if (!Number.isNaN(qty) && !Number.isNaN(unit) && qty && unit) return s + qty * unit;
      return s;
    }, 0) * 100,
  ) / 100;
}

export function sumLineExtPo(lines: { extPo?: number | null }[]): number {
  return Math.round(lines.reduce((s, l) => s + (Number(l.extPo) || 0), 0) * 100) / 100;
}

/** Header gross invoice, else sum Ext Inv / qtyM2×unitM2 fallback */
export function resolveGrossInvoiceValue(
  po: Pick<PurchaseOrder, "grossInvoiceValue" | "lines">,
): number | null {
  if (po.grossInvoiceValue != null && !Number.isNaN(Number(po.grossInvoiceValue))) {
    return Number(po.grossInvoiceValue);
  }
  if (!po.lines?.length) return null;
  const sum = sumLineExtInv(po.lines);
  return sum > 0 ? sum : null;
}

export const PO_PRIORITIES = ["Standard", "High"] as const;
export type PoPriority = (typeof PO_PRIORITIES)[number];
