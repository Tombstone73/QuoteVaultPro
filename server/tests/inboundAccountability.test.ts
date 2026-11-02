import { describe, expect, jest, test } from "@jest/globals";
import { inboundEvidenceHarness as harness } from "./helpers/inboundEvidenceHarness";
import { inboundAccountabilityLabel, inboundIsPending, inboundQueueBucket } from "@shared/inboundAccountability";
import { eligibleForAutomaticInboundDraft } from "@shared/inboundEmailProcessing";
import { PgDialect } from "drizzle-orm/pg-core";
import { inboundParentOrderIdSql } from "../services/inboundOrders/inboundQueuePolicy";
import { InboundOrdersRepository } from "../storage/inboundOrders.repo";
jest.unstable_mockModule("../services/pricing/PricingService", () => ({ priceLineItem: jest.fn() }));
const { InboundOrderService } = await import("../services/inboundOrders/InboundOrderService");

const identity = { organizationId: "tenant-a", inboundRecordId: "email-1", actorUserId: "staff" };
const sourceEvent = { actorType: "user" as const, eventType: "email.thread_source_refreshed" };
async function changeEvidence(h: ReturnType<typeof harness>, text = "Revised request") {
  return h.repo.updateRecordWithEvent({ ...identity, patch: { rawPayloadJson: { subject: "Order", bodyText: text } }, event: sourceEvent });
}
async function dismissal(h: ReturnType<typeof harness>, fingerprint = h.fingerprint()) {
  return h.repo.updateRecordWithEvent({ ...identity, expectedEvidenceFingerprint: fingerprint,
    patch: { status: "ignored", reviewOutcome: "ignored", requiresHumanDecision: false },
    event: { actorType: "user", actorUserId: "staff", eventType: "review.ignored" } });
}
function quote(h: ReturnType<typeof harness>, fingerprint: string | null = h.fingerprint()) {
  Object.assign(h.current(), { createdQuoteId: "quote", status: "submitted", reviewOutcome: "quote_draft_created",
    normalizedPayloadJson: { evidenceFingerprint: h.fingerprint(), quoteEvidenceFingerprint: fingerprint } });
  h.tables.quotes.push({ id: "quote", organizationId: "tenant-a", convertedToOrderId: "order" });
  h.tables.orders.push({ id: "order", organizationId: "tenant-a", quoteId: "quote" });
}
const converted = { organizationId: "tenant-a", quoteId: "quote", orderId: "order", actorUserId: "staff" };
const list = (h: ReturnType<typeof harness>, statusGroup?: any, converted?: boolean) => h.repo.listRecords("tenant-a", { statusGroup, converted, limit: 100, offset: 0 });

