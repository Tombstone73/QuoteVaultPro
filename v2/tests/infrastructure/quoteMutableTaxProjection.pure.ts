import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { PostgresQuoteTransaction } from "../../infrastructure/sales/postgresQuoteTransaction.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const organizationId = brandedId<"OrganizationId">("org-a");
const quoteId = brandedId<"QuoteId">("quote-a");

const storedUnresolved = {
  status: "unresolved" as const,
  calculatorVersion: "v2-sales-receipt-jurisdiction-v1" as const,
  reason: "tax_jurisdiction_not_configured" as const,
  finalTotalCents: 1063,
};

const makeClient = (input: Readonly<{
  deliveryState: "not_sent" | "sent";
  pendingDelivery?: boolean;
}>) => {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes("FROM v2_sales_documents d JOIN v2_sales_quote_details q"))
        return { rows: [{
          id: quoteId, organization_id: organizationId, business_number: "1016", display_number: "QT-1016",
          customer_id: "customer-a", contact_id: "contact-a", purchase_order_number: null, requested_due_date: null,
          currency: "USD", terms_json: { termsCode: "NET 30 QA" }, tax_context_reference: null,
          sales_representative_id: null, commercial_notes: null, revision: "7", expires_at: null,
          delivery_state: input.deliveryState, acceptance_state: "not_accepted", lifecycle_state: "open",
          requested_fulfillment_method: "pickup", requested_destination: null, fulfillment_instructions: null,
          selling_adjustment_cents: "0", selling_adjustment_reason: null, commercial_charge: null,
          tax_composition: storedUnresolved,
        }] };
      if (text.includes("FROM v2_sales_document_lines"))
        return { rows: [{
          id: "line-a", product_id: "product-a", product_type_id: null, description: "QA Banner", quantity: 1,
          calculated_line_cents: "1063", selling_line_cents: "1063", resolved_configuration: {},
          pricing_result: { currency: "USD", normalizedInput: { quantity: 1 } },
          selling_price_decision: { kind: "calculated" }, taxability_snapshot: { taxable: true },
        }] };
      if (text.includes("FROM v2_sales_quote_checkpoints")) return { rows: [] };
      if (text.includes("FROM v2_sales_quote_conversions")) return { rows: [] };
      if (text.includes("FROM v2_sales_quote_delivery_attempts")) return { rows: [{ exists: input.pendingDelivery === true }] };
      if (text.includes("FROM v2_sales_tax_jurisdictions"))
        return { rows: [{
          id: "indiana", name: "Indiana Sales Tax", country_code: "US", region_code: "INDIANA",
          postal_code: null, rate_basis_points: 700, active: true, home_business: true,
        }] };
      if (text.includes("FROM customers"))
        return { rows: [{ is_tax_exempt: false, tax_exempt_reason: null, tax_exempt_certificate_ref: null }] };
      throw new Error(`Unexpected query: ${text}`);
    },
  } as unknown as PoolClient;
  return { client, queries };
};

{
  const { client, queries } = makeClient({ deliveryState: "not_sent" });
  const read = await new PostgresQuoteTransaction(client).read(organizationId, quoteId);
  assert.equal(read?.quote.taxComposition?.status, "resolved", "an open Quote must derive the newly configured Pickup jurisdiction without an edit");
  assert.equal(read?.quote.taxComposition?.taxCents, 74, "tax must use the canonical 7% integer-cent composition");
  assert.equal(read?.quote.taxComposition?.finalTotalCents, 1137, "fresh tax must be included in the server projection");
  assert.ok(queries.some((query) => query.includes("FROM v2_sales_tax_jurisdictions")), "mutable projection must read current tenant settings");
  assert.ok(queries.every((query) => /^\s*SELECT\b/i.test(query)), "GET projection must not issue persistence statements");
}

{
  const { client, queries } = makeClient({ deliveryState: "sent" });
  const read = await new PostgresQuoteTransaction(client).read(organizationId, quoteId);
  assert.deepEqual(read?.quote.taxComposition, storedUnresolved, "a sent Quote must use its frozen stored composition rather than current Settings");
  assert.ok(!queries.some((query) => query.includes("v2_sales_tax_jurisdictions")), "historical Quote reads must not dynamically compose tax");
}

{
  const { client, queries } = makeClient({ deliveryState: "not_sent", pendingDelivery: true });
  const read = await new PostgresQuoteTransaction(client).read(organizationId, quoteId);
  assert.deepEqual(read?.quote.taxComposition, storedUnresolved, "the pending customer-document preparation must remain pinned until it becomes sent or fails");
  assert.ok(!queries.some((query) => query.includes("v2_sales_tax_jurisdictions")), "a pending delivery must not recompose after provider preparation");
}

console.log("Mutable Quote tax projection contracts passed.");
