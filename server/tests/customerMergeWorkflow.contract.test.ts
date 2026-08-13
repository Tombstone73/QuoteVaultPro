import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("admin customer merge workflow wiring", () => {
  it("keeps merge provenance, tenant scope, audit, and retry handling at the canonical service", async () => {
    const [service, schema, migration, route] = await Promise.all([
      source("server/services/customerCanonicalIdentityService.ts"),
      source("shared/schema.ts"),
      source("server/db/migrations_v2/0171_customer_merge_workflow.sql"),
      source("server/routes/customers.routes.ts"),
    ]);
    expect(service).toContain("export async function mergeCustomers");
    expect(service).toContain("getCustomerMergePreview");
    expect(service).toContain("FIELD_CONFLICT_RESOLUTION_REQUIRED");
    expect(service).toContain("PRIMARY_CONTACT_RESOLUTION_REQUIRED");
    expect(service).toContain("SOURCE_ALREADY_MERGED");
    expect(service).toContain("customer_merge_completed");
    expect(service).toContain("mergedIntoCustomerId: survivor.id");
    expect(service).toContain("eq(customers.organizationId, input.organizationId)");
    expect(schema).toContain("mergedIntoCustomerId");
    expect(schema).toContain("customerMergeOperations");
    expect(migration).toContain("customer_merge_operations");
    expect(route).toContain('"/api/customers/merge/preview"');
    expect(route).toContain('"/api/customers/merge"');
    expect(route).toContain("tenantContext, isAdmin");
  });

  it("keeps the customer list as a bounded review client, not a re-parenting engine", async () => {
    const [list, dialog] = await Promise.all([
      source("client/src/components/CustomerList.tsx"),
      source("client/src/components/CustomerMergeDialog.tsx"),
    ]);
    expect(list).toContain("onMergeCustomers");
    expect(dialog).toContain("/api/customers/merge/preview");
    expect(dialog).toContain("/api/customers/merge");
    expect(dialog).toContain("reviewed: true");
    expect(dialog).toContain("primaryContactId");
    expect(dialog).not.toContain("/api/orders/");
    expect(dialog).not.toContain("/api/invoices/");
  });
});
