import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import { ProductionApplicationService, type ProductionTransaction } from "../../src/modules/production/productionApplication.js";
import type { ProductionAttempt, ProductionWork, ProductionWorkProjection } from "../../src/modules/production/contracts.js";
import { productionCompletion } from "../../src/modules/production/productionCompletion.js";
import { RoutingLifecycleApplicationService, type RoutingLifecycleTransaction } from "../../src/modules/routing/routingLifecycle.js";
import type { RouteInstance } from "../../src/modules/routing/contracts.js";
import { FulfillmentApplicationService, type FulfillmentTransaction } from "../../src/modules/fulfillment/fulfillmentApplication.js";
import type { FulfillmentAvailability, FulfillmentHandoff, FulfillmentHandoffLine } from "../../src/modules/fulfillment/contracts.js";
import { fulfillmentCompletion } from "../../src/modules/fulfillment/fulfillmentCompletion.js";
import { orderCompletionEligibility } from "../../src/modules/sales/orderLifecycle.js";
import { reconciledOrderState } from "../../src/modules/sales/orderAutomaticLifecycle.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const unwrap = <T>(result: ApplicationResult<T>): T => {
  if (!result.ok) throw result.error;
  return result.value;
};
const org = brandedId<"OrganizationId">("mixed-station-org");
const orderId = brandedId<"OrderId">("mixed-station-order");
const time = "2026-10-10T00:00:00.000Z";
const stations = ["roll", "flatbed"] as const;
const context = (id: string): OperationContext => ({
  organizationId: org, operationId: `test:${id}`, businessRequest: { id, payloadFingerprint: "service-derived" },
  principal: { kind: "staff", organizationId: org, userId: "operator", authority: { membershipId: "member", capabilities: ["production.view", "production.work", "production.complete", "route.advance", "fulfillment.view", "fulfillment.pickup"] } },
});

