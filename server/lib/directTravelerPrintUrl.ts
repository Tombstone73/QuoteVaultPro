const canonicalTravelerHosts = new Set([
  "www.printershero.com",
  "dev.printershero.com",
]);

export function getCanonicalTravelerWebOrigin(publicWebOrigin: string | null): string {
  if (!publicWebOrigin) {
    throw new Error("APP_PUBLIC_WEB_ORIGIN must be configured before a Traveler print job can be claimed.");
  }

  let parsed: URL;
  try {
    parsed = new URL(publicWebOrigin);
  } catch {
    throw new Error("APP_PUBLIC_WEB_ORIGIN is not a valid Traveler web origin.");
  }

  if (parsed.protocol !== "https:" || !canonicalTravelerHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("APP_PUBLIC_WEB_ORIGIN must be the canonical HTTPS PrintersHero web application origin.");
  }

  return parsed.origin;
}

export function buildClaimedTravelerWebUrl(
  publicWebOrigin: string | null,
  orderId: string,
  directPrintJobId: string,
): string {
  const origin = getCanonicalTravelerWebOrigin(publicWebOrigin);
  const route = `/orders/${encodeURIComponent(orderId)}/traveler`;
  return `${origin}${route}?directPrintJobId=${encodeURIComponent(directPrintJobId)}`;
}
