import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductionWorkProjection } from "./api";
import { OrderProduction } from "./OrderWorkspace";

const work = (productionWorkId: string, orderLineId: string, completedGoodQuantity: number, orderedQuantity: number, stationKey?: string) => ({
  work: { productionWorkId, orderId: "order-a", orderLineId, orderedQuantity },
  attempts: stationKey ? [{ stationKey }] : [],
  completedGoodQuantity,
  unitQuantitySatisfied: completedGoodQuantity >= orderedQuantity,
}) as unknown as ProductionWorkProjection;

const empty = renderToStaticMarkup(<OrderProduction works={[]} loading={false} onOpen={() => undefined} />);
assert.match(empty, /Production.*No Production work/s);

const populated = renderToStaticMarkup(<OrderProduction works={[
  work("production-aaaa", "line-11111111", 2, 3, "flatbed"),
  work("production-bbbb", "line-22222222", 1, 1, "roll"),
]} loading={false} onOpen={() => undefined} />);
assert.match(populated, /Work producti/);
assert.match(populated, /line line-111/);
assert.match(populated, /2\/3 complete.*flatbed/s);
assert.match(populated, /1\/1 complete.*roll/s);
assert.doesNotMatch(populated, /Start Production|Record output|Consume material/);

const workspace = await readFile(new URL("./OrderWorkspace.tsx", import.meta.url), "utf8");
assert.match(workspace, /Production:\s*<OrderProduction works=\{production\.data\} loading=\{production\.isLoading\}/);
console.log("Order Production panel presentation tests passed.");
