import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.resolve("server/db/migrations_v2/0288_v2_shipment_shipping_allocation_event_kinds.sql"), "utf8");
assert.match(sql, /DROP CONSTRAINT v2_fulfillment_shipment_economics_events_kind_chk/);
assert.match(sql, /'estimated_cost_set'/);
assert.match(sql, /'actual_cost_set'/);
assert.match(sql, /'customer_price_frozen'/);
assert.match(sql, /'shipping_allocation_equal'/);
assert.match(sql, /'shipping_allocation_manual'/);
assert.match(sql, /event_kind IN/);
console.log("shipment shipping allocation event repair migration contract: OK");
