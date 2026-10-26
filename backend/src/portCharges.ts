/** Inland is the same for every destination port. Keep in step with frontend/src/portCharges.ts. */
export const INLAND_CHARGE = 1000;

const PORT_FREIGHT: Record<string, number> = {
  houston: 8000,
  savannah: 7800,
  baltimore: 8700,
  oakland: 8200,
};

function portKey(name: string | null | undefined): string {
  const key = (name ?? "").trim().toLowerCase();
  return key === "savanah" ? "savannah" : key;
}

export function freightForPort(port: string | null | undefined): number | null {
  return PORT_FREIGHT[portKey(port)] ?? null;
}

/** When a write leaves freight or inland empty, fill them from the destination port. */
export function fillMissingPortCharges(
  poData: Record<string, unknown>,
  existing?: Record<string, unknown> | null,
): Record<string, unknown> {
  const portRaw = poData.portOfDest !== undefined ? poData.portOfDest : existing?.portOfDest;
  const freight = freightForPort(typeof portRaw === "string" ? portRaw : null);
  if (freight == null) return poData;
  const currentFreight = poData.freight !== undefined ? poData.freight : existing?.freight;
  const currentInland = poData.inland !== undefined ? poData.inland : existing?.inland;
  const next = { ...poData };
  if (currentFreight == null || currentFreight === "") next.freight = freight;
  if (currentInland == null || currentInland === "") next.inland = INLAND_CHARGE;
  return next;
}
