import assert from "node:assert/strict";
import { completeProductionAndHandoff, type ProductionCompletionPorts } from "./productionCompletionHandoff";
import type { OrderRead, ProductionWorkProjection } from "./api";

const route = (id: string, satisfied: boolean): OrderRead["routes"][number] => ({
  routeInstanceId: id, work: { orderLineId: id },
  state: "active", revision: "4", currentStepId: `${id}-print`, currentPrerequisite: { satisfied },
  steps: [{ routeInstanceStepId: `${id}-print`, position: 0, kind: "production" }, { routeInstanceStepId: `${id}-pack`, position: 1, kind: "fulfillment" }],
});
let routes = [route("roll", true), route("flatbed", false)];
let satisfied = true;
const completions: string[] = [], advances: string[] = [];
const ports: ProductionCompletionPorts = {
  complete: async (_org, _attempt, key) => { completions.push(key); },
  readWork: async () => ({ work: { productionWorkId: "work", orderId: "mixed-order", orderLineId: "roll" }, unitQuantitySatisfied: satisfied }) as ProductionWorkProjection,
  readOrder: async () => ({ order: { organizationId: "org", orderId: "mixed-order" }, routes,
    completionEligibility: { lines: routes.map(item => ({ orderLineId: item.work.orderLineId, workflowIntent: "standard_production" as const, routeRequired: true, productionRequired: true, productionComplete: item.currentPrerequisite?.satisfied === true })) } }),
  advance: async (_org, id, key, revision) => {
    assert.equal(revision, "4"); advances.push(key);
    routes = routes.map(item => item.routeInstanceId === id ? { ...item, revision: "5", currentStepId: `${id}-pack` } : item);
  },
};
const input = { organizationId: "org", workId: "work", attemptId: "attempt-roll", canAdvanceRouting: true };
assert.match(await completeProductionAndHandoff(ports, input), /remains in production/);
assert.equal(advances.length, 0, "Roll cannot hand off the mixed Order while Flatbed is outstanding");
routes = [route("roll", true), route("flatbed", true)];
assert.match(await completeProductionAndHandoff(ports, { ...input, attemptId: "attempt-flatbed" }), /handoff completed/);
assert.deepEqual(advances, ["production-handoff:roll:roll-print", "production-handoff:flatbed:flatbed-print"]);
await completeProductionAndHandoff(ports, { ...input, attemptId: "attempt-flatbed" });
assert.equal(advances.length, 2, "Reload/retry must not complete the fulfillment step");
assert.equal(completions.at(-1), completions.at(-2), "Completion retry retains its exact request identity");
satisfied = false;
assert.match(await completeProductionAndHandoff(ports, input), /quantity remains outstanding/);
assert.equal(advances.length, 2);
satisfied = true;
assert.match(await completeProductionAndHandoff(ports, { ...input, canAdvanceRouting: false }), /permissions are required/);
assert.equal(advances.length, 2);
routes = [route("roll", true), route("flatbed", true)];
const keys: string[] = [];
let lost = true;
const uncertain: ProductionCompletionPorts = { ...ports, advance: async (_org, id, key) => {
  keys.push(key); if (lost) { lost = false; throw new Error("Lost handoff response"); }
  routes = routes.map(item => item.routeInstanceId === id ? { ...item, currentStepId: `${id}-pack` } : item);
} };
await assert.rejects(completeProductionAndHandoff(uncertain, input), /Lost handoff response/);
await completeProductionAndHandoff(uncertain, input);
assert.equal(keys[0], keys[1], "Uncertain route retry preserves the exact owner request");
const goodRead = await ports.readOrder("org", "mixed-order");
await assert.rejects(completeProductionAndHandoff({ ...ports, readOrder: async () => ({ ...goodRead, completionEligibility: { lines: [] } }) }, input), /coverage is unavailable/);
await assert.rejects(completeProductionAndHandoff({ ...ports, readOrder: async () => ({ ...goodRead, completionEligibility: { lines: goodRead.completionEligibility.lines.map(line => ({ ...line, workflowIntent: "unavailable", productionRequired: false, routeRequired: false })) } }) }, input), /coverage is unavailable/);
await assert.rejects(completeProductionAndHandoff({ ...ports, readOrder: async () => ({ ...goodRead, routes: goodRead.routes.map(item => ({ ...item, currentStepId: "missing" })) }) }, input), /route-step evidence is unavailable/);
console.log("Production completion handoff: mixed-station, partial quantity, permissions and exact retry checks passed.");
