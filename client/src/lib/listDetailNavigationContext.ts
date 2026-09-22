export type ListNavigationEntity = "invoice" | "order";

export type ListDetailContext = {
  source: string;
  index: number;
  returnTo?: string;
};

const allowedSourcePath: Record<ListNavigationEntity, string> = {
  invoice: "/invoices",
  order: "/orders",
};

const allowedDetailReturnPath = [
  /^\/invoices\/[^/?#]+$/,
  /^\/customers\/[^/?#]+$/,
];

function validCustomerReturnPath(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !/^\/customers\/[^/]+$/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Detail-to-detail navigation may return only to a known staff detail route.
 * This deliberately does not accept arbitrary internal paths as redirects.
 */
function validDetailReturnPath(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !allowedDetailReturnPath.some((pattern) => pattern.test(url.pathname))
    ) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function validIndex(value: string | null): number | null {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** The source is an internal list URL, never an arbitrary redirect destination. */
export function parseListDetailContext(
  entity: ListNavigationEntity,
  params: URLSearchParams,
): ListDetailContext | null {
  const source = params.get("listSource");
  const index = validIndex(params.get("listIndex"));
  if (!source || index == null) return null;
  try {
    const url = new URL(source, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== allowedSourcePath[entity]) return null;
    const returnTo = validCustomerReturnPath(params.get("listReturnTo"));
    return { source: `${url.pathname}${url.search}`, index, ...(returnTo ? { returnTo } : {}) };
  } catch {
    return null;
  }
}

export function buildListDetailPath(
  entity: ListNavigationEntity,
  recordId: string,
  source: string,
  index: number,
  returnTo?: string,
): string {
  const params = new URLSearchParams({ listSource: source, listIndex: String(Math.max(0, index)) });
  const validatedReturnTo = validCustomerReturnPath(returnTo ?? null);
  if (validatedReturnTo) params.set("listReturnTo", validatedReturnTo);
  return `${allowedSourcePath[entity]}/${recordId}?${params.toString()}`;
}

/** Adds a validated detail return path while preserving destination query parameters. */
export function buildDetailReturnPath(path: string, returnTo?: string): string {
  const destination = new URL(path, window.location.origin);
  const validatedReturnTo = validDetailReturnPath(returnTo ?? null);
  if (destination.origin !== window.location.origin || !validatedReturnTo) return path;
  destination.searchParams.set("detailReturnTo", validatedReturnTo);
  return `${destination.pathname}${destination.search}`;
}

export function parseDetailReturnPath(params: URLSearchParams): string | null {
  return validDetailReturnPath(params.get("detailReturnTo"));
}

function validOrderReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || /^\/orders\/[^/]+(?:\/edit)?$/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** For internal links that perform a full page navigation rather than router state. */
export function buildOrderDetailReturnPath(path: string, returnTo: string): string {
  const destination = new URL(path, window.location.origin);
  const validatedReturnTo = validOrderReturnPath(returnTo);
  if (destination.origin !== window.location.origin || !validatedReturnTo) return path;
  destination.searchParams.set("orderReturnTo", validatedReturnTo);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export function parseOrderDetailReturnPath(params: URLSearchParams): string | null {
  return validOrderReturnPath(params.get("orderReturnTo"));
}

export function resolveDetailBackPath(
  detailReturnTo: string | null,
  listBackPath: string | null,
  fallbackPath: string,
): string {
  return detailReturnTo ?? listBackPath ?? fallbackPath;
}

/** Order Detail accepts a referrer only when it resolves inside this app. */
export function resolveOrderDetailBackPath(
  detailReturnTo: string | null,
  referrer: unknown,
  listBackPath: string | null,
  currentPath: string,
): string {
  if (detailReturnTo) return detailReturnTo;
  if (referrer && typeof referrer === "object") {
    const route = referrer as { pathname?: unknown; search?: unknown; hash?: unknown };
    if (typeof route.pathname === "string" && route.pathname.startsWith("/") && !route.pathname.startsWith("//")) {
      const href = `${route.pathname}${typeof route.search === "string" ? route.search : ""}${typeof route.hash === "string" ? route.hash : ""}`;
      try {
        const parsed = new URL(href, window.location.origin);
        const current = new URL(currentPath, window.location.origin);
        if (parsed.origin === window.location.origin && parsed.pathname !== current.pathname) {
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      } catch { /* Treat malformed state as direct entry. */ }
    }
  }
  return listBackPath ?? "/orders";
}
