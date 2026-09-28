import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { OPERATIONS_ROLE } from "../../src/authorization/operationsRole";
import { capabilityIds } from "../../src/authorization/capabilities";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets";

describe("canonical Operations staff role", () => {
  test("SQL seed and typed role contain exactly the same existing capabilities", () => {
    expect(OPERATIONS_ROLE).toMatchObject({ templateKey: "operations", name: "Operations", principalKind: "staff" });
    const migration = readFileSync("server/db/migrations_v2/0292_v2_operations_permission_role.sql", "utf8");
    const seeded = [...migration.matchAll(/\('([a-z]+(?:\.[a-zA-Z]+)+)'\)/g)].map((match) => match[1]);
    expect(seeded.sort()).toEqual([...OPERATIONS_ROLE.capabilities].sort());
    expect(new Set(OPERATIONS_ROLE.capabilities).size).toBe(OPERATIONS_ROLE.capabilities.length);
    for (const capability of OPERATIONS_ROLE.capabilities) expect(capabilityIds).toContain(capability);
    expect(migration).not.toMatch(/DELETE FROM|UPDATE v2_permission_sets|INSERT INTO v2_staff_permission_set_assignments|UPDATE users|UPDATE user_organizations/);
    expect(migration).toContain("WHERE ps.source_template_key='operations'");
    expect(migration).toContain("WHERE t.template_key='operations'");
  });

  test("normal permission-set issuance authorizes the whole workflow, never administrator shortcuts", async () => {
    const issuer = new PermissionSetPrincipalIssuer({
      resolvePortal: async () => null,
      resolveStaff: async (userId, organizationId) => ({
        organizationId, organizationActive: true, authorityRevision: 1,
        staff: { userId, membershipId: "member", membershipActive: true, teamAccessManagement: false,
          permissionSets: [{ id: "operations-set", name: "Operations", active: true, revision: 1 }],
          capabilities: OPERATIONS_ROLE.capabilities },
      }),
    });
    const policy = new AuthorityPolicy();
    const real = await issuer.issue({ subjectId: "real-staff", authenticationMethod: "session", authenticatedAt: new Date() }, { organizationId: "org" });
    for (const capability of capabilityIds) {
      expect(policy.decide(real, { capability, resource: { organizationId: "org" } }).allowed).toBe((OPERATIONS_ROLE.capabilities as readonly string[]).includes(capability));
      expect(policy.decide(real, { capability, resource: { organizationId: "other" } }).allowed).toBe(false);
    }
    for (const capability of ["order.create", "quote.convert", "artwork.view", "artwork.adopt", "artwork.assign", "proof.prepare", "proof.issue", "prepress.complete", "production.run.execute", "production.rework", "fulfillment.replace", "fulfillment.pickup", "invoice.editIssued", "invoice.issue", "payment.view"]) expect(OPERATIONS_ROLE.capabilities).toContain(capability);
    for (const capability of ["organization.configure", "numbering.configure", "communications.configure", "permissions.view", "permissions.manageSets", "permissions.assignStaff", "permissions.assignPortal", "product.edit", "pricing.configure", "pricing.publish", "payment.record", "refund.issue", "route.manageTemplates", "workflow.override", "proof.respond"]) expect(OPERATIONS_ROLE.capabilities).not.toContain(capability);
  });
});
