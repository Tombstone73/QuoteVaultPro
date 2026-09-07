import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("server/db/migrations_v2/0270_v2_payment_allocation_aggregate.sql", "utf8");
const application = readFileSync("v2/src/modules/billing/paymentApplication.ts", "utf8");
const persistence = readFileSync("v2/infrastructure/billing/postgresBillingPaymentsTransaction.ts", "utf8");

assert.match(migration, /DROP CONSTRAINT IF EXISTS v2_billing_payment_allocations_payment_uidx/u);
assert.match(migration, /UNIQUE \(payment_id, invoice_id\)/u);
assert.match(migration, /allocation_intent jsonb/u);
assert.match(migration, /Payment allocation backfill found an ambiguous historic Payment/u);
assert.match(application, /recordManualPaymentAllocations/u);
assert.match(application, /beginProviderPaymentAggregate/u);
assert.match(application, /confirmProviderPaymentAggregate/u);
assert.match(application, /A Payment may allocate to an Invoice only once/u);
assert.match(application, /All Payment allocations must belong to one Customer account/u);
assert.match(application, /All Payment allocations must use one currency/u);
assert.match(persistence, /recordPaymentAggregate/u);
assert.match(persistence, /confirmProviderPaymentAggregate/u);
assert.match(persistence, /Multi-invoice Payment refunds require allocation-aware reversal support/u);
assert.match(persistence, /for\(const allocation of allocations\).*v2_billing_payment_allocations/u);

console.log("V2 payment aggregate contracts passed.");
