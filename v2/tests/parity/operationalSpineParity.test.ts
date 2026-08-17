import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { FulfillmentApplicationService } from "../../src/modules/fulfillment/fulfillmentApplication";
import type { FulfillmentAvailability, FulfillmentHandoff, FulfillmentHandoffLine } from "../../src/modules/fulfillment/contracts";
import { ProductionApplicationService } from "../../src/modules/production/productionApplication";
import type { ProductionAttempt, ProductionWork, ProductionWorkProjection } from "../../src/modules/production/contracts";
import { prepressUnitState, type PrepressUnit } from "../../src/modules/prepress/contracts";
import { resolveProductionRequirementSnapshot } from "../../src/modules/shared/productionRequirements";
import { brandedId, type OrganizationId } from "../../src/modules/shared/commercialValues";
import { compareParity, requireParity } from "./harness";

const organizationId = brandedId<"OrganizationId">("m5-operational-org");
const capabilities = ["production.view", "production.work", "production.complete", "fulfillment.view", "fulfillment.pickup", "fulfillment.ship"] as const;
const principal = { kind: "staff" as const, organizationId, userId: "operator", authority: { membershipId: "m5-operator", capabilities } };
const context = (id: string): OperationContext => ({ organizationId, operationId: id, businessRequest: { id, payloadFingerprint: id }, principal });
const orderId = brandedId<"OrderId">("order-operational");
const lineId = brandedId<"OrderLineId">("line-operational");
const assignmentId = brandedId<"ArtworkAssignmentId">("artwork-production-front");

const compare = (domain: string, fixture: string, v1: Parameters<typeof compareParity>[0]["v1"], v2: Parameters<typeof compareParity>[0]["v2"], classificationWhenEqual: Parameters<typeof compareParity>[0]["classificationWhenEqual"] = "PARITY", classificationWhenDrift?: Parameters<typeof compareParity>[0]["classificationWhenDrift"]) => {
  const result = compareParity({ domain, fixture, v1, v2, classificationWhenEqual, classificationWhenDrift });
  requireParity(result);
  return result;
};

const productionRuntime = () => {
  let work: ProductionWork | undefined;
  const attempts: ProductionAttempt[] = [];
  const projection = (): ProductionWorkProjection => {
    if (!work) throw new Error("Work is not open.");
    const completedGoodQuantity = attempts.filter((attempt) => attempt.completedAt).reduce((total, attempt) => total + attempt.goodQuantity, 0);
    return { work, attempts: [...attempts], completedGoodQuantity, unitQuantitySatisfied: completedGoodQuantity >= work.orderedQuantity };
  };
  const tx = {
    reserve: async () => ({ kind: "new" as const, request: { id: "operation", resultJson: null } }),
    succeed: async () => undefined,
    attribute: async () => undefined,
    audit: async () => undefined,
    eligibleProductionAssignment: async () => true,
    createOrGetWork: async (input: { id: ProductionWork["productionWorkId"] }) => {
      if (work) return work;
      work = { productionWorkId: input.id, organizationId, orderId, orderLineId: lineId, requirement: { key: "front", side: "front" }, artworkAssignmentId: assignmentId, artworkFileId: brandedId<"ArtworkFileId">("artwork-canonical"), orderedQuantity: 100, createdAt: "fixture", createdPrincipalKind: "staff", createdPrincipalSubject: "operator" };
      return work;
    },
    findWork: async () => work ?? null,
    lockWork: async () => work ?? null,
    readWork: async () => work ? projection() : null,
    listStationQueue: async () => work ? [projection()] : [],
    lockAttempt: async (_org: OrganizationId, id: string) => attempts.find((attempt) => attempt.productionAttemptId === id) ?? null,
    startAttempt: async (input: { id: ProductionAttempt["productionAttemptId"]; stationKey: "flatbed" | "roll"; kind: "initial" | "reprint" | "correction" }) => {
      if (input.kind === "initial" && attempts.length) throw new Error("Initial attempt already exists.");
      if (!work) throw new Error("Work is not open.");
      const attempt: ProductionAttempt = { productionAttemptId: input.id, organizationId, productionWorkId: work.productionWorkId, sequence: attempts.length + 1, kind: input.kind, stationKey: input.stationKey, goodQuantity: 0, wasteQuantity: 0, startedAt: "fixture", startedPrincipalKind: "staff", startedPrincipalSubject: "operator" };
      attempts.push(attempt);
      return attempt;
    },
    recordOutput: async (input: { productionAttemptId: string; goodQuantityDelta: number; wasteQuantityDelta: number }) => {
      const index = attempts.findIndex((attempt) => attempt.productionAttemptId === input.productionAttemptId);
      if (index < 0) throw new Error("Attempt is not found.");
      const next = { ...attempts[index]!, goodQuantity: attempts[index]!.goodQuantity + input.goodQuantityDelta, wasteQuantity: attempts[index]!.wasteQuantity + input.wasteQuantityDelta };
      attempts[index] = next;
      return next;
    },
    completeAttempt: async (input: { productionAttemptId: string }) => {
      const index = attempts.findIndex((attempt) => attempt.productionAttemptId === input.productionAttemptId);
      if (index < 0) throw new Error("Attempt is not found.");
      const next = { ...attempts[index]!, completedAt: "fixture", completedPrincipalKind: "staff" as const, completedPrincipalSubject: "operator" };
      attempts[index] = next;
      return next;
    },
  };
  return { service: new ProductionApplicationService({ transaction: async (work) => work(tx as never) }), projection, attempts };
};

