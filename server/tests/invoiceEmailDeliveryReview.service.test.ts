import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const execute = jest.fn();
const insertedValues: Array<Record<string, unknown>> = [];
const updatedValues: Array<Record<string, unknown>> = [];

const valuesReturning = (result: unknown) => ({
  values: jest.fn((value: Record<string, unknown>) => {
    insertedValues.push(value);
    return { returning: jest.fn(async () => [result]) };
  }),
});

const tx = {
  execute,
  insert: jest.fn(),
  update: jest.fn(() => ({
    set: jest.fn((value: Record<string, unknown>) => {
      updatedValues.push(value);
      return { where: jest.fn(async () => []) };
    }),
  })),
};

jest.unstable_mockModule("../db", () => ({
  db: { transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) },
}));

let resolveInvoiceEmailDeliveryNeedsReview: typeof import("../services/invoiceBulkEmailQueue.service").resolveInvoiceEmailDeliveryNeedsReview;

beforeAll(async () => {
  ({ resolveInvoiceEmailDeliveryNeedsReview } = await import("../services/invoiceBulkEmailQueue.service"));
});

const lockedNeedsReviewJob = () => ({
  id: "needs-review-job",
  organizationId: "org-1",
  campaignId: "campaign-old",
  invoiceId: "invoice-1",
  invoiceVersion: 2,
  recipientEmail: "customer@example.test",
  recipientKey: "customer@example.test",
  status: "needs_review",
  attemptCount: 3,
  maxAttempts: 3,
  failureReason: "Delivery outcome is uncertain.",
  metadata: {},
});

describe("invoice email needs-review resolution", () => {
  beforeEach(() => {
    execute.mockReset();
    tx.insert.mockReset();
    tx.update.mockClear();
    insertedValues.splice(0);
    updatedValues.splice(0);
  });

  test("locks a needs-review row, preserves it as failed, and clears the block without sending or queueing", async () => {
    execute.mockResolvedValueOnce({ rows: [lockedNeedsReviewJob()] });

    const result = await resolveInvoiceEmailDeliveryNeedsReview({
      organizationId: "org-1",
      jobId: "needs-review-job",
      reviewedByUserId: "user-1",
      reviewedByUserName: "Dale",
    });

    expect(result).toMatchObject({ originalJobId: "needs-review-job", replayed: false, replacementJob: null });
    expect(updatedValues[0]).toMatchObject({ status: "failed" });
    expect(updatedValues[0]).toMatchObject({ metadata: { deliveryReview: expect.objectContaining({ resolution: "verified_not_sent", reviewedByUserId: "user-1", replacementJobId: null }) } });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  test("creates one fresh queued replacement only when the operator explicitly chooses Retry through Queue", async () => {
    execute.mockResolvedValueOnce({ rows: [lockedNeedsReviewJob()] });
    tx.insert
      .mockReturnValueOnce(valuesReturning({ id: "campaign-retry" }))
      .mockReturnValueOnce(valuesReturning({ id: "replacement-job", status: "queued", attemptCount: 0, maxAttempts: 3 }));

    const result = await resolveInvoiceEmailDeliveryNeedsReview({ organizationId: "org-1", jobId: "needs-review-job", retryThroughQueue: true });

    expect(result).toMatchObject({ originalJobId: "needs-review-job", replayed: false, replacementJob: { id: "replacement-job", status: "queued", attemptCount: 0 } });
    expect(insertedValues[1]).toMatchObject({ status: "queued", attemptCount: 0, invoiceId: "invoice-1", recipientEmail: "customer@example.test" });
    expect(insertedValues[1]).not.toHaveProperty("sentAt");
  });

  test("keeps the 409 guard for a row that genuinely is not awaiting review", async () => {
    execute.mockResolvedValueOnce({ rows: [{ ...lockedNeedsReviewJob(), status: "failed" }] });

    await expect(resolveInvoiceEmailDeliveryNeedsReview({ organizationId: "org-1", jobId: "needs-review-job" }))
      .rejects.toMatchObject({ statusCode: 409, message: "This delivery is no longer awaiting operator review" });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("selects the persisted status in the locked row rather than inferring it", () => {
    const source = readFileSync(path.join(process.cwd(), "server/services/invoiceBulkEmailQueue.service.ts"), "utf8");
    const resolver = source.slice(source.indexOf("export async function resolveInvoiceEmailDeliveryNeedsReview"), source.indexOf("type ClaimedJob"));
    expect(resolver).toContain('recipient_email AS "recipientEmail", recipient_key AS "recipientKey",\n             status,');
    expect(resolver).toContain('original.status !== "needs_review"');
  });
});
