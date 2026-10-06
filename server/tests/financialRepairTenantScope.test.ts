import { describe, expect, it } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertExclusiveTenantCandidates,
  scopedFleetInvoice,
  scopedInvoiceIdentity,
  scopedInvoiceLine,
  scopedOrderLine,
  scopedOrderLineId,
} from "../lib/financialRepairTenantScope";

const live = { id: "56e0f644-bb25-43ef-8ee1-473831115849", name: "Titan Graphics" };
const sandbox = { id: "d51ff3e7-75aa-462f-b0ab-3751bd888306", name: "Sandbox Titan Graphics" };

function compiled(predicate: ReturnType<typeof scopedFleetInvoice>) {
  return new PgDialect().sqlToQuery(sql`select 1 where ${predicate}`);
}

describe("financial repair tenant isolation", () => {
  it("refuses the INV-1200 wrong-tenant candidate, even with a unique-looking number", () => {
    expect(() => assertExclusiveTenantCandidates(live.id, [live], [{ organizationId: sandbox.id }]))
      .toThrow(/crosses organizations/);
  });

  it("refuses an unscoped 20467-style lookup and duplicate document numbers across tenants", () => {
    expect(() => assertExclusiveTenantCandidates(live.id, [live], [
      { organizationId: live.id }, { organizationId: sandbox.id },
    ])).toThrow(/crosses organizations/);
  });

  it("refuses a correct UUID supplied with the wrong organization", () => {
    expect(() => assertExclusiveTenantCandidates(live.id, [live], [{ organizationId: sandbox.id }]))
      .toThrow(/crosses organizations/);
    const query = compiled(scopedInvoiceIdentity("sandbox-invoice-uuid", live.id));
    expect(query.params).toEqual(["sandbox-invoice-uuid", live.id]);
    expect(query.sql).toContain('"invoices"."organization_id"');
  });

  it("keeps fleet counts tenant-pure, including colliding invoice/order/display numbers and similar customers", () => {
    const rows = [
      { organizationId: live.id, invoiceNumber: 20467, orderNumber: 20467, displayNumber: "INV-20467", customer: "Elite Printing" },
      { organizationId: sandbox.id, invoiceNumber: 20467, orderNumber: 20467, displayNumber: "INV-20467", customer: "Elite Print" },
    ];
    expect(rows.filter((row) => row.organizationId === live.id)).toHaveLength(1);
    const query = compiled(scopedFleetInvoice(live.id));
    expect(query.params).toEqual([live.id]);
    expect(query.sql).toContain('"invoices"."organization_id"');
  });

  it("requires correlated tenant ownership for child reads and mutations", () => {
    for (const predicate of [scopedOrderLine("order-id", live.id), scopedOrderLineId("line-id", live.id), scopedInvoiceLine("invoice-id", live.id)]) {
      const query = compiled(predicate!);
      expect(query.sql).toMatch(/exists \(select 1 from/);
      expect(query.sql).toContain('"organization_id"');
      expect(query.params).toContain(live.id);
    }
  });

  it("requires one resolvable target organization and one exclusive candidate", () => {
    expect(() => assertExclusiveTenantCandidates(live.id, [], [{ organizationId: live.id }])).toThrow(/exactly once/);
    expect(() => assertExclusiveTenantCandidates(live.id, [live, sandbox], [{ organizationId: live.id }])).toThrow(/exactly once/);
    expect(() => assertExclusiveTenantCandidates(live.id, [live], [])).toThrow(/expected one/);
  });

  it("keeps the reusable fleet runner explicitly tenant-bound and read-only", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/audit-order-invoice-tenant.ts"), "utf8");
    expect(source).toContain("scopedFleetInvoice(organizationId)");
    expect(source).toContain("eq(orders.organizationId, organizationId)");
    expect(source).toContain("eq(payments.organizationId, organizationId)");
    expect(source).not.toMatch(/\.update\(|\.delete\(|\.insert\(/);
    expect(source).toContain('process.argv.includes("--apply")');
  });
});
