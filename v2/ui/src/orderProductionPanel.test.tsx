import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrderRead, ProductionWorkProjection } from "./api";
import { OrderProduction, orderProductionStation } from "./OrderWorkspace";

const work = (productionWorkId: string, orderLineId: string, completedGoodQuantity: number, orderedQuantity: number, stationKey?: string) => ({
  work: { productionWorkId, orderId: "order-a", orderLineId, orderedQuantity, requirement: { key: "print.front", side: "front" } },
  attempts: stationKey ? [{ stationKey }] : [],
  completedGoodQuantity,
  unitQuantitySatisfied: completedGoodQuantity >= orderedQuantity,
}) as unknown as ProductionWorkProjection;

const empty = renderToStaticMarkup(<OrderProduction works={[]} loading={false} onOpen={() => undefined} />);
assert.match(empty, /Production.*No Production work/s);
assert.match(empty, /<h2>Production<\/h2>/);

const populated = renderToStaticMarkup(<OrderProduction works={[
  work("production-aaaa", "line-11111111", 2, 3, "flatbed"),
  work("production-bbbb", "line-22222222", 1, 1, "roll"),
]} loading={false} onOpen={() => undefined} />);
assert.match(populated, /2\/3 complete.*Flatbed/s);
assert.match(populated, /1\/1 complete.*Roll/s);
assert.doesNotMatch(populated, /production-aaaa|line-11111111/);
assert.doesNotMatch(populated, /Start Production|Record output|Consume material/);
const identified = renderToStaticMarkup(<OrderProduction works={[
  { ...work("production-front", "line-a", 0, 2), operatorContext: { product: { productId: "catalog-roll", displayName: "QA Roll" } } },
  { ...work("production-back", "line-a", 0, 2), operatorContext: { product: { productId: "catalog-roll", displayName: "QA Roll" } }, work: { ...work("production-back", "line-a", 0, 2).work, requirement: { key: "print.back", side: "back" } } },
  { ...work("production-rigid", "line-b", 0, 2), operatorContext: { product: { productId: "catalog-flatbed", displayName: "QA Flatbed" } } },
]} loading={false} onOpen={() => undefined} />);
assert.match(identified, /QA Roll.*Front.*0\/2 complete/s);
assert.match(identified, /QA Roll.*Back.*0\/2 complete/s);
assert.match(identified, /QA Flatbed.*Front.*0\/2 complete/s);

const workspace = await readFile(new URL("./OrderWorkspace.tsx", import.meta.url), "utf8");
assert.match(workspace, /Production:\s*\(\s*<OrderProduction\s+works=\{production\.data\}\s+loading=\{production\.isLoading\}/);
const production: ProductionWorkProjection = { work: { productionWorkId: "production-a", orderId: "order-a", orderLineId: "line-a", orderedQuantity: 2, requirement: { key: "back", side: "back" }, artworkAssignmentId: "assignment-a", artworkFileId: "file-a" }, attempts: [], completedGoodQuantity: 0, recordedGoodQuantity: 0, rejectedGoodQuantity: 0, usableGoodQuantity: 0, remainingGoodQuantity: 2, unitQuantitySatisfied: false, state: "ready", exceptionEvents: [], outputDispositions: [] };
const order: OrderRead = { order: { organizationId: "org-a", orderId: "order-a", customerContact: { organizationId: "org-a", customerId: "customer-a" }, currency: "USD", terms: {}, commercialState: "open", lines: [] }, number: { core: "1", display: "ORD-1" }, revision: "1", totals: { calculated: { cents: 0, currency: "USD" }, selling: { cents: 0, currency: "USD" } }, routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } };
const step = { routeInstanceStepId: "step-a", position: 1, kind: "production", productionDestination: "roll" } as const;
const flatbedStep = { ...step, productionDestination: "flatbed" } as const;
const invalidStep = { ...step, productionDestination: "invalid" } as const;
const route: OrderRead["routes"][number] = { work: { orderLineId: "line-a" }, state: "active", currentStepId: "step-a", steps: [step] };
const station = (routes: OrderRead["routes"]) => orderProductionStation({ ...order, routes }, production);
assert.equal(station([route]), "roll");
assert.equal(station([{ ...route, steps: [flatbedStep] }]), "flatbed");
assert.equal(station([]), undefined, "missing route must not invent a station from Product or Artwork");
assert.equal(station([route, { ...route, routeInstanceId: "duplicate" }]), undefined, "duplicate same-line routes are ambiguous");
assert.equal(station([{ ...route, currentStepId: "missing" }]), undefined);
assert.equal(station([{ ...route, steps: [step, flatbedStep] }]), undefined, "duplicate current steps are ambiguous");
assert.equal(station([{ ...route, steps: [{ ...step, kind: "prepress" }] }]), undefined);
assert.equal(station([{ ...route, steps: [invalidStep] }]), undefined);
assert.equal(station([{ ...route, steps: [{ routeInstanceStepId: step.routeInstanceStepId, position: 1, kind: "production" }] }]), undefined);
assert.equal(station([{ ...route, work: { orderLineId: "other-line" } }]), undefined);
assert.equal(orderProductionStation({ ...order, routes: [route] }, { ...production, work: { ...production.work, orderId: "other-order" } }), undefined);
console.log("Order Production panel presentation tests passed.");
