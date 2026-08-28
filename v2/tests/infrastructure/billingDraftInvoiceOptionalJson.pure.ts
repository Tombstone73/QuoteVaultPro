import assert from "node:assert/strict";
import { PostgresBillingDraftInvoiceTransaction } from "../../infrastructure/billing/postgresBillingDraftInvoiceTransaction.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";

const queries: Array<Readonly<{ text: string; values: readonly unknown[] }>> = [];
const client = {
  async query<T>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    queries.push({ text, values });
    if (text.includes("SELECT id,invoice_state")) return { rows: [] };
    if (text.includes("SELECT tax_composition,commercial_charge")) return { rows: [] };
    if (text.includes("INSERT INTO v2_billing_invoices"))
      return { rows: [{ id: "invoice-a", synchronization_version: "1" }] as T[] };
    return { rows: [] };
  },
};

const organizationId = brandedId<"OrganizationId">("organization-a");
const transaction = new PostgresBillingDraftInvoiceTransaction(client as never);
await transaction.createDraftInvoice({
  organizationId,
  orderId: brandedId<"OrderId">("order-a"),
  businessRequestId: brandedId<"BusinessRequestId">("request-a"),
  customerContact: { organizationId, customerId: brandedId<"CustomerId">("customer-a") },
  currency: currencyCode("USD"),
  sourceSalesStateToken: "1",
  taxInput: {},
  salesLines: [{
    lineId: brandedId<"SalesLineId">("line-a"),
    productId: brandedId<"ProductId">("product-a"),
    description: "QA line",
    quantity: 1,
    sellingUnitAmount: money(currencyCode("USD"), 250),
    sellingLineAmount: money(currencyCode("USD"), 250),
    salesPricingEvidenceFingerprint: "pricing-evidence-a",
  }],
});

const invoiceInsert = queries.find(({ text }) => text.includes("INSERT INTO v2_billing_invoices"));
assert(invoiceInsert, "Draft Invoice creation must persist an Invoice header.");
assert.equal(invoiceInsert.values[17], null, "an absent commercial charge must bind SQL NULL, never JSON null");
assert.equal(invoiceInsert.values[18], null, "an absent tax composition must bind SQL NULL, never JSON null");
console.log("[billing-draft-invoice] optional JSON fields preserve SQL NULL semantics.");