describe("inbound evidence accountability (modeled transactions, not PostgreSQL)", () => {
  test("Quote-only legacy records stay pending even after downstream approval", async () => {
    const h = harness(); quote(h); h.current().status = "approved"; h.current().reviewOutcome = "downstream_quote_completed";
    expect(inboundAccountabilityLabel(h.current())).toBe("Awaiting quote acceptance");
    expect(await list(h, "active", false)).toHaveLength(1);
    expect(await list(h, "waiting")).toHaveLength(1);
    expect(await list(h, "converted")).toHaveLength(0);
    await h.repo.markLinkedQuoteCompleted({ organizationId: "tenant-a", quoteId: "quote", quoteStatus: "active", completionSource: "quote_staff_approval" });
    expect(h.current().status).toBe("waiting_on_customer"); expect(inboundIsPending(h.current())).toBe(true);
  });
  test("counts and filters share one bucket projection; processing alone remains pending", async () => {
    const h = harness(); quote(h);
    h.tables.inbound_order_records.push(
      { id: "done", organizationId: "tenant-a", status: "submitted", createdOrderId: "order" },
      { id: "AI", organizationId: "tenant-a", status: "processing" },
      { id: "foreign", organizationId: "tenant-b", status: "needs_review" },
    );
    const summary = await h.repo.getQueueSummary("tenant-a");
    expect(summary).toMatchObject({ waitingOnCustomer: 1, needsReview: 1, convertedSubmitted: 1 });
    for (const [group, field] of [["waiting", "waitingOnCustomer"], ["needs_review", "needsReview"], ["converted", "convertedSubmitted"]]) {
      expect(await list(h, group)).toHaveLength((summary as any)[field]);
    }
    expect(await list(h, "active")).toHaveLength(2);
    expect(h.calls.some(sql => sql.includes("count(*) filter (where case"))).toBe(true);
  });
  test("canonical Quote linkage resolves only covered evidence and repeated linkage has no effects", async () => {
    const h = harness(); quote(h);
    await h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted));
    expect(h.current()).toMatchObject({ createdOrderId: "order", status: "submitted", normalizedPayloadJson: { evidenceResolution: { fingerprint: h.fingerprint() } } });
    expect(await list(h)).toHaveLength(0);
    const events = structuredClone(h.tables.inbound_order_events);
    await h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted));
    expect(h.tables.inbound_order_events).toEqual(events); expect(h.tables.orders).toHaveLength(1);
  });
  test("new evidence while Quote conversion waits links the Order without acknowledging the revision", async () => {
    const h = harness(); quote(h); const draft = h.addDraft(); const saved = structuredClone(draft);
    await changeEvidence(h);
    await h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted));
    expect(h.current()).toMatchObject({ createdOrderId: "order", status: "needs_review" });
    expect(inboundQueueBucket(h.current())).toBe("needs_review");
    expect(h.tables.inbound_order_review_snapshots).toEqual([saved]);
    expect(h.tables.orders).toEqual([{ id: "order", organizationId: "tenant-a", quoteId: "quote" }]);
    expect(eligibleForAutomaticInboundDraft(h.current())).toBe(false);
  });
  test("an Order linkage stays resolved until new email or attachment evidence arrives", async () => {
    for (const kind of ["email", "attachment"] as const) {
      const h = harness(); quote(h); await h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted));
      const original = structuredClone(h.current());
      await h.repo.getEvidenceState("tenant-a", "email-1"); expect(h.current()).toEqual(original);
      if (kind === "email") await changeEvidence(h);
      else await h.repo.createFile({ organizationId: "tenant-a", inboundRecordId: "email-1", sourceFilename: "revision.pdf", checksum: "new" });
      expect(await list(h)).toHaveLength(1); expect(await list(h, "converted")).toHaveLength(0);
      expect(h.current().createdOrderId).toBe("order");
      await h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted));
      expect(inboundIsPending(h.current())).toBe(true); // stale conversion replay cannot acknowledge it
      expect(h.tables.orders).toHaveLength(1);
    }
  });
  test("dismissal is versioned, idempotent, audited, and later evidence reopens it", async () => {
    const h = harness(); await h.repo.getEvidenceState("tenant-a", "email-1");
    const old = h.fingerprint(); await dismissal(h); await dismissal(h);
    expect(h.tables.inbound_order_events.filter(event => event.eventType === "review.ignored")).toHaveLength(1);
    expect(await list(h)).toHaveLength(0);
    await changeEvidence(h); expect(await list(h)).toHaveLength(1);
    await expect(dismissal(h, old)).rejects.toThrow(); expect(inboundIsPending(h.current())).toBe(true);
    await dismissal(h); expect(await list(h)).toHaveLength(0);
    expect(h.tables.inbound_order_events.some(event => event.eventType === "evidence.reopened")).toBe(true);
  });
  test("a genuinely new unlinked request can be deliberately reviewed after an earlier dismissal", async () => {
    const h = harness(); await dismissal(h); const dismissedFingerprint = h.fingerprint();
    await changeEvidence(h); const draft = h.addDraft();
    await h.repo.createReviewSnapshotWithEvent({ snapshot: { ...draft, snapshotType: "approval", payloadJson: { ...draft.payloadJson, status: "ready_to_convert" } },
      evidenceSourceSnapshotId: draft.id, recordPatch: { status: "ready", reviewOutcome: "reviewed" },
      event: { actorType: "user", actorUserId: "staff", eventType: "review_draft.marked_ready" } } as any);
    expect(h.current().status).toBe("ready"); expect(inboundQueueBucket(h.current())).toBe("ready");
    expect(h.tables.inbound_order_events.find(event => event.eventType === "review.ignored").metadataJson.evidenceFingerprint).toBe(dismissedFingerprint);
    await expect(h.repo.claimInboundOrderForOrderConversion({ ...identity, snapshotId: h.tables.inbound_order_review_snapshots[0].id })).resolves.toMatchObject({ status: "processing" });
  });
  test("deliberate reopen is visible, and a subsequent dismissal of the same evidence is a new audited decision", async () => {
    const h = harness(); await dismissal(h);
    await h.repo.updateRecordWithEvent({ ...identity, patch: { status: "needs_review" }, event: { actorType: "user", actorUserId: "staff", eventType: "review.reopen" } });
    expect(inboundIsPending(h.current())).toBe(true);
    await dismissal(h); expect(inboundIsPending(h.current())).toBe(false);
    expect(h.tables.inbound_order_events.filter(event => event.eventType === "review.ignored")).toHaveLength(2);
  });
  test("ignore rules and the versioned disposition roll back together when disposition persistence fails", async () => {
    const h = harness(); h.current().rawPayloadJson.sender = { email: "buyer@printshop.example" };
    await h.repo.getEvidenceState("tenant-a", "email-1");
    const service = new InboundOrderService(h.repo);
    const failure = jest.spyOn(InboundOrdersRepository.prototype, "updateRecordWithEvent").mockRejectedValue(new Error("Synthetic disposition failure"));
    try {
      await expect(service.applyIgnoreActionWithSummary({ ...identity, action: "ignore_sender", expectedEvidenceFingerprint: h.fingerprint() })).rejects.toThrow("Synthetic disposition failure");
      expect(h.calls).toContain("insert:inbound_email_ignore_rules");
      expect(h.tables.inbound_email_ignore_rules).toHaveLength(0);
      expect(inboundIsPending(h.current())).toBe(true);
    } finally { failure.mockRestore(); }
  });
  test("legacy resolved records are not bulk reopened or stamped reviewed; observed changes reopen them", async () => {
    for (const prior of [{ createdOrderId: "legacy-order", status: "submitted" }, { status: "ignored" }, { status: "terminal", reviewOutcome: "deleted", archivedAt: new Date() }]) {
      const h = harness(); Object.assign(h.current(), prior);
      await h.repo.getEvidenceState("tenant-a", "email-1");
      expect(h.current().normalizedPayloadJson.evidenceResolution).toBeUndefined(); expect(inboundIsPending(h.current())).toBe(false);
      await changeEvidence(h); expect(inboundIsPending(h.current())).toBe(true); expect(h.current().archivedAt).toBeNull();
    }
    const h = harness(); quote(h, null); await h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted));
    expect(h.current().createdOrderId).toBe("order"); expect(inboundIsPending(h.current())).toBe(true);
  });
  test("missing version, AI dismissal, foreign tenant, and mismatched Order linkage fail closed", async () => {
    const h = harness(); quote(h);
    await expect(h.repo.updateRecordWithEvent({ ...identity, patch: { status: "ignored" }, event: { actorType: "user", eventType: "review.ignored" } })).rejects.toThrow("Refresh");
    await expect(h.repo.updateRecordWithEvent({ ...identity, patch: { status: "ignored" }, event: { actorType: "system", eventType: "parse.completed" } })).resolves.toBeNull();
    await expect(h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted({ ...converted, organizationId: "tenant-b" }))).rejects.toThrow();
    h.tables.orders[0].quoteId = "other-quote";
    await expect(h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted))).rejects.toThrow();
  });
  test("a merged source cannot claim a second Order and its parent context query is tenant scoped", async () => {
    const h = harness(); const draft = h.addDraft(); h.current().status = "ready";
    h.current().normalizedPayloadJson.combinedParentRecordId = "parent";
    await expect(h.repo.claimInboundOrderForOrderConversion({ ...identity, snapshotId: draft.id })).resolves.toBeNull();
    const sql = new PgDialect().sqlToQuery(inboundParentOrderIdSql()).sql;
    expect(sql).toContain('from "inbound_order_records" as "inbound_parent"');
    expect(sql).toContain('"inbound_parent"."organization_id" = "inbound_order_records"."organization_id"');
    expect(sql).toContain('"inbound_parent_order"."organization_id" = "inbound_order_records"."organization_id"');
  });
  test("competing modeled transitions serialize without duplicate linkage or lost evidence", async () => {
    const h = harness(); quote(h); const before = h.fingerprint();
    await Promise.all([
      h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted)),
      changeEvidence(h), h.repo.transaction(async (_tx, repo) => repo.markLinkedQuoteOrderConverted(converted)),
    ]);
    expect(h.current().createdOrderId).toBe("order"); expect(inboundIsPending(h.current())).toBe(true);
    expect(h.tables.inbound_order_events.filter(event => event.eventType === "order.linked_from_quote")).toHaveLength(1);
    await expect(dismissal(h, before)).rejects.toThrow();
  });
  test("explicit attachment to the linked Order resolves current evidence atomically and is idempotent", async () => {
    const h = harness();
    h.current().receivedAt = new Date("2026-10-29T00:00:00Z");
    h.tables.orders.push({ id: "order", organizationId: "tenant-a", orderNumber: "QA-ONLY", lineItems: [] });
    h.tables.order_audit_log = [];
    const orderRepository: any = {
      withExecutor: () => orderRepository,
      getOrderById: async (org: string, id: string) => h.tables.orders.find(order => order.organizationId === org && order.id === id),
      listAllOrderAttachments: async () => [], createOrder: jest.fn(),
      createOrderAuditLog: async (entry: any) => h.tables.order_audit_log.push(entry),
    };
    const service = new InboundOrderService(h.repo, orderRepository);
    await h.repo.getEvidenceState("tenant-a", "email-1");
    h.addDraft();
    const input = { ...identity, orderId: "order", expectedEvidenceFingerprint: h.fingerprint(), includeAttachments: false,
      includeMessageHistory: true, includeParsedNotes: false, includeJunkAttachments: false, confirmCustomerMismatch: false, artworkAssignments: [] };
    const unchangedOrder = structuredClone(h.tables.orders);
    await service.attachInboundRecordToOrder(input);
    expect(inboundQueueBucket(h.current())).toBe("converted");
    await service.attachInboundRecordToOrder(input);
    expect(h.tables.order_audit_log).toHaveLength(1);
    expect(h.tables.orders).toEqual(unchangedOrder); expect(orderRepository.createOrder).not.toHaveBeenCalled();
    await changeEvidence(h); expect(inboundIsPending(h.current())).toBe(true);
    expect(eligibleForAutomaticInboundDraft(h.current())).toBe(false);
    await expect(service.convertInboundReviewDraftToOrder(identity)).resolves.toMatchObject({ alreadyConverted: true, orderId: "order" });
    expect(inboundIsPending(h.current())).toBe(true); expect(orderRepository.createOrder).not.toHaveBeenCalled();
    await expect(service.attachInboundRecordToOrder(input)).rejects.toThrow();
    await service.attachInboundRecordToOrder({ ...input, expectedEvidenceFingerprint: h.fingerprint() });
    expect(inboundIsPending(h.current())).toBe(false); expect(h.tables.order_audit_log).toHaveLength(2);
    await h.repo.getEvidenceState("tenant-a", "email-1");
    expect(h.current()).toMatchObject({ status: "submitted", requiresHumanDecision: false });
    expect(h.tables.orders).toEqual(unchangedOrder);
    await changeEvidence(h, "Another change");
    orderRepository.createOrderAuditLog = async () => { throw new Error("Synthetic transaction failure"); };
    const before = structuredClone(h.current());
    await expect(service.attachInboundRecordToOrder({ ...input, expectedEvidenceFingerprint: h.fingerprint() })).rejects.toThrow("Synthetic");
    expect(h.current()).toEqual(before); expect(inboundIsPending(h.current())).toBe(true);
  });
});
