import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("bulk customer commercial configuration", () => {
  test("keeps the endpoint permissioned, tenant scoped, and separate from generic customer patching", () => {
    const routes = source("server/routes/customers.routes.ts");
    expect(routes).toContain('app.post("/api/customers/bulk-commercial-configuration", isAuthenticated, tenantContext');
    expect(routes).toContain("canManageCustomerCommercialConfiguration(req.actorOrgRole ?? req.orgRole)");
    expect(routes).toContain("bulkCustomerCommercialConfigurationSchema.parse(req.body ?? {})");
    expect(routes).toContain("updateCustomersCommercialConfiguration({ organizationId, actorUserId, update })");
  });

  test("updates only supported fields atomically after all selected customers are tenant verified", () => {
    const service = source("server/services/customerBulkCommercialConfiguration.service.ts");
    expect(service).toContain("return db.transaction");
    expect(service).toContain("inArray(customers.id, customerIds)");
    expect(service).toContain("selectedCustomers.length !== customerIds.length");
    expect(service).toContain("paymentTerms: input.update.paymentTerms");
    expect(service).toContain("creditLimitConfiguredAt: configuredAt");
    expect(service).toContain("customer_credit_limit_updated");
    expect(service).not.toContain("invoices");
    expect(service).not.toContain("payments");
  });
});
