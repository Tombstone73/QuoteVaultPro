import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import { ProductionApplicationService } from "../../src/modules/production/productionApplication.js";
import type { ProductionAttempt, ProductionWork, ProductionWorkEvent, ProductionWorkProjection } from "../../src/modules/production/contracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const org = brandedId<"OrganizationId">("production-exception-org");
const work: ProductionWork = {
  productionWorkId: brandedId<"ProductionWorkId">("work-a"), organizationId: org,
  orderId: brandedId<"OrderId">("order-a"), orderLineId: brandedId<"OrderLineId">("line-a"),
  requirement: { key: "front", side: "front" }, artworkAssignmentId: brandedId<"ArtworkAssignmentId">("art-a"),
  artworkFileId: brandedId<"ArtworkFileId">("file-a"), orderedQuantity: 100,
  createdAt: "2026-09-10T00:00:00.000Z", createdPrincipalKind: "staff", createdPrincipalSubject: "operator-a",
};
let attempt: ProductionAttempt = {
  productionAttemptId: brandedId<"ProductionAttemptId">("attempt-a"), organizationId: org, productionWorkId: work.productionWorkId,
  sequence: 1, kind: "initial", stationKey: "flatbed", goodQuantity: 20, wasteQuantity: 3,
  startedAt: "2026-09-10T00:00:00.000Z", startedPrincipalKind: "staff", startedPrincipalSubject: "operator-a",
};
const events: ProductionWorkEvent[] = [];
const results = new Map<string, unknown>();
let frozenRouteRevision = 7;
let siblingRecordedGoodQuantity = 11;
const projection = (): ProductionWorkProjection => {
  const latest = [...events].reverse().find((item) => item.kind !== "note");
  const state = latest?.kind === "rework_requested" ? "rework_requested" : latest?.kind === "hold" ? "held" : "active";
  return { work, attempts: [attempt], completedGoodQuantity: 0, recordedGoodQuantity: attempt.goodQuantity,
    remainingGoodQuantity: 100 - attempt.goodQuantity, activeAttempt: attempt, unitQuantitySatisfied: false, state, exceptionEvents: [...events] };
};
const tx = {
  reserve: async (input: { businessRequestId: string }) => results.has(input.businessRequestId)
    ? { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: results.get(input.businessRequestId) ?? null } }
    : { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } },
  succeed: async (_organizationId: string, id: string, result: unknown) => { results.set(id, result); },
  attribute: async () => undefined, audit: async () => undefined,
  eligibleProductionAssignment: async () => true, createOrGetWork: async () => work,
  findWork: async (organizationId: string) => organizationId === org ? work : null,
  lockWork: async (organizationId: string) => organizationId === org ? work : null,
  readWork: async (organizationId: string) => organizationId === org ? projection() : null,
  listStationQueue: async () => ({ items: [projection()], pagination: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 } }),
  listOrderWorks: async () => [projection()], lockAttempt: async () => attempt,
  startAttempt: async () => attempt,
  recordOutput: async (input: { goodQuantityDelta: number; wasteQuantityDelta: number }) => {
    attempt = { ...attempt, goodQuantity: attempt.goodQuantity + input.goodQuantityDelta, wasteQuantity: attempt.wasteQuantity + input.wasteQuantityDelta }; return attempt;
  },
  completeAttempt: async () => attempt,
  appendWorkEvent: async (input: Omit<ProductionWorkEvent, "productionWorkEventId" | "sequence" | "createdAt"> & { id: string }) => {
    const created: ProductionWorkEvent = { productionWorkEventId: input.id, organizationId: input.organizationId, productionWorkId: input.productionWorkId,
      sequence: events.length + 1, kind: input.kind, ...(input.category ? { category: input.category } : {}), ...(input.reason ? { reason: input.reason } : {}), ...(input.note ? { note: input.note } : {}), ...(input.productionAttemptId ? { productionAttemptId: input.productionAttemptId } : {}), ...(input.recordedGoodQuantity === undefined ? {} : { recordedGoodQuantity: input.recordedGoodQuantity }), ...(input.recordedWasteQuantity === undefined ? {} : { recordedWasteQuantity: input.recordedWasteQuantity }), createdAt: "2026-09-10T00:00:00.000Z", createdPrincipalKind: input.createdPrincipalKind, createdPrincipalSubject: input.createdPrincipalSubject, ...(input.createdStaffActorUserId ? { createdStaffActorUserId: input.createdStaffActorUserId } : {}) };
    events.push(created); return created;
  },
};
const capabilities = ["production.view", "production.work", "production.complete", "production.hold", "production.note", "production.rework"] as const;
const context = (id: string, organizationId = org): OperationContext => ({ organizationId, operationId: id, businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff", organizationId, userId: "operator-a", authority: { membershipId: "membership-a", capabilities } } });
const service = new ProductionApplicationService({ transaction: async (operation) => operation(tx as never) });

const held = await service.hold(context("hold-a"), { businessRequestId: "hold-a", productionWorkId: work.productionWorkId, category: "quality", note: "Inspect color shift" });
assert.equal(held.ok, true); assert.equal(projection().state, "held");
const blockedOutput = await service.recordOutput(context("blocked-output"), { businessRequestId: "blocked-output", productionAttemptId: attempt.productionAttemptId, goodQuantityDelta: 1 });
assert.equal(blockedOutput.ok, false, "held work rejects new output");
assert.equal(attempt.goodQuantity, 20, "a rejected held action cannot alter output");
const resumed = await service.resume(context("resume-a"), { businessRequestId: "resume-a", productionWorkId: work.productionWorkId, note: "Color verified" });
assert.equal(resumed.ok, true); assert.equal(projection().state, "active");
const noted = await service.note(context("note-a"), { businessRequestId: "note-a", productionWorkId: work.productionWorkId, note: "Operator observed a registration risk" });
assert.equal(noted.ok, true); assert.equal(events.at(-1)?.kind, "note");
const before = { good: attempt.goodQuantity, waste: attempt.wasteQuantity, eventCount: events.length, routeRevision: frozenRouteRevision, siblingGood: siblingRecordedGoodQuantity };
const requested = await service.requestRework(context("rework-a"), { businessRequestId: "rework-a", productionWorkId: work.productionWorkId, reason: "Customer artwork needs a revised bleed", category: "artwork", note: "Await Prepress review" });
assert.equal(requested.ok, true); assert.equal(projection().state, "rework_requested");
assert.deepEqual({ good: attempt.goodQuantity, waste: attempt.wasteQuantity }, { good: before.good, waste: before.waste }, "rework request preserves all output");
assert.equal(attempt.completedAt, undefined, "rework request does not terminalize the active attempt");
assert.equal(events.at(-1)?.recordedGoodQuantity, 20, "request snapshots immutable output totals");
assert.equal(frozenRouteRevision, before.routeRevision, "rework request leaves the frozen route untouched");
assert.equal(siblingRecordedGoodQuantity, before.siblingGood, "rework request leaves sibling Production work untouched");
const replay = await service.requestRework(context("rework-a"), { businessRequestId: "rework-a", productionWorkId: work.productionWorkId, reason: "Customer artwork needs a revised bleed", category: "artwork", note: "Await Prepress review" });
assert.equal(replay.ok, true); assert.equal(events.length, before.eventCount + 1, "same request id replays without duplicate evidence");
const blockedComplete = await service.complete(context("blocked-complete"), { businessRequestId: "blocked-complete", productionAttemptId: attempt.productionAttemptId });
assert.equal(blockedComplete.ok, false, "rework-blocked work rejects completion");
const foreign = await service.note(context("tenant-note", brandedId<"OrganizationId">("other-org")), { businessRequestId: "tenant-note", productionWorkId: work.productionWorkId, note: "wrong tenant" });
assert.equal(foreign.ok, false, "cross-tenant principal cannot record an exception");
const deniedContext: OperationContext = { organizationId: org, operationId: "denied-rework", businessRequest: { id: "denied-rework", payloadFingerprint: "denied-rework" }, principal: { kind: "staff", organizationId: org, userId: "observer", authority: { membershipId: "observer-membership", capabilities: ["production.view"] } } };
const denied = await service.requestRework(deniedContext, { businessRequestId: "denied-rework", productionWorkId: work.productionWorkId, reason: "not authorized" });
assert.equal(denied.ok, false, "missing production.rework authority is rejected");
console.log("Production exception foundation contract passed.");
