import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const sql=readFileSync(path.resolve("server/db/migrations_v2/0206_v2_invoice_lifecycle_foundation.sql"),"utf8");
assert.match(sql,/CREATE TABLE v2_billing_invoice_checkpoints/);assert.match(sql,/UNIQUE \(invoice_id, organization_id\)/);assert.match(sql,/v2_billing_invoices_issued_actor_chk/);assert.match(sql,/v2_billing_invoice_lifecycle_immutable_trigger/);assert.match(sql,/v2_billing_invoice_line_lifecycle_immutable_trigger/);assert.match(sql,/v2_billing_invoice_checkpoint_immutable_trigger/);assert.match(sql,/Invoice void requires a future canonical Billing operation/);console.log("[m3.3] Billing invoice lifecycle migration contract tests passed (7 assertions).");
