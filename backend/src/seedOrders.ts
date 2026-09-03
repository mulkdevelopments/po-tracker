import type { PrismaClient } from "@prisma/client";
import { missingHeaderTotals } from "./lineMath.js";

export type Company = "UFP" | "SYNERGY";
export type OrderRecord = Record<string, unknown> & { lines?: Record<string, unknown>[] };

// The seed JSON keeps blank spreadsheet cells as "" and absent columns as null.
export const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
export const s = (v: unknown): string | null => (v == null ? null : String(v));
export const i = (v: unknown): number | null => (v == null || v === "" ? null : Math.round(Number(v)));

/**
 * Header fields the tracker spreadsheet owns, mapped from one of its rows.
 *
 * Shared by the initial import and the sync that re-applies a newer copy of the sheet,
 * so the two can never disagree about what the tracker is allowed to set.
 */
export function orderHeaderFromTracker(o: OrderRecord): Record<string, unknown> {
  const lines = o.lines ?? [];
  // The tracker sheet has no gross invoice column of its own: for UFP the PI value is
  // that same m²-based figure, and Cynergy's sheet leaves it to the lines (request #1).
  const totals = missingHeaderTotals(
    {
      poValue: n(o.poValue),
      totalM2: n(o.totalM2),
      skids: n(o.skids),
      grossInvoiceValue: n(o.piValue),
    },
    lines.map((l) => ({ extPo: n(l.extPo), extInv: n(l.extInv), qtyM2: n(l.qtyM2), skids: n(l.skids) })),
  );
  return {
    siNo: i(o.siNo),
    concat: s(o.concat),
    status: String(o.status ?? "PO Received"),
    poDate: s(o.poDate),
    active: o.active !== false,
    skids: n(o.skids) ?? totals.skids ?? null,
    stockingLocation: s(o.stockingLocation),
    portOfDest: s(o.portOfDest),
    poValue: n(o.poValue) ?? totals.poValue ?? null,
    grossInvoiceValue: n(o.piValue) ?? totals.grossInvoiceValue ?? null,
    totalM2: n(o.totalM2) ?? totals.totalM2 ?? null,
    piNo: s(o.piNo),
    piDate: s(o.piDate),
    poToPi: i(o.poToPi),
    piValue: n(o.piValue),
    dpDate: s(o.dpDate),
    piToDp: i(o.piToDp),
    dpAmount: n(o.dpAmount),
    productionEtc: s(o.productionEtc),
    shippingEta: s(o.shippingEta),
    bol: s(o.bol),
    isf: s(o.isf),
    containerNo: s(o.containerNo),
    shippingLine: s(o.shippingLine),
    shippingUrl: s(o.shippingUrl),
    actualDeparture: s(o.actualDeparture),
    dpToShip: i(o.dpToShip),
    ciNo: s(o.ciNo),
    ciDate: s(o.ciDate),
    revisionSent: s(o.revisionSent),
    freight: n(o.freight),
    inland: n(o.inland),
    ciValue: n(o.ciValue),
    balanceDue: n(o.balanceDue),
    bpDate: s(o.bpDate),
    ciToBp: i(o.ciToBp),
    bpAmount: n(o.bpAmount),
    telexDate: s(o.telexDate),
    bpToTelex: i(o.bpToTelex),
    arrivalDate: s(o.arrivalDate),
  };
}

/** Line fields the tracker owns, mapped from one of its line rows. */
export function orderLineFromTracker(
  l: Record<string, unknown>,
  idx: number,
): Record<string, unknown> {
  return {
    lineNo: i(l.lineNo) ?? idx + 1,
    partNo: s(l.partNo),
    custPartNo: s(l.custPartNo),
    size: s(l.size),
    widthMm: n(l.widthMm),
    lengthMm: n(l.lengthMm),
    color: s(l.color),
    qtyMsf: n(l.qtyMsf),
    qtyM2: n(l.qtyM2),
    sheets: n(l.sheets),
    skids: n(l.skids),
    unitMsf: n(l.unitMsf),
    unitSheet: n(l.unitSheet),
    unitM2: n(l.unitM2),
    extPo: n(l.extPo),
    extInv: n(l.extInv),
    notes: s(l.notes),
  };
}

/** Create one order (with its lines) exactly as the full seed would. */
export async function importOrder(prisma: PrismaClient, company: Company, o: OrderRecord) {
  const lines = o.lines ?? [];
  await prisma.purchaseOrder.create({
    data: {
      ...(orderHeaderFromTracker(o) as object),
      company,
      poNo: String(o.poNo ?? ""),
      rev: i(o.rev) ?? 0,
      lines: { create: lines.map(orderLineFromTracker) },
      history: {
        create: {
          stage: String(o.status ?? "PO Received"),
          note: "Imported from Order Tracker spreadsheet",
          byRole: "seed",
          at: s(o.poDate) || new Date().toISOString().slice(0, 10),
        },
      },
    } as Parameters<PrismaClient["purchaseOrder"]["create"]>[0]["data"],
  });
}

/** Destructive: replaces every order for the company. */
export async function seedOrders(prisma: PrismaClient, company: Company, orders: OrderRecord[]) {
  await prisma.purchaseOrder.deleteMany({ where: { company } });

  let count = 0;
  for (const o of orders) {
    await importOrder(prisma, company, o);
    count++;
  }
  console.log(`Seeded ${count} purchase orders (${company})`);
}
