import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { inboundEvidenceHarness } from "./helpers/inboundEvidenceHarness";
import { InboundEmailProcessingRepository } from "../storage/inboundEmailProcessing.repo";
import { InboundEmailProcessingWorker } from "../services/inboundOrders/InboundEmailProcessingWorker";
import { InboundOrderParsingService } from "../services/inboundOrders/InboundOrderParsingService";
import { InboundOrderService } from "../services/inboundOrders/InboundOrderService";
import { InboundEvidenceConflictError } from "../services/inboundOrders/inboundEmailEvidenceFingerprint";
import { INBOUND_EMAIL_LEASE_MS, inboundEmailRetryDelayMs } from "@shared/inboundEmailProcessing";
import { isInboundEmailProcessingEnabled } from "../services/inboundOrders/inboundEmailProcessingConfig";
import { inboundOrderParsedDraftSchema } from "@shared/inboundOrdersApi";

const org = "tenant-a", recordId = "email-1";
const original = { worker: process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED, organizations: process.env.INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS, global: process.env.WORKERS_ENABLED };
beforeEach(() => {
  process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED = "true";
  process.env.INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS = org;
  delete process.env.WORKERS_ENABLED;
});
afterEach(() => {
  for (const [name, value] of Object.entries({ WORKER_INBOUND_EMAIL_DRAFTS_ENABLED: original.worker, INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS: original.organizations, WORKERS_ENABLED: original.global })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
const jobs = (h: ReturnType<typeof inboundEvidenceHarness>) => h.tables.inbound_email_processing_jobs;
async function setup() {
  const h = inboundEvidenceHarness();
  await h.repo.completeEmailImport(org, recordId, "staff");
  return { ...h, queue: new InboundEmailProcessingRepository(h.executor) };
}
const settings = { getSettings: async () => ({ inboundEmailIntakeEnabled: true, inboundEmailPullPaused: false }) } as any;
const uncertain = () => inboundOrderParsedDraftSchema.parse({ customer: {}, order: {}, lineItems: [], artwork: [], globalWarnings: [], missingDecisions: [] });

describe("durable inbound automatic preparation (mocked transactions, no PostgreSQL lock proof)", () => {
  test("completed import schedules one durable evidence job; repeated import never duplicates it", async () => {
    const h = await setup();
    await h.repo.completeEmailImport(org, recordId, "staff");
    await h.repo.completeEmailImport(org, recordId, "staff");
    expect(jobs(h)).toHaveLength(1);
    expect(jobs(h)[0]).toMatchObject({ organizationId: org, inboundRecordId: recordId, evidenceFingerprint: h.fingerprint(), status: "waiting", attempts: 0 });
    expect(h.current().status).toBe("needs_review");
  });

  test("competing claim calls select one owner and use PostgreSQL skip-locked claim SQL", async () => {
    const h = await setup();
    const [first, second] = await Promise.all([h.queue.claim(), new InboundEmailProcessingRepository(h.executor).claim()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(jobs(h)[0]).toMatchObject({ status: "processing", attempts: 1 });
    expect(jobs(h)[0].claimToken).toBeTruthy();
    expect(h.calls).toContain("for:update:skipLocked");
    await h.repo.completeEmailImport(org, recordId, "staff");
    expect(jobs(h)).toHaveLength(1); expect(jobs(h)[0].attempts).toBe(1);
  });

  test("expired claims recover with a new fencing token; late old owners cannot finish", async () => {
    const h = await setup(); const first = (await h.queue.claim())!;
    h.advance(INBOUND_EMAIL_LEASE_MS + 1);
    const second = (await h.queue.claim())!;
    expect(second.attempts).toBe(2); expect(second.claimToken).not.toBe(first.claimToken);
    expect(await h.queue.finish(first, "review_ready")).toEqual([]);
    expect(jobs(h)[0].claimToken).toBe(second.claimToken);
    expect(await h.queue.heartbeat(first)).toBe(false);
  });

  test("heartbeats extend an owned live lease without allowing a competing claim", async () => {
    const h = await setup(); const first = (await h.queue.claim())!;
    h.advance(INBOUND_EMAIL_LEASE_MS / 2);
    expect(await h.queue.heartbeat(first)).toBe(true);
    h.advance(INBOUND_EMAIL_LEASE_MS / 2 + 1);
    expect(await h.queue.claim()).toBeNull();
    h.advance(INBOUND_EMAIL_LEASE_MS / 2);
    expect((await h.queue.claim())?.claimToken).not.toBe(first.claimToken);
  });

  test("an abandoned owner cannot publish an initial draft even when evidence has not changed", async () => {
    const h = await setup(); const old = (await h.queue.claim())!;
    h.advance(INBOUND_EMAIL_LEASE_MS + 1); await h.queue.claim();
    h.tables.inbound_order_parse_attempts.push({ id: "attempt", organizationId: org, inboundOrderRecordId: recordId, rawResponse: { inboundEvidenceFingerprint: h.fingerprint() } });
    await expect(h.repo.createReviewSnapshotWithEvent({
      snapshot: { organizationId: org, inboundRecordId: recordId, snapshotType: "approval", payloadJson: { metadata: { snapshotKind: "editable_review_draft" } } },
      evidenceSourceParseAttemptId: "attempt", evidenceSourceSnapshotId: null,
      automaticProcessing: { jobId: old.id, claimToken: old.claimToken!, evidenceFingerprint: old.evidenceFingerprint },
      event: { actorType: "system", eventType: "review_draft.initialized" },
    })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(0);
  });

  test("failure after draft persistence recovers to review rather than offering a replacement retry", async () => {
    const h = await setup();
    for (let index = 0; index < 3; index++) { await h.queue.claim(); h.advance(INBOUND_EMAIL_LEASE_MS + 1); }
    await h.queue.claim(); expect(jobs(h)[0].status).toBe("failed");
    const draft = h.addDraft(); await h.repo.getEvidenceState(org, recordId);
    expect(jobs(h)[0]).toMatchObject({ status: "needs_attention", errorCode: "EXISTING_DRAFT_RETAINED" });
    expect(h.tables.inbound_order_review_snapshots).toEqual([draft]);
    expect((await h.queue.view(org, recordId, h.fingerprint())).job?.canRetry).toBe(false);
  });

  test("repeated worker deaths reach a visible terminal failure; explicit retry resets a bounded run", async () => {
    const h = await setup();
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await h.queue.claim())?.attempts).toBe(attempt); h.advance(INBOUND_EMAIL_LEASE_MS + 1);
    }
    expect(await h.queue.claim()).toBeNull();
    expect(jobs(h)[0]).toMatchObject({ status: "failed", errorCode: "ABANDONED_CLAIM_LIMIT" });
    await h.repo.retryEmailProcessing(org, recordId, "retrying-staff");
    expect(jobs(h)[0]).toMatchObject({ status: "waiting", attempts: 0, actorUserId: "retrying-staff" });
    await expect(h.repo.retryEmailProcessing(org, recordId, "staff")).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect((await h.queue.claim())?.attempts).toBe(1);
  });

  test("provider failures back off and stop after three attempts, without persisting raw exception text", async () => {
    const h = await setup();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = (await h.queue.claim())!; await h.queue.fail(claimed);
      expect(jobs(h)[0].status).toBe(attempt === 3 ? "failed" : "waiting");
      expect(await h.queue.claim()).toBeNull(); h.advance(inboundEmailRetryDelayMs(attempt) + 1);
    }
    expect(await h.queue.claim()).toBeNull();
    expect((await h.queue.view(org, recordId, h.fingerprint())).job?.canRetry).toBe(true);
    expect(jobs(h)[0].message).toContain("three attempts");
  });

  test("worker exceptions schedule recovery without leaking provider/email content into queue messages or logs", async () => {
    const h = await setup(); const secret = "private email content and credential";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const parser = { getDraftPreview: async () => ({ draft: null, latestAttempt: null }), parseInboundOrderRecord: jest.fn(async () => { throw new Error(secret); }) };
    try {
      await new InboundEmailProcessingWorker(h.queue, h.repo, parser as any, {} as any, settings).runOnce(1);
      expect(jobs(h)[0]).toMatchObject({ status: "waiting", attempts: 1, errorCode: "AI_DRAFT_PREPARATION_FAILED" });
      expect(JSON.stringify(jobs(h))).not.toContain(secret);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    } finally { warn.mockRestore(); }
  });

  test("the existing tenant intake disable switch prevents an AI call", async () => {
    const h = await setup(); const parser = { parseInboundOrderRecord: jest.fn() };
    const disabled = { getSettings: async () => ({ inboundEmailIntakeEnabled: false, inboundEmailPullPaused: false }) };
    await new InboundEmailProcessingWorker(h.queue, h.repo, parser as any, {} as any, disabled as any).runOnce(1);
    expect(parser.parseInboundOrderRecord).not.toHaveBeenCalled();
    expect(jobs(h)[0]).toMatchObject({ status: "waiting", errorCode: "INBOUND_INTAKE_DISABLED" });
  });

  test("new evidence supersedes active work and persists the newer identity without losing it", async () => {
    const h = await setup(); const old = (await h.queue.claim())!;
    await h.repo.updateRecordWithEvent({ organizationId: org, inboundRecordId: recordId,
      patch: { rawPayloadJson: { subject: "Revision", bodyText: "Twenty signs instead" } }, event: { eventType: "email.test_refresh", actorType: "system" } });
    expect(jobs(h)).toHaveLength(2);
    expect(jobs(h).find(job => job.id === old.id)?.status).toBe("superseded");
    expect(jobs(h).find(job => job.evidenceFingerprint === h.fingerprint())?.status).toBe("waiting");
    await expect(h.repo.updateRecordWithEvent({ organizationId: org, inboundRecordId: recordId, automaticProcessing: { jobId: old.id, claimToken: old.claimToken!, evidenceFingerprint: old.evidenceFingerprint },
      patch: { status: "ready" }, event: { eventType: "parse.completed", actorType: "system" } })).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    expect(h.current().status).toBe("needs_review");
  });

  test("existing staff edits survive evidence changes and require deliberate reconciliation", async () => {
    const h = await setup(); const draft = h.addDraft();
    await h.repo.updateRecordWithEvent({ organizationId: org, inboundRecordId: recordId,
      patch: { rawPayloadJson: { subject: "Revision", bodyText: "New attached PO" } }, event: { eventType: "email.test_refresh", actorType: "system" } });
    const current = jobs(h).find(job => job.evidenceFingerprint === h.fingerprint());
    expect(current).toMatchObject({ status: "needs_attention", errorCode: "STAFF_REFRESH_REQUIRED" });
    expect(h.tables.inbound_order_review_snapshots).toEqual([draft]);
    const parser = { parseInboundOrderRecord: jest.fn() };
    await new InboundEmailProcessingWorker(h.queue, h.repo, parser as any, {} as any, settings).runOnce();
    expect(parser.parseInboundOrderRecord).not.toHaveBeenCalled();
    expect(h.tables.inbound_order_review_snapshots[0].payloadJson.reviewNotes).toBe("Keep my staff edits");
    await expect(h.repo.retryEmailProcessing(org, recordId, "staff")).rejects.toBeInstanceOf(InboundEvidenceConflictError);
  });

  test("current claims cannot overwrite business disposition during background parsing", async () => {
    const h = await setup(); h.current().status = "waiting_on_customer"; h.current().reviewOutcome = "awaiting_customer";
    const job = (await h.queue.claim())!;
    await h.repo.updateRecordWithEvent({ organizationId: org, inboundRecordId: recordId, automaticProcessing: { jobId: job.id, claimToken: job.claimToken!, evidenceFingerprint: job.evidenceFingerprint },
      parsedEvidenceFingerprint: h.fingerprint(), patch: { status: "ready", reviewOutcome: "entered", requiresHumanDecision: false, parsedAt: new Date() },
      event: { eventType: "parse.completed", actorType: "system" } });
    expect(h.current()).toMatchObject({ status: "waiting_on_customer", reviewOutcome: "awaiting_customer", parsedAt: expect.any(Date) });
  });

  test("tenant isolation and disabled rollout prevent claims and external work", async () => {
    const h = await setup();
    process.env.INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS = "tenant-b";
    expect(isInboundEmailProcessingEnabled(org)).toBe(false); expect(await h.queue.claim()).toBeNull();
    await expect(h.repo.retryEmailProcessing("tenant-b", recordId, "staff")).rejects.toBeInstanceOf(InboundEvidenceConflictError);
    const parser = { parseInboundOrderRecord: jest.fn() };
    delete process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED;
    expect(await new InboundEmailProcessingWorker(h.queue, h.repo, parser as any, {} as any, settings).runOnce()).toEqual({ processed: 0 });
    expect(parser.parseInboundOrderRecord).not.toHaveBeenCalled();
    process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED = "true"; process.env.INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS = org; process.env.WORKERS_ENABLED = "false";
    expect(await h.queue.claim()).toBeNull();
  });

  test.each(["createdOrderId", "createdQuoteId"])("already linked %s records never become new automatic drafts", async field => {
    const h = await setup(); h.current()[field] = "existing";
    await h.repo.getEvidenceState(org, recordId);
    expect(jobs(h)[0].status).toBe("superseded"); expect(await h.queue.claim()).toBeNull();
  });

  test.each(["uncertain", "non_order", "possible_duplicate_po", "possible_revision"])("real tracked parser and draft initializer keep %s findings reviewable without an Order", async finding => {
    const h = await setup(); h.current().rawPayloadJson = { subject: "Question", bodyText: "Can someone help with this?" };
    await h.repo.getEvidenceState(org, recordId);
    const draft = uncertain();
    draft.globalWarnings.push({ code: finding, message: `${finding} requires staff review.`, severity: "warning" } as any);
    const provider = { generateJson: jest.fn(async () => {
      expect(h.activeTransactions()).toBe(0);
      return { provider: "mock", model: "fixture", rawText: JSON.stringify(draft), parsed: draft };
    }) };
    const evidence = { buildEvidenceBundle: jest.fn(async () => { expect(h.activeTransactions()).toBe(0); return { items: [], conflicts: [] }; }) };
    const parser = new InboundOrderParsingService(h.repo, () => provider as any, evidence as any);
    const reviews = new InboundOrderService(h.repo);
    const worker = new InboundEmailProcessingWorker(h.queue, h.repo, parser, reviews, settings);
    await worker.runOnce(1);
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    expect(h.tables.inbound_order_parse_attempts).toHaveLength(1);
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(1);
    expect(h.tables.inbound_order_review_snapshots[0].payloadJson.metadata.evidenceFingerprint).toBe(h.fingerprint());
    expect(jobs(h).find(job => job.evidenceFingerprint === h.fingerprint())?.status).toBe("needs_attention");
    expect(h.current()).toMatchObject({ status: "needs_review", createdOrderId: null, createdQuoteId: null });
    await h.repo.completeEmailImport(org, recordId, "staff"); await worker.runOnce();
    expect(provider.generateJson).toHaveBeenCalledTimes(1); expect(h.tables.inbound_order_review_snapshots).toHaveLength(1);
  });

  test("AI finishing after newer evidence arrives cannot publish a draft or cover the newer evidence", async () => {
    const h = await setup();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const provider = { generateJson: jest.fn(async () => {
      expect(h.activeTransactions()).toBe(0);
      if (first) { first = false; entered(); await waiting; }
      return { provider: "mock", model: "fixture", rawText: JSON.stringify(uncertain()) };
    }) };
    const evidence = { buildEvidenceBundle: async () => ({ items: [], conflicts: [] }) };
    const parser = new InboundOrderParsingService(h.repo, () => provider as any, evidence as any);
    const worker = new InboundEmailProcessingWorker(h.queue, h.repo, parser, new InboundOrderService(h.repo), settings);
    const running = worker.runOnce(1); await started;
    await h.repo.updateRecordWithEvent({ organizationId: org, inboundRecordId: recordId, patch: { rawPayloadJson: { subject: "Updated", bodyText: "New request" } }, event: { eventType: "email.updated", actorType: "system" } });
    release(); await running;
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(0);
    expect(jobs(h).find(job => job.evidenceFingerprint === h.fingerprint())?.status).toBe("waiting");
    await worker.runOnce(1);
    expect(provider.generateJson).toHaveBeenCalledTimes(2);
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(1);
    expect(h.tables.inbound_order_review_snapshots[0].payloadJson.metadata.evidenceFingerprint).toBe(h.fingerprint());
  });

  test("available attachment evidence is captured by the existing parser outside transactions", async () => {
    const h = await setup();
    await h.repo.createFile({ organizationId: org, inboundRecordId: recordId, sourceFilename: "PO.txt", mimeType: "text/plain", checksum: "fixture-checksum", status: "available", role: "po", metadataJson: {}, sizeBytes: 40 });
    const evidence = { buildEvidenceBundle: jest.fn(async () => { expect(h.activeTransactions()).toBe(0); return { items: [], conflicts: [] }; }) };
    const provider = { generateJson: async () => ({ provider: "mock", model: "fixture", rawText: JSON.stringify(uncertain()) }) };
    const parser = new InboundOrderParsingService(h.repo, () => provider as any, evidence as any);
    const reviews = new InboundOrderService(h.repo);
    const getReviewDraft = reviews.getReviewDraft.bind(reviews);
    let failure: unknown;
    jest.spyOn(reviews, "getReviewDraft").mockImplementation(async input => { try { return await getReviewDraft(input); } catch (error) { failure = error; throw error; } });
    await new InboundEmailProcessingWorker(h.queue, h.repo, parser, reviews, settings).runOnce(1);
    expect(failure).toBeUndefined();
    expect(evidence.buildEvidenceBundle).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org, files: [expect.objectContaining({ sourceFilename: "PO.txt", checksum: "fixture-checksum" })] }));
    expect(h.tables.inbound_order_review_snapshots).toHaveLength(1);
  });

  test("abandoned work reuses a tracked current parse rather than calling AI again", async () => {
    const h = await setup(); const job = (await h.queue.claim())!;
    h.tables.inbound_order_parse_attempts.unshift({ id: "completed-before-crash", organizationId: org, inboundOrderRecordId: recordId,
      status: "success", parsedDraft: uncertain(), rawResponse: { inboundEvidenceFingerprint: h.fingerprint() }, createdAt: new Date() });
    h.advance(INBOUND_EMAIL_LEASE_MS + 1);
    const parser = new InboundOrderParsingService(h.repo, () => { throw new Error("AI must not be called"); });
    await new InboundEmailProcessingWorker(h.queue, h.repo, parser, new InboundOrderService(h.repo), settings).runOnce(1);
    expect(h.tables.inbound_order_parse_attempts).toHaveLength(1); expect(h.tables.inbound_order_review_snapshots).toHaveLength(1);
    expect(jobs(h)[0].attempts).toBe(job.attempts + 1);
  });
});
