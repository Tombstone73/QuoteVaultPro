import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import type { ProductionWorkProjection, PrepressQueueItem } from "./api";

const require = createRequire(import.meta.url);
const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://ui.invalid" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
const React = require("react") as typeof import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
const { productionApi, prepressApi, orderApi, routingApi } = require("./api") as typeof import("./api");
const { ProductionWorkspace } = require("./ProductionWorkspace") as typeof import("./ProductionWorkspace");
const { configureProductionRecoveryTransport } = require("./productionRecoveryApi") as typeof import("./productionRecoveryApi");
configureProductionRecoveryTransport(async <T,>() => [] as T);
const work = (id: string, station: "flatbed" | "roll"): ProductionWorkProjection => ({
  work: { productionWorkId: id, orderId: "order-a", orderLineId: id, requirement: { key: "front", side: "front" }, artworkAssignmentId: "art-a", artworkFileId: "file-a", orderedQuantity: 12 },
  attempts: [{ productionAttemptId: `attempt-${id}`, productionWorkId: id, sequence: 1, kind: "initial", stationKey: station, goodQuantity: 12, wasteQuantity: 0, startedAt: "2026-10-01T00:00:00Z" }],
  completedGoodQuantity: 0, recordedGoodQuantity: 12, rejectedGoodQuantity: 0, usableGoodQuantity: 12, remainingGoodQuantity: 0, unitQuantitySatisfied: false, state: "active", exceptionEvents: [], outputDispositions: [],
  operatorContext: { orderNumber: `SO-${id}`, product: { productId: "product-a", displayName: `Canonical ${id}` }, customer: { customerId: "customer-a", displayName: "Canonical customer" } },
});
const first = work("first", "flatbed"), second = work("second", "flatbed"), roll = work("roll", "roll"), routed = work("routed", "flatbed");
const specifications = [first, second, roll, routed].map(item => ({ orderId: item.work.orderId, orderLineId: item.work.orderLineId, quantity: 12, requestedDueDate: "2026-10-20", operational: { expectedDimensions: { width: "24", height: "36", unit: "in" } } } as PrepressQueueItem));
const calls: { station: string; page: number; pageSize: number; search: string }[] = [];
let completed = false;
let specificationsAvailable = true;
productionApi.queue = async (_org, station, options) => {
  const state = { station, page: options?.page ?? 1, pageSize: options?.pageSize ?? 25, search: options?.search ?? "" };
  calls.push(state);
  return { items: station === "roll" ? [roll] : state.search === "missing" ? [] : state.page === 2 || completed ? [second] : [first], pagination: { page: state.page, pageSize: state.pageSize, totalCount: 26, totalPages: state.pageSize === 25 ? 2 : 1 } };
};
productionApi.get = async () => routed;
productionApi.materials = async () => ({ usage: { comparison: [], facts: [] }, inventory: { balances: [], facts: [] } } as never);
productionApi.complete = async () => { completed = true; return {} as never; };
prepressApi.list = async () => ({ items: specificationsAvailable ? specifications : [], pagination: { page: 1, pageSize: 100, totalCount: 4, totalPages: 1 } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: [] }), { headers: { "content-type": "application/json" } });
let root = createRoot(document.getElementById("root")!);
let client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
const text = () => document.body.textContent ?? "";
const settle = async (predicate: () => boolean) => {
  for (let index = 0; index < 100; index++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    if (predicate()) return;
  }
  assert.ok(predicate(), text());
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === label);
  assert.ok(button, `Button ${label}`);
  assert.equal(button.disabled, false);
  await act(async () => button.click());
};
const resolutions: { id: string; station: string }[] = [];
const selections: { id?: string; station?: string }[] = [];
const selectedStation = () => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? "";
const render = async (station: "flatbed" | "roll" | null = "flatbed", productionWorkId?: string, canHandoff = false, organizationId = "org-a", sessionScope = "scope-a") => {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(ProductionWorkspace, {
    organizationId, sessionScope, canView: true, canWork: true, canComplete: true, canHandoff, station: station ?? undefined, productionWorkId,
    onStationChange: () => {}, onSelectWork: (id?: string, station?: "flatbed" | "roll") => selections.push({ id, station }), openOrder: () => {}, openCustomer: () => {}, openArtwork: () => {},
    onResolveWorkStation: (id: string, station: "flatbed" | "roll") => resolutions.push({ id, station }),
  }))));
};
const reset = async () => {
  await act(async () => root.unmount()); client.clear(); sessionStorage.clear();
  root = createRoot(document.getElementById("root")!);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  completed = false;
  specificationsAvailable = true;
  resolutions.length = 0;
  selections.length = 0;
};
try {
  const originalGet = productionApi.get;
  await reset();
  productionApi.get = async () => roll;
  await render(null, "roll");
  await settle(() => selectedStation().startsWith("Roll") && text().includes("Canonical roll"));
  assert.deepEqual(resolutions, [{ id: "roll", station: "roll" }], "bare Roll bookmark restores from immutable attempt");
  await reset();
  const completedRoll = { ...roll, state: "complete" as const, attempts: [{ ...roll.attempts[0]!, sequence: 3, completedAt: "2026-10-02T00:00:00Z" }, { ...roll.attempts[0]!, productionAttemptId: "old-flatbed", sequence: 1, stationKey: "flatbed" as const, completedAt: "2026-10-01T01:00:00Z" }] };
  productionApi.get = async () => completedRoll;
  await render("flatbed", "roll");
  await settle(() => selectedStation().startsWith("Roll"));
  assert.match(text(), /Canonical roll/);
  assert.deepEqual(resolutions, [{ id: "roll", station: "roll" }], "highest sequence outside queues overrides contradictory URL hint");
  await reset();
  const unstarted = { ...roll, attempts: [], state: "ready" as const };
  productionApi.get = async () => unstarted;
  await render("roll", "roll");
  await settle(() => text().includes("Canonical roll"));
  assert.match(selectedStation(), /^Roll/);
  assert.equal(resolutions.length, 0, "unstarted canonical navigation hint survives without attempt evidence");
  await reset(); await render(null, "roll");
  await settle(() => text().includes("Station unavailable for this exact work"));
  assert.equal(selectedStation(), "", "missing destination must not select Flatbed");
  assert.equal([...document.querySelectorAll("button")].some(button => /Start|Reprint/.test(button.textContent ?? "")), false);
  await reset();
  let resolveOld!: (value: ProductionWorkProjection) => void;
  productionApi.get = async (org) => org === "org-a" ? new Promise(resolve => { resolveOld = resolve; }) : { ...routed, work: { ...routed.work, productionWorkId: "roll" } };
  await render(null, "roll"); await settle(() => Boolean(resolveOld));
  await render(null, "roll", false, "org-b", "scope-b");
  await settle(() => selectedStation().startsWith("Flatbed") && text().includes("Canonical routed"));
  await act(async () => resolveOld(roll));
  await settle(() => selectedStation().startsWith("Flatbed"));
  assert.deepEqual(resolutions, [{ id: "roll", station: "flatbed" }], "late prior org/session exact read cannot rewrite the current station even for the same requested ID");
  productionApi.get = originalGet;
  const originalQueue = productionApi.queue, originalComplete = productionApi.complete;
  await reset();
  productionApi.queue = async (_org, station) => ({ items: station === "roll" ? [unstarted] : [], pagination: { page: 1, pageSize: 25, totalCount: station === "roll" ? 1 : 0, totalPages: 1 } });
  await render(null);
  await settle(() => text().includes("Canonical roll"));
  await click("Ready for attempt");
  assert.deepEqual(selections, [{ id: "roll", station: "roll" }], "overview selection persists the actual owner queue destination for unstarted Roll work");
  productionApi.queue = originalQueue;
  for (const station of ["roll", "flatbed"] as const) {
    await reset();
    const front = work(`output-front-${station}`, station), back = work(`output-back-${station}`, station);
    let outputRecorded = false, attemptCompleted = false;
    const completionAttempts: string[] = [];
    productionApi.queue = async () => ({
      items: attemptCompleted ? [back] : [{ ...front, attempts: front.attempts.map(attempt => ({ ...attempt, goodQuantity: outputRecorded ? 12 : 0 })), recordedGoodQuantity: outputRecorded ? 12 : 0, usableGoodQuantity: 0, remainingGoodQuantity: outputRecorded ? 0 : 12 }, back],
      pagination: { page: 1, pageSize: 25, totalCount: attemptCompleted ? 1 : 2, totalPages: 1 },
    });
    productionApi.complete = async (_org, attemptId) => { completionAttempts.push(attemptId); attemptCompleted = true; return {} as never; };
    await render(station);
    await settle(() => text().includes(`Canonical output-front-${station}`));
    // Model the owner queue refetch after recording the target, before completion.
    await act(async () => {
      outputRecorded = true;
      await client.invalidateQueries({ queryKey: ["v2", "scope-a", "org-a", "production", station, "queue"] });
    });
    const completeButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Complete attempt");
    assert.ok(completeButton && !completeButton.disabled, "target output keeps the selected front attempt completable");
    await click("Complete attempt");
    await settle(() => attemptCompleted && !text().includes(`Canonical output-front-${station}`));
    assert.deepEqual(completionAttempts, [`attempt-output-front-${station}`], "completion uses the front attempt, not the back selected after completion");
    assert.match(text(), new RegExp(`Canonical output-back-${station}`));
  }
  productionApi.queue = originalQueue; productionApi.complete = originalComplete;
  await reset();
  await render();
  await settle(() => text().includes("Canonical first") && text().includes("24 x 36 in"));
  assert.match(text(), /SO-first/); assert.match(text(), /Canonical customer/); assert.match(text(), /2026-10-20/);
  assert.match(text(), /0 \/ 12/); assert.match(text(), /26 jobs/);
  await click("Next");
  await settle(() => text().includes("Canonical second") && !text().includes("Canonical first"));
  assert.ok(calls.some(call => call.station === "flatbed" && call.page === 2));
  const rows = document.querySelector<HTMLSelectElement>('.v2-queue-pager select');
  assert.ok(rows, "Queue page size selector");
  await act(async () => { rows.value = "50"; rows.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await settle(() => calls.some(call => call.station === "flatbed" && call.pageSize === 50 && call.page === 1));
  const input = document.querySelector<HTMLInputElement>('[aria-label="Search flatbed queue"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "missing");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await settle(() => text().includes("No job selected."));
  assert.ok(calls.some(call => call.search === "missing" && call.page === 1));

  await reset(); await render(); await settle(() => text().includes("Canonical first"));
  await click("Complete attempt");
  await settle(() => text().includes("Canonical second") && !text().includes("Canonical first"));

  await reset(); await render("roll");
  await settle(() => text().includes("Canonical roll") && text().includes("24 x 36 in"));
  assert.match(text(), /2026-10-20/); assert.match(text(), /Target12/);
  specificationsAvailable = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ["v2", "scope-a", "org-a", "production", "eligible"] }); });
  await settle(() => text().includes("Dimensions unavailable") && text().includes("Due date unavailable"));
  assert.doesNotMatch(text(), /24 x 36 in|2026-10-20/);

  await reset(); await render("flatbed", "routed");
  await settle(() => text().includes("Canonical routed"));
  await click("Complete attempt");
  await settle(() => completed);
  assert.match(text(), /Canonical routed/);

  await reset();
  sessionStorage.setItem("ph.v2.production.pending-output-presence", "org-a");
  sessionStorage.setItem("ph.v2.production.pending-output.org-a.scope-a", JSON.stringify({ organizationId: "org-a", sessionScope: "scope-a", productionAttemptId: "attempt-first", businessRequestId: "original", submittedAt: "2026-10-01T00:00:00.000Z", input: { goodQuantityDelta: 12, wasteQuantityDelta: 0 } }));
  await render(); await settle(() => text().includes("Original request original"));
  assert.match(text(), /Retry original output/);
  await act(async () => { completed = true; await client.invalidateQueries({ queryKey: ["v2", "scope-a", "org-a", "production", "flatbed", "queue"] }); });
  assert.match(text(), /Original request original/);
  assert.equal(sessionStorage.getItem("ph.v2.production.pending-output-presence"), "org-a");
  await reset();
  const completions: string[] = [], handoffs: string[] = [];
  let handoffLost = true;
  const route = { routeInstanceId: "route-first", revision: "4", work: { orderLineId: "first" }, state: "active", currentStepId: "print-first", currentPrerequisite: { satisfied: true }, steps: [{ routeInstanceStepId: "print-first", kind: "production", position: 0 }, { routeInstanceStepId: "pack-first", kind: "fulfillment", position: 1 }] };
  productionApi.complete = async (_org, attemptId, key) => { assert.equal(attemptId, "attempt-first"); completions.push(key); completed = true; return {}; };
  productionApi.get = async (_org, id) => { assert.equal(id, "first", "Retry retains original completed work despite queue reselection"); return { ...first, unitQuantitySatisfied: true }; };
  orderApi.get = async () => ({ order: { organizationId: "org-a", orderId: "order-a" }, routes: [route], completionEligibility: { lines: [{ orderLineId: "first", workflowIntent: "standard_production", routeRequired: true, productionRequired: true, productionComplete: true }] } } as never);
  routingApi.completeCurrent = async (_org, id, key, revision) => { assert.equal(id, "route-first"); assert.equal(revision, "4"); handoffs.push(key); if (handoffLost) { handoffLost = false; throw new Error("Lost handoff response"); } return {} as never; };
  await render("flatbed", undefined, true); await settle(() => text().includes("Canonical first"));
  await click("Complete attempt"); await settle(() => text().includes("Retry completion and handoff") && text().includes("Canonical second"));
  await act(async () => root.unmount()); client.clear();
  root = createRoot(document.getElementById("root")!);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  await render("flatbed", undefined, true);
  await settle(() => text().includes("Retry completion and handoff") && text().includes("Canonical second"));
  assert.equal(completions.length, 1, "Reload restores recovery without making any automatic mutation");
  await click("Retry completion and handoff"); await settle(() => text().includes("Canonical Routing handoff completed"));
  assert.equal(completions.length, 2); assert.equal(completions[0], completions[1]);
  assert.equal(handoffs.length, 2); assert.equal(handoffs[0], handoffs[1]);
  assert.equal(sessionStorage.getItem("ph.v2.production.pending-completion.org-a.scope-a"), null);
  console.log("Mounted Production station context, pagination, selection and recovery tests passed.");
} finally {
  await act(async () => root.unmount()); client.clear(); globalThis.fetch = originalFetch; dom.window.close();
}
