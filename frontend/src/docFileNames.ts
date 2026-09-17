/**
 * Names for downloaded documents, mirroring what the API puts in
 * Content-Disposition (backend/src/routes/orders.ts). Used when the browser
 * will not hand that header over.
 */

function clean(name: string): string {
  return name.trim().replace(/[/\\?%*:|"<>]+/g, "-").replace(/^-+|-+$/g, "");
}

/** PI NX/PI/26/06/1087 on PO 52952099 is filed as PI-1087-52952099.pdf. */
export function piFileName(piNo?: string | null, poNo?: string | null): string | null {
  if (!piNo?.trim() || !poNo?.trim()) return null;
  const parts = piNo.split(/[^0-9A-Za-z]+/).filter(Boolean);
  const last = parts[parts.length - 1];
  const serial = last && /^\d+$/.test(last) ? last : parts.join("-");
  return `${clean(`PI-${serial}-${poNo}`)}.pdf`;
}

/** CI EBT/2026/08/254 is filed as CI-EBT-2026-08-254.xlsx. */
export function ciFileName(ciNo?: string | null): string | null {
  if (!ciNo?.trim()) return null;
  return `${clean(`CI-${ciNo}`)}.xlsx`;
}
