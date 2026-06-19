export interface ShippingLineRef {
  name: string;
  trackingUrl: string | null;
}

/** Build a carrier tracking URL from master tracking base + BOL number. */
export function buildShippingTrackingUrl(
  trackingUrl: string | null | undefined,
  bol: string,
): string {
  const base = (trackingUrl ?? "").trim();
  const num = bol.trim();
  if (!base) return "";
  if (!num) return base;
  if (base.includes("{bol}")) {
    return base.replace(/\{bol\}/g, encodeURIComponent(num));
  }
  const joiner =
    base.endsWith("/") || base.endsWith("=") || base.endsWith("?") || base.endsWith("&") ? "" : "/";
  return `${base}${joiner}${encodeURIComponent(num)}`;
}

export function trackingUrlForLine(
  shippingLines: ShippingLineRef[],
  lineName: string,
): string | null {
  const line = shippingLines.find((l) => l.name === lineName);
  return line?.trackingUrl ?? null;
}

export function autoShippingUrl(
  shippingLines: ShippingLineRef[],
  shippingLine: string,
  bol: string,
): string {
  const base = trackingUrlForLine(shippingLines, shippingLine);
  return buildShippingTrackingUrl(base, bol);
}
