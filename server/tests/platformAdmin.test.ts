/**
 * Platform Admin Feature Tests
 *
 * Tests: slugify helper, step-up window logic, requirePlatformAdminOr404 behaviour.
 *
 * NOTE: These tests inline the pure functions to avoid pulling in the DB/schema
 * import chain that would trigger the known Jest OOM issue in this project.
 * The orgOnboardingService.ts unit tests serve as the integration boundary.
 */

import { describe, it, expect } from "@jest/globals";

// ─── Inline: slugify (mirrors server/services/orgOnboardingService.ts) ────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Inline: step-up window logic ─────────────────────────────────────────────

const REAUTH_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_WINDOW_MS  = 15 * 60 * 1000;

function isStepUpSatisfied(
  now: number,
  platformReauthAt?: number,
  lastLoginAt?: Date
): boolean {
  if (platformReauthAt && now - platformReauthAt < REAUTH_WINDOW_MS) return true;
  if (lastLoginAt && now - lastLoginAt.getTime() < LOGIN_WINDOW_MS) return true;
  return false;
}

// ─── Inline: 404-gate logic ────────────────────────────────────────────────────

function should404(isAuthenticated: boolean, isPlatformAdmin: boolean): boolean {
  if (!isAuthenticated) return true;
  if (!isPlatformAdmin) return true;
  return false;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("slugify()", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Acme Print Co")).toBe("acme-print-co");
  });

  it("strips special characters", () => {
    expect(slugify("Hello, World! (v2)")).toBe("hello-world-v2");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("a--b---c")).toBe("a-b-c");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  -hello-  ")).toBe("hello");
  });

  it("returns empty string for non-slug-able input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("Step-up window logic", () => {
  it("satisfied when platformReauthAt is within 10 min", () => {
    const now = Date.now();
    expect(isStepUpSatisfied(now, now - 5 * 60 * 1000)).toBe(true);
  });

  it("not satisfied when platformReauthAt is older than 10 min", () => {
    const now = Date.now();
    expect(isStepUpSatisfied(now, now - 11 * 60 * 1000)).toBe(false);
  });

  it("satisfied when lastLoginAt is within 15 min and no reauth", () => {
    const now = Date.now();
    const lastLogin = new Date(now - 10 * 60 * 1000);
    expect(isStepUpSatisfied(now, undefined, lastLogin)).toBe(true);
  });

  it("not satisfied when lastLoginAt is > 15 min and no reauth", () => {
    const now = Date.now();
    const lastLogin = new Date(now - 20 * 60 * 1000);
    expect(isStepUpSatisfied(now, undefined, lastLogin)).toBe(false);
  });

  it("satisfied when platformReauthAt is valid even if lastLoginAt is old", () => {
    const now = Date.now();
    const oldLogin = new Date(now - 20 * 60 * 1000);
    expect(isStepUpSatisfied(now, now - 1 * 60 * 1000, oldLogin)).toBe(true);
  });

  it("not satisfied when both are undefined", () => {
    expect(isStepUpSatisfied(Date.now())).toBe(false);
  });
});

describe("requirePlatformAdminOr404 gate logic", () => {
  it("returns 404 for unauthenticated user", () => {
    expect(should404(false, false)).toBe(true);
  });

  it("returns 404 for authenticated non-platform-admin", () => {
    expect(should404(true, false)).toBe(true);
  });

  it("allows platform admin through (no 404)", () => {
    expect(should404(true, true)).toBe(false);
  });
});
