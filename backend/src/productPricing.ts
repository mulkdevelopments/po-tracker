import type { Product, ProductPrice } from "@prisma/client";
import { prisma } from "./middleware/auth.js";

export type PriceRates = {
  pricePerSqft: number | null;
  pricePerM2: number | null;
  pricePerMsq: number | null;
  pricePerSheet: number | null;
  leadTimeDays: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function isPriceEffectiveOn(
  from: string,
  to: string | null | undefined,
  onISO: string,
): boolean {
  if (from > onISO) return false;
  if (to && to < onISO) return false;
  return true;
}

export function pickPriceForDate(
  prices: Pick<
    ProductPrice,
    | "pricePerSqft"
    | "pricePerM2"
    | "pricePerMsq"
    | "pricePerSheet"
    | "leadTimeDays"
    | "effectiveFrom"
    | "effectiveTo"
  >[],
  onISO: string,
): PriceRates | null {
  const hit = [...prices]
    .filter((p) => isPriceEffectiveOn(p.effectiveFrom, p.effectiveTo, onISO))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!hit) return null;
  return {
    pricePerSqft: hit.pricePerSqft,
    pricePerM2: hit.pricePerM2,
    pricePerMsq: hit.pricePerMsq,
    pricePerSheet: hit.pricePerSheet,
    leadTimeDays: hit.leadTimeDays,
    effectiveFrom: hit.effectiveFrom,
    effectiveTo: hit.effectiveTo,
  };
}

/** Fallback to denormalized Product columns when no history row matches */
export function ratesFromProduct(p: Product, onISO: string): PriceRates | null {
  if (
    p.pricePerSqft == null &&
    p.pricePerM2 == null &&
    p.pricePerMsq == null &&
    p.pricePerSheet == null
  ) {
    return null;
  }
  const from = p.effectiveFrom || "2020-01-01";
  if (!isPriceEffectiveOn(from, p.effectiveTo, onISO)) return null;
  return {
    pricePerSqft: p.pricePerSqft,
    pricePerM2: p.pricePerM2,
    pricePerMsq: p.pricePerMsq,
    pricePerSheet: p.pricePerSheet,
    leadTimeDays: p.leadTimeDays,
    effectiveFrom: from,
    effectiveTo: p.effectiveTo,
  };
}

export async function resolveProductPrice(
  productId: number,
  onISO: string,
): Promise<PriceRates | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { prices: true },
  });
  if (!product) return null;
  return pickPriceForDate(product.prices, onISO) ?? ratesFromProduct(product, onISO);
}

export async function resolveProductPriceByPartNo(
  partNo: string,
  onISO: string,
): Promise<(PriceRates & { productId: number; partNo: string }) | null> {
  const product = await prisma.product.findUnique({
    where: { partNo },
    include: { prices: true },
  });
  if (!product) return null;
  const rates = pickPriceForDate(product.prices, onISO) ?? ratesFromProduct(product, onISO);
  if (!rates) return null;
  return { ...rates, productId: product.id, partNo: product.partNo };
}

/**
 * Close the open price version and open a new one from `effectiveFrom`.
 * Does not change existing PO lines (they already store unit/ext + priceAsOf).
 */
export async function updateProductPrice(
  productId: number,
  rates: {
    pricePerSqft?: number | null;
    pricePerM2?: number | null;
    pricePerMsq?: number | null;
    pricePerSheet?: number | null;
    leadTimeDays?: number | null;
  },
  effectiveFrom: string,
) {
  return prisma.$transaction(async (tx) => {
    const open = await tx.productPrice.findMany({
      where: { productId, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
    });
    for (const row of open) {
      if (row.effectiveFrom >= effectiveFrom) {
        // Replace same-day open version
        await tx.productPrice.delete({ where: { id: row.id } });
      } else {
        await tx.productPrice.update({
          where: { id: row.id },
          data: { effectiveTo: dayBefore(effectiveFrom) },
        });
      }
    }

    const created = await tx.productPrice.create({
      data: {
        productId,
        pricePerSqft: rates.pricePerSqft ?? null,
        pricePerM2: rates.pricePerM2 ?? null,
        pricePerMsq: rates.pricePerMsq ?? null,
        pricePerSheet: rates.pricePerSheet ?? null,
        leadTimeDays: rates.leadTimeDays ?? null,
        effectiveFrom,
        effectiveTo: null,
      },
    });

    // Keep Product denormalized to current open rates
    await tx.product.update({
      where: { id: productId },
      data: {
        pricePerSqft: created.pricePerSqft,
        pricePerM2: created.pricePerM2,
        pricePerMsq: created.pricePerMsq,
        pricePerSheet: created.pricePerSheet,
        leadTimeDays: created.leadTimeDays,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: null,
      },
    });

    return created;
  });
}
