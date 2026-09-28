import { describe, expect, test } from "@jest/globals";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy";
import { OPERATIONS_ROLE } from "../../src/authorization/operationsRole";
import { PermissionSetPrincipalIssuer, type PermissionAuthorityReader } from "../../src/authorization/permissionSets";

const identity = { subjectId: "staff-a", authenticationMethod: "session" as const, authenticatedAt: new Date() };
const paymentCapabilities = ["payment.view", "payment.record"] as const;

const reader = (sets: readonly Readonly<{ id: string; name: string; capabilities: readonly string[] }>[]): PermissionAuthorityReader => ({
  resolvePortal: async () => null,
  resolveStaff: async () => ({ organizationId: "org-a", organizationActive: true, authorityRevision: 1, staff: {
    userId: "staff-a", membershipId: "membership-a", membershipActive: true, teamAccessManagement: false,
    permissionSets: sets.map((set) => ({ id: set.id, name: set.name, active: true, revision: 1 })),
    capabilities: [...new Set(sets.flatMap((set) => set.capabilities))].sort() as never,
  } }),
});

const issue = (sets: Parameters<typeof reader>[0]) => new PermissionSetPrincipalIssuer(reader(sets)).issue(identity, { organizationId: "org-a" });
const can = (principal: Awaited<ReturnType<typeof issue>>, capability: string) => new AuthorityPolicy().decide(principal as never, { capability: capability as never, resource: { organizationId: "org-a" } }).allowed;

describe("organization role composition", () => {
  test("Operations alone supports the normal workflow but not payment recording", async () => {
    const operations = await issue([{ id: "operations", name: "Operations", capabilities: OPERATIONS_ROLE.capabilities }]);
    for (const capability of ["order.edit", "artwork.assign", "proof.issue", "prepress.complete", "production.run.execute", "fulfillment.pickup", "invoice.issue"]) expect(can(operations, capability)).toBe(true);
    expect(can(operations, "payment.view")).toBe(true);
    expect(can(operations, "payment.record")).toBe(false);
    expect(can(operations, "refund.issue")).toBe(false);
  });

  test("Operations plus a tenant Payments role combines authority without changing Operations", async () => {
    const composed = await issue([{ id: "operations", name: "Operations", capabilities: OPERATIONS_ROLE.capabilities }, { id: "payments", name: "Payments", capabilities: paymentCapabilities }]);
    expect(can(composed, "artwork.assign")).toBe(true);
    expect(can(composed, "payment.record")).toBe(true);
    expect(can(composed, "refund.issue")).toBe(false);
    expect(OPERATIONS_ROLE.capabilities).not.toContain("payment.record");
  });

  test("removing one role only removes authority unique to that role and duplicate grants are harmless", async () => {
    const withDuplicate = await issue([{ id: "operations", name: "Operations", capabilities: OPERATIONS_ROLE.capabilities }, { id: "payments", name: "Payments", capabilities: paymentCapabilities }, { id: "payment-view-copy", name: "Payment view copy", capabilities: ["payment.view"] }]);
    expect(can(withDuplicate, "payment.view")).toBe(true);
    expect(can(withDuplicate, "payment.record")).toBe(true);
    const operationsOnly = await issue([{ id: "operations", name: "Operations", capabilities: OPERATIONS_ROLE.capabilities }]);
    expect(can(operationsOnly, "payment.view")).toBe(true);
    expect(can(operationsOnly, "payment.record")).toBe(false);
    expect(can(operationsOnly, "artwork.assign")).toBe(true);
  });
});
