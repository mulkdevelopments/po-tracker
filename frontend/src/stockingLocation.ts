export type StockingLoc = { name: string; arrivalPort: string | null };

/** Match a typed location to Master Data. "Minneota" matches "Minneota, MN". */
export function matchStockingLocation<T extends StockingLoc>(
  locations: T[],
  value: string,
): T | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  const exact = locations.find((l) => l.name.trim().toLowerCase() === v);
  if (exact) return exact;
  const byCity = locations.filter((l) => l.name.split(",")[0].trim().toLowerCase() === v);
  return byCity.length === 1 ? byCity[0] : undefined;
}
