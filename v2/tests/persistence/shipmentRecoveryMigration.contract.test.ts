import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.resolve("server/db/migrations_v2/0275_v2_fulfillment_shipment_recovery.sql"), "utf8");

assert.match(sql, /shipment_status IN \('prepared','shipped','voided'\)/);
assert.match(sql, /void_reason varchar\(1000\)/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_prepared_revisions/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_prepared_revision_lines/);
assert.match(sql, /CREATE TABLE v2_fulfillment_shipment_events/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_prepared_revisions/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_prepared_revision_lines/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON v2_fulfillment_shipment_events/);
assert.match(sql, /prepared_revision_id/);
assert.match(sql, /FOREIGN KEY \(order_line_id, organization_id, order_document_id\)/);
assert.match(sql, /DROP TRIGGER IF EXISTS v2_fulfillment_shipment_handoff_validate_trigger/);
assert.match(sql, /CREATE CONSTRAINT TRIGGER v2_fulfillment_shipment_handoff_validate_trigger[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
assert.match(sql, /event_type IN \('prepared','corrected','voided','shipped'\)/);
assert.match(sql, /A shipment requires one or more prepared reservation lines before it can be shipped/);

console.log("Shipment recovery migration contract tests passed.");
