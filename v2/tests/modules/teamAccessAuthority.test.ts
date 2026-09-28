import { describe, expect, test } from "@jest/globals";
import { canManageTeamAccess, canReadTeamAccess, teamAccessManagementAuthority } from "../../src/authorization/teamAccessAuthority.js";
import type { Principal, StaffPrincipal } from "../../src/authorization/principals.js";

const staff = (teamAccessManagement: boolean): StaffPrincipal => ({ kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", source: "permission_set", authorityRevision: "7", capabilities: ["order.view"], teamAccessManagement } });

describe("Team & Access read and management authority", () => {
  test.each(["owner", "admin"])("%s membership receives canonical management authority", (organizationRole) => {
    expect(teamAccessManagementAuthority({ organizationRole, isPlatformDeveloper: false })).toBe(true);
  });

  test("Platform Developer receives management authority only through the existing platform flag", () => {
    expect(teamAccessManagementAuthority({ organizationRole: "member", isPlatformDeveloper: true })).toBe(true);
    expect(teamAccessManagementAuthority({ organizationRole: "member", isPlatformDeveloper: false })).toBe(false);
  });

  test.each(["manager", "member", "employee", "sales", "production", "custom"])("ordinary %s Staff can read but cannot manage", (organizationRole) => {
    expect(teamAccessManagementAuthority({ organizationRole, isPlatformDeveloper: false })).toBe(false);
    expect(canReadTeamAccess(staff(false))).toBe(true);
    expect(canManageTeamAccess(staff(false))).toBe(false);
  });

  test("a portal principal cannot read or manage Staff Team & Access", () => {
    const portal: Principal = { kind: "portal", organizationId: "org-a", customerId: "customer-a", subjectId: "portal-a", capabilities: ["order.view"] };
    expect(canReadTeamAccess(portal)).toBe(false);
    expect(canManageTeamAccess(portal)).toBe(false);
  });

  test("management requires the freshly derived authority fact, not mutable permission capabilities", () => {
    expect(canManageTeamAccess(staff(false))).toBe(false);
    expect(canManageTeamAccess(staff(true))).toBe(true);
  });
});
