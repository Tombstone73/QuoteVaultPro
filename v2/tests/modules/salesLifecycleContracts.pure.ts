import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = async (relative: string) => readFile(path.join(root, relative), "utf8");

const [deliveryMigration, terminalMigration, quoteApplication, conversion, orderApplication, orderTransaction, delivery, documents] = await Promise.all([
  source("server/db/migrations_v2/0229_v2_sales_customer_delivery_evidence.sql"),
  source("server/db/migrations_v2/0230_v2_quote_terminal_lifecycle.sql"),
  source("v2/src/modules/sales/quoteApplication.ts"),
  source("v2/src/modules/sales/quoteConversionApplication.ts"),
  source("v2/src/modules/sales/orderApplication.ts"),
  source("v2/infrastructure/sales/postgresOrderTransaction.ts"),
  source("v2/infrastructure/sales/postgresQuoteDelivery.ts"),
  source("v2/infrastructure/sales/postgresCustomerDocuments.ts"),
]);

assert.match(deliveryMigration, /delivery_state IN \('pending','succeeded','failed','uncertain'\)/);
assert.match(deliveryMigration, /one_success_uidx/);
assert.match(deliveryMigration, /operation_uidx UNIQUE/);
assert.match(terminalMigration, /lifecycle_state IN \('open','declined','voided'\)/);

assert.match(quoteApplication, /async recordDelivered\(/);
assert.match(quoteApplication, /Provider delivery evidence is required/);
assert.match(quoteApplication, /current\.quote\.lifecycleState !== "open"/);
assert.match(quoteApplication, /async decline\(/);
assert.match(quoteApplication, /async void\(/);
assert.match(conversion, /current\.quote\.lifecycleState !== "open"/);

assert.match(delivery, /quoteRecipient(?:InTransaction)?\(/);
assert.match(delivery, /freezeTaxComposition\(/);
assert.match(delivery, /resolveOrderRoutability/);
assert.match(delivery, /routability: Readonly<\{ status: "ready" \| "unroutable"/);
const send = delivery.slice(delivery.indexOf("async send("), delivery.indexOf("private async prepare("));
const prepare = delivery.slice(delivery.indexOf("private async prepare("), delivery.indexOf("private async routability("));
assert.ok(send.indexOf("requireRoutability") < send.indexOf("integrations.requireReady"), "send must reject unroutable Product lines before email readiness/provider preparation");
assert.ok(send.indexOf("requireRoutability") < send.indexOf("this.prepare"), "send must reject unroutable Product lines before commercial freeze");
assert.ok(prepare.indexOf("requireRoutability") < prepare.indexOf("quoteInTransaction"), "the locked send preparation must recheck routability before PDF rendering");
assert.match(delivery, /quoteInTransaction\(/);
assert.match(delivery, /frozenTaxComposition: prepared\.frozenTaxComposition/);
assert.ok(
  delivery.indexOf("freezeTaxComposition(") < delivery.indexOf("quoteInTransaction(") &&
    delivery.indexOf("quoteInTransaction(") < delivery.indexOf("INSERT INTO v2_sales_quote_delivery_attempts"),
  "delivery must freeze tax, render the exact transactional customer document, then reserve its provider attempt",
);
assert.match(delivery, /markPermanentFailure/);
assert.match(delivery, /automatic retry is disabled/);
assert.match(delivery, /recordDelivered\(context, committed\)/);
assert.match(documents, /quoteRecipient\(/);
assert.match(documents, /salesConfigurationPresentation/);

assert.match(orderApplication, /A cancellation reason is required/);
assert.match(orderApplication, /cancellationBlockers/);
assert.match(orderApplication, /order_cancelled/);
for (const relation of ["v2_proof_works", "v2_prepress_units", "v2_production_works", "v2_fulfillment_handoffs", "v2_billing_invoices", "v2_billing_payments"])
  assert.match(orderTransaction, new RegExp(relation));

console.log("Sales lifecycle and customer-document contract tests passed.");
