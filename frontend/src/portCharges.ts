import { expectedBalanceDue } from "./paymentFlags";

/** Inland is the same for every destination port. */
export const INLAND_CHARGE = 1000;

/**
 * Ocean freight by port. Each total is the port base plus the current 5,000 surcharge.
 * "Savanah" is accepted as Savannah.
 */
const PORT_RATES: { name: string; base: number; surcharge: number; freight: number }[] = [
  { name: "Houston", base: 3000, surcharge: 5000, freight: 8000 },
  { name: "Savannah", base: 2800, surcharge: 5000, freight: 7800 },
  { name: "Baltimore", base: 3700, surcharge: 5000, freight: 8700 },
  { name: "Oakland", base: 3200, surcharge: 5000, freight: 8200 },
];

const SCHEDULE_FREIGHT = new Set(PORT_RATES.flatMap((r) => [r.freight, r.base, 4500]));

function portKey(name: string | null | undefined): string {
  const key = (name ?? "").trim().toLowerCase();
  return key === "savanah" ? "savannah" : key;
}

export function rateForPort(port: string | null | undefined) {
  const key = portKey(port);
  return PORT_RATES.find((r) => r.name.toLowerCase() === key) ?? null;
}

/** Blank, the old flat 4,500, a pre-surcharge base, or a current schedule total. */
export function freightFollowsSchedule(freight: unknown): boolean {
  if (freight == null || freight === "") return true;
  const n = Number(freight);
  return Number.isFinite(n) && SCHEDULE_FREIGHT.has(n);
}

/** Fill freight and inland from the destination port and recompute balance due. */
export function applyPortCharges<T extends Record<string, unknown>>(
  form: T,
  force = false,
): T & { freight?: string; inland?: string; balanceDue?: string } {
  const rate = rateForPort(typeof form.portOfDest === "string" ? form.portOfDest : null);
  if (!rate) return form;
  const follow = force || freightFollowsSchedule(form.freight);
  const dueFor = (row: { ciValue?: unknown; freight?: unknown; inland?: unknown; dpAmount?: unknown }) =>
    expectedBalanceDue({
      ciValue: row.ciValue as number | string | null | undefined,
      freight: row.freight as number | string | null | undefined,
      inland: row.inland as number | string | null | undefined,
      dpAmount: row.dpAmount as number | string | null | undefined,
    });
  if (!follow) {
    if (form.inland != null && form.inland !== "") return form;
    const inland = String(INLAND_CHARGE);
    const due = dueFor({ ...form, inland });
    return { ...form, inland, balanceDue: due == null ? "" : String(due) };
  }
  const freight = String(rate.freight);
  const inland = String(INLAND_CHARGE);
  const due = dueFor({ ...form, freight, inland });
  return { ...form, freight, inland, balanceDue: due == null ? "" : String(due) };
}
