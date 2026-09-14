import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.resolve("server/db/migrations_v2/0287_v2_shipment_shipping_invoice_projection.sql"), "utf8");
assert.match(sql, /CREATE TABLE v2_billing_invoice_additional_charges/);
assert.match(sql, /charge_kind IN \('shipping'\)/);
assert.match(sql, /shipment_shipping_allocation_id/);
assert.match(sql, /UNIQUE\(organization_id, shipment_shipping_allocation_id\)/);
assert.match(sql, /CREATE TABLE v2_billing_invoice_revisions/);
assert.match(sql, /revision_kind IN \('additional_charge'\)/);
assert.doesNotMatch(sql, /product_id/);
assert.doesNotMatch(sql, /v2_billing_invoice_checkpoints/);
console.log("shipment shipping Invoice projection migration contract: OK");
