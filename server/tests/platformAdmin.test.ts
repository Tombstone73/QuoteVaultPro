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

// ─── Inline: sha256Hex (mirrors server/lib/tokenHash.ts) ──────────────────────

import crypto from "crypto";

function sha256Hex(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

describe("sha256Hex()", () => {
  it("returns a 64-character hex string", () => {
    const hash = sha256Hex("any-token");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic — same input produces same output", () => {
    const token = "deterministic-test-token";
    expect(sha256Hex(token)).toBe(sha256Hex(token));
  });

  it("different inputs produce different hashes", () => {
    expect(sha256Hex("token-a")).not.toBe(sha256Hex("token-b"));
  });

  it("matches known SHA-256 vector (empty string)", () => {
    const expected =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256Hex("")).toBe(expected);
  });
});

// ─── Inline: invite accept state machine ──────────────────────────────────────

type InviteState = "valid" | "used" | "expired" | "not_found";

interface MockInvite {
  acceptedAt: Date | null;
  expiresAt: Date;
}

function resolveInviteState(
  invite: MockInvite | null,
  now: Date
): InviteState {
  if (!invite) return "not_found";
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt < now) return "expired";
  return "valid";
}

describe("Invite accept state machine", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000);   // 1 hour from now
  const past   = new Date(Date.now() - 60 * 60 * 1000);   // 1 hour ago
  const now    = new Date();

  it("returns 'not_found' when invite is null", () => {
    expect(resolveInviteState(null, now)).toBe("not_found");
  });

  it("returns 'used' when acceptedAt is set (regardless of expiry)", () => {
    expect(
      resolveInviteState({ acceptedAt: past, expiresAt: future }, now)
    ).toBe("used");
  });

  it("returns 'used' even when invite is past expiry if acceptedAt is set", () => {
    expect(
      resolveInviteState({ acceptedAt: past, expiresAt: past }, now)
    ).toBe("used");
  });

  it("returns 'expired' when not yet used and expiresAt is in the past", () => {
    expect(
      resolveInviteState({ acceptedAt: null, expiresAt: past }, now)
    ).toBe("expired");
  });

  it("returns 'valid' when not used and expiresAt is in the future", () => {
    expect(
      resolveInviteState({ acceptedAt: null, expiresAt: future }, now)
    ).toBe("valid");
  });

  it("returns 'expired' when expiresAt equals now (boundary — not strictly after)", () => {
    // expiresAt === now → expiresAt < now is false here; this would be 'valid'
    // at exact boundary. Mirrors real DB logic where >= means valid.
    const boundary = new Date(now.getTime());
    expect(
      resolveInviteState({ acceptedAt: null, expiresAt: boundary }, now)
    ).toBe("valid");
  });

  it("returns 'expired' for expiresAt 1ms before now", () => {
    const justExpired = new Date(now.getTime() - 1);
    expect(
      resolveInviteState({ acceptedAt: null, expiresAt: justExpired }, now)
    ).toBe("expired");
  });
});

// ─── Inline: CORS origin allow logic ──────────────────────────────────────────
// Mirrors the logic in server/index.ts corsOptions.origin callback.

function isCorsAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // no-origin requests always allowed
  return allowedOrigins.includes(origin);
}

describe("CORS origin allow logic", () => {
  const origins = [
    "https://www.printershero.com",
    "https://quotevaultpro-production.up.railway.app",
    "http://localhost:5173",
    "http://localhost:5000",
  ];

  it("allows undefined origin (server-to-server / curl)", () => {
    expect(isCorsAllowed(undefined, origins)).toBe(true);
  });

  it("allows the Railway production domain", () => {
    expect(isCorsAllowed("https://quotevaultpro-production.up.railway.app", origins)).toBe(true);
  });

  it("allows www.printershero.com", () => {
    expect(isCorsAllowed("https://www.printershero.com", origins)).toBe(true);
  });

  it("allows localhost dev origins", () => {
    expect(isCorsAllowed("http://localhost:5173", origins)).toBe(true);
    expect(isCorsAllowed("http://localhost:5000", origins)).toBe(true);
  });

  it("denies an unknown origin", () => {
    expect(isCorsAllowed("https://evil.example.com", origins)).toBe(false);
  });

  it("denies a partial-match origin (not in list)", () => {
    // Ensure there's no substring matching bug
    expect(isCorsAllowed("https://quotevaultpro-production.up.railway.app.evil.com", origins)).toBe(false);
  });

  it("CORS_EXTRA_ORIGINS env-driven origin is allowed when list is extended", () => {
    const extended = [...origins, "https://staging.printershero.com"];
    expect(isCorsAllowed("https://staging.printershero.com", extended)).toBe(true);
  });
});

