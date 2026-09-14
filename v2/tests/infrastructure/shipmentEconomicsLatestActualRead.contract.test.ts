import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.resolve("v2/infrastructure/fulfillment/postgresShipmentEconomicsRead.ts"), "utf8");
assert.match(source, /LEFT JOIN LATERAL/);
assert.match(source, /v2_fulfillment_shipment_actual_cost_updates/);
assert.match(source, /actual\.responsibility,actual\.reason,actual\.note/);
assert.match(source, /ORDER BY u\.created_at DESC,u\.id DESC LIMIT 1/);
assert.match(source, /Math\.max\(0, actual-customer\)/);
assert.doesNotMatch(source, /s\.shipping_responsibility/);
assert.doesNotMatch(source, /s\.shipping_reason/);
console.log("shipment economics latest actual-cost read contract: OK");
