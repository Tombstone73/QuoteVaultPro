export type ReferrerRoute = {
  pathname: string;
  search?: string;
  hash?: string;
};

export function getDefaultSectionRoute(pathname: string): string {
  if (pathname.startsWith("/system/admin")) return "/system/admin";
  if (pathname.startsWith("/orders")) return "/orders";
  if (pathname.startsWith("/customers")) return "/customers";
  if (pathname.startsWith("/quotes")) return "/quotes";
  if (pathname.startsWith("/invoices")) return "/invoices";
  if (pathname.startsWith("/contacts")) return "/contacts";
  if (pathname.startsWith("/production")) return "/production";
  if (pathname.startsWith("/materials")) return "/materials";
  if (pathname.startsWith("/vendors")) return "/vendors";
  if (pathname.startsWith("/purchase-orders")) return "/purchase-orders";
  return "/";
}

export function isSafeInternalRoute(locationLike: unknown): locationLike is ReferrerRoute {
  if (!locationLike || typeof locationLike !== "object") return false;
  const value = locationLike as Partial<ReferrerRoute>;
  if (typeof value.pathname !== "string") return false;
  if (!value.pathname.startsWith("/")) return false;
  if (value.pathname.startsWith("//")) return false;
  return true;
}

export function buildReferrer(location: { pathname: string; search?: string; hash?: string }): ReferrerRoute {
  return {
    pathname: location.pathname,
    search: location.search || "",
    hash: location.hash || "",
  };
}

export function toHref(route: ReferrerRoute): string {
  return `${route.pathname}${route.search || ""}${route.hash || ""}`;
}
