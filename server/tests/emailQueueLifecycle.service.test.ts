import { beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";

const returning = jest.fn(), selectRows = jest.fn();
const patches: any[] = [], predicates: any[] = [];
const update = jest.fn(() => ({ set: (patch: any) => { patches.push(patch); return { where: (condition: any) => {
  predicates.push(new PgDialect().sqlToQuery(condition));
  return { returning, then: (resolve: any) => Promise.resolve([]).then(resolve) };
} }; } }));
const select = jest.fn(() => ({ from: () => ({ where: () => ({ then: (resolve: any) => selectRows().then(resolve), orderBy: () => selectRows() }) }) }));
const dbMock = { update, select, execute: jest.fn(async () => ({ rows: [{ active: 0, failed: 0 }] })), transaction: async (callback: any) => callback(dbMock) };
jest.unstable_mockModule("../db", () => ({ db: dbMock }));
let cancel: typeof import("../services/emailQueueLifecycle.service").cancelEmailQueueJobs;
let supersede: typeof import("../services/emailQueueLifecycle.service").supersedePendingInvoiceJob;
beforeAll(async () => { ({ cancelEmailQueueJobs: cancel, supersedePendingInvoiceJob: supersede } = await import("../services/emailQueueLifecycle.service")); });
beforeEach(() => { patches.length = 0; predicates.length = 0; update.mockClear(); select.mockClear(); returning.mockReset(); selectRows.mockReset(); });

test("cancel preserves frozen metadata and failure history, with audit and a tenant/status guard", async () => {
  returning.mockResolvedValue([{ id: "job", campaignId: "campaign" }]);
  const result = await cancel({ organizationId: "org", userId: "staff", userName: "Dale", jobIds: ["job"], reason: "Duplicate" });
  expect(result.canceled).toEqual(["job"]);
  expect(predicates[0].params).toEqual(expect.arrayContaining(["org", "job", "queued", "retrying", "needs_review"]));
  expect(predicates[0].params).not.toContain("processing");
  expect(Object.keys(patches[0]).sort()).toEqual(["claimExpiresAt", "metadata", "status", "updatedAt"]);
  const metadata = new PgDialect().sqlToQuery(patches[0].metadata);
  expect(metadata.sql).toContain("coalesce"); expect(metadata.sql).toContain("||");
  expect(JSON.parse(metadata.params[0]).cancellation).toMatchObject({ canceledByUserId: "staff", canceledByUserName: "Dale", reason: "Duplicate" });
});
test("mixed bulk cancellation reports sent/processing/not-found rows and canceled no-ops", async () => {
  returning.mockResolvedValue([{ id: "queued", campaignId: "campaign" }, { id: "retry", campaignId: "campaign" }]);
  selectRows.mockResolvedValue([{ id: "sent", status: "sent" }, { id: "race", status: "processing" }, { id: "done", status: "canceled" }]);
  const result = await cancel({ organizationId: "org", userId: "staff", jobIds: ["queued", "retry", "sent", "race", "done", "missing"] });
  expect(result.canceled).toEqual(["queued", "retry"]); expect(result.alreadyCanceled).toEqual(["done"]);
  expect(result.skipped.map(row => row.status)).toEqual(["sent", "processing", "not_found"]);
});
test("empty selection never constructs an empty IN query", async () => {
  expect(await cancel({ organizationId: "org", userId: "staff", jobIds: [] })).toEqual({ canceled: [], alreadyCanceled: [], skipped: [] });
  expect(update).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
test("a worker winning the claim race cannot be overwritten by cancellation", async () => {
  returning.mockResolvedValue([]); selectRows.mockResolvedValue([{ id: "race", status: "processing" }]);
  const result = await cancel({ organizationId: "org", userId: "staff", jobIds: ["race"] });
  expect(result.canceled).toEqual([]); expect(result.skipped[0].reason).toMatch(/cannot safely cancel/);
});
test("supersession retains snapshots and conditionally terminalizes only pending rows", async () => {
  const old = { id: "old", organizationId: "org", invoiceId: "invoice", campaignId: "request", recipientKey: "billing@test", invoiceVersion: 1,
    createdAt: new Date("2026-09-20"), deliveryType: "invoice", status: "retrying", metadata: { subject: "Frozen", message: "Body", attachment: "keep" } };
  selectRows.mockResolvedValue([{ ...old, id: "new", status: "sent", createdAt: new Date("2026-09-21"), sentAt: new Date("2026-09-21"), providerMessageId: "provider" }]);
  returning.mockResolvedValue([{ id: "old" }]);
  expect(await supersede(dbMock as any, old as any)).toEqual({ id: "old" });
  expect(patches[0].status).toBe("superseded");
  expect(Object.keys(patches[0]).sort()).toEqual(["claimExpiresAt", "metadata", "status", "updatedAt"]);
  expect(predicates[0].params).toEqual(expect.arrayContaining(["org", "old", "queued", "retrying"]));
  expect(predicates[0].params).not.toContain("processing");
  returning.mockResolvedValue([]);
  expect(await supersede(dbMock as any, old as any)).toBeNull();
});
