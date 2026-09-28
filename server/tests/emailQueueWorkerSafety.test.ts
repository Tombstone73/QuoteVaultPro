import { beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
const statements: string[] = [];
const execute = jest.fn(async (query: any) => {
  const text = new PgDialect().sqlToQuery(query).sql; statements.push(text);
  // The queue contains terminal history only; the actual predicates must not
  // include those rows in claim or expired-lease recovery.
  return { rows: [], rowCount: 0 };
});
const mockDb = { execute, transaction: async (fn: any) => fn(mockDb) };
jest.unstable_mockModule("../db", () => ({ db: mockDb }));
let worker: typeof import("../services/invoiceBulkEmailQueue.service").runBulkInvoiceEmailQueueWorker;
let providerBoundary: typeof import("../services/invoiceBulkEmailQueue.service").markInvoiceEmailDeliveryProviderSubmissionStarted;
beforeAll(async () => { ({ runBulkInvoiceEmailQueueWorker: worker, markInvoiceEmailDeliveryProviderSubmissionStarted: providerBoundary } = await import("../services/invoiceBulkEmailQueue.service")); });
beforeEach(() => { statements.length = 0; execute.mockClear(); });
test("claim and recovery positively restrict states, excluding canceled/superseded history", async () => {
  expect(await worker()).toEqual({ processed: 0, sent: 0, failed: 0 });
  expect(statements[0]).toContain("WHERE status = 'processing' AND claim_expires_at <= now()");
  expect(statements[1]).toContain("WHERE status IN ('queued', 'retrying')");
  expect(statements[1]).toContain("attempt_count < max_attempts");
  expect(statements[1]).toContain("FOR UPDATE SKIP LOCKED");
});
test("a canceled or superseded job cannot cross the provider boundary after an expired claim", async () => {
  await expect(providerBoundary({ organizationId: "org", deliveryJobId: "canceled-job" })).rejects.toThrow("provider submission stopped");
  expect(statements[0]).toContain("AND status = 'processing'");
  expect(statements[0]).toContain("RETURNING id");
});
