import { resolveOrganizationRoleAuthority } from "../organizationRoleAuthority";

describe("organization role authority policy", () => {
  it("keeps members read-only for AI business authority", () => {
    const authority = resolveOrganizationRoleAuthority("member");
    expect(authority.status).toBe("resolved");
    expect(authority.grants).toEqual(["assistant.internal_staff", "catalog.read"]);
    expect(authority.grants).not.toContain("assistant.billing.send_invoice");
    expect(authority.grants).not.toContain("assistant.payments.record_manual_payment");
  });

  it("preserves command-definition-backed operational authority for managers and employees", () => {
    for (const role of ["manager", "employee"]) {
      const authority = resolveOrganizationRoleAuthority(role);
      expect(authority.grants).toEqual(expect.arrayContaining(["assistant.billing.send_invoice", "assistant.payments.record_manual_payment"]));
      expect(authority.grants).not.toContain("assistant.products.update_existing_product");
    }
  });

  it("reserves product mutation authority for owner and admin", () => {
    for (const role of ["owner", "admin"]) {
      expect(resolveOrganizationRoleAuthority(role).grants).toEqual(expect.arrayContaining(["assistant.products.update_existing_product", "assistant.products.replace_inactive_matrix"]));
    }
  });

  it("fails closed for unmapped platform or synthetic roles", () => {
    expect(resolveOrganizationRoleAuthority("super_admin")).toMatchObject({ status: "unknown", grants: [] });
    expect(resolveOrganizationRoleAuthority("internal_ai")).toMatchObject({ status: "unknown", grants: [] });
  });
});
