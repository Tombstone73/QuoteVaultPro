import assert from "node:assert/strict";
import type { OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import { ShipmentContainerApplicationService, type ShipmentContainerTransaction } from "../../src/modules/fulfillment/shipmentContainerApplication.js";
import type { FulfillmentShipmentContainerDetail, ShipmentPreparedAllocation, ShipmentPreparedRevision } from "../../src/modules/fulfillment/shipmentContainer.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const org = brandedId<"OrganizationId">("shipment-auth-org");
const ship: readonly Capability[] = ["fulfillment.ship"], both: readonly Capability[] = [...ship, "fulfillment.replace"];
const context = (id: string, capabilities = ship, organizationId: string = org): OperationContext => ({ organizationId, operationId: id,
  businessRequest: { id, payloadFingerprint: "untrusted-route-value" }, principal: { kind: "staff", organizationId, userId: "operator",
    authority: { membershipId: "membership", capabilities } } });
const original: ShipmentPreparedAllocation = { orderId: "order", orderLineId: "line", quantity: 1 };
const replacement: ShipmentPreparedAllocation = { ...original, replacementObligationId: "replacement" };
const denied = (result: ApplicationResult<unknown>, code = "FORBIDDEN") => { assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, code); };
const value = <T>(result: ApplicationResult<T>): T => { assert.ok(result.ok, result.ok ? "" : result.error.publicMessage); return result.value; };

