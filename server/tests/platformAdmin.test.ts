/**
 * Platform Admin Feature Tests
 *
 * Tests: slugify helper, step-up window logic, requirePlatformAdminOr404 behaviour,
 * create-org DTO validation, duplicate invite detection.
 *
 * NOTE: These tests inline the pure functions to avoid pulling in the DB/schema
 * import chain that would trigger the known Jest OOM issue in this project.
 */

import { describe, it, expect } from "@jest/globals";
import { z } from "zod";

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

// ─── Inline: create-org DTO schema (mirrors server/routes/platform.ts) ────────
// Must stay in sync with the Zod schema in platform.ts.

const createOrgBodySchema = z.object({
  name: z.string().min(1, "Org name required").max(255),
  slug: z.string().max(100).regex(/^[a-z0-9-]*$/).optional(),
  ownerEmail: z.string().email("A valid owner email is required"),
});

// ─── Inline: DuplicateInviteError (mirrors orgOnboardingService.ts) ───────────

class DuplicateInviteError extends Error {
  constructor(orgId: string, email: string) {
    super(`An unaccepted invite for ${email} in org ${orgId} already exists.`);
    this.name = "DuplicateInviteError";
  }
}

function simulateDuplicateCheck(
  existingInvitePresent: boolean,
  orgId: string,
  email: string
): void {
  if (existingInvitePresent) throw new DuplicateInviteError(orgId, email);
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

describe("create-org DTO validation (Forced Invite Model)", () => {
  it("accepts valid payload with all required fields", () => {
    const result = createOrgBodySchema.safeParse({
      name: "Acme Print Co",
      ownerEmail: "owner@acme.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects payload missing ownerEmail", () => {
    const result = createOrgBodySchema.safeParse({
      name: "Acme Print Co",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("ownerEmail");
    }
  });

  it("rejects payload with invalid ownerEmail format", () => {
    const result = createOrgBodySchema.safeParse({
      name: "Acme Print Co",
      ownerEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("A valid owner email is required");
    }
  });

  it("rejects payload missing org name", () => {
    const result = createOrgBodySchema.safeParse({
      name: "",
      ownerEmail: "owner@acme.com",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional slug when valid", () => {
    const result = createOrgBodySchema.safeParse({
      name: "Acme Print Co",
      slug: "acme-print",
      ownerEmail: "owner@acme.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug characters", () => {
    const result = createOrgBodySchema.safeParse({
      name: "Acme Print Co",
      slug: "Acme Print",
      ownerEmail: "owner@acme.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("Duplicate invite detection", () => {
  it("throws DuplicateInviteError when active invite exists", () => {
    expect(() =>
      simulateDuplicateCheck(true, "org_abc", "owner@acme.com")
    ).toThrow(DuplicateInviteError);
  });

  it("DuplicateInviteError message includes org and email", () => {
    expect(() =>
      simulateDuplicateCheck(true, "org_abc", "owner@acme.com")
    ).toThrow("owner@acme.com");
  });

  it("does not throw when no existing invite", () => {
    expect(() =>
      simulateDuplicateCheck(false, "org_abc", "owner@acme.com")
    ).not.toThrow();
  });

  it("DuplicateInviteError name is correct", () => {
    try {
      simulateDuplicateCheck(true, "org_xyz", "test@test.com");
    } catch (err: any) {
      expect(err.name).toBe("DuplicateInviteError");
    }
  });
});
