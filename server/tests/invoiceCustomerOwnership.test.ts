import { describe, expect, test } from "@jest/globals";
import { resolveCanonicalInvoiceCustomerOwnership } from "../../shared/invoiceCustomerOwnership";

describe("resolveCanonicalInvoiceCustomerOwnership", () => {
  test("uses the current linked Order customer and contact for a native invoice", () => {
    expect(resolveCanonicalInvoiceCustomerOwnership({
      invoiceCustomerId: "former-customer",
      linkedOrderId: "order-1",
      linkedOrderCustomerId: "current-customer",
      linkedOrderContactId: "current-contact",
    })).toEqual({ customerId: "current-customer", contactId: "current-contact", source: "order" });
  });

  test("falls back to the stored customer for standalone, missing-order, and imported QuickBooks invoices", () => {
    for (const input of [
      { invoiceCustomerId: "stored" },
      { invoiceCustomerId: "stored", linkedOrderId: "missing-customer-order" },
      { invoiceCustomerId: "stored", invoiceImportSource: "quickbooks", linkedOrderId: "order-1", linkedOrderCustomerId: "live-customer" },
    ]) {
      expect(resolveCanonicalInvoiceCustomerOwnership(input)).toEqual({ customerId: "stored", contactId: null, source: "invoice" });
    }
  });
});