function harness() {
  const calls: string[] = [], receipts = new Map<string, { id: string; fingerprint: string; result?: unknown }>(), revisions = new Map<string, ShipmentPreparedRevision>();
  let current: FulfillmentShipmentContainerDetail | null = null, locked = false, resumed = false;
  const revision = (allocations: readonly ShipmentPreparedAllocation[], prior?: ShipmentPreparedRevision): ShipmentPreparedRevision => ({
    revisionId: `revision-${revisions.size + 1}`, shipmentId: "shipment", organizationId: org, revisionNumber: prior ? prior.revisionNumber + 1 : 1,
    kind: prior ? "correction" : "initial", ...(prior ? { supersedesRevisionId: prior.revisionId } : {}), allocations,
    carrier: { status: "prepared" }, createdAt: "2026-10-01T00:00:00.000Z", createdPrincipalKind: "staff", createdPrincipalSubject: "operator" });
  const store = (next: ShipmentPreparedRevision) => {
    revisions.set(next.revisionId, structuredClone(next));
    current = { shipmentId: "shipment", organizationId: org, status: "prepared", carrier: { status: "prepared" },
      preparedRevisionId: next.revisionId, currentPreparedRevision: next, events: [], createdAt: next.createdAt, createdPrincipalKind: "staff", createdPrincipalSubject: "operator" };
    return structuredClone(current);
  };
  const mutation = (name: string) => { assert.ok(locked, "scope and mutation use the held transaction lock"); calls.push(name, "availability"); };
  const tx: ShipmentContainerTransaction = {
    async reserve(input) {
      calls.push("reserve");
      const key = `${input.organizationId}:${input.operation}:${input.businessRequestId}`, existing = receipts.get(key);
      if (existing) {
        if (existing.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Payload changed");
        return { kind: "replay", request: { id: existing.id, resultJson: existing.result } };
      }
      const request = { id: `request-${receipts.size}`, fingerprint: input.payloadFingerprint };
      receipts.set(key, request);
      return { kind: resumed ? "resumed" : "new", request: { id: request.id, resultJson: null } };
    },
    async succeed(_org, id, result) { calls.push("succeed"); const receipt = [...receipts.values()].find(item => item.id === id)!; receipt.result = structuredClone(result); },
    async create() { throw Error("Legacy create not used"); }, async attach() { throw Error("No attach"); }, async markShipped() { throw Error("No markShipped"); },
    async createPrepared(input) { calls.push("create", "availability"); return store(revision(input.allocations)); },
    async get(organizationId, shipmentId, options) {
      if (options?.forUpdate) { calls.push("lock"); locked = true; } else calls.push("get");
      if (organizationId !== org || shipmentId !== current?.shipmentId) return null;
      const detail = structuredClone(current), saved = detail.currentPreparedRevision;
      if (options?.forUpdate) Object.defineProperty(detail, "currentPreparedRevision", { get() { assert.ok(locked, "active scope inspection follows the lock"); calls.push("scope"); return saved; } });
      return detail;
    },
    async getPreparedRevision(organizationId, shipmentId, id) {
      assert.ok(locked, "historical scope inspection follows the lock"); calls.push(`prior:${id}`);
      return organizationId === org && shipmentId === "shipment" ? structuredClone(revisions.get(id) ?? null) : null;
    },
    async correctPrepared(input) { mutation("correct"); return store(revision(input.allocations, current!.currentPreparedRevision)); },
    async finalizePrepared(input) {
      mutation("finalize"); assert.equal(input.expectedPreparedRevisionId, current?.preparedRevisionId);
      current = { ...current!, status: "shipped", carrier: { status: "shipped", shippedAt: "2026-10-01T01:00:00.000Z" } }; return structuredClone(current);
    },
    async voidPrepared() { mutation("void"); current = { ...current!, status: "voided", carrier: { status: "voided" } }; return structuredClone(current); },
  };
  class TracedPolicy extends AuthorityPolicy {
    override decide(...args: Parameters<AuthorityPolicy["decide"]>) {
      calls.push(`allow:${args[1].capability}`);
      if (args[1].capability === "fulfillment.replace" && current) assert.ok(locked, "replacement decision holds the shipment lock");
      return super.decide(...args);
    }
  }
  const service = new ShipmentContainerApplicationService({ transaction: async work => {
    calls.push("begin"); locked = false;
    const before = new Map(structuredClone([...receipts]));
    try { const result = await work(tx); calls.push("commit"); return result; }
    catch (error) { receipts.clear(); for (const [key, receipt] of before) receipts.set(key, receipt); calls.push("rollback"); throw error; }
    finally { locked = false; }
  } }, new TracedPolicy(), { reconcileOrder: async () => { calls.push("reconcile"); }, reconcileInvoice: async () => undefined });
  return { service, tx, calls, receipts, revisions, seed: (allocations = [replacement]) => store(revision(allocations)), resume: () => { resumed = true; } };
}
const noEffects = (calls: string[], lifecycleReplay = false) => {assert.ok(!calls.some(call => ["create", "correct", "void", "finalize", "availability", "succeed", ...(lifecycleReplay?[]:["reconcile"])].includes(call)), calls.join(","));if(lifecycleReplay)assert.equal(calls.filter(call=>call==="reconcile").length,1,"authorized finalization replay repairs postcommit lifecycle only");};
const cases: [string, () => Promise<void>][] = [];

cases.push(["new/resumed and mixed replacement creates deny before domain writes", async () => {
  for (const resume of [false, true]) for (const allocations of [[replacement], [original, replacement]]) {
    const h = harness(); if (resume) h.resume();
    denied(await h.service.createPrepared(context("create"), { allocations })); noEffects(h.calls); assert.equal(h.receipts.size, 0);
    value(await h.service.createPrepared(context("create", both), { allocations }));
  }
}]);
cases.push(["current plus proposed scope includes both adding and removing replacement", async () => {
  for (const [before, after] of [[[replacement], [original]], [[original], [replacement]], [[original, replacement], [original]]]) {
    const h = harness(); h.seed(before);
    denied(await h.service.correctPrepared(context("correct"), { shipmentId: "shipment", allocations: after, reason: "Correction" })); noEffects(h.calls);
    assert.ok(h.calls.indexOf("lock") < h.calls.indexOf("scope"));
    assert.ok(h.calls.indexOf("scope") < h.calls.indexOf("allow:fulfillment.replace"));
  }
}]);
cases.push(["finalize/void authorize locked current replacement scope", async () => {
  for (const operation of ["finalize", "void"] as const) {
    const h = harness(), initial = h.seed();
    const run = (capabilities = ship) => operation === "finalize"
      ? h.service.finalize(context(operation, capabilities), { shipmentId: "shipment", expectedPreparedRevisionId: initial.preparedRevisionId! })
      : h.service.voidPrepared(context(operation, capabilities), { shipmentId: "shipment", reason: "Cancel" });
    denied(await run()); noEffects(h.calls);
    const accepted = value(await run(both)); h.calls.length = 0;
    denied(await run()); noEffects(h.calls); h.calls.length = 0;
    assert.deepEqual(value(await run(both)), accepted); noEffects(h.calls,operation==="finalize");
    h.calls.length = 0; denied(await run([])); assert.deepEqual(h.calls, ["allow:fulfillment.ship"]);
  }
}]);
cases.push(["removal replay requires prior authority, later original commands and their replays do not", async () => {
  const h = harness();
  const prepared = value(await h.service.createPrepared(context("prepare", both), { allocations: [replacement] }));
  const remove = { shipmentId: "shipment", allocations: [original], reason: "Remove replacement" };
  const removed = value(await h.service.correctPrepared(context("remove", both), remove)); h.calls.length = 0;
  denied(await h.service.correctPrepared(context("remove"), remove)); noEffects(h.calls);
  assert.ok(h.calls.includes(`prior:${prepared.preparedRevisionId}`)); h.calls.length = 0;
  assert.deepEqual(value(await h.service.correctPrepared(context("remove", both), remove)), removed); noEffects(h.calls);
  const laterInput = { ...remove, reason: "Later original only", carrier: { notes: "Later revision" } };
  const later = value(await h.service.correctPrepared(context("later"), laterInput));
  const latest = value(await h.service.correctPrepared(context("latest", both), { ...remove, allocations: [replacement], reason: "Add replacement later" }));
  assert.notEqual(latest.preparedRevisionId, later.preparedRevisionId); h.calls.length = 0;
  assert.deepEqual(value(await h.service.correctPrepared(context("later"), laterInput)), later); noEffects(h.calls);
  assert.ok(h.calls.includes(`prior:${removed.preparedRevisionId}`));
  assert.ok(!h.calls.includes(`prior:${prepared.preparedRevisionId}`), "not every historical replacement"); h.calls.length = 0;
  denied(await h.service.correctPrepared(context("remove"), remove)); noEffects(h.calls);
  assert.deepEqual(value(await h.service.correctPrepared(context("remove", both), remove)), removed); noEffects(h.calls);
  h.calls.length = 0; denied(await h.service.createPrepared(context("prepare"), { allocations: [replacement] })); noEffects(h.calls);
  assert.deepEqual(value(await h.service.createPrepared(context("prepare", both), { allocations: [replacement] })), prepared); noEffects(h.calls);
  denied(await h.service.correctPrepared(context("remove", both), { ...remove, reason: "Changed payload" }), "IDEMPOTENCY_CONFLICT");
  denied(await h.service.createPrepared(context("prepare", both), { allocations: [original] }), "IDEMPOTENCY_CONFLICT");
  denied(await h.service.correctPrepared(context("remove"), { ...remove, allocations: [replacement] }), "IDEMPOTENCY_CONFLICT");
  denied(await h.service.createPrepared(context("prepare"), { allocations: [original] }), "IDEMPOTENCY_CONFLICT");
  h.calls.length = 0;
  denied(await h.service.correctPrepared(context("remove", []), remove));
  denied(await h.service.createPrepared(context("prepare", []), { allocations: [replacement] }));
  assert.deepEqual(h.calls, ["allow:fulfillment.ship", "allow:fulfillment.ship"]);
}]);
cases.push(["original prepare replay uses saved allocations even when the active revision is replacement", async () => {
  const h = harness(), input = { allocations: [original] };
  const prepared = value(await h.service.createPrepared(context("prepare"), input));
  value(await h.service.correctPrepared(context("add", both), { shipmentId: "shipment", allocations: [replacement], reason: "Add replacement" }));
  h.calls.length = 0;
  assert.deepEqual(value(await h.service.createPrepared(context("prepare"), input)), prepared); noEffects(h.calls);
  assert.ok(!h.calls.includes("allow:fulfillment.replace"));
}]);
cases.push(["original-only create/correct/finalize/void retain ship-only authorization", async () => {
  for (const terminal of ["finalize", "void"] as const) {
    const h = harness(), input = { allocations: [original] };
    const first = value(await h.service.createPrepared(context("prepare"), input));
    assert.deepEqual(value(await h.service.createPrepared(context("prepare"), input)), first);
    const correction = { shipmentId: "shipment", allocations: [original], reason: "Original-only correction" };
    const corrected = value(await h.service.correctPrepared(context("correct"), correction));
    assert.deepEqual(value(await h.service.correctPrepared(context("correct"), correction)), corrected);
    const run = () => terminal === "finalize" ? h.service.finalize(context(terminal), { shipmentId: "shipment", expectedPreparedRevisionId: corrected.preparedRevisionId! })
      : h.service.voidPrepared(context(terminal), { shipmentId: "shipment", reason: "Cancel original" });
    const done = value(await run()); h.calls.length = 0; assert.deepEqual(value(await run()), done); noEffects(h.calls,terminal==="finalize");
  }
  const legacy = harness(); legacy.seed([]);
  const correction = { shipmentId: "shipment", allocations: [original], reason: "Allocate legacy empty container" };
  const corrected = value(await legacy.service.correctPrepared(context("legacy-correct"), correction));
  legacy.calls.length = 0;
  assert.deepEqual(value(await legacy.service.correctPrepared(context("legacy-correct"), correction)), corrected); noEffects(legacy.calls);
}]);
cases.push(["missing adapters and missing/inconsistent active or historical evidence fail closed", async () => {
  const corruptions: ((h: ReturnType<typeof harness>) => void)[] = [
    h => { h.tx.get = undefined; }, h => { h.tx.getPreparedRevision = undefined; }, h => { h.revisions.delete("revision-1"); },
    h => { h.revisions.set("revision-1", { ...h.revisions.get("revision-1")!, organizationId: brandedId<"OrganizationId">("foreign") }); },
    h => { h.revisions.set("revision-1", { ...h.revisions.get("revision-1")!, shipmentId: "foreign" }); },
    h => { h.revisions.set("revision-1", { ...h.revisions.get("revision-1")!, revisionId: "different" }); },
    h => { h.revisions.set("revision-1", { ...h.revisions.get("revision-1")!, revisionNumber: 9 }); },
    h => { [...h.receipts.values()][0].result = null; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, currentPreparedRevision: undefined }; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, preparedRevisionId: "mismatch" }; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, organizationId: "foreign" }; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, shipmentId: "foreign" }; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, currentPreparedRevision: { ...saved.currentPreparedRevision, allocations: undefined } }; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, currentPreparedRevision: { ...saved.currentPreparedRevision, allocations: [] } }; },
    h => { const saved = [...h.receipts.values()][0].result as FulfillmentShipmentContainerDetail; [...h.receipts.values()][0].result = { ...saved, currentPreparedRevision: { ...saved.currentPreparedRevision, supersedesRevisionId: saved.preparedRevisionId } }; },
  ];
  for (const corrupt of corruptions) {
    const h = harness(); h.seed(); const input = { shipmentId: "shipment", allocations: [original], reason: "Remove" };
    value(await h.service.correctPrepared(context("correct", both), input)); corrupt(h); h.calls.length = 0;
    const result = await h.service.correctPrepared(context("correct", both), input); assert.equal(result.ok, false); noEffects(h.calls);
  }
  for (const currentPreparedRevision of [undefined, { organizationId: "foreign" }]) {
    const h = harness(); h.seed(); h.tx.get = async () => ({ shipmentId: "shipment", organizationId: org, preparedRevisionId: "revision-1", currentPreparedRevision } as FulfillmentShipmentContainerDetail);
    denied(await h.service.voidPrepared(context("void", both), { shipmentId: "shipment", reason: "Cancel" }), "CONFLICT"); noEffects(h.calls);
  }
}]);
cases.push(["foreign tenant and revoked ship grant fail without mutation or replay", async () => {
  const h = harness(); h.seed();
  denied(await h.service.voidPrepared({ ...context("foreign", both), organizationId: "foreign" }, { shipmentId: "shipment", reason: "Cancel" }), "WRONG_TENANT");
  assert.deepEqual(h.calls, []);
  denied(await h.service.voidPrepared(context("foreign", both, "foreign"), { shipmentId: "shipment", reason: "Cancel" }), "CONFLICT"); noEffects(h.calls);
  h.calls.length = 0; denied(await h.service.createPrepared(context("missing-ship", ["fulfillment.replace"]), { allocations: [replacement] }));
  assert.deepEqual(h.calls, ["allow:fulfillment.ship"]);
}]);

for (const [name, run] of cases) { await run(); console.log(`PASS ${name}`); }
console.log(`shipmentReplacementAuthorization.pure: ${cases.length} scenarios PASS, zero skipped`);
