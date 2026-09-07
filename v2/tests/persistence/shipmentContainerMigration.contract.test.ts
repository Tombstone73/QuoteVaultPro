import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.resolve("server/db/migrations_v2/0267_v2_fulfillment_shipment_containers.sql"), "utf8");
assert.match(sql, /CREATE TABLE v2_fulfillment_shipments/);
assert.match(sql, /shipment_status IN \('prepared','shipped'\)/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_handoffs/);
assert.match(sql, /UNIQUE \(organization_id,handoff_id\)/);
assert.match(sql, /h\.handoff_method='shipment'/);
assert.match(sql, /s\.shipment_status='shipped'/);
console.log("Shipment container migration contract tests passed.");
