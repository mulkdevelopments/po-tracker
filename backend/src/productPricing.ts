import type { Product, ProductPrice, Prisma } from "@prisma/client";
import { prisma } from "./middleware/auth.js";
import { isCatalogPartNo } from "./pricingExcel.js";
import type { Company } from "./companies.js";

type Tx = Prisma.TransactionClient;

export type PriceRates = {
  pricePerSqft: number | null;
  pricePerM2: number | null;
  pricePerMsq: number | null;
  pricePerSheet: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function dayBefore(iso: string): string {
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
  company: Company = "UFP",
): Promise<(PriceRates & { productId: number; partNo: string }) | null> {
  const product = await prisma.product.findUnique({
    where: { company_partNo: { company, partNo } },
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
  },
  effectiveFrom: string,
  opts?: { priceListVersionId?: number | null; tx?: Tx },
) {
  const run = async (tx: Tx) => {
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
        priceListVersionId: opts?.priceListVersionId ?? null,
        pricePerSqft: rates.pricePerSqft ?? null,
        pricePerM2: rates.pricePerM2 ?? null,
        pricePerMsq: rates.pricePerMsq ?? null,
        pricePerSheet: rates.pricePerSheet ?? null,
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
        effectiveFrom: created.effectiveFrom,
        effectiveTo: null,
      },
    });

    return created;
  };

  if (opts?.tx) return run(opts.tx);
  return prisma.$transaction((tx) => run(tx));
}

export type PriceListApplyRow = {
  partNo: string;
  custPartNo?: string | null;
  vendorPartNo?: string | null;
  itemType?: string | null;
  surface?: string | null;
  construction?: string | null;
  thickness?: string | null;
  widthIn?: number | null;
  widthMm?: number | null;
  lengthIn?: number | null;
  lengthMm?: number | null;
  description?: string | null;
  colorName?: string | null;
  vendorColorCode?: string | null;
  shortColorName?: string | null;
  pricePerSqft?: number | null;
  pricePerM2?: number | null;
  pricePerMsq?: number | null;
  pricePerSheet?: number | null;
};

/**
 * Apply a full pricing table for one company.
 * - mode "live": supersedes that company's current LIVE list; opens new ProductPrice for every row (even unchanged rates).
 * - mode "historical": imports a past table without touching current open/LIVE rates.
 * Existing PO/invoice line stamps are never modified.
 */
export async function applyPriceList(args: {
  company: Company;
  mode: "live" | "historical";
  label: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceSheet?: string | null;
  sourceFile?: string | null;
  note?: string | null;
  createdById?: string | null;
  rows: PriceListApplyRow[];
}) {
  const { company, mode, label, effectiveFrom, rows } = args;
  if (!rows.length) throw new Error("No pricing rows to apply");
  if (!effectiveFrom) throw new Error("effectiveFrom is required");

  if (mode === "historical" && !args.effectiveTo) {
    throw new Error("effectiveTo is required when importing a historical (past) price list");
  }
  if (mode === "historical" && args.effectiveTo && args.effectiveTo < effectiveFrom) {
    throw new Error("effectiveTo must be on or after effectiveFrom");
  }

  return prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    if (mode === "live") {
      const live = await tx.priceListVersion.findMany({ where: { company, status: "LIVE" } });
      for (const v of live) {
        await tx.priceListVersion.update({
          where: { id: v.id },
          data: {
            status: "PAST",
            effectiveTo: v.effectiveTo ?? dayBefore(effectiveFrom),
          },
        });
      }
    }

    const version = await tx.priceListVersion.create({
      data: {
        company,
        label,
        effectiveFrom,
        effectiveTo: mode === "live" ? null : args.effectiveTo ?? null,
        status: mode === "live" ? "LIVE" : "PAST",
        sourceSheet: args.sourceSheet ?? null,
        sourceFile: args.sourceFile ?? null,
        note: args.note ?? null,
        createdById: args.createdById ?? null,
      },
    });

    for (const row of rows) {
      const partNo = String(row.partNo ?? "").trim();
      if (!partNo || !isCatalogPartNo(partNo, company)) continue;

      const existing = await tx.product.findUnique({
        where: { company_partNo: { company, partNo } },
        include: { prices: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
      });

      const productData = {
        custPartNo: row.custPartNo ?? null,
        vendorPartNo: row.vendorPartNo ?? null,
        itemType: row.itemType ?? null,
        surface: row.surface ?? null,
        construction: row.construction ?? null,
        thickness: row.thickness ?? null,
        widthIn: row.widthIn ?? null,
        widthMm: row.widthMm ?? null,
        lengthIn: row.lengthIn ?? null,
        lengthMm: row.lengthMm ?? null,
        description: row.description ?? null,
        colorName: row.colorName ?? null,
        vendorColorCode: row.vendorColorCode ?? null,
        shortColorName: row.shortColorName ?? null,
      };

      const rates = {
        pricePerSqft: row.pricePerSqft ?? null,
        pricePerM2: row.pricePerM2 ?? null,
        pricePerMsq: row.pricePerMsq ?? null,
        pricePerSheet: row.pricePerSheet ?? null,
      };

      let productId: number;
      if (!existing) {
        const createdProduct = await tx.product.create({
          data: {
            company,
            partNo,
            ...productData,
            ...(mode === "live"
              ? {
                  pricePerSqft: rates.pricePerSqft,
                  pricePerM2: rates.pricePerM2,
                  pricePerMsq: rates.pricePerMsq,
                  pricePerSheet: rates.pricePerSheet,
                  effectiveFrom,
                  effectiveTo: null,
                }
              : {}),
          },
        });
        productId = createdProduct.id;
        created++;
      } else {
        productId = existing.id;
        await tx.product.update({ where: { id: productId }, data: productData });
        const open = existing.prices[0];
        const same =
          open &&
          open.pricePerSqft === rates.pricePerSqft &&
          open.pricePerM2 === rates.pricePerM2 &&
          open.pricePerMsq === rates.pricePerMsq &&
          open.pricePerSheet === rates.pricePerSheet;
        if (same) unchanged++;
        else updated++;
      }

      if (mode === "live") {
        await updateProductPrice(productId, rates, effectiveFrom, {
          priceListVersionId: version.id,
          tx,
        });
      } else {
        // Historical: write closed ProductPrice; do not touch open/current denormalized Product rates.
        await tx.productPrice.create({
          data: {
            productId,
            priceListVersionId: version.id,
            ...rates,
            effectiveFrom,
            effectiveTo: args.effectiveTo!,
          },
        });
      }

      if (row.vendorColorCode) {
        await tx.color.upsert({
          where: { company_code: { company, code: row.vendorColorCode } },
          update: {
            name: row.colorName ?? undefined,
            shortName: row.shortColorName ?? undefined,
            construction: row.construction ?? undefined,
          },
          create: {
            company,
            code: row.vendorColorCode,
            name: row.colorName,
            shortName: row.shortColorName,
            construction: row.construction,
            isStandard: false,
          },
        });
      }
    }

    return {
      version,
      stats: { created, updated, unchanged, total: rows.length },
    };
  }, { timeout: 120_000 });
}
