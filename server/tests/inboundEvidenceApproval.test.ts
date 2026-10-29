import { describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { InboundOrdersRepository } from "../storage/inboundOrders.repo";
import { fingerprintInboundEmailEvidence, InboundEvidenceConflictError } from "../services/inboundOrders/inboundEmailEvidenceFingerprint";

// Exercise the real repository transaction bodies with an in-memory Drizzle
// executor. This checks decisions and SQL lock participation, not PostgreSQL's
// scheduler or actual lock behavior (which requires an isolated database).
function harness() {
  const record: any = { id: "email-1", organizationId: "tenant-a", sourceType: "email", sourceMessageId: "m1",
    status: "needs_review", rawPayloadJson: { subject: "Order", bodyText: "Ten signs" }, normalizedPayloadJson: {},
    createdOrderId: null, createdQuoteId: null };
  const tables: Record<string, any[]> = {
    inbound_order_records: [record], inbound_order_files: [], inbound_order_review_snapshots: [],
    inbound_order_events: [], inbound_order_parse_attempts: [],
  };
  const calls: string[] = [];
  const dialect = new PgDialect();
  function rows(table: any, condition?: any) {
    const name = getTableName(table);
    if (!condition) return tables[name] ?? [];
    const query = dialect.sqlToQuery(condition);
    const camel = (value: string) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return (tables[name] ?? []).filter((row) => {
      for (const match of query.sql.matchAll(/"([a-z_]+)" = \$(\d+)/g)) {
        if (row[camel(match[1])] !== query.params[Number(match[2]) - 1]) return false;
      }
      for (const match of query.sql.matchAll(/"([a-z_]+)" in \(([^)]+)\)/g)) {
        const values = [...match[2].matchAll(/\$(\d+)/g)].map((value) => query.params[Number(value[1]) - 1]);
        if (!values.includes(row[camel(match[1])])) return false;
      }
      if (query.sql.includes("combinedParentRecordId")) return row.normalizedPayloadJson?.combinedParentRecordId === query.params[1];
      if (query.sql.includes('"created_order_id" is null') && row.createdOrderId) return false;
      if (query.sql.includes('"created_quote_id" is null') && row.createdQuoteId) return false;
      return true;
    });
  }
  let sequence = 0;
  function query(table: any, mode: string) {
    let condition: any;
    let values: any;
    let limit: number | undefined;
    const execute = () => {
      const name = getTableName(table);
      if (mode === "insert") {
        const inserted = { id: `row-${++sequence}`, createdAt: new Date(), ...values };
        tables[name].unshift(inserted);
        calls.push(`insert:${name}`);
        return [structuredClone(inserted)];
      }
      const selected = rows(table, condition);
      if (mode === "update") {
        selected.forEach((row) => Object.assign(row, values));
        calls.push(`update:${name}`);
      }
      return structuredClone(selected.slice(0, limit));
    };
    const chain: any = {
      where: (value: any) => { condition = value; return chain; },
      limit: (value: number) => { limit = value; return chain; },
      orderBy: () => chain,
      for: (value: string) => { calls.push(`for:${value}`); return chain; },
      set: (value: any) => { values = value; return chain; },
      values: (value: any) => { values = value; return chain; },
      returning: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve().then(execute).then(resolve, reject),
    };
    return chain;
  }
  const executor: any = {
    execute: async (statement: any) => { calls.push(dialect.sqlToQuery(statement).sql); return []; },
    select: () => ({ from: (table: any) => query(table, "select") }),
    update: (table: any) => query(table, "update"), insert: (table: any) => query(table, "insert"),
    transaction: async (callback: any) => {
      const before = structuredClone(tables);
      calls.push("transaction");
      try { return await callback(executor); }
      catch (error) { for (const key of Object.keys(tables)) tables[key] = before[key]; throw error; }
    },
  };
  const repo = new InboundOrdersRepository(executor);
  const current = () => tables.inbound_order_records[0];
  const fingerprint = () => fingerprintInboundEmailEvidence(current(), tables.inbound_order_files);
  const addDraft = (covered: string | null = fingerprint()) => {
    const snapshot = { id: `draft-${++sequence}`, organizationId: "tenant-a", inboundRecordId: "email-1", snapshotVersion: sequence,
      payloadJson: { status: "draft", reviewNotes: "Keep my staff edits", reviewedLineItemsJson: [{ quantity: 7 }],
        metadata: { snapshotKind: "editable_review_draft", evidenceFingerprint: covered } } };
    tables.inbound_order_review_snapshots.unshift(snapshot);
    return snapshot;
  };
  return { repo, tables, calls, current, fingerprint, addDraft };
}

