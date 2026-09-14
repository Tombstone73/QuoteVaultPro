import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql=await readFile(new URL("../../../server/db/migrations_v2/0284_v2_replacement_obligation_execution.sql",import.meta.url),"utf8");
for(const token of ["v2_order_replacement_obligation_events","append-only","replacement_origin_production_work_id","v2_refresh_replacement_obligation","production_satisfied","fulfillment_satisfied","v2_refresh_replacement_after_handoff_line","replacement_obligation_id varchar","v2_fulfillment_prepared_revision_lines_replacement_fk","v2_fulfillment_prepared_revision_lines_authority_uidx"])assert.match(sql,new RegExp(token.replaceAll(".","\\.")));
assert.doesNotMatch(sql,/UPDATE v2_fulfillment_handoffs SET/,"historical fulfillment is never rewritten");
assert.doesNotMatch(sql,/UPDATE v2_production_attempts SET good_quantity/,"historical production output is never rewritten");
console.log("replacement obligation execution migration: OK");
