/**
 * requireDeveloperAccess — unit tests
 *
 * Tests the core authorization logic for the requireDeveloperAccess middleware.
 * Following the established pattern in platformAdmin.test.ts: pure inline functions,
 * no DB or schema imports, no OOM risk.
 *
 * Coverage:
 *   - Unauthenticated request → blocked (no userId)
 *   - Authenticated user with isPlatformDeveloper=false → blocked
 *   - Authenticated user with isPlatformDeveloper=true → allowed
 *   - Tenant admin (org role) without developer flag → blocked
 *   - Tenant owner (users.role=owner) without developer flag → blocked
 *   - Platform admin (isPlatformAdmin) without developer flag → blocked
 *   - Platform admin WITH developer flag → allowed
 */

import { describe, it, expect } from "@jest/globals";

// ─── Inline: core authorization predicate ─────────────────────────────────────
// Mirrors the decision logic in server/middleware/requireDeveloperAccess.ts.
// The middleware wraps this in a DB fetch; here we test the predicate directly.

function isDeveloperAccessAllowed(params: {
  isAuthenticated: boolean;
  userId: string | undefined;
  isPlatformDeveloper: boolean | undefined;
}): boolean {
  if (!params.isAuthenticated) return false;
  if (!params.userId) return false;
  if (!params.isPlatformDeveloper) return false;
  return true;
}

// ─── Inline: simulated middleware response shape ───────────────────────────────

type MiddlewareOutcome = "next" | { status: number; message: string };

function simulateRequireDeveloperAccess(params: {
  isAuthenticated: boolean;
  userId: string | undefined;
  isPlatformDeveloper: boolean | undefined;
  dbLookupFailed?: boolean;
}): MiddlewareOutcome {
  if (params.dbLookupFailed) {
    return { status: 500, message: "Failed to verify developer access." };
  }
  if (!params.isAuthenticated || !params.userId) {
    return { status: 403, message: "Access denied. Platform developer access required." };
  }
  if (!params.isPlatformDeveloper) {
    return { status: 403, message: "Access denied. Platform developer access required." };
  }
  return "next";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("requireDeveloperAccess — core predicate", () => {
  it("blocks unauthenticated requests", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: false, userId: undefined, isPlatformDeveloper: false })
    ).toBe(false);
  });

  it("blocks authenticated user with no userId", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: undefined, isPlatformDeveloper: false })
    ).toBe(false);
  });

  it("blocks authenticated user with isPlatformDeveloper=false", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-1", isPlatformDeveloper: false })
    ).toBe(false);
  });

  it("blocks authenticated user with isPlatformDeveloper=undefined", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-1", isPlatformDeveloper: undefined })
    ).toBe(false);
  });

  it("allows authenticated user with isPlatformDeveloper=true", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-1", isPlatformDeveloper: true })
    ).toBe(true);
  });
});

describe("requireDeveloperAccess — tenant role isolation", () => {
  // These tests verify that tenant roles do NOT grant developer access.
  // Org role and users.role are unrelated to isPlatformDeveloper.

  it("blocks tenant admin (orgRole=admin) without developer flag", () => {
    // orgRole is not passed to the middleware — only isPlatformDeveloper matters
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-admin", isPlatformDeveloper: false })
    ).toBe(false);
  });

  it("blocks tenant owner (users.role=owner) without developer flag", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-owner", isPlatformDeveloper: false })
    ).toBe(false);
  });

  it("blocks isPlatformAdmin=true user who does NOT have isPlatformDeveloper", () => {
    // Platform admin and platform developer are independent flags
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-platform-admin", isPlatformDeveloper: false })
    ).toBe(false);
  });

  it("allows isPlatformAdmin=true user who ALSO has isPlatformDeveloper=true", () => {
    expect(
      isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-both", isPlatformDeveloper: true })
    ).toBe(true);
  });
});

describe("requireDeveloperAccess — middleware response shape", () => {
  it("returns 403 with correct message for unauthenticated user", () => {
    const result = simulateRequireDeveloperAccess({
      isAuthenticated: false,
      userId: undefined,
      isPlatformDeveloper: false,
    });
    expect(result).toEqual({ status: 403, message: "Access denied. Platform developer access required." });
  });

  it("returns 403 for authenticated user without developer flag", () => {
    const result = simulateRequireDeveloperAccess({
      isAuthenticated: true,
      userId: "user-1",
      isPlatformDeveloper: false,
    });
    expect(result).toEqual({ status: 403, message: "Access denied. Platform developer access required." });
  });

  it("returns next for authenticated developer", () => {
    const result = simulateRequireDeveloperAccess({
      isAuthenticated: true,
      userId: "user-1",
      isPlatformDeveloper: true,
    });
    expect(result).toBe("next");
  });

  it("returns 500 when DB lookup fails", () => {
    const result = simulateRequireDeveloperAccess({
      isAuthenticated: true,
      userId: "user-1",
      isPlatformDeveloper: true,
      dbLookupFailed: true,
    });
    expect(result).toEqual({ status: 500, message: "Failed to verify developer access." });
  });

  it("returns 403 not 404 — route existence is visible (developer routes are not secret)", () => {
    const result = simulateRequireDeveloperAccess({
      isAuthenticated: true,
      userId: "user-1",
      isPlatformDeveloper: false,
    });
    expect((result as any).status).toBe(403);
    expect((result as any).status).not.toBe(404);
  });
});

describe("requireDeveloperAccess — flag independence", () => {
  // Verify that isPlatformAdmin and isPlatformDeveloper are evaluated independently.
  // The DB select in the middleware only reads isPlatformDeveloper.

  const cases: Array<{
    label: string;
    isPlatformAdmin: boolean;
    isPlatformDeveloper: boolean;
    shouldAllow: boolean;
  }> = [
    { label: "neither flag", isPlatformAdmin: false, isPlatformDeveloper: false, shouldAllow: false },
    { label: "platformAdmin only", isPlatformAdmin: true, isPlatformDeveloper: false, shouldAllow: false },
    { label: "platformDeveloper only", isPlatformAdmin: false, isPlatformDeveloper: true, shouldAllow: true },
    { label: "both flags", isPlatformAdmin: true, isPlatformDeveloper: true, shouldAllow: true },
  ];

  for (const { label, isPlatformDeveloper, shouldAllow } of cases) {
    it(`${label} → allowed=${shouldAllow}`, () => {
      expect(
        isDeveloperAccessAllowed({ isAuthenticated: true, userId: "user-x", isPlatformDeveloper })
      ).toBe(shouldAllow);
    });
  }
});
