/**
 * Catalog-driven line filling, shared by PO upload and PO drawer edit.
 *
 * Rates always come from our price list as it stood on the order's PO date — never from
 * the figures printed on the customer PO (see priceCompare.ts). Editing an old order
 * therefore reprices against the list that was live when it was placed, not today's.
 */

import { recomputeLineForm, type LineForm } from "./lineMath";
import { pickProductPrice } from "./productPricing";
import type { ReferenceData } from "./types";
import { todayISO } from "./utils";

export type CatalogProduct = ReferenceData["products"][number];
type Rates = ReturnType<typeof pickProductPrice>;

const toStr = (v: unknown) => (v == null ? "" : String(v));

export function priceAsOfFor(poDate?: string | null): string {
  return (poDate?.trim() || todayISO()).slice(0, 10);
}

export function catalogMap(products: CatalogProduct[] | undefined): Map<string, CatalogProduct> {
  const m = new Map<string, CatalogProduct>();
  for (const p of products ?? []) m.set(p.partNo, p);
  return m;
}

/** UFP quotes per MSF, Cynergy per sheet — fill only the rate that applies. */
export function unitRateFields(company: string, product: CatalogProduct, rates: Rates) {
  return company === "SYNERGY"
    ? { unitMsf: "", unitSheet: toStr(rates?.pricePerSheet ?? product.pricePerSheet) }
    : { unitMsf: toStr(rates?.pricePerMsq ?? product.pricePerMsq), unitSheet: "" };
}

export function productSizeLabel(product: CatalogProduct): string {
  return [
    product.thickness,
    product.widthIn ? `${product.widthIn}"` : "",
    product.lengthIn ? `x ${product.lengthIn}"` : "",
    product.construction,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Overwrite a line's descriptive fields and rates from the catalog. */
export function fillLineFromProduct(
  row: LineForm,
  product: CatalogProduct,
  company: string,
  asOf: string,
): LineForm {
  const rates = pickProductPrice(product, asOf);
  return {
    ...row,
    custPartNo: toStr(product.custPartNo),
    size: productSizeLabel(product),
    widthMm: toStr(product.widthMm),
    lengthMm: toStr(product.lengthMm),
    color: `${product.vendorColorCode ?? ""} ${product.colorName ?? ""}`.trim(),
    ...unitRateFields(company, product, rates),
    unitM2: toStr(rates?.pricePerM2 ?? product.pricePerM2),
    priceAsOf: rates ? asOf : "",
    priceEffectiveFrom: rates ? rates.effectiveFrom : "",
  };
}

/** Reprice a line's rates from the catalog, keeping its quantities. */
export function repriceLineFromProduct(
  row: LineForm,
  product: CatalogProduct,
  company: string,
  asOf: string,
): LineForm {
  const rates = pickProductPrice(product, asOf);
  return {
    ...row,
    ...unitRateFields(company, product, rates),
    unitM2: toStr(rates?.pricePerM2 ?? product.pricePerM2),
  };
}

/**
 * Recompute a line, first filling any blank dimension or rate from the catalog.
 * Values the operator already typed are left alone.
 */
export function computeLineWithCatalog(
  row: LineForm,
  opts: {
    product?: CatalogProduct;
    company: string;
    asOf: string;
    sheetsPerSkid?: number;
    changedKey?: string;
  },
): LineForm {
  const { product, company, asOf, sheetsPerSkid = 200, changedKey = "sheets" } = opts;
  const rates = product ? pickProductPrice(product, asOf) : null;
  const withDims: LineForm = {
    ...row,
    widthMm: row.widthMm || toStr(product?.widthMm),
    lengthMm: row.lengthMm || toStr(product?.lengthMm),
    unitM2: row.unitM2 || toStr(rates?.pricePerM2 ?? product?.pricePerM2),
    ...(company === "SYNERGY"
      ? { unitSheet: row.unitSheet || toStr(rates?.pricePerSheet ?? product?.pricePerSheet) }
      : { unitMsf: row.unitMsf || toStr(rates?.pricePerMsq ?? product?.pricePerMsq) }),
  };
  const next = recomputeLineForm(withDims, changedKey, sheetsPerSkid);
  return {
    ...next,
    priceAsOf: rates ? asOf : (row.priceAsOf ?? ""),
    priceEffectiveFrom: rates ? rates.effectiveFrom : (row.priceEffectiveFrom ?? ""),
  };
}
