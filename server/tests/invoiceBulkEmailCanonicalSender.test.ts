import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { invoiceEmailLogs } from "../../shared/schema";

const selectLimit = jest.fn();
const selectWhere = jest.fn(() => ({ limit: selectLimit }));
const selectFrom = jest.fn(() => ({ where: selectWhere }));
const select = jest.fn(() => ({ from: selectFrom }));
const updateWhere = jest.fn(async () => []);
const updateSet = jest.fn(() => ({ where: updateWhere }));
const update = jest.fn(() => ({ set: updateSet }));
const execute = jest.fn(async () => ({ rows: [{ active: 0, failed: 0 }] }));

jest.unstable_mockModule("../db", () => ({ db: { select, update, execute } }));

let registerCanonicalInvoiceEmailSender: typeof import("../services/invoiceBulkEmailQueue.service").registerCanonicalInvoiceEmailSender;
let registerCanonicalCustomerStatementEmailSender: typeof import("../services/invoiceBulkEmailQueue.service").registerCanonicalCustomerStatementEmailSender;
let processClaimedBulkInvoiceEmailJob: typeof import("../services/invoiceBulkEmailQueue.service").processClaimedBulkInvoiceEmailJob;
let recordInvoiceEmailDeliveryStage: typeof import("../services/invoiceBulkEmailQueue.service").recordInvoiceEmailDeliveryStage;
let normalizeInvoiceEmailQueueTimestamp: typeof import("../services/invoiceBulkEmailQueue.service").normalizeInvoiceEmailQueueTimestamp;

beforeAll(async () => {
  ({ registerCanonicalInvoiceEmailSender, registerCanonicalCustomerStatementEmailSender, processClaimedBulkInvoiceEmailJob, recordInvoiceEmailDeliveryStage, normalizeInvoiceEmailQueueTimestamp } = await import("../services/invoiceBulkEmailQueue.service"));
});