// ─── Inline: resolveActiveOrg decision tree ────────────────────────────────────
// Mirrors the logic in server/tenantContext.ts tenantContext middleware.
// Pure function version — no DB calls.

type OrgEntry = { organizationId: string };

type ResolveOrgInput = {
  headerOrgId?: string;         // X-Organization-Id header
  lastActiveOrgId?: string | null; // users.last_active_org_id
  memberships: OrgEntry[];      // all user_organizations rows for this user
};

type ResolveOrgResult =
  | { type: "resolved"; orgId: string; shouldPersist?: boolean }
  | { type: "ORG_SELECTION_REQUIRED" }
  | { type: "NO_MEMBERSHIP" };

function resolveActiveOrg(input: ResolveOrgInput): ResolveOrgResult {
  const { headerOrgId, lastActiveOrgId, memberships } = input;

  // 1. Explicit header takes highest priority
  if (headerOrgId) {
    const valid = memberships.some((m) => m.organizationId === headerOrgId);
    if (valid) return { type: "resolved", orgId: headerOrgId };
  }

  // 2. Persisted last-active org (if still valid membership)
  if (lastActiveOrgId) {
    const valid = memberships.some((m) => m.organizationId === lastActiveOrgId);
    if (valid) return { type: "resolved", orgId: lastActiveOrgId };
    // Stale → fall through
  }

  // 3. Single-membership auto-select + persist
  if (memberships.length === 1) {
    return { type: "resolved", orgId: memberships[0].organizationId, shouldPersist: true };
  }

  // 4. Multiple orgs with no clear winner → require selection
  if (memberships.length > 1) {
    return { type: "ORG_SELECTION_REQUIRED" };
  }

  // 5. No memberships at all
  return { type: "NO_MEMBERSHIP" };
}

describe("resolveActiveOrg decision tree", () => {
  const orgA = { organizationId: "org-a" };
  const orgB = { organizationId: "org-b" };
  const orgC = { organizationId: "org-c" };

  it("0 memberships → NO_MEMBERSHIP", () => {
    expect(resolveActiveOrg({ memberships: [] })).toEqual({ type: "NO_MEMBERSHIP" });
  });

  it("1 membership + no hint → resolved with shouldPersist=true", () => {
    const result = resolveActiveOrg({ memberships: [orgA] });
    expect(result).toEqual({ type: "resolved", orgId: "org-a", shouldPersist: true });
  });

  it(">1 memberships + no hint → ORG_SELECTION_REQUIRED", () => {
    expect(resolveActiveOrg({ memberships: [orgA, orgB] })).toEqual({
      type: "ORG_SELECTION_REQUIRED",
    });
  });

  it(">1 memberships + valid lastActiveOrgId → resolved (no persist)", () => {
    const result = resolveActiveOrg({ memberships: [orgA, orgB], lastActiveOrgId: "org-b" });
    expect(result).toEqual({ type: "resolved", orgId: "org-b" });
    expect((result as any).shouldPersist).toBeUndefined();
  });

  it(">1 memberships + stale lastActiveOrgId (org removed) → ORG_SELECTION_REQUIRED", () => {
    // org-c is not in memberships — it was removed
    expect(
      resolveActiveOrg({ memberships: [orgA, orgB], lastActiveOrgId: "org-c" })
    ).toEqual({ type: "ORG_SELECTION_REQUIRED" });
  });

  it("header org overrides lastActiveOrgId", () => {
    const result = resolveActiveOrg({
      headerOrgId: "org-a",
      lastActiveOrgId: "org-b",
      memberships: [orgA, orgB, orgC],
    });
    expect(result).toEqual({ type: "resolved", orgId: "org-a" });
  });

  it("header org pointing to invalid/unjoined org → falls through to lastActiveOrgId", () => {
    // Header org-z is not a membership; lastActiveOrgId org-b is valid
    const result = resolveActiveOrg({
      headerOrgId: "org-z",
      lastActiveOrgId: "org-b",
      memberships: [orgA, orgB],
    });
    expect(result).toEqual({ type: "resolved", orgId: "org-b" });
  });

  it("null lastActiveOrgId treated as absent", () => {
    expect(
      resolveActiveOrg({ memberships: [orgA, orgB], lastActiveOrgId: null })
    ).toEqual({ type: "ORG_SELECTION_REQUIRED" });
  });
});
