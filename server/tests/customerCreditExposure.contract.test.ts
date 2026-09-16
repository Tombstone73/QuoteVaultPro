import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(file, "utf8");

describe("customer credit exposure service contract", () => {
  test("uses tenant-scoped canonical customer ownership, payment rollups, and approval classification", () => {
    const service = source("server/services/customerCreditExposureService.ts");
    expect(service).toContain("eq(invoices.organizationId, organizationId)");
    expect(service).toContain("canonicalInvoiceCustomerId");
    expect(service).toContain("normalizeInvoiceAccountingDisplay");
    expect(service).toContain("isInvoiceApprovedForAccounting");
    expect(service).not.toContain("getInvoiceEmailStatuses");
  });

  test("keeps the compact header reconciled and labels its financial semantics", () => {
    const view = source("client/src/features/customers/EnhancedCustomerView.tsx");
    expect(view).toContain("Approved invoice balances still owed.");
    expect(view).toContain("Customer work not yet approved for accounting.");
    expect(view).toContain("Outstanding A/R plus pending billing.");
    expect(view).toContain("Current operational work value.");
    expect(view).not.toContain("Unbilled Orders");
  });
});
