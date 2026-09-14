import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.resolve("server/db/migrations_v2/0286_v2_shipping_pricing_policy_authority.sql"), "utf8");
assert.match(sql, /customer_shipping_price_frozen_at timestamptz/);
assert.match(sql, /shipping_price_freeze_chk CHECK[\s\S]*NOT VALID/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_economics_events/);
assert.match(sql, /event_kind IN \('estimated_cost_set','actual_cost_set','customer_price_frozen'\)/);
assert.match(sql, /CREATE TABLE v2_shipping_pricing_policy_events/);
assert.match(sql, /FOREIGN KEY\(customer_id,organization_id\) REFERENCES customers\(id,organization_id\)/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_economics_events/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON v2_shipping_pricing_policy_events/);
console.log("Shipping pricing authority migration contract tests passed.");