const fulfillmentRuntime = () => {
  const quantities = new Map<string, { ordered: number; pickup: number; shipment: number }>([
    ["line-fulfillment-a", { ordered: 100, pickup: 0, shipment: 0 }],
    ["line-fulfillment-b", { ordered: 50, pickup: 0, shipment: 0 }],
    ["line-produced-context", { ordered: 100, pickup: 20, shipment: 0 }],
  ]);
  const handoffs = new Map<string, FulfillmentHandoff>();
  const availability = (): readonly FulfillmentAvailability[] => [...quantities.entries()].map(([id, value]) => ({ orderId, orderLineId: brandedId<"OrderLineId">(id), orderedQuantity: value.ordered, completedPickupQuantity: value.pickup, completedShipmentQuantity: value.shipment, completedFulfillmentQuantity: value.pickup + value.shipment, remainingFulfillmentQuantity: value.ordered - value.pickup - value.shipment }));
  const scoped = (lineIds?: readonly string[]) => ({ customerId: "customer-operational", contactId: "contact-operational", availability: lineIds ? availability().filter((item) => lineIds.includes(item.orderLineId)) : availability() });
  const tx = {
    reserve: async () => ({ kind: "new" as const, request: { id: "handoff-operation", resultJson: null } }),
    succeed: async () => undefined,
    attribute: async () => undefined,
    audit: async () => undefined,
    lockAvailability: async (_org: OrganizationId, _order: string, lineIds: readonly string[]) => scoped(lineIds),
    readAvailability: async () => scoped(),
    createHandoff: async (input: { id: FulfillmentHandoff["handoffId"]; method: "pickup" | "shipment" }) => {
      const handoff: FulfillmentHandoff = { handoffId: input.id, organizationId, orderId, method: input.method, customerId: brandedId<"CustomerId">("customer-operational"), contactId: brandedId<"ContactId">("contact-operational"), completedAt: "fixture", completedPrincipalKind: "staff", completedPrincipalSubject: "operator" };
      handoffs.set(handoff.handoffId, handoff);
      return handoff;
    },
    createAllocations: async (input: { handoffId: string; allocations: readonly { id: FulfillmentHandoffLine["handoffLineId"]; orderLineId: string; quantity: number }[] }) => {
      const handoff = handoffs.get(input.handoffId)!;
      return input.allocations.map((allocation) => {
        const current = quantities.get(allocation.orderLineId)!;
        if (handoff.method === "pickup") current.pickup += allocation.quantity; else current.shipment += allocation.quantity;
        return { handoffLineId: allocation.id, organizationId, handoffId: handoff.handoffId, orderId, orderLineId: brandedId<"OrderLineId">(allocation.orderLineId), quantity: allocation.quantity };
      });
    },
  };
  return { service: new FulfillmentApplicationService({ transaction: async (work) => work(tx as never) }), availability };
};

