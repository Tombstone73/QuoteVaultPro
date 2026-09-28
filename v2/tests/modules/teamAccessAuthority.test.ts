import { describe, expect, test } from "@jest/globals";
import { canAssignStaffRoles, canBuildTeamRoles, canDelegateTeamCapability, canManageTeamAccess, canReadTeamAccess, delegableTeamCapabilities, teamAccessManagementAuthority, teamRoleDelegationAuthority } from "../../src/authorization/teamAccessAuthority.js";
import type { Principal, StaffPrincipal } from "../../src/authorization/principals.js";

const staff = (teamAccessManagement: boolean): StaffPrincipal => ({ kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", source: "permission_set", authorityRevision: "7", capabilities: ["order.view"], teamAccessManagement } });
const delegated = (teamRoleDelegation: NonNullable<StaffPrincipal["authority"]["teamRoleDelegation"]>, capabilities: readonly string[] = ["order.view"]): StaffPrincipal => ({ kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", source: "permission_set", authorityRevision: "7", capabilities: capabilities as never, teamAccessManagement: teamRoleDelegation === "owner" || teamRoleDelegation === "administrator" || teamRoleDelegation === "platform_developer", teamRoleDelegation } });

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

  test("structural membership rank grants Manager role-builder and Staff-assignment access without widening broad Team & Access administration", () => {
    expect(teamRoleDelegationAuthority({ organizationRole: "manager", isPlatformDeveloper: false })).toBe("manager");
    expect(canBuildTeamRoles(delegated("manager"))).toBe(true);
    expect(canAssignStaffRoles(delegated("manager"))).toBe(true);
    expect(canManageTeamAccess(delegated("manager"))).toBe(false);
  });

  test("Owner and Platform Developer may delegate every active tenant Staff capability while Manager and Administrator remain capability-ceiling bound", () => {
    const owner = delegated("owner", ["order.view"]);
    const platformDeveloper = delegated("platform_developer", ["order.view"]);
    const manager = delegated("manager", ["order.view"]);
    const administrator = delegated("administrator", ["order.view", "payment.record"]);
    expect(canDelegateTeamCapability(owner, "refund.issue")).toBe(true);
    expect(canDelegateTeamCapability(platformDeveloper, "refund.issue")).toBe(true);
    expect(canDelegateTeamCapability(manager, "order.view")).toBe(true);
    expect(canDelegateTeamCapability(manager, "refund.issue")).toBe(false);
    expect(canDelegateTeamCapability(administrator, "payment.record")).toBe(true);
    expect(canDelegateTeamCapability(administrator, "refund.issue")).toBe(false);
    expect(delegableTeamCapabilities(manager, ["order.view", "refund.issue"])).toEqual(["order.view"]);
  });

  test("a role capability never confers structural Owner, Administrator, Manager, or Platform Developer identity", () => {
    const ordinary = delegated("none", ["permissions.manageSets", "permissions.assignStaff"]);
    expect(canBuildTeamRoles(ordinary)).toBe(false);
    expect(canAssignStaffRoles(ordinary)).toBe(false);
    expect(canManageTeamAccess(ordinary)).toBe(false);
  });
});
