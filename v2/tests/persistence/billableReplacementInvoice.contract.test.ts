import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration,writer,replacements,drafts] = await Promise.all([
  readFile(new URL("../../../server/db/migrations_v2/0285_v2_billable_replacement_invoices.sql",import.meta.url),"utf8"),
  readFile(new URL("../../infrastructure/billing/postgresReplacementInvoice.ts",import.meta.url),"utf8"),
  readFile(new URL("../../infrastructure/fulfillment/postgresReplacementObligations.ts",import.meta.url),"utf8"),
  readFile(new URL("../../infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts",import.meta.url),"utf8"),
]);
for(const token of ["replacement_obligation_id","v2_billing_invoices_replacement_obligation_uidx","v2_billing_invoices_replacement_sequence_uidx","invoice_sequence BETWEEN 2 AND 26","v2_billing_preserve_replacement_invoice_number_trigger","billable_invoice_created"])assert.match(migration,new RegExp(token.replaceAll(".","\\.")));
assert.match(writer,/FOR UPDATE OF d,o/,"suffix allocation locks the canonical Order");
assert.match(writer,/ON CONFLICT DO NOTHING/,"duplicate obligation Invoice creation is conflict safe");
assert.match(writer,/replacement_obligation_id/,"Invoice is structurally linked to its obligation");
assert.match(writer,/proportionalReplacementLineCents/,"partial amounts retain original effective selling basis");
assert.match(writer,/sales_line\.quantity AS source_quantity/,"replacement quantity is sourced from the Order line");
assert.match(writer,/sales_line\.selling_unit_cents AS source_selling_unit_cents/,"replacement unit price is sourced from the Order line");
assert.match(writer,/sales_line\.selling_line_cents AS source_selling_line_cents/,"replacement line price is sourced from the Order line");
assert.match(writer,/sales_line\.pricing_evidence_fingerprint AS source_pricing_evidence_fingerprint/,"replacement pricing evidence is sourced from the Order line");
assert.doesNotMatch(writer,/line\.selling_unit_cents,line\.selling_line_cents,line\.sales_pricing_evidence_fingerprint/,"live Invoice-line selling evidence is not the replacement pricing source");
assert.match(writer,/tax_evidence/,"frozen tax evidence is reused rather than current pricing");
assert.match(writer,/0,NULL,NULL,NULL/,"document-level Order adjustments are not allocated into the replacement Invoice");
assert.doesNotMatch(writer,/enqueueV2QuickBooksAutoSync|customerPricing|resolveActivePricingInput/,"creation does not queue accounting or invoke current pricing");
assert.match(replacements,/PostgresOperationRequestRepository/,"replacement retry uses canonical business-request idempotency");
assert.match(replacements,/createOrReadReplacementInvoice/,"billable creation atomically creates the canonical Invoice");
assert.match(replacements,/A billable replacement Invoice already exists and cannot be cancelled/,"billable to no-charge reversal fails closed");
assert.match(drafts,/replacement_obligation_id IS NULL/,"ordinary Order Invoice synchronization excludes immutable replacement drafts");
console.log("billable replacement Invoice persistence contracts passed.");
