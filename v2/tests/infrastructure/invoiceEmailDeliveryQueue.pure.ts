import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queue = readFileSync("v2/infrastructure/communications/invoiceEmailDeliveryQueue.ts", "utf8");
const sender = readFileSync("v2/infrastructure/communications/invoiceEmailSender.ts", "utf8");
const migration = readFileSync("server/db/migrations_v2/0252_v2_invoice_email_delivery_queue.sql", "utf8");
const providerSafetyMigration = readFileSync("server/db/migrations_v2/0255_v2_invoice_email_provider_attempt_safety.sql", "utf8");
const routes = readFileSync("v2/src/interfaces/http/invoiceRoutes.ts", "utf8");
const finance = readFileSync("v2/ui/src/FinanceWorkspace.tsx", "utf8");

// Admission is bounded, tenant-scoped, de-duplicates submitted IDs, and has
// no provider call on its route. Recipient planning belongs to the sender.
assert.match(queue, /invoiceEmailSelectionLimit = 100/u);
assert.match(queue, /new Set\(values\.map/u);
assert.match(queue, /this\.sender\.plan\(organizationId,allowed\)/u, "the scheduler delegates recipient expansion to the canonical sender");
assert.match(sender, /customer_contact_links/u, "the canonical sender resolves configured billing and primary recipients");
assert.match(sender, /recipient.*invoiceIds/u, "the canonical sender owns recipient delivery plans");
assert.match(queue, /invoiceEmailScheduleSpacingMs = 60_000/u, "each queued message has a durable one-minute scheduled offset");
assert.match(queue, /available_at\) VALUES[\s\S]*availableAt/u, "the scheduled time is persisted with the job");
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
assert.match(queue, /state IN \('queued','retry_wait'\)/u);
assert.doesNotMatch(queue, /state IN \('queued','retry_wait','ambiguous'\)/u, "ambiguous delivery is never automatically claimed for a new send");
assert.match(queue, /provider_attempted_at=now\(\)/u, "the provider boundary is durable before Gmail is called");
assert.match(queue, /state=\$3::varchar/u, "the worker completion update explicitly types its state parameter before reuse in settlement cases");
assert.match(queue, /CASE WHEN \$3::varchar='sent'/u, "completion state comparisons reuse the explicit database type rather than relying on PostgreSQL parameter inference");
assert.match(queue, /lease_expires_at<=now\(\) AND provider_attempted_at IS NOT NULL/u, "expired provider attempts become ambiguous instead of being sent again");
assert.match(sender, /timeout:30_000/u, "a hung provider call resolves to the existing ambiguous outcome");
assert.match(queue, /provider_attempted_at=NULL/u, "an operator retry starts a new intentional provider attempt");
assert.match(providerSafetyMigration, /ADD COLUMN provider_attempted_at/u);
assert.match(providerSafetyMigration, /WHERE state='processing'/u, "pre-marker in-flight jobs are conservatively held for reconciliation");

// Operators get a bounded selection and admission confirmation rather than a
// browser-side send loop. Customer links retain normal portal authentication.
assert.match(finance, /Select visible invoices/u);
assert.match(finance, /Send selected/u);
assert.match(finance, /Queue email delivery/u);
assert.match(finance, /emailAdmissionError/u);
assert.match(finance, /emailAdmission\.queuedInvoices/u);
assert.match(finance, /emailInvoiceIds/u);
assert.match(sender, /\/portal\/invoices\/\$\{encodeURIComponent/u);
assert.match(sender, /"\/portal\/invoices"/u);
assert.doesNotMatch(sender, /[?&](token|secret)=/iu);
assert.match(queue, /this\.sender\.send\(/u, "the worker invokes the one canonical direct sender");
assert.doesNotMatch(queue, /users\.messages\.send/u, "the scheduler never calls Gmail directly");
assert.doesNotMatch(queue, /rawMime/u, "the scheduler never constructs MIME");
assert.match(sender, /users\.messages\.send/u, "only the direct sender reaches Gmail");
assert.match(sender, /invoice_email_sent/u, "the direct sender writes per-Invoice delivery audit");

console.log("V2 invoice email queue contract tests passed.");
