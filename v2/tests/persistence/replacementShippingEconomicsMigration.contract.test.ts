import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../../../server/db/migrations_v2/0283_v2_replacement_obligations_shipping_economics.sql", import.meta.url), "utf8");
assert.match(sql, /CREATE TABLE v2_order_replacement_obligations/);
assert.match(sql, /replacement_quantity integer NOT NULL/);
assert.match(sql, /source_fulfillment_handoff_id/);
assert.match(sql, /replacement_obligation_id/);
assert.match(sql, /CREATE TABLE v2_shipping_pricing_policies/);
assert.match(sql, /estimated_carrier_cost_cents/);
assert.match(sql, /actual_carrier_cost_cents/);
assert.match(sql, /customer_shipping_price_cents/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_shipping_allocations/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_actual_cost_updates/);
assert.match(sql, /fulfillment\.replace/);
console.log("replacement/shipping migration contract: OK");