// Same pure transaction-port approach as routingLifecycle/fulfillmentProductionAvailability.
// These are synthetic owner facts, not a PostgreSQL, HTTP, or concurrency proof.
for (const quantity of [1, 10, 100]) {
  const works = new Map<string, ProductionWork>();
  const attempts = new Map<string, ProductionAttempt>();
  const receipts = new Map<string, { id: string; fingerprint: string; resultJson: unknown }>();
  const pending = new Map<string, string>();
  const routes = new Map<string, RouteInstance>();
  const handoffs = new Map<string, FulfillmentHandoff>();
  const allocations: FulfillmentHandoffLine[] = [];
  const snapshots = new Set<string>();
  let outputWrites = 0, completionWrites = 0, routeWrites = 0, audits = 0;
  const reserve: ProductionTransaction["reserve"] = async input => {
    const id = `${input.operation}:${input.businessRequestId}`;
    const saved = receipts.get(id);
    if (saved) {
      if (saved.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Changed intent cannot replay.");
      return { kind: "replay", request: saved };
    }
    pending.set(id, input.payloadFingerprint);
    return { kind: "new", request: { id, resultJson: null } };
  };
  const succeed = async (_org: string, id: string, resultJson: unknown) => {
    receipts.set(id, { id, fingerprint: pending.get(id)!, resultJson: structuredClone(resultJson) });
    pending.delete(id);
  };
  const ledger = { reserve, succeed, attribute: async () => undefined, audit: async () => { audits++; } };
  const projection = (id: string): ProductionWorkProjection => {
    const work = works.get(id)!;
    const history = [...attempts.values()].filter(a => a.productionWorkId === id);
    const completedGoodQuantity = history.filter(a => a.completedAt).reduce((sum, a) => sum + a.goodQuantity, 0);
    const recordedGoodQuantity = history.reduce((sum, a) => sum + a.goodQuantity, 0);
    const activeAttempt = history.find(a => !a.completedAt);
    const unitQuantitySatisfied = completedGoodQuantity >= work.orderedQuantity;
    return { work, attempts: history, completedGoodQuantity, recordedGoodQuantity, usableGoodQuantity: completedGoodQuantity, rejectedGoodQuantity: 0, remainingGoodQuantity: work.orderedQuantity - recordedGoodQuantity, activeAttempt, unitQuantitySatisfied, state: unitQuantitySatisfied ? "complete" : activeAttempt ? "active" : "ready", exceptionEvents: [], outputDispositions: [] };
  };
  const availability = (): FulfillmentAvailability[] => [...works.values()].map(work => {
    const produced = projection(work.productionWorkId).usableGoodQuantity;
    const fulfilled = allocations.filter(a => a.orderLineId === work.orderLineId).reduce((sum, a) => sum + a.quantity, 0);
    return { orderId, orderLineId: work.orderLineId, orderedQuantity: quantity, productionRequired: true, completedProductionQuantity: produced, completedPickupQuantity: fulfilled, completedShipmentQuantity: 0, completedFulfillmentQuantity: fulfilled, availableFulfillmentQuantity: produced - fulfilled, remainingProductionQuantity: quantity - produced, remainingFulfillmentQuantity: quantity - fulfilled };
  });
  const eligibility = () => orderCompletionEligibility([...works.values()].map(work => ({
    orderLineId: work.orderLineId, description: work.requirement.key, workflowIntent: "standard_production", requiresProduction: true, orderedQuantity: quantity,
    productionComplete: projection(work.productionWorkId).unitQuantitySatisfied,
    fulfilledQuantity: availability().find(a => a.orderLineId === work.orderLineId)!.completedFulfillmentQuantity,
    routeComplete: routes.get(work.orderLineId)!.state === "completed",
  })));
  const lifecycle = { reconcileOrder: async () => { assert.equal(reconciledOrderState("open", eligibility(), false), "open", "unsettled parent never closes"); }, reconcileInvoice: async () => undefined };
  const productionTx = {
    ...ledger,
    eligibleProductionAssignment: async () => true,
    createOrGetWork: async (input: Parameters<ProductionTransaction["createOrGetWork"]>[0]) => {
      const existing = [...works.values()].find(w => w.artworkAssignmentId === input.artworkAssignmentId);
      if (existing) return existing;
      const station = input.artworkAssignmentId.endsWith("roll") ? "roll" : "flatbed";
      const work: ProductionWork = { productionWorkId: input.id, organizationId: org, orderId, orderLineId: brandedId<"OrderLineId">(`line-${station}`), requirement: { key: "front", side: "front" }, artworkAssignmentId: input.artworkAssignmentId, artworkFileId: brandedId<"ArtworkFileId">(`file-${station}`), orderedQuantity: quantity, createdAt: time, createdPrincipalKind: "staff", createdPrincipalSubject: "operator" };
      works.set(work.productionWorkId, work);
      return work;
    },
    findWork: async (_org: unknown, id: string) => works.get(id) ?? null,
    lockWork: async (_org: unknown, id: string) => works.get(id) ?? null,
    readWork: async (_org: unknown, id: string) => works.has(id) ? projection(id) : null,
    lockAttempt: async (_org: unknown, id: string) => attempts.get(id) ?? null,
    startAttempt: async (input: Parameters<ProductionTransaction["startAttempt"]>[0]) => {
      const attempt: ProductionAttempt = { productionAttemptId: input.id, organizationId: org, productionWorkId: input.productionWorkId, stationKey: input.stationKey, kind: input.kind, sequence: 1, goodQuantity: 0, wasteQuantity: 0, startedAt: time, startedPrincipalKind: input.principalKind, startedPrincipalSubject: input.principalSubject };
      attempts.set(attempt.productionAttemptId, attempt); return attempt;
    },
    recordOutput: async (input: Parameters<ProductionTransaction["recordOutput"]>[0]) => {
      outputWrites++; const old = attempts.get(input.productionAttemptId)!;
      const next = { ...old, goodQuantity: old.goodQuantity + input.goodQuantityDelta, wasteQuantity: old.wasteQuantity + input.wasteQuantityDelta };
      attempts.set(input.productionAttemptId, next); return next;
    },
    completeAttempt: async (input: Parameters<ProductionTransaction["completeAttempt"]>[0]) => {
      completionWrites++; const next = { ...attempts.get(input.productionAttemptId)!, completedAt: time, completedPrincipalKind: input.principalKind, completedPrincipalSubject: input.principalSubject };
      attempts.set(input.productionAttemptId, next); return next;
    },
  } satisfies Partial<ProductionTransaction>;
  const production = new ProductionApplicationService({ transaction: async action => action(productionTx as unknown as ProductionTransaction) }, undefined, lifecycle);
  const routingTx = {
    ...ledger,
    lockRouteInstance: async (_org: unknown, id: string) => [...routes.values()].find(r => r.routeInstanceId === id) ?? null,
    prerequisite: async (_org: unknown, route: RouteInstance, step: RouteInstance["steps"][number]) => {
      const work = [...works.values()].find(w => w.orderLineId === route.work.orderLineId)!;
      const state = step.kind === "production"
        ? productionCompletion({ requiredUnitCount: 1, openedUnitCount: 1, completedUnitCount: Number(projection(work.productionWorkId).unitQuantitySatisfied) }).state
        : fulfillmentCompletion({ orderedQuantity: quantity, completedQuantity: availability().find(a => a.orderLineId === work.orderLineId)!.completedFulfillmentQuantity }).state;
      return { satisfied: state === "complete", reason: "Owner obligation is incomplete." };
    },
    advance: async (input: Parameters<RoutingLifecycleTransaction["advance"]>[0]) => {
      routeWrites++; const old = [...routes.values()].find(r => r.routeInstanceId === input.routeInstanceId)!;
      assert.equal(input.expectedRevision, old.revision);
      const next: RouteInstance = { ...old, currentStepId: input.nextStepId ? brandedId<"RouteInstanceStepId">(input.nextStepId) : undefined, state: input.nextStepId ? "active" : "completed", revision: String(Number(old.revision) + 1) };
      routes.set(old.work.orderLineId, next); return next;
    },
  } satisfies RoutingLifecycleTransaction;
  const routing = new RoutingLifecycleApplicationService({ transaction: async action => action(routingTx) }, undefined, lifecycle);
  const fulfillmentTx = {
    ...ledger,
    readAvailability: async () => ({ availability: availability() }),
    lockAvailability: async (_org: unknown, _order: unknown, ids: readonly string[]) => ({ availability: availability().filter(a => ids.includes(a.orderLineId)) }),
    createHandoff: async (input: Parameters<FulfillmentTransaction["createHandoff"]>[0]) => {
      const handoff: FulfillmentHandoff = { handoffId: input.id, organizationId: org, orderId, method: input.method, completedAt: time, completedPrincipalKind: input.principalKind, completedPrincipalSubject: input.principalSubject };
      handoffs.set(input.id, handoff); return handoff;
    },
    createAllocations: async (input: Parameters<FulfillmentTransaction["createAllocations"]>[0]) => {
      const lines = input.allocations.map(a => ({ handoffLineId: a.id, organizationId: org, orderId, handoffId: input.handoffId, orderLineId: brandedId<"OrderLineId">(a.orderLineId), quantity: a.quantity }));
      allocations.push(...lines); return lines;
    },
    writeDocumentSnapshot: async (input: Parameters<FulfillmentTransaction["writeDocumentSnapshot"]>[0]) => { assert(!snapshots.has(input.handoffId)); snapshots.add(input.handoffId); },
  } satisfies Partial<FulfillmentTransaction>;
  const fulfillment = new FulfillmentApplicationService({ transaction: async action => action(fulfillmentTx as unknown as FulfillmentTransaction) }, undefined, lifecycle);
  const opened: ProductionWork[] = [];
  for (const station of stations) {
    const input = { businessRequestId: `open-${station}`, artworkAssignmentId: brandedId<"ArtworkAssignmentId">(`art-${station}`) };
    // Seed the completed Proof/Prepress frozen-route prerequisites, not shadow jobs.
    const lineId = brandedId<"OrderLineId">(`line-${station}`);
    routes.set(lineId, {
      routeInstanceId: brandedId<"RouteInstanceId">(`route-${station}`), organizationId: org,
      work: { kind: "sales_order_line", organizationId: org, orderId, orderLineId: lineId },
      sourceTemplate: { routeTemplateId: brandedId<"RouteTemplateId">(`template-${station}`), revision: "1", definitionFingerprint: "synthetic" },
      state: "active", currentStepId: brandedId<"RouteInstanceStepId">(`production-${station}`), revision: "3",
      steps: [
        { routeInstanceStepId: brandedId<"RouteInstanceStepId">(`production-${station}`), position: 2, kind: "production", productionDestination: station },
        { routeInstanceStepId: brandedId<"RouteInstanceStepId">(`fulfillment-${station}`), position: 3, kind: "fulfillment" },
      ],
    });
    const result = unwrap(await production.open(context(input.businessRequestId), input)); opened.push(result.work);
    assert.deepEqual(unwrap(await production.open(context(input.businessRequestId), input)), result);
    assert.equal(unwrap(await production.open(context(`open-again-${station}`), { ...input, businessRequestId: `open-again-${station}` })).work.productionWorkId, result.work.productionWorkId);
  }
  assert.equal(works.size, 2); assert.deepEqual(opened.map(w => w.orderedQuantity), [quantity, quantity]);
  const advance = (station: typeof stations[number], id: string) => {
    const route = routes.get(`line-${station}`)!;
    return routing.completeCurrentStep(context(id), { businessRequestId: id, routeInstanceId: route.routeInstanceId, expectedRevision: route.revision });
  };
  assert.equal((await advance("flatbed", "premature-route")).ok, false);
  for (const [index, station] of stations.entries()) {
    const work = opened[index]!;
    const started = unwrap(await production.start(context(`start-${station}`), { businessRequestId: `start-${station}`, productionWorkId: work.productionWorkId, stationKey: station, kind: "initial" })).attempt!;
    const input = { businessRequestId: `output-${station}`, productionAttemptId: started.productionAttemptId, goodQuantityDelta: quantity, wasteQuantityDelta: 1 };
    const recorded = unwrap(await production.recordOutput(context(input.businessRequestId), input));
    const beforeReplay = audits;
    assert.deepEqual(unwrap(await production.recordOutput(context(input.businessRequestId), input)), recorded);
    assert.equal(audits, beforeReplay, "output replay cannot duplicate audit");
    const changed = await production.recordOutput(context(input.businessRequestId), { ...input, wasteQuantityDelta: 2 });
    assert(!changed.ok && changed.error.code === "IDEMPOTENCY_CONFLICT", "changed intent is not a replay");
    assert.equal(attempts.get(started.productionAttemptId)!.goodQuantity, quantity);
    assert.equal(attempts.get(started.productionAttemptId)!.wasteQuantity, 1);
    const excess = await production.recordOutput(context(`excess-${station}`), { ...input, businessRequestId: `excess-${station}`, goodQuantityDelta: 1 });
    assert(!excess.ok && excess.error.code === "CONFLICT", "a fresh request cannot double-record the satisfied quantity");
    assert.equal(projection(work.productionWorkId).unitQuantitySatisfied, false, "recorded output is not completed output");
    assert.equal((await advance(station, `recorded-route-${station}`)).ok, false);
    const completeInput = { businessRequestId: `complete-${station}`, productionAttemptId: started.productionAttemptId };
    const completed = unwrap(await production.complete(context(completeInput.businessRequestId), completeInput));
    assert.deepEqual(unwrap(await production.complete(context(completeInput.businessRequestId), completeInput)), completed);
    const late = await production.recordOutput(context(`late-${station}`), { ...input, businessRequestId: `late-${station}`, goodQuantityDelta: 0 });
    assert(!late.ok && late.error.code === "CONFLICT", "completed output history is immutable");
    assert.deepEqual(attempts.get(started.productionAttemptId), completed.attempt);
    assert.equal(routeWrites, 0, "attempt completion never bypasses Routing authority");
    assert.equal(handoffs.size, 0, "Production never fabricates a customer handoff");
    if (station === "roll") {
      assert.equal(projection(opened[1]!.productionWorkId).state, "ready");
      assert(eligibility().blockers.some(b => b.orderLineId === "line-flatbed" && b.kind === "production_incomplete"));
      assert.equal(reconciledOrderState("open", eligibility(), true), "open", "Roll alone cannot close even a paid parent");
      const early = await fulfillment.recordPickup(context("early-mixed-pickup"), { businessRequestId: "early-mixed-pickup", orderId, allocations: opened.map(w => ({ orderLineId: w.orderLineId, quantity })) });
      assert.equal(early.ok, false); assert.equal(handoffs.size, 0);
    }
  }
  assert.equal(outputWrites, 2); assert.equal(completionWrites, 2); assert.equal(attempts.size, 2);
  for (const station of stations) {
    const route = routes.get(`line-${station}`)!;
    const input = { businessRequestId: `handoff-route-${station}`, routeInstanceId: route.routeInstanceId, expectedRevision: route.revision };
    const handed = unwrap(await routing.completeCurrentStep(context(input.businessRequestId), input));
    assert.equal(handed.nextStep?.kind, "fulfillment");
    assert.deepEqual(unwrap(await routing.completeCurrentStep(context(input.businessRequestId), input)), handed);
    assert.equal((await advance(station, `premature-route-close-${station}`)).ok, false);
  }
  assert.equal(routeWrites, 2);
  const pickup = { businessRequestId: "mixed-pickup", orderId, allocations: opened.map(w => ({ orderLineId: w.orderLineId, quantity })) };
  const handed = unwrap(await fulfillment.recordPickup(context(pickup.businessRequestId), pickup));
  assert.deepEqual(unwrap(await fulfillment.recordPickup(context(pickup.businessRequestId), pickup)), handed);
  assert.equal(handoffs.size, 1); assert.equal(allocations.length, 2); assert.equal(snapshots.size, 1);
  assert(availability().every(a => a.availableFulfillmentQuantity === 0 && a.completedFulfillmentQuantity === quantity));
  assert.equal((await fulfillment.recordPickup(context("duplicate-physical-output"), { ...pickup, businessRequestId: "duplicate-physical-output" })).ok, false);
  for (const station of stations) unwrap(await advance(station, `close-${station}`));
  assert.equal(eligibility().eligible, true);
  assert.equal(reconciledOrderState("open", eligibility(), true), "completed", "only fully routed, fulfilled, settled parent can close");
  console.log(JSON.stringify({ quantity, canonicalWorks: works.size, attempts: attempts.size, outputWrites, completionWrites, routeWrites, customerHandoffs: handoffs.size, allocations: allocations.length, engine: "pure transaction ports", databaseWrites: false }));
}
console.log("Mixed Roll + Flatbed canonical lifecycle regression passed for quantities 1, 10, 100.");
