/**
 * A portal return target is navigation state only; it must never become a
 * redirect capability.  Keep this deliberately narrow so login/invite links
 * can return a recipient to the intended invoice without accepting external
 * URLs or arbitrary in-app routes.
 */
export function sanitizePortalReturnTarget(value: unknown): string {
  if (typeof value !== "string") return "/portal";
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/portal";

  try {
    const parsed = new URL(candidate, "https://portal.invalid");
    if (parsed.origin !== "https://portal.invalid" || parsed.search || parsed.hash) return "/portal";
    if (parsed.pathname === "/portal") return "/portal";
    return /^\/portal\/invoices\/[^/?#]+$/.test(parsed.pathname)
      ? parsed.pathname
      : "/portal";
  } catch {
    return "/portal";
  }
}

export function getPortalReturnTarget(value: unknown): string | null {
  const target = sanitizePortalReturnTarget(value);
  return target === "/portal" && value !== "/portal" ? null : target;
}
