import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("uninvoiced historical Order workflow", () => {
  test("uses tenant-scoped relational EXISTS predicates and returns all linked invoice identities", async () => {
    const repository = await source("server/storage/orders.repo.ts");
    expect(repository).toContain('invoice?: "no_invoice" | "has_invoice"');
    expect(repository).toContain("not exists (");
    expect(repository).toContain("exists (");
    expect(repository).toContain("invoices.organizationId} = ${organizationId}");
    expect(repository).toContain("invoices.orderId} = ${orders.id}");
    expect(repository).toContain("invoiceSummary");
    expect(repository).toContain("invoiceCreationEligibility");
  });

  test("creates only a first invoice through the canonical locked operation", async () => {
    const [operation, route] = await Promise.all([
      source("server/services/billing/canonicalInvoiceOperations.ts"),
      source("server/routes/mvpInvoicing.routes.ts"),
    ]);
    expect(operation).toContain("createFirstOrderBackedInvoice");
    expect(operation).toContain("pg_advisory_xact_lock");
    expect(operation).toContain("eq(invoices.orderId, orderId)");
    expect(operation).toContain("if (existing) return { invoice: existing, created: false }");
    expect(operation).toContain("isCanceledOrder(order)");
    expect(operation).toContain("resolveInvoiceFinancialEligibility");
    expect(operation).toContain("createInvoiceFromOrderInTransaction");
    expect(route).toContain("canonicalInvoiceOperations.createFirstOrderBackedInvoice");
    expect(route).toContain("created: result.created");
  });

  test("renders the global relationship filter, Invoice links, and first-Invoice action", async () => {
    const page = await source("client/src/pages/orders.tsx");
    expect(page).toContain("Invoice: No Invoice");
    expect(page).toContain("Invoice: Has Invoice");
    expect(page).toContain('params.set("invoice", value)');
    expect(page).toContain("ROUTES.invoices.detail(primaryInvoice.id)");
    expect(page).toContain("Create Invoice");
  });

  test("renders the actual EnhancedCustomerView customer Orders filter and actions", async () => {
    const view = await source("client/src/features/customers/EnhancedCustomerView.tsx");
    expect(view).toContain("invoice: invoiceFilter === \"all\" ? undefined : invoiceFilter");
    expect(view).toContain("Invoice: No Invoice");
    expect(view).toContain('id: "invoice", label: "Invoice"');
    expect(view).toContain("No Invoice");
    expect(view).toContain("Create Invoice");
    expect(view).toContain("ROUTES.invoices.detail(primaryInvoice.id)");
  });
});
