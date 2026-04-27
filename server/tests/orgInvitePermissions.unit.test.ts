/**
 * orgInvitePermissions.unit.test.ts
 *
 * Unit tests for org-scoped invite and role-assignment policy helpers.
 *
 * Functions under test (inlined to avoid DB/schema import chain):
 *   canInviteOrgUsers(actorRole)  — who may invite new org members
 *   canAssignOrgRole(actorRole, targetRole) — what roles an actor may assign
 *
 * NOTE: user_organizations.role is the authoritative org-scoped role.
 * users.role / users.is_admin are global identity fields only and must NOT
 * be used for org invite / role-assignment permission checks.
 *
 * Policy under test:
 *   owner:   invite yes | assign owner, admin, manager, member
 *   admin:   invite yes | assign admin, manager, member
 *   manager: invite yes | assign manager, member
 *   member:  invite no  | assign none
 *   unknown: invite no  | assign none  (fail-closed)
 */

import { describe, it, expect } from "@jest/globals";

// ─── Inline: canInviteOrgUsers (mirrors server/lib/orgPermissions.ts) ──────────

function canInviteOrgUsers(actorRole: string): boolean {
  return actorRole === "owner" || actorRole === "admin" || actorRole === "manager";
}

// ─── Inline: canAssignOrgRole (mirrors server/lib/orgPermissions.ts) ───────────

function canAssignOrgRole(actorRole: string, targetRole: string): boolean {
  switch (actorRole) {
    case "owner":
      return ["owner", "admin", "manager", "member"].includes(targetRole);
    case "admin":
      return ["admin", "manager", "member"].includes(targetRole);
    case "manager":
      return ["manager", "member"].includes(targetRole);
    default:
      return false;
  }
}

// ─── Tests: canInviteOrgUsers ─────────────────────────────────────────────────

describe("canInviteOrgUsers — who may invite", () => {
  it("owner can invite", () => {
    expect(canInviteOrgUsers("owner")).toBe(true);
  });

  it("admin can invite", () => {
    expect(canInviteOrgUsers("admin")).toBe(true);
  });

  it("manager can invite", () => {
    expect(canInviteOrgUsers("manager")).toBe(true);
  });

  it("member cannot invite", () => {
    expect(canInviteOrgUsers("member")).toBe(false);
  });

  it("unknown role cannot invite (fail-closed)", () => {
    expect(canInviteOrgUsers("superuser")).toBe(false);
    expect(canInviteOrgUsers("")).toBe(false);
    expect(canInviteOrgUsers("OWNER")).toBe(false); // case-sensitive
  });

  it("checks use user_organizations.role — global users.role must NOT be trusted", () => {
    // This test documents the invariant: the actor role passed in MUST come from
    // user_organizations.role, not users.role. The function itself is pure and
    // doesn't know the source, but callers are expected to supply the org role.
    // 'employee' is a global users.role value that has no meaning at org scope.
    expect(canInviteOrgUsers("employee")).toBe(false);
  });
});

// ─── Tests: canAssignOrgRole — owner ─────────────────────────────────────────

describe("canAssignOrgRole — owner scope", () => {
  it("owner can assign owner", () => {
    expect(canAssignOrgRole("owner", "owner")).toBe(true);
  });

  it("owner can assign admin", () => {
    expect(canAssignOrgRole("owner", "admin")).toBe(true);
  });

  it("owner can assign manager", () => {
    expect(canAssignOrgRole("owner", "manager")).toBe(true);
  });

  it("owner can assign member", () => {
    expect(canAssignOrgRole("owner", "member")).toBe(true);
  });

  it("owner cannot assign unknown role (fail-closed)", () => {
    expect(canAssignOrgRole("owner", "superuser")).toBe(false);
    expect(canAssignOrgRole("owner", "")).toBe(false);
  });
});

// ─── Tests: canAssignOrgRole — admin scope ────────────────────────────────────

describe("canAssignOrgRole — admin scope", () => {
  it("admin can assign admin", () => {
    expect(canAssignOrgRole("admin", "admin")).toBe(true);
  });

  it("admin can assign manager", () => {
    expect(canAssignOrgRole("admin", "manager")).toBe(true);
  });

  it("admin can assign member", () => {
    expect(canAssignOrgRole("admin", "member")).toBe(true);
  });

  it("admin cannot assign owner", () => {
    expect(canAssignOrgRole("admin", "owner")).toBe(false);
  });

  it("admin cannot assign unknown role (fail-closed)", () => {
    expect(canAssignOrgRole("admin", "superuser")).toBe(false);
  });
});

// ─── Tests: canAssignOrgRole — manager scope ──────────────────────────────────

describe("canAssignOrgRole — manager scope", () => {
  it("manager can assign manager", () => {
    expect(canAssignOrgRole("manager", "manager")).toBe(true);
  });

  it("manager can assign member", () => {
    expect(canAssignOrgRole("manager", "member")).toBe(true);
  });

  it("manager cannot assign admin", () => {
    expect(canAssignOrgRole("manager", "admin")).toBe(false);
  });

  it("manager cannot assign owner", () => {
    expect(canAssignOrgRole("manager", "owner")).toBe(false);
  });

  it("manager cannot assign unknown role (fail-closed)", () => {
    expect(canAssignOrgRole("manager", "superuser")).toBe(false);
    expect(canAssignOrgRole("manager", "")).toBe(false);
  });
});

// ─── Tests: canAssignOrgRole — member / unknown scope ─────────────────────────

describe("canAssignOrgRole — member and unknown scope (fail-closed)", () => {
  it("member cannot assign any role", () => {
    expect(canAssignOrgRole("member", "member")).toBe(false);
    expect(canAssignOrgRole("member", "manager")).toBe(false);
    expect(canAssignOrgRole("member", "admin")).toBe(false);
    expect(canAssignOrgRole("member", "owner")).toBe(false);
  });

  it("unknown actor role cannot assign any role", () => {
    expect(canAssignOrgRole("employee", "member")).toBe(false);
    expect(canAssignOrgRole("", "member")).toBe(false);
    expect(canAssignOrgRole("ADMIN", "member")).toBe(false); // case-sensitive
  });
});

// ─── Tests: scope boundary — escalation is always blocked ─────────────────────

describe("canAssignOrgRole — no role can escalate beyond its own level", () => {
  it("manager cannot escalate to admin via invite", () => {
    expect(canAssignOrgRole("manager", "admin")).toBe(false);
  });

  it("manager cannot escalate to owner via invite", () => {
    expect(canAssignOrgRole("manager", "owner")).toBe(false);
  });

  it("admin cannot escalate to owner via invite", () => {
    expect(canAssignOrgRole("admin", "owner")).toBe(false);
  });
});
