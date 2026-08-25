import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("canonical CRM, Invoice, and Payment operation wiring", () => {
  it("routes UI and confirmed CRM writes through CanonicalCustomerContactOperations", async () => {
    const [customersRoute, contactsRoute, assistant] = await Promise.all([
      source("server/routes/customers.routes.ts"),
      source("server/routes/customerRelations.routes.ts"),
      source("server/services/assistant/crmManagementService.ts"),
    ]);
    expect(customersRoute).toContain("canonicalCustomerContactOperations.createCustomer");
    expect(customersRoute).toContain("canonicalCustomerContactOperations.updateCustomer");
    expect(contactsRoute).toContain("canonicalCustomerContactOperations.createContact");
    expect(contactsRoute).toContain("canonicalCustomerContactOperations.updateContact");
    expect(assistant).toContain("canonicalCustomerContactOperations.createCustomer");
    expect(assistant).toContain("canonicalCustomerContactOperations.updateContact");
    expect(assistant).not.toMatch(/tx\.insert\(customers\)|tx\.insert\(customerContacts\)|tx\.insert\(customerContactLinks\)/);
  });

  it("routes reviewed UI and AI invoice mutations through CanonicalInvoiceOperations", async () => {
    const [route, assistant] = await Promise.all([
      source("server/routes/mvpInvoicing.routes.ts"),
      source("server/services/assistant/billingInvoiceOperationsService.ts"),
    ]);
    expect(route).toContain("canonicalInvoiceOperations.createDraftsFromOrders");
    expect(route).toContain("canonicalInvoiceOperations.finalize");
    expect(route).toContain("canonicalInvoiceOperations.markSent");
    expect(route).toContain("eq(customers.organizationId, organizationId)");
    expect(assistant).toContain("canonicalInvoiceOperations.createDraftsFromOrders");
    expect(assistant).toContain("canonicalInvoiceOperations.updateSafeDraft");
    expect(assistant).toContain("canonicalInvoiceOperations.markSent");
    expect(assistant).toContain("canonicalInvoiceOperations.addInternalNote");
  });

  it("uses one exact-cent locked and idempotent manual-payment operation for UI and AI", async () => {
    const [route, assistant, operation, financialCore] = await Promise.all([
      source("server/routes/mvpInvoicing.routes.ts"),
      source("server/services/assistant/paymentOperationsService.ts"),
      source("server/services/billing/canonicalPaymentOperations.ts"),
      source("server/invoicesService.ts"),
    ]);
    expect(route).toContain("canonicalPaymentOperations.recordManualPayment");
    expect(assistant).toContain("canonicalPaymentOperations.recordManualPayment");
    expect(operation).toContain("amountCents: number");
    expect(operation).toContain("idempotencyKey: string");
    expect(financialCore).toContain("recordManualPaymentCanonical");
    expect(financialCore).toContain("pg_advisory_xact_lock");
    expect(financialCore).toContain("getInvoiceFinancialPaymentEligibility");
    expect(financialCore).toContain("IDEMPOTENCY_KEY_CONFLICT");
    expect(financialCore).toContain("amountCents > financialState.amountDueCents");
    expect(financialCore).toContain("OVERPAYMENT_NOT_ALLOWED");
  });

  it("keeps manual payment voids as audited rollup reconciliations instead of deleting history", async () => {
    const [route, financialCore] = await Promise.all([
      source("server/routes/mvpInvoicing.routes.ts"),
      source("server/invoicesService.ts"),
    ]);
    expect(financialCore).toContain("reconcileInvoicePaymentStateInTransaction");
    expect(financialCore).toContain("voidManualPaymentCanonical");
    expect(route).toContain("voidManualPaymentCanonical");
    expect(route).not.toContain("await db.delete(payments)");
  });
});
