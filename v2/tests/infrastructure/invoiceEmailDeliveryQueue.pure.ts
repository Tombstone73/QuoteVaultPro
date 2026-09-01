import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queue = readFileSync("v2/infrastructure/communications/invoiceEmailDeliveryQueue.ts", "utf8");
const migration = readFileSync("server/db/migrations_v2/0252_v2_invoice_email_delivery_queue.sql", "utf8");
const routes = readFileSync("v2/src/interfaces/http/invoiceRoutes.ts", "utf8");
const finance = readFileSync("v2/ui/src/FinanceWorkspace.tsx", "utf8");

// Admission is bounded, tenant-scoped, de-duplicates submitted IDs, groups
// only exact normalized addresses, and has no provider call on its route.
assert.match(queue, /invoiceEmailSelectionLimit = 100/u);
assert.match(queue, /new Set\(input\.invoiceIds/u);
assert.match(queue, /i\.organization_id=\$1 AND i\.id=ANY/u);
assert.match(queue, /recipient=row\.email\?normalize\(row\.email\)/u);
assert.match(queue, /grouped\.get\(recipient\)/u);
assert.match(queue, /invoiceEmailMessageInvoiceLimit = 20/u);
assert.match(routes, /emailDelivery\.admit/u);
assert.doesNotMatch(routes, /gmail|users\.messages\.send/u);

// Durable state, exclusive claims, lease recovery, and intentional ambiguity
// are database-owned rather than browser timing or invoice financial state.
assert.match(migration, /v2_invoice_email_delivery_jobs/u);
assert.match(migration, /'queued','processing','retry_wait','sent','failed','ambiguous'/u);
assert.match(migration, /v2_invoice_email_delivery_items/u);
assert.match(queue, /FOR UPDATE SKIP LOCKED/u);
assert.match(queue, /lease_expires_at<=now\(\)/u);
assert.match(queue, /v2_invoice_email_delivery_rate_limits/u);
assert.match(queue, /V2_INVOICE_EMAIL_DELIVERY_MAX_ATTEMPTS/u);
assert.match(queue, /providerAttempted\?this\.providerState/u);
assert.match(queue, /return "ambiguous"/u);
assert.doesNotMatch(queue, /state='ambiguous'.*available_at/isu);

// Operators get a bounded selection and admission confirmation rather than a
// browser-side send loop. Customer links retain normal portal authentication.
assert.match(finance, /Select visible invoices/u);
assert.match(finance, /Send selected/u);
assert.match(finance, /Queue email delivery/u);
assert.match(queue, /\/portal\/invoices\/\$\{encodeURIComponent/u);
assert.match(queue, /"\/portal\/invoices"/u);
assert.doesNotMatch(queue, /[?&](token|secret)=/iu);

console.log("V2 invoice email queue contract tests passed.");
