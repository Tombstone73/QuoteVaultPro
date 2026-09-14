import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(path.resolve("server/db/migrations_v2/0289_v2_billing_invoice_revision_history_immutability.sql"), "utf8");
const writer = readFileSync(path.resolve("v2/infrastructure/fulfillment/postgresShipmentShippingAllocation.ts"), "utf8");
const checkpoint = readFileSync(path.resolve("server/db/migrations_v2/0206_v2_invoice_lifecycle_foundation.sql"), "utf8");

assert.match(migration, /CREATE TRIGGER v2_billing_invoice_revision_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON v2_billing_invoice_revisions/);
assert.match(migration, /v2_billing_invoice_checkpoint_immutable_validate/);
assert.match(checkpoint, /IF TG_OP <> 'INSERT' THEN[\s\S]*Issued Invoice checkpoints are immutable/);
assert.match(writer, /INSERT INTO v2_billing_invoice_revisions/);
assert.match(writer, /UPDATE v2_billing_invoices SET subtotal_cents=/);
assert.doesNotMatch(migration, /v2_billing_invoices\s+SET/);
assert.doesNotMatch(migration, /v2_billing_invoice_checkpoints/);
console.log("invoice revision history immutability migration contract: OK");
