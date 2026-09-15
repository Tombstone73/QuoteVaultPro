import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.resolve("server/db/migrations_v2/0287_v2_shipment_shipping_invoice_projection.sql"), "utf8");
const allocations = readFileSync(path.resolve("server/db/migrations_v2/0283_v2_replacement_obligations_shipping_economics.sql"), "utf8");
const allocationTable = allocations.slice(
  allocations.indexOf("CREATE TABLE v2_fulfillment_shipment_shipping_allocations"),
  allocations.indexOf("CREATE INDEX v2_fulfillment_shipment_shipping_allocations_invoice_idx"),
);
assert.match(sql, /ADD CONSTRAINT v2_fulfillment_shipment_shipping_allocations_id_org_uidx\s+UNIQUE\(id,organization_id\)/);
assert.ok(
  sql.indexOf("v2_fulfillment_shipment_shipping_allocations_id_org_uidx")
    < sql.indexOf("CREATE TABLE v2_billing_invoice_additional_charges"),
  "the parent composite tenant key must exist before the child foreign key is created",
);
assert.match(sql, /FOREIGN KEY\(shipment_shipping_allocation_id,organization_id\) REFERENCES v2_fulfillment_shipment_shipping_allocations\(id,organization_id\)/);
assert.match(allocationTable, /id varchar PRIMARY KEY/);
assert.doesNotMatch(allocationTable, /UNIQUE\(id,organization_id\)/, "the pending projection migration, not the previously applied allocation migration, supplies the required composite key");
assert.match(sql, /CREATE TABLE v2_billing_invoice_additional_charges/);
assert.match(sql, /charge_kind IN \('shipping'\)/);
assert.match(sql, /shipment_shipping_allocation_id/);
assert.match(sql, /UNIQUE\(organization_id, shipment_shipping_allocation_id\)/);
assert.match(sql, /CREATE TABLE v2_billing_invoice_revisions/);
assert.match(sql, /revision_kind IN \('additional_charge'\)/);
assert.doesNotMatch(sql, /product_id/);
assert.doesNotMatch(sql, /v2_billing_invoice_checkpoints/);
console.log("shipment shipping Invoice projection migration contract: OK");