const identity = { organizationId: "tenant-a", inboundRecordId: "email-1", actorUserId: "staff" };
const event = { actorType: "user" as const, eventType: "review.status_updated" };

describe("inbound evidence approval protocol", () => {
  test("persists identity and keeps staff edits when email changes", async () => {
    const h = harness();
    const draft = h.addDraft();
    const previous = structuredClone(draft);
    await h.repo.updateRecordWithEvent({ ...identity, patch: { rawPayloadJson: { subject: "Order", bodyText: "Twenty signs" } }, event });
    expect(h.current().normalizedPayloadJson.evidenceFingerprint).toBe(h.fingerprint());
    expect(h.current()).toMatchObject({ status: "needs_review", requiresHumanDecision: true, approvedAt: null });
    expect(h.tables.inbound_order_review_snapshots).toEqual([previous]);
    expect(h.current().normalizedPayloadJson.evidenceFingerprint).not.toBe(draft.payloadJson.metadata.evidenceFingerprint);
    expect(h.calls.indexOf("for:update")).toBeLessThan(h.calls.indexOf("update:inbound_order_records"));
    expect(h.calls.some((call) => call.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  test("attachment writers take the lock and invalidate without changing draft contents", async () => {
    const h = harness();
    const draft = h.addDraft();
    const original = structuredClone(draft);
    await h.repo.createFile({ organizationId: "tenant-a", inboundRecordId: "email-1", sourceFilename: "PO.pdf", checksum: "old" });
    const first = h.fingerprint();
    const file = h.tables.inbound_order_files[0];
    await h.repo.updateFile({ ...identity, fileId: file.id, patch: { checksum: "new" } });
    expect(h.fingerprint()).not.toBe(first);
    expect(h.tables.inbound_order_review_snapshots).toEqual([original]);
    expect(h.calls.filter((call) => call === "for:update")).toHaveLength(2);
  });

  test("late parse cannot clear newer evidence or mark it reviewed", async () => {
    const h = harness();
    h.addDraft();
    const old = h.fingerprint();
    await h.repo.updateRecordWithEvent({ ...identity, patch: { rawPayloadJson: { bodyText: "Revised" } }, event });
    await h.repo.updateRecordWithEvent({ ...identity, parsedEvidenceFingerprint: old,
      patch: { status: "ready", requiresHumanDecision: false }, event: { ...event, eventType: "parse.completed" } });
    expect(h.current()).toMatchObject({ status: "needs_review", requiresHumanDecision: true,
      normalizedPayloadJson: { evidenceFingerprint: h.fingerprint(), reparseRecommended: true } });
    expect(h.tables.inbound_order_events[0].toStatus).toBe("needs_review");
  });

  test.each(["ready", "approved", "submitted"] as const)("direct status %s rejects stale evidence", async (status) => {
    const h = harness();
    h.addDraft("outdated");
    await expect(h.repo.updateRecordWithEvent({ ...identity, patch: { status }, event })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.current().status).toBe("needs_review");
  });

  test("conversion claim rejects stale evidence even if record still says ready", async () => {
    const h = harness();
    const draft = h.addDraft("old");
    h.current().status = "ready";
    await expect(h.repo.claimInboundOrderForOrderConversion({ ...identity, snapshotId: draft.id })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.current().reviewOutcome).toBeUndefined();
  });

  test("current evidence follows normal conversion claim and changed snapshots reject", async () => {
    const h = harness();
    const draft = h.addDraft();
    h.current().status = "ready";
    await expect(h.repo.claimInboundOrderForOrderConversion({ ...identity, snapshotId: "previous-draft" })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    await expect(h.repo.claimInboundOrderForOrderConversion({ ...identity, snapshotId: draft.id })).resolves.toMatchObject({ status: "processing", reviewOutcome: "order_conversion_requested" });
  });

  test("legacy draft stays untracked through saving and cannot be approved", async () => {
    const h = harness();
    const draft = h.addDraft(null);
    const saved = await h.repo.createReviewSnapshotWithEvent({
      snapshot: { ...draft, snapshotType: "approval", payloadJson: { ...draft.payloadJson, metadata: { ...draft.payloadJson.metadata, evidenceFingerprint: h.fingerprint() } } },
      evidenceSourceSnapshotId: draft.id, event,
    } as any);
    expect((saved.snapshot.payloadJson as any).metadata.evidenceFingerprint).toBeNull();
    await expect(h.repo.updateRecordWithEvent({ ...identity, patch: { status: "ready" }, event })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
  });

  test("explicit refresh records covered evidence; stale and legacy parse results reject", async () => {
    const h = harness();
    const draft = h.addDraft(null);
    const refresh = (attemptId: string) => h.repo.createReviewSnapshotWithEvent({
      snapshot: { ...draft, snapshotType: "approval" }, evidenceSourceParseAttemptId: attemptId, evidenceSourceSnapshotId: draft.id, event,
    } as any);
    h.tables.inbound_order_parse_attempts.push(
      { id: "legacy", organizationId: "tenant-a", inboundOrderRecordId: "email-1", rawResponse: {} },
      { id: "old", organizationId: "tenant-a", inboundOrderRecordId: "email-1", rawResponse: { inboundEvidenceFingerprint: "old" } },
      { id: "current", organizationId: "tenant-a", inboundOrderRecordId: "email-1", rawResponse: { inboundEvidenceFingerprint: h.fingerprint() } },
    );
    await expect(refresh("legacy")).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    await expect(refresh("old")).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    const refreshed = await refresh("current");
    expect((refreshed.snapshot.payloadJson as any).metadata.evidenceFingerprint).toBe(h.fingerprint());
  });

  test("ready snapshot and record approval are one transaction, with stale rollback", async () => {
    const h = harness();
    const draft = h.addDraft();
    const ready = () => h.repo.createReviewSnapshotWithEvent({ snapshot: { ...draft, snapshotType: "approval",
      payloadJson: { ...draft.payloadJson, status: "ready_to_convert" } }, evidenceSourceSnapshotId: draft.id,
      recordPatch: { status: "ready" }, event } as any);
    h.current().rawPayloadJson.bodyText = "newer"; // Arrived before approval acquired its lock.
    await expect(ready()).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(1);
    h.current().rawPayloadJson.bodyText = "Ten signs";
    await ready();
    expect(h.current().status).toBe("ready");
  });

  test("refresh prepared before a staff save cannot overwrite that newer draft", async () => {
    const h = harness();
    const original = h.addDraft();
    h.tables.inbound_order_parse_attempts.push({ id: "parse", organizationId: "tenant-a", inboundOrderRecordId: "email-1", rawResponse: { inboundEvidenceFingerprint: h.fingerprint() } });
    const staffSave = h.addDraft();
    staffSave.payloadJson.reviewNotes = "New staff edit while refresh was being prepared";
    await expect(h.repo.createReviewSnapshotWithEvent({ snapshot: { ...original, snapshotType: "approval" },
      evidenceSourceParseAttemptId: "parse", evidenceSourceSnapshotId: original.id, event } as any)).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.tables.inbound_order_review_snapshots[0].payloadJson.reviewNotes).toBe(staffSave.payloadJson.reviewNotes);
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(2);
  });

  test("the alternate quote conversion entry point also rejects stale evidence under lock", async () => {
    const h = harness();
    const draft = h.addDraft("outdated");
    await expect(h.repo.createQuoteDraftFromInboundReview("tenant-a", { ...identity, snapshotId: draft.id } as any)).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.calls.some((call) => call.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(h.calls).toContain("for:update");
    expect(h.current().createdQuoteId).toBeNull();
  });

  test("conversion failure requires review and cannot demote an already linked record", async () => {
    const h = harness();
    h.addDraft();
    h.current().status = "processing";
    await h.repo.markInboundOrderConversionFailed({ ...identity, message: "Order creation failed" });
    expect(h.current()).toMatchObject({ status: "needs_review", requiresHumanDecision: true, approvedAt: null });
    h.current().createdQuoteId = "linked-quote";
    h.current().status = "submitted";
    const linked = structuredClone(h.current());
    await h.repo.markInboundOrderConversionFailed({ ...identity, message: "Late failure handler" });
    expect(h.current()).toEqual(linked);
  });

  test("tenant boundary rejects reads, evidence writes, approval and foreign parse coverage", async () => {
    const h = harness();
    h.addDraft();
    await expect(h.repo.getEvidenceState("tenant-b", "email-1")).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    await expect(h.repo.createFile({ organizationId: "tenant-b", inboundRecordId: "email-1", sourceFilename: "bad.pdf" })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    await expect(h.repo.claimInboundOrderForOrderConversion({ ...identity, organizationId: "tenant-b" })).resolves.toBeNull();
    expect(h.tables.inbound_order_files).toHaveLength(0);
    h.tables.inbound_order_parse_attempts.push({ id: "foreign", organizationId: "tenant-b", inboundOrderRecordId: "email-1", rawResponse: { inboundEvidenceFingerprint: h.fingerprint() } });
    await expect(h.repo.createReviewSnapshotWithEvent({ snapshot: { ...h.tables.inbound_order_review_snapshots[0], snapshotType: "approval" }, evidenceSourceParseAttemptId: "foreign", event } as any)).rejects.toBeInstanceOf(InboundEvidenceConflictError);
  });
});
