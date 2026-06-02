import { describe, expect, test } from "@jest/globals";

import {
  PORTAL_THEME_LOCAL_STORAGE_KEY,
  getNextPortalAuthSessionState,
  portalLogoutRedirectPath,
  portalNavItems,
  readPortalTheme,
  writePortalTheme,
  type PortalAuthSessionState,
} from "./portalShell";

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("portal shell", () => {
  test("orders customer portal navigation for customer workflows", () => {
    expect(portalNavItems.map((item) => item.label)).toEqual([
      "Dashboard",
      "Quotes",
      "Orders",
      "Proofs",
      "Invoices",
      "Documents",
    ]);
  });

  test("models logout transition through logged out before login redirect", () => {
    let state: PortalAuthSessionState = "authenticated_active";

    state = getNextPortalAuthSessionState(state, "logout_requested");
    expect(state).toBe("logging_out");

    state = getNextPortalAuthSessionState(state, "logout_completed");
    expect(state).toBe("logged_out");
    expect(portalLogoutRedirectPath).toBe("/login");

    state = getNextPortalAuthSessionState(state, "redirected_to_login");
    expect(state).toBe("unauthenticated");
  });

  test("persists portal theme without touching the staff theme key", () => {
    const storage = makeStorage({ themeId: "command" });

    writePortalTheme(storage, "dark");

    expect(readPortalTheme(storage)).toBe("dark");
    expect(storage.getItem(PORTAL_THEME_LOCAL_STORAGE_KEY)).toBe("dark");
    expect(storage.getItem("themeId")).toBe("command");
  });
});
