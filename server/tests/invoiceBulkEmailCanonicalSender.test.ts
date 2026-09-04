import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

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
let processClaimedBulkInvoiceEmailJob: typeof import("../services/invoiceBulkEmailQueue.service").processClaimedBulkInvoiceEmailJob;

beforeAll(async () => {
  ({ registerCanonicalInvoiceEmailSender, processClaimedBulkInvoiceEmailJob } = await import("../services/invoiceBulkEmailQueue.service"));
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

    expect(canonicalSender).toHaveBeenCalledWith({
      organizationId: "org-1",
      invoiceId: "invoice-1",
      userId: "user-1",
      toEmail: "customer@example.test",
      deliveryJobId: "job-1",
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", providerMessageId: "gmail-message-1" }));
  });
});
