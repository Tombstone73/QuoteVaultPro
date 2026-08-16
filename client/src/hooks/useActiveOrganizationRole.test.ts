import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/lib/apiConfig", () => ({
  getApiUrl: (path: string) => path,
}));

jest.mock("@/lib/api/me", () => ({
  fetchMyOrgs: jest.fn(),
}));

import { resolveActiveOrganizationRole } from "./useActiveOrganizationRole";

describe("resolveActiveOrganizationRole", () => {
  test("grants saved-order and Settings authority to the active Admin membership", () => {
    expect(resolveActiveOrganizationRole({
      success: true,
      data: {
        lastActiveOrgId: "org-admin",
        orgs: [
          { id: "org-admin", name: "Admin Org", slug: "admin", role: "admin" },
          { id: "org-member", name: "Member Org", slug: "member", role: "member" },
        ],
      },
    })).toMatchObject({ activeOrgId: "org-admin", role: "admin" });
  });

  test("removes Admin authority after switching to a member organization", () => {
    expect(resolveActiveOrganizationRole({
      success: true,
      data: {
        lastActiveOrgId: "org-member",
        orgs: [
          { id: "org-admin", name: "Admin Org", slug: "admin", role: "admin" },
          { id: "org-member", name: "Member Org", slug: "member", role: "member" },
        ],
      },
    })).toMatchObject({ activeOrgId: "org-member", role: "member" });
  });

  test("uses the active organization Manager role without a global-role fallback", () => {
    expect(resolveActiveOrganizationRole({
      success: true,
      data: {
        lastActiveOrgId: "org-manager",
        orgs: [
          { id: "org-manager", name: "Manager Org", slug: "manager", role: "manager" },
          { id: "org-owner", name: "Owner Org", slug: "owner", role: "owner" },
        ],
      },
    })).toMatchObject({ activeOrgId: "org-manager", role: "manager" });
  });
});
