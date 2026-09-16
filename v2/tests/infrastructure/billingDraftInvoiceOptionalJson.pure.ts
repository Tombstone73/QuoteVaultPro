import assert from "node:assert/strict";
import { PostgresBillingDraftInvoiceTransaction } from "../../infrastructure/billing/postgresBillingDraftInvoiceTransaction.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";

const queries: Array<Readonly<{ text: string; values: readonly unknown[] }>> = [];
let invoiceReads = 0;
let invoiceInserts = 0;
const client = {
  async query<T>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    queries.push({ text, values });
    if (text.includes("SELECT id,invoice_state")) {
      invoiceReads += 1;
      return {
        rows: invoiceReads === 3
          ? [{ id: "invoice-a", invoice_state: "draft", source_sales_state_token: "1", synchronization_version: "1" }] as T[]
          : [],
      };
    }
    if (text.includes("SELECT tax_composition,commercial_charge")) return { rows: [] };
    if (text.includes("INSERT INTO v2_billing_invoices")) {
      invoiceInserts += 1;
      return { rows: invoiceInserts === 1 ? [{ id: "invoice-a", synchronization_version: "1" }] as T[] : [] };
    }
    return { rows: [] };
  },
};

const organizationId = brandedId<"OrganizationId">("organization-a");
const transaction = new PostgresBillingDraftInvoiceTransaction(client as never);
const input = {
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
} as const;

const created = await transaction.createDraftInvoice(input);
const replayedAfterConflict = await transaction.createDraftInvoice(input);

const invoiceInsert = queries.find(({ text }) => text.includes("INSERT INTO v2_billing_invoices"));
assert(invoiceInsert, "Draft Invoice creation must persist an Invoice header.");
assert.equal(created.status, "created", "the canonical base draft is created once");
assert.equal(replayedAfterConflict.status, "unchanged", "a concurrent primary-draft conflict resolves to the canonical existing draft");
assert.equal(replayedAfterConflict.invoiceId, "invoice-a", "the conflict arbiter returns the original base draft identity");
assert.equal(invoiceInserts, 2, "the test exercises the database conflict-arbiter fallback");
assert.match(invoiceInsert.text, /ON CONFLICT \(organization_id,sales_order_document_id\)\s+WHERE invoice_state='draft' AND replacement_obligation_id IS NULL/, "the base-draft writer exactly targets the 0285 primary-draft partial index");
assert.equal(invoiceInsert.values[17], null, "an absent commercial charge must bind SQL NULL, never JSON null");
assert.equal(invoiceInsert.values[18], null, "an absent tax composition must bind SQL NULL, never JSON null");
console.log("[billing-draft-invoice] primary-draft conflict arbiter and optional JSON fields preserve canonical semantics.");