describe("bulk invoice email canonical sender boundary", () => {
  beforeEach(() => {
    select.mockClear();
    selectFrom.mockClear();
    selectWhere.mockClear();
    selectLimit.mockReset().mockResolvedValue([]);
    update.mockClear();
    updateSet.mockClear();
    updateWhere.mockClear();
    execute.mockClear();
  });

  test("uses the registered canonical direct-send service for a claimed bulk job", async () => {
    const canonicalSender = jest.fn(async () => ({ messageId: "gmail-message-1" }));
    registerCanonicalInvoiceEmailSender(canonicalSender);

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-1",
      organizationId: "org-1",
      invoiceId: "invoice-1",
      recipientEmail: "customer@example.test",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-09-04T16:00:00.000Z"),
      campaignId: "campaign-1",
      metadata: { createdByUserId: "user-1" },
    })).resolves.toBe("sent");

    expect(canonicalSender).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      invoiceId: "invoice-1",
      userId: "user-1",
      toEmail: "customer@example.test",
      deliveryJobId: "job-1",
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", providerMessageId: "gmail-message-1" }));
  });

  test("normalizes a raw claimed timestamp before Drizzle checks durable send evidence", async () => {
    // PostgreSQL raw SQL may return this as an ISO string. Drizzle's timestamp
    // mapper requires a Date and otherwise throws `value.toISOString is not a
    // function` before the canonical sender can run.
    const queuedAt = normalizeInvoiceEmailQueueTimestamp("2026-09-20T21:01:00.000Z", "createdAt");
    expect(queuedAt).toBeInstanceOf(Date);
    expect((invoiceEmailLogs.sentAt as any).mapToDriverValue(queuedAt)).toBe("2026-09-20T21:01:00.000Z");

    const canonicalSender = jest.fn(async () => ({ messageId: "gmail-message-from-raw-timestamp" }));
    registerCanonicalInvoiceEmailSender(canonicalSender);

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-raw-created-at",
      organizationId: "org-1",
      invoiceId: "invoice-1",
      recipientEmail: "customer@example.test",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: "2026-09-20T21:01:00.000Z",
      campaignId: "campaign-raw-created-at",
    })).resolves.toBe("sent");

    expect(canonicalSender).toHaveBeenCalledTimes(1);
  });

  test("delivers a frozen customer statement through the same durable worker", async () => {
    const statementSender = jest.fn(async () => ({ messageId: "statement-message-1" }));
    registerCanonicalCustomerStatementEmailSender(statementSender);

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "statement-job-1",
      organizationId: "org-1",
      invoiceId: null,
      deliveryType: "customer_statement",
      customerStatementSnapshotId: "statement-snapshot-1",
      recipientEmail: "billing@example.test",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-09-04T16:00:00.000Z"),
      campaignId: "campaign-statement-1",
      metadata: { createdByUserId: "user-1" },
    })).resolves.toBe("sent");

    expect(statementSender).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      statementSnapshotId: "statement-snapshot-1",
      toEmail: "billing@example.test",
      deliveryJobId: "statement-job-1",
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", providerMessageId: "statement-message-1" }));
  });

  test("preserves the operator-authored message and actor on a durable retry", async () => {
    const canonicalSender = jest.fn(async () => ({ messageId: "gmail-message-2" }));
    registerCanonicalInvoiceEmailSender(canonicalSender);

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-2",
      organizationId: "org-1",
      invoiceId: "invoice-1",
      recipientEmail: "customer@example.test",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-09-04T16:00:00.000Z"),
      campaignId: "campaign-2",
      metadata: {
        createdByUserId: "user-1",
        createdByUserName: "Dale",
        subject: "Corrected invoice",
        message: "Please use this revision.",
      },
    })).resolves.toBe("sent");

    expect(canonicalSender).toHaveBeenCalledWith(expect.objectContaining({
      userName: "Dale",
      subject: "Corrected invoice",
      message: "Please use this revision.",
    }));
  });

  test("uses durable success evidence instead of resending after a worker recovery", async () => {
    // The worker may perform additional durable lookup reads as its delivery
    // types grow; every lookup in this recovery test represents prior success.
    selectLimit.mockResolvedValue([{ id: "email-log-1", messageId: "gmail-existing" }]);
    const canonicalSender = jest.fn(async () => ({ messageId: "must-not-send" }));
    registerCanonicalInvoiceEmailSender(canonicalSender);

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-recovered",
      organizationId: "org-1",
      invoiceId: "invoice-1",
      recipientEmail: "customer@example.test",
      attemptCount: 2,
      maxAttempts: 3,
      createdAt: new Date("2026-09-04T16:00:00.000Z"),
      campaignId: "campaign-1",
    })).resolves.toBe("sent");

    expect(canonicalSender).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", providerMessageId: "gmail-existing" }));
  });

  test("never records a retryable provider failure as sent", async () => {
    const retryable = Object.assign(new Error("Gmail rejected the request"), { invoiceEmailDeliveryFailureKind: "retryable" });
    registerCanonicalInvoiceEmailSender(jest.fn(async () => { throw retryable; }));

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-retry",
      organizationId: "org-1",
      invoiceId: "invoice-1",
      recipientEmail: "customer@example.test",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-09-04T16:00:00.000Z"),
      campaignId: "campaign-1",
    })).resolves.toBe("failed");

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "retrying" }));
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  test("holds an uncertain provider outcome for review instead of retrying a possible send", async () => {
    execute.mockResolvedValueOnce({ rows: [{ metadata: { queueStage: "provider_submitting" } }] });
    const uncertain = Object.assign(new Error("network timeout after provider submission"), {
      invoiceEmailDeliveryFailureKind: "needs_review",
    });
    registerCanonicalInvoiceEmailSender(jest.fn(async () => { throw uncertain; }));

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-review",
      organizationId: "org-1",
      invoiceId: "invoice-1",
      recipientEmail: "customer@example.test",
      attemptCount: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-09-04T16:00:00.000Z"),
      campaignId: "campaign-1",
    })).resolves.toBe("failed");

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "needs_review" }));
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  test("treats a PDF preparation timeout as retryable because the provider was never contacted", async () => {
    registerCanonicalInvoiceEmailSender(jest.fn(async () => { throw new Error("Invoice PDF generation timed out before the email provider was contacted."); }));
    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-pdf-timeout", organizationId: "org-1", invoiceId: "invoice-1", recipientEmail: "customer@example.test", attemptCount: 1, maxAttempts: 3, createdAt: new Date("2026-09-04T16:00:00.000Z"), campaignId: "campaign-timeout",
    })).resolves.toBe("failed");
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "retrying" }));
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "needs_review" }));
  });

  test("retains the last canonical sender stage with a retryable pre-provider failure", async () => {
    execute.mockResolvedValueOnce({ rows: [{ metadata: { queueStage: "preparing", lastStage: "invoice_pdf_generation_started" } }] });
    registerCanonicalInvoiceEmailSender(jest.fn(async () => {
      throw new Error("Invoice PDF generation timed out before the email provider was contacted.");
    }));

    await expect(processClaimedBulkInvoiceEmailJob({
      id: "job-stage", organizationId: "org-1", invoiceId: "invoice-1", recipientEmail: "customer@example.test", attemptCount: 1, maxAttempts: 3, createdAt: new Date("2026-09-04T16:00:00.000Z"), campaignId: "campaign-stage",
    })).resolves.toBe("failed");

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "retrying",
      failureReason: expect.stringContaining("invoice_pdf_generation_started"),
    }));
  });

  test("records concrete canonical sender stages on the durable processing job", async () => {
    await recordInvoiceEmailDeliveryStage({ organizationId: "org-1", deliveryJobId: "job-stage-write", stage: "invoice_attachment_preparation_completed" });
    expect(execute).toHaveBeenCalled();
  });
});
