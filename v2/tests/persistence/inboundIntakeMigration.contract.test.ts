import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = fs.readFileSync(path.join(root, "server/db/migrations_v2/0268_v2_inbound_intake_foundation.sql"), "utf8");

assert.match(sql, /CREATE TABLE v2_inbound_intakes/);
assert.match(sql, /v2_inbound_intakes_provider_message_uidx/);
assert.match(sql, /REFERENCES customer_contacts\(id, organization_id\)/);
assert.match(sql, /REFERENCES v2_sales_order_details\(document_id, organization_id\)/);
assert.match(sql, /v2_inbound_intake_attachments/);
assert.match(sql, /v2_inbound_intake_events_request_uidx/);
assert.doesNotMatch(sql, /CREATE TABLE .*inbound.*files/i);

console.log("inbound intake migration contract checks passed");
