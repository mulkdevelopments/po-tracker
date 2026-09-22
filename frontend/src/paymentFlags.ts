import type { PurchaseOrder } from "./types";

export type PaymentFlagKind = "under" | "over" | "ok";

export interface PaymentFlag {
  kind: PaymentFlagKind;
  label: string;
  expected: number;
  actual: number;
  variance: number;
}

/** Default variance ($) allowed before a payment is flagged; overridable in Master Data (#3). */
export const DEFAULT_PAYMENT_TOLERANCE_ABS = 1;

export type PaymentTolerance = { abs: number };

function resolveTolerance(t?: Partial<PaymentTolerance> | number | null): PaymentTolerance {
  if (typeof t === "number") {
    return { abs: Number.isFinite(t) ? t : DEFAULT_PAYMENT_TOLERANCE_ABS };
  }
  return {
    abs: Number.isFinite(Number(t?.abs)) ? Number(t?.abs) : DEFAULT_PAYMENT_TOLERANCE_ABS,
  };
}

function nearlyEqual(a: number, b: number, tol: PaymentTolerance): boolean {
  return Math.abs(a - b) <= tol.abs;
}

function flagPayment(
  actual: number,
  expected: number,
  underLabel: string,
  overLabel: string,
  tol: PaymentTolerance,
): PaymentFlag {
  const variance = Math.round((actual - expected) * 100) / 100;
  if (nearlyEqual(actual, expected, tol)) {
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
  tolerance?: Partial<PaymentTolerance> | null,
): PaymentFlag | null {
  if (po.dpAmount == null && !po.dpDate) return null;
  if (po.dpAmount == null) return null;
  const expected = expectedDownpayment(po, downpaymentPct);
  if (expected == null) return null;
  return flagPayment(
    Number(po.dpAmount),
    expected,
    "Underpayment",
    "Overpayment",
    resolveTolerance(tolerance),
  );
}

type MoneyInput = number | string | null | undefined;

function money(v: MoneyInput): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CI net + freight + inland, before any down payment is taken off. */
function grossCommercial(charges: {
  ciValue?: MoneyInput;
  freight?: MoneyInput;
  inland?: MoneyInput;
}): number | null {
  const ciValue = money(charges.ciValue);
  if (ciValue == null || ciValue === 0) return ciValue;
  return Math.round((ciValue + (money(charges.freight) ?? 0) + (money(charges.inland) ?? 0)) * 100) / 100;
}

/**
 * Balance due = commercial invoice (net) + freight + inland − down payment
 * already received. Accepts form strings so the edit screens can show the
 * figure while it is being typed.
 */
export function expectedBalanceDue(charges: {
  ciValue?: MoneyInput;
  freight?: MoneyInput;
  inland?: MoneyInput;
  dpAmount?: MoneyInput;
}): number | null {
  const ciValue = money(charges.ciValue);
  if (ciValue == null) return null;
  // A zeroed invoice marks a superseded revision — nothing is due on it.
  if (ciValue === 0) return 0;
  const commercial = ciValue + (money(charges.freight) ?? 0) + (money(charges.inland) ?? 0);
  return Math.round((commercial - (money(charges.dpAmount) ?? 0)) * 100) / 100;
}

/**
 * Balance due to show and to check a balance payment against.
 * When the stored figure is still the full commercial invoice, a down payment
 * already received comes off it. A figure that was billed as something else
 * (the older sheet amount) is left as recorded.
 */
export function shownBalanceDue(
  po: Pick<PurchaseOrder, "balanceDue" | "ciValue" | "freight" | "inland" | "dpAmount">,
): number | null {
  const stored = po.balanceDue == null ? null : Number(po.balanceDue);
  const derived = expectedBalanceDue(po);
  const gross = grossCommercial(po);
  const dp = money(po.dpAmount) ?? 0;
  if (
    derived != null &&
    dp > 0 &&
    gross != null &&
    (stored == null || Math.abs(stored - gross) < 0.05)
  ) {
    return derived;
  }
  return stored;
}

/** Flag balance payment once BP amount is recorded */
export function balancePaymentFlag(
  po: Pick<PurchaseOrder, "bpAmount" | "bpDate" | "balanceDue" | "ciValue" | "freight" | "inland" | "dpAmount">,
  tolerance?: Partial<PaymentTolerance> | null,
): PaymentFlag | null {
  if (po.bpAmount == null && !po.bpDate) return null;
  if (po.bpAmount == null) return null;
  const expected = shownBalanceDue(po);
  if (expected == null || Number.isNaN(expected)) return null;
  return flagPayment(
    Number(po.bpAmount),
    Number(expected),
    "Underpayment",
    "Overpayment",
    resolveTolerance(tolerance),
  );
}

/** Read the configured dollar tolerance off master data / the reference config payload. */
export function paymentTolerance(
  source?: { paymentToleranceAbs?: number | null } | null,
): PaymentTolerance {
  return resolveTolerance({ abs: source?.paymentToleranceAbs ?? undefined });
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
