/** Shared helpers for dated product prices (frontend). */

export type PriceVersion = {
  id?: number;
  pricePerSqft?: number | null;
  pricePerM2?: number | null;
  pricePerMsq?: number | null;
  pricePerSheet?: number | null;
  leadTimeDays?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type ProductWithPrices = {
  id: number;
  partNo: string;
  pricePerSqft?: number | null;
  pricePerM2?: number | null;
  pricePerMsq?: number | null;
  pricePerSheet?: number | null;
  leadTimeDays?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  prices?: PriceVersion[];
};

export function isPriceEffectiveOn(
  from: string | null | undefined,
  to: string | null | undefined,
  onISO: string,
): boolean {
  if (from && from > onISO) return false;
  if (to && to < onISO) return false;
  return true;
}

/** Pick the price version effective on a date (usually PO date). */
export function pickProductPrice(
  product: ProductWithPrices,
  onISO: string,
): PriceVersion | null {
  const versions = product.prices?.length
    ? product.prices
    : product.pricePerSqft != null || product.pricePerM2 != null || product.pricePerSheet != null
      ? [
          {
            pricePerSqft: product.pricePerSqft,
            pricePerM2: product.pricePerM2,
            pricePerMsq: product.pricePerMsq,
            pricePerSheet: product.pricePerSheet,
            leadTimeDays: product.leadTimeDays,
            effectiveFrom: product.effectiveFrom || "2020-01-01",
            effectiveTo: product.effectiveTo,
          },
        ]
      : [];

  const hit = [...versions]
    .filter((p) => isPriceEffectiveOn(p.effectiveFrom, p.effectiveTo, onISO))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return hit ?? null;
}

export function currentProductPrice(product: ProductWithPrices, asOf = new Date().toISOString().slice(0, 10)) {
  return pickProductPrice(product, asOf);
}
