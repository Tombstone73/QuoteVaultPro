import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const insertedValues: Array<Record<string, unknown>> = [];
const execute = jest.fn();
const insert = jest.fn();
const update = jest.fn();
const select = jest.fn();

const tx = {
  execute,
  insert,
  update,
  select,
};

jest.unstable_mockModule("../db", () => ({
  db: { transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) },
}));

let enqueueInteractiveInvoiceEmailCampaign: typeof import("../services/invoiceBulkEmailQueue.service").enqueueInteractiveInvoiceEmailCampaign;

beforeAll(async () => {
  ({ enqueueInteractiveInvoiceEmailCampaign } = await import("../services/invoiceBulkEmailQueue.service"));
});

function valuesReturning(result: unknown) {
  return {
    values: jest.fn((value: Record<string, unknown>) => {
      insertedValues.push(value);
      return {
        onConflictDoNothing: jest.fn(() => ({ returning: jest.fn(async () => [result]) })),
        returning: jest.fn(async () => [result]),
      };
    }),
  };
}

describe("interactive invoice email queue", () => {
  beforeEach(() => {
    insertedValues.splice(0);
    execute.mockReset();
    select.mockReset();
    update.mockReset();
    insert.mockReset();

    insert
      .mockReturnValueOnce(valuesReturning({ id: "campaign-interactive" }))
      .mockReturnValueOnce(valuesReturning({ id: "job-interactive" }));
    update.mockReturnValue({
      set: jest.fn(() => ({
        where: jest.fn(() => ({
          returning: jest.fn(async () => [{ id: "campaign-interactive" }]),
        })),
      })),
    });
  });

  test("persists an individual Send action as a queued job with content and actor evidence", async () => {
    const result = await enqueueInteractiveInvoiceEmailCampaign({
      organizationId: "org-1",
      createdByUserId: "user-1",
      createdByUserName: "Dale",
      invoiceId: "invoice-1",
      idempotencyKey: "browser-request-1",
      candidates: [{
        invoiceId: "invoice-1",
        invoiceVersion: 4,
        recipientEmail: "customer@example.test",
        subject: "Invoice #1004",
        message: "Thank you.",
      }],
    });

    expect(result).toMatchObject({ campaignId: "campaign-interactive", queued: 1, alreadyQueued: 0, replayed: false });
    expect(insertedValues[0]).toMatchObject({
      organizationId: "org-1",
      idempotencyKey: "interactive:browser-request-1",
      metadata: { deliveryMode: "interactive_invoice_message", createdByUserName: "Dale" },
    });
    expect(insertedValues[1]).toMatchObject({
      organizationId: "org-1",
      invoiceId: "invoice-1",
      invoiceVersion: 4,
      recipientEmail: "customer@example.test",
      metadata: {
        deliveryMode: "interactive_invoice_message",
        createdByUserId: "user-1",
        createdByUserName: "Dale",
        subject: "Invoice #1004",
        message: "Thank you.",
      },
    });
    expect(insertedValues[1]).not.toHaveProperty("sentAt");
    expect(insertedValues[1].availableAt).toBeInstanceOf(Date);
  });
});
