export type PortalNavItem = {
  to: string;
  label: string;
  icon: "home" | "quotes" | "orders" | "proofs" | "invoices" | "documents";
  end?: boolean;
};

export const portalNavItems: PortalNavItem[] = [
  { to: "/portal", label: "Dashboard", icon: "home", end: true },
  { to: "/portal/quotes", label: "Quotes", icon: "quotes" },
  { to: "/portal/orders", label: "Orders", icon: "orders" },
  { to: "/portal/proofs", label: "Proofs", icon: "proofs" },
  { to: "/portal/invoices", label: "Invoices", icon: "invoices" },
  { to: "/portal/documents", label: "Documents", icon: "documents" },
];

export type PortalAuthSessionState = "unauthenticated" | "authenticated_active" | "logging_out" | "logged_out";
export type PortalLogoutEvent = "logout_requested" | "logout_completed" | "redirected_to_login";

export const portalLogoutRedirectPath = "/login";

export function getNextPortalAuthSessionState(
  state: PortalAuthSessionState,
  event: PortalLogoutEvent,
): PortalAuthSessionState {
  if (state === "authenticated_active" && event === "logout_requested") return "logging_out";
  if (state === "logging_out" && event === "logout_completed") return "logged_out";
  if (state === "logged_out" && event === "redirected_to_login") return "unauthenticated";
  return state;
}

export type PortalThemeId = "light" | "dark";

export const PORTAL_THEME_LOCAL_STORAGE_KEY = "portalThemeId";

export function isPortalThemeId(value: unknown): value is PortalThemeId {
  return value === "light" || value === "dark";
}

export function readPortalTheme(storage: Pick<Storage, "getItem"> | undefined | null): PortalThemeId | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(PORTAL_THEME_LOCAL_STORAGE_KEY);
    return isPortalThemeId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writePortalTheme(storage: Pick<Storage, "setItem"> | undefined | null, theme: PortalThemeId): void {
  if (!storage) return;
  try {
    storage.setItem(PORTAL_THEME_LOCAL_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is a convenience; the visible theme change should still work.
  }
}
