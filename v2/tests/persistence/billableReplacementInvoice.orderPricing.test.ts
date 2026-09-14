import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { createOrReadReplacementInvoice } from "../../infrastructure/billing/postgresReplacementInvoice.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

type Source = Readonly<{
  source_quantity: number;
  source_selling_unit_cents: string;
  source_selling_line_cents: string;
  source_pricing_evidence_fingerprint: string;
}>;

const source = (pricing: Source) => ({
  id: "base-invoice", customer_id: "customer", contact_id: null, purchase_order_number: null, currency: "USD", terms_code: "net30",
  tax_context_reference: null, tax_calculator_version: "tax-v1", tax_evidence: { status: "unresolved", calculatorVersion: "v2-sales-receipt-jurisdiction-v1", reason: "tax_jurisdiction_not_configured", finalTotalCents: 0 },
  source_sales_line_id: "order-line", product_id: "product", description: "Discounted override line", taxability_snapshot: { taxable: true },
  ...pricing,
});

const create = async (pricing: Source) => {
  const calls: ReadonlyArray<Readonly<{ sql: string; values: readonly unknown[] }>> = [];
  let replacementLine: readonly unknown[] | undefined;
  const client = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      (calls as Array<{ sql: string; values: readonly unknown[] }>).push({ sql, values });
      if (sql.includes("replacement_obligation_id=$2 FOR UPDATE")) return { rows: [] };
      if (sql.includes("FROM v2_sales_documents d JOIN v2_sales_order_details")) return { rows: [{ id: "order", display_number: "ORD-100" }] };
      if (sql.includes("FROM v2_billing_invoices i")) return { rows: [source(pricing)] };
      if (sql.includes("SELECT invoice_sequence")) return { rows: [{ invoice_sequence: 1 }] };
      if (sql.includes("SELECT 1 FROM invoices")) return { rows: [] };
      if (sql.includes("INSERT INTO v2_billing_invoices(")) return { rows: [{ id: "replacement", invoice_display_number: "ORD-100-B", invoice_state: "draft", currency: "USD", total_cents: "2500" }] };
      if (sql.includes("INSERT INTO v2_billing_invoice_lines(")) { replacementLine = values; return { rows: [] }; }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as PoolClient;
  const result = await createOrReadReplacementInvoice(client, {
    organizationId: brandedId<"OrganizationId">("org"), orderId: brandedId<"OrderId">("order"), orderLineId: brandedId<"OrderLineId">("order-line"), replacementObligationId: brandedId<"ReplacementObligationId">("obligation"), replacementQuantity: 1,
  });
  return { calls, replacementLine, result };
};

// The live base Invoice could contain a stale $55.55 / 2-unit projection. The
// mocked source query exposes only the original Order line's $99.99 / 4-unit
// discounted-total evidence; the replacement must be $25.00, not $27.78.
const orderPricing = { source_quantity: 4, source_selling_unit_cents: "2500", source_selling_line_cents: "9999", source_pricing_evidence_fingerprint: "sha256:order-discount-override" } as const;
const priced = await create(orderPricing);
assert.equal(priced.result.totalCents, 2500, "replacement total uses the Order line's proportional total");
assert.equal(priced.replacementLine?.[9], 2500, "replacement preserves the Order line unit cents");
assert.equal(priced.replacementLine?.[10], 2500, "replacement proration uses the Order line quantity and total");
assert.equal(priced.replacementLine?.[11], "sha256:order-discount-override", "replacement preserves Order line override/discount evidence");
assert.match(priced.calls.find(call => call.sql.includes("INSERT INTO v2_billing_invoices("))!.sql, /0,NULL,NULL,NULL/, "document-level adjustments are not inherited or allocated");

await assert.rejects(
  () => create({ ...orderPricing, source_pricing_evidence_fingerprint: "   " }),
  /original Order line cannot safely price this replacement/,
  "missing Order-line pricing evidence fails closed before creating a replacement Invoice",
);
await assert.rejects(
  () => create({ ...orderPricing, source_selling_line_cents: "not-cents" }),
  /original Order line cannot safely price this replacement/,
  "invalid Order-line selling amounts fail closed",
);
console.log("billable replacement Invoice uses Order-line pricing evidence passed.");
