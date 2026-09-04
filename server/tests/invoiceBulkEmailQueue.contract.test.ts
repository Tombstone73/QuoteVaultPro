import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("bulk invoice email delivery queue contract", () => {
  const route = source("server/routes/mvpInvoicing.routes.ts");
  const queue = source("server/services/invoiceBulkEmailQueue.service.ts");
  const server = source("server/index.ts");
  const migration = source("server/db/migrations_v2/0191_bulk_invoice_email_delivery_queue.sql");
  const retrySafetyMigration = source("server/db/migrations_v2/0192_invoice_email_delivery_retry_safety.sql");
  const client = source("client/src/pages/invoices.tsx");
  const v2Contracts = source("v2/src/modules/billing/contracts.ts");

  test("uses canonical recipient resolution for a bounded, tenant-scoped queue request", () => {
    const batchRoute = route.slice(route.indexOf('app.post("/api/invoices/batch-send"'));
    expect(batchRoute).toContain("requireOrgOwnerAdmin");
    expect(batchRoute).toContain("resolveInvoiceEmailRecipientsForOperations");
    expect(batchRoute).toContain("getBulkInvoiceEmailQueueConfig");
    expect(batchRoute).toContain("enqueueBulkInvoiceEmailCampaign");
    expect(batchRoute).toContain("dryRun");
    expect(batchRoute).not.toContain("await sendInvoiceEmailForOperations(");
  });

  test("keeps PDF, provider delivery, logs, and audit writes on the one canonical sender", () => {
    expect(route).toContain("registerCanonicalInvoiceEmailSender(sendInvoiceEmailForOperations)");
    expect(queue).toContain("canonicalInvoiceEmailSender");
    expect(queue).toContain("await canonicalInvoiceEmailSender");
    expect(route).toContain("generateInvoicePdfBytes");
    expect(route).toContain("createInvoicePdfEmailAttachment");
    expect(route).toContain("buildInvoiceEmailSentAudit");
  });

  test("persists one active job per invoice-recipient-version and claims it safely", () => {
    expect(migration).toContain("invoice_id varchar NOT NULL REFERENCES invoices(id)");
    expect(migration).toContain("invoice_version integer NOT NULL");
    expect(retrySafetyMigration).toContain("invoice_email_delivery_jobs_active_guard_uidx");
    expect(retrySafetyMigration).toContain("WHERE status IN ('queued', 'processing', 'retrying', 'needs_review')");
    expect(queue).toContain("FOR UPDATE SKIP LOCKED");
    expect(queue).toContain("pg_advisory_xact_lock");
    expect(queue).toContain("claim_expires_at");
    expect(queue).toContain("BULK_INVOICE_EMAIL_RATE_LIMIT");
  });

  test("keeps same-recipient invoices as independently durable messages", () => {
    expect(queue).toContain('deliveryMode: "individual_invoice_messages"');
    expect(queue).toContain('deliveryMode: "individual_invoice_message"');
    expect(migration).toContain("(organization_id, invoice_id, recipient_key, invoice_version)");
    expect(migration).not.toContain("  invoice_ids jsonb");
  });

  test("does not retry an ambiguous provider result automatically", () => {
    expect(queue).toContain('status: needsReview ? "needs_review"');
    expect(queue).toContain("Delivery outcome is uncertain. Review before retrying to avoid a duplicate email");
    expect(queue).toContain("getInvoiceEmailDeliveryFailureKind");
    expect(queue).toContain("isAmbiguousProviderFailure");
    expect(queue).toContain("maxAttempts");
  });

  test("bounds delivery attempts and converts expired processing claims to non-resend review failures", () => {
    expect(queue).toContain("attempt_count < max_attempts");
    expect(queue).toContain("SET status = 'needs_review', claim_expires_at = null");
    expect(queue).toContain("The message was not resent to avoid a duplicate email.");
    expect(queue).not.toContain("OR (status = 'processing' AND claim_expires_at <= now())");
  });

  test("permits a new explicit attempt after a retry-safe terminal failure but blocks active and ambiguous work", () => {
    expect(retrySafetyMigration).toContain("DROP INDEX IF EXISTS invoice_email_delivery_jobs_invoice_recipient_version_uidx");
    expect(queue).toContain('inArray(invoiceEmailDeliveryJobs.status, ["queued", "processing", "retrying", "needs_review"])');
    expect(route).toContain("Previous delivery needs review because the provider outcome is uncertain.");
  });

  test("keeps every invoice send entry point on the durable queue", () => {
    const directSendRoute = route.slice(route.indexOf('app.post("/api/invoices/:id/send"'), route.indexOf('app.post("/api/invoices/batch-send"'));
    expect(directSendRoute).toContain("enqueueBulkInvoiceEmailCampaign");
    expect(directSendRoute).toContain('req.get("Idempotency-Key") || randomUUID()');
    expect(directSendRoute).not.toContain("await sendInvoiceEmailForOperations(");
  });

  test("starts a healthy worker immediately and exposes durable queue state without treating it as Last Sent", () => {
    expect(server).toContain("void runBulkInvoiceEmailTick()");
    expect(queue).toContain("getInvoiceEmailDeliveryStates");
    expect(queue).toContain("invoiceEmailDeliveryJobs.failureReason");
    expect(queue).toContain("This deliberately describes the queue job, not");
  });

  test("exposes a bounded tenant-scoped read-only queue list without an unsafe retry mutation", () => {
    expect(route).toContain('app.get("/api/invoices/email-queue"');
    expect(route).toContain("listInvoiceEmailDeliveryJobs");
    expect(queue).toContain("InvoiceEmailQueueView");
    expect(queue).toContain("Math.min(100, input.pageSize)");
    expect(queue).toContain("eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId)");
    expect(route).not.toContain('app.post("/api/invoices/email-queue/retry"');
  });

  test("registers the concrete queue path before the generic invoice-id route", () => {
    expect(route.indexOf('app.get("/api/invoices/email-queue"')).toBeLessThan(route.indexOf('app.get("/api/invoices/:id"'));
  });

  test("gives the V1 operator a preflight confirmation and models the V2 shared boundary", () => {
    expect(client).toContain("dryRun: true");
    expect(client).toContain("window.confirm(confirmation)");
    expect(client).toContain("Emails will be queued and sent in a throttled background worker.");
    expect(v2Contracts).toContain("BulkInvoiceDeliveryPort");
    expect(v2Contracts).toContain("queueBulkInvoiceDelivery");
  });
});
