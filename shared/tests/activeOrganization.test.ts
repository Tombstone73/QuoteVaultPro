import { describe, expect, test } from "@jest/globals";
import { resolveActiveOrganization } from "@shared/activeOrganization";

const memberships = [
  { id: "org-admin", role: "admin", isDefault: true },
  { id: "org-member", role: "member", isDefault: false },
];

describe("active organization membership resolution", () => {
  test("uses the selected membership instead of a role from another organization", () => {
    expect(resolveActiveOrganization(memberships, "org-member")).toEqual(memberships[1]);
  });

  test("uses the default membership when legacy sessions have no active organization", () => {
    expect(resolveActiveOrganization(memberships, null)).toEqual(memberships[0]);
  });

  test("does not grant a role when multiple memberships have no active or default selection", () => {
    expect(resolveActiveOrganization([
      { id: "org-admin", role: "admin" },
      { id: "org-member", role: "member" },
    ], null)).toBeNull();
  });
});
