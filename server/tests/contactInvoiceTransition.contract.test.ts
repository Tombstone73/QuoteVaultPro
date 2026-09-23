import { readFileSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Contact-only Order billing transition contract", () => {
  test("Order and pristine Invoice owner update occur within one transaction with financial-history checks", () => {
    const operation = source("../services/orders/canonicalOrderOperations.ts");
    const transaction = operation.slice(operation.indexOf("return db.transaction(async (tx) =>", operation.indexOf("async updateEditableHeader")));
    expect(transaction).toContain("getInvoiceBillingOwnerTransitionBlocker");
    expect(transaction).toContain("tx.update(invoices).set({");
    expect(transaction).toContain("customerId: nextCustomerId");
    expect(transaction).toContain("contactId: nextCustomerId ? null : nextContactId");
    expect(transaction).toContain("new OrdersRepository(tx).updateOrder");
    expect(transaction).toContain("invoice_billing_owner_changed");
    expect(transaction).toContain("for update");
  });

  test("email queue locks the Invoice and rejects a stale version before recording the delivery job", () => {
    const queue = source("../services/invoiceBulkEmailQueue.service.ts");
    const loop = queue.slice(queue.indexOf("for (const candidate of input.candidates)"));
    expect(loop.indexOf("for update")).toBeLessThan(loop.indexOf("tx.insert(invoiceEmailDeliveryJobs)"));
    expect(loop).toContain("Number(lockedVersion) !== Number(candidate.invoiceVersion)");
  });

  test("portal remains Customer-ID scoped and Contact-owned Invoice does not resolve to former company", () => {
    const portal = source("../services/portal.service.ts");
    const projection = source("../services/invoiceCustomerProjection.ts");
    expect(portal).toContain("eq(canonicalInvoiceCustomerId, scope.customerId)");
    expect(projection).toContain("and ${invoices.contactId} is null");
  });

  test("QuickBooks invoice sync is held explicitly before customer mapping, and approval does not autoqueue it", () => {
    const qb = source("../quickbooksService.ts");
    const approval = source("../services/invoiceAccountingApproval.service.ts");
    expect(qb).toContain("CONTACT_INVOICE_QB_MAPPING_REQUIRED");
    expect(approval).toContain("contactQuickBooksHold");
    expect(approval).toContain("!contactQuickBooksHold");
  });

  test("Contact billing cannot fall back into a company payment batch or company portal link", () => {
    const payments = source("../services/billing/customerPaymentOperations.ts");
    expect(payments).toContain("invoiceContactId: invoice.contactId");
    expect(payments).toContain("CONTACT_INVOICE_CUSTOMER_PAYMENT_UNSUPPORTED");
    const routes = source("../routes/mvpInvoicing.routes.ts");
    expect(routes).toContain('cust.kind === "customer" && getInvoiceFinancialPaymentEligibility');
    expect(routes).toContain('cust.kind === "contact" ? null');
  });
});