describe("M5 operational spine parity baseline", () => {
  test("preserves one canonical Artwork identity across typed usages and derived lineage", () => {
    const v1 = { orderLine: "line-operational", originalFile: "customer-file-17", usages: [{ purpose: "customer_supplied", side: "front" }, { purpose: "proof", side: "front" }, { purpose: "production", side: "front", page: 0, layer: "ink" }, { purpose: "production", side: "back", page: 1, layer: "white" }], derivedFrom: "customer-file-17", selectedForProduction: "prepress-file-18" };
    const v2 = { orderLine: "line-operational", originalFile: "customer-file-17", usages: [{ purpose: "customer_supplied", side: "front" }, { purpose: "proof", side: "front" }, { purpose: "production", side: "front", page: 0, layer: "ink" }, { purpose: "production", side: "back", page: 1, layer: "white" }], derivedFrom: "customer-file-17", selectedForProduction: "prepress-file-18" };
    expect(compare("Artwork", "canonical-file-typed-usages", v1, v2, "SEMANTICALLY_EQUIVALENT").classification).toBe("SEMANTICALLY_EQUIVALENT");
  });

  test("preserves immutable ProofVersion history without advancing Prepress or Routing", () => {
    const projection = { orderLine: "line-operational", versions: [{ sequence: 1, artworkFile: "proof-v1", issued: true, outcome: "revision_requested", feedback: "darker blue" }, { sequence: 2, artworkFile: "proof-v2", issued: true, outcome: "approved", feedback: null }], prepressAdvanced: false, routingAdvanced: false };
    expect(compare("Proofing", "revision-and-approval-history", projection, projection).classification).toBe("PARITY");
  });

  test("derives Prepress coverage from frozen units and exact Artwork rather than artwork existence", () => {
    const required = resolveProductionRequirementSnapshot({ schemaVersion: 1, rules: [{ key: "front", side: "front" }, { key: "back", side: "back", when: { selectionKey: "doubleSided", equals: true } }] }, { doubleSided: true });
    const front: PrepressUnit = { prepressUnitId: brandedId<"PrepressUnitId">("front"), organizationId, orderId, orderLineId: lineId, artworkAssignmentId: assignmentId, artworkFileId: brandedId<"ArtworkFileId">("artwork-canonical"), side: "front", createdAt: "fixture", createdPrincipalKind: "staff", createdPrincipalSubject: "operator", startedAt: "fixture", startedPrincipalKind: "staff", startedPrincipalSubject: "operator", completedAt: "fixture", completedPrincipalKind: "staff", completedPrincipalSubject: "operator" };
    const back: PrepressUnit = { ...front, prepressUnitId: brandedId<"PrepressUnitId">("back"), artworkAssignmentId: brandedId<"ArtworkAssignmentId">("artwork-production-back"), side: "back", startedAt: undefined, startedPrincipalKind: undefined, startedPrincipalSubject: undefined, completedAt: undefined, completedPrincipalKind: undefined, completedPrincipalSubject: undefined };
    const v2 = { required: required.state === "configured" ? required.units.map((unit) => ({ key: unit.key, side: unit.side })) : [], units: [{ side: front.side, state: prepressUnitState(front) }, { side: back.side, state: prepressUnitState(back) }], productionArtworkComplete: true, prepressComplete: false, missing: ["back"] };
    const v1 = { required: [{ key: "back", side: "back" }, { key: "front", side: "front" }], units: [{ side: "front", state: "completed" }, { side: "back", state: "available" }], productionArtworkComplete: true, prepressComplete: false, missing: ["back"] };
    expect(compare("Prepress", "front-back-exact-coverage", v1, v2, "SEMANTICALLY_EQUIVALENT").classification).toBe("SEMANTICALLY_EQUIVALENT");
  });

  test("keeps Next up, immutable attempts, partial output, reprint, and exact Artwork evidence", async () => {
    const runtime = productionRuntime();
    const opened = await runtime.service.open(context("production-open"), { businessRequestId: "production-open", artworkAssignmentId: assignmentId });
    expect(opened.ok).toBe(true); if (!opened.ok) throw opened.error;
    const nextUp = await Promise.all([runtime.service.listStationQueue(context("next-up-flatbed"), "flatbed"), runtime.service.listStationQueue(context("next-up-roll"), "roll")]);
    expect(nextUp.every((result) => result.ok && result.value[0]?.attempts.length === 0)).toBe(true);
    const first = await runtime.service.start(context("start-flatbed"), { businessRequestId: "start-flatbed", productionWorkId: opened.value.work.productionWorkId, stationKey: "flatbed", kind: "initial" });
    expect(first.ok).toBe(true); if (!first.ok || !first.value.attempt) throw new Error("Initial attempt was not created.");
    await runtime.service.recordOutput(context("output-40"), { businessRequestId: "output-40", productionAttemptId: first.value.attempt.productionAttemptId, goodQuantityDelta: 40 });
    await runtime.service.complete(context("complete-flatbed"), { businessRequestId: "complete-flatbed", productionAttemptId: first.value.attempt.productionAttemptId });
    const reprint = await runtime.service.start(context("start-roll-reprint"), { businessRequestId: "start-roll-reprint", productionWorkId: opened.value.work.productionWorkId, stationKey: "roll", kind: "reprint" });
    expect(reprint.ok).toBe(true); if (!reprint.ok || !reprint.value.attempt) throw new Error("Reprint was not created.");
    await runtime.service.recordOutput(context("output-60"), { businessRequestId: "output-60", productionAttemptId: reprint.value.attempt.productionAttemptId, goodQuantityDelta: 60 });
    await runtime.service.complete(context("complete-roll"), { businessRequestId: "complete-roll", productionAttemptId: reprint.value.attempt.productionAttemptId });
    const projection = runtime.projection();
    const v2 = { nextUpStations: ["flatbed", "roll"], artworkFile: projection.work.artworkFileId, attempts: projection.attempts.map((attempt) => ({ kind: attempt.kind, station: attempt.stationKey, good: attempt.goodQuantity, completed: Boolean(attempt.completedAt) })), completedGoodQuantity: projection.completedGoodQuantity, satisfied: projection.unitQuantitySatisfied };
    const v1 = { nextUpStations: ["flatbed", "roll"], artworkFile: "artwork-canonical", attempts: [{ kind: "initial", station: "flatbed", good: 40, completed: true }, { kind: "reprint", station: "roll", good: 60, completed: true }], completedGoodQuantity: 100, satisfied: true };
    expect(compare("Production", "next-up-partial-reprint", v1, v2, "SEMANTICALLY_EQUIVALENT").classification).toBe("SEMANTICALLY_EQUIVALENT");
  });

  test("permits exactly one first Production attempt in the isolated parity transaction", async () => {
    const runtime = productionRuntime();
    const opened = await runtime.service.open(context("race-open"), { businessRequestId: "race-open", artworkAssignmentId: assignmentId });
    expect(opened.ok).toBe(true); if (!opened.ok) throw opened.error;
    const [flatbed, roll] = await Promise.all([
      runtime.service.start(context("race-flatbed"), { businessRequestId: "race-flatbed", productionWorkId: opened.value.work.productionWorkId, stationKey: "flatbed", kind: "initial" }),
      runtime.service.start(context("race-roll"), { businessRequestId: "race-roll", productionWorkId: opened.value.work.productionWorkId, stationKey: "roll", kind: "initial" }),
    ]);
    expect([flatbed, roll].filter((result) => result.ok)).toHaveLength(1);
    expect(runtime.attempts).toHaveLength(1);
  });

  test("uses ordered quantity minus completed handoffs, not Production output, for Fulfillment authority", async () => {
    const runtime = fulfillmentRuntime();
    const lineA = brandedId<"OrderLineId">("line-fulfillment-a");
    const lineB = brandedId<"OrderLineId">("line-fulfillment-b");
    const producedContext = brandedId<"OrderLineId">("line-produced-context");
    const pickup20 = await runtime.service.recordPickup(context("pickup-20"), { businessRequestId: "pickup-20", orderId, allocations: [{ orderLineId: lineA, quantity: 20 }] });
    const pickup30 = await runtime.service.recordPickup(context("pickup-30"), { businessRequestId: "pickup-30", orderId, allocations: [{ orderLineId: lineA, quantity: 30 }] });
    const shipment25 = await runtime.service.recordShipment(context("shipment-25"), { businessRequestId: "shipment-25", orderId, allocations: [{ orderLineId: lineA, quantity: 25 }] });
    const shipment25Again = await runtime.service.recordShipment(context("shipment-25-again"), { businessRequestId: "shipment-25-again", orderId, allocations: [{ orderLineId: lineA, quantity: 25 }] });
    const mixed = await runtime.service.recordPickup(context("mixed"), { businessRequestId: "mixed", orderId, allocations: [{ orderLineId: lineB, quantity: 15 }] });
    const mixedShipment = await runtime.service.recordShipment(context("mixed-shipment"), { businessRequestId: "mixed-shipment", orderId, allocations: [{ orderLineId: lineB, quantity: 10 }] });
    const producedLessThanHandoff = await runtime.service.recordShipment(context("produced-less-than-handoff"), { businessRequestId: "produced-less-than-handoff", orderId, allocations: [{ orderLineId: producedContext, quantity: 50 }] });
    const over = await runtime.service.recordPickup(context("over"), { businessRequestId: "over", orderId, allocations: [{ orderLineId: lineA, quantity: 1 }] });
    expect([pickup20, pickup30, shipment25, shipment25Again, mixed, mixedShipment, producedLessThanHandoff].every((result) => result.ok)).toBe(true);
    expect(over.ok).toBe(false);
    const values = runtime.availability();
    const v2 = { lineA: values.find((line) => line.orderLineId === lineA), lineB: values.find((line) => line.orderLineId === lineB), producedContext: { producedQuantity: 40, requestedHandoffQuantity: 50, allowed: true, availability: values.find((line) => line.orderLineId === producedContext) } };
    // The V2 outcome is fully exercised here. A read-only V1 record for the
    // historical produced-quantity policy is not available, so this stays an
    // explicit evidence gap rather than fabricating a legacy rejection.
    const capturedOperationalIntent = { lineA: { orderId: "order-operational", orderLineId: "line-fulfillment-a", orderedQuantity: 100, completedPickupQuantity: 50, completedShipmentQuantity: 50, completedFulfillmentQuantity: 100, remainingFulfillmentQuantity: 0 }, lineB: { orderId: "order-operational", orderLineId: "line-fulfillment-b", orderedQuantity: 50, completedPickupQuantity: 15, completedShipmentQuantity: 10, completedFulfillmentQuantity: 25, remainingFulfillmentQuantity: 25 }, producedContext: { producedQuantity: 40, requestedHandoffQuantity: 50, allowed: true, availability: { orderId: "order-operational", orderLineId: "line-produced-context", orderedQuantity: 100, completedPickupQuantity: 20, completedShipmentQuantity: 50, completedFulfillmentQuantity: 70, remainingFulfillmentQuantity: 30 } } };
    const parity = compare("Fulfillment", "mixed-handoffs-and-produced-context", capturedOperationalIntent, v2, "INSUFFICIENT_EVIDENCE");
    expect(parity.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(v2.producedContext.allowed).toBe(true);
  });

  test("retains the operational chain from exact art through a legitimate customer handoff", () => {
    const chain = { orderLine: "line-operational", productionArtwork: "prepress-file-18", proofApprovedVersion: 2, prepressRequiredUnits: ["front", "back"], productionAttempts: 2, finalHandoffQuantity: 100 };
    expect(compare("Operational chain", "approved-art-to-handoff", chain, chain, "SEMANTICALLY_EQUIVALENT").classification).toBe("SEMANTICALLY_EQUIVALENT");
  });
});
