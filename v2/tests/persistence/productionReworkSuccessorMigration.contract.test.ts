import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../../../server/db/migrations_v2/0280_v2_production_rework_successor_cycles.sql",import.meta.url),"utf8");
const production=readFileSync(new URL("../../infrastructure/production/postgresProductionTransaction.ts",import.meta.url),"utf8");
const prepress=readFileSync(new URL("../../infrastructure/prepress/postgresPrepressTransaction.ts",import.meta.url),"utf8");

for(const token of ["CREATE TABLE v2_production_rework_cycles","predecessor_production_work_id","successor_prepress_unit_id","successor_production_work_id","remaining_required_quantity","prior_recorded_good_quantity","DROP CONSTRAINT v2_prepress_units_assignment_uidx","rework_cycle_id","predecessor_production_work_id"])assert.match(migration,new RegExp(token.replaceAll(".","\\.")));
assert.match(production,/Release the active Production Run member before requesting Prepress rework/,"reserved Run work fails closed");
assert.match(production,/terminal_disposition='released'/,"active attempts receive explicit non-success disposition");
assert.match(production,/remaining=workRow\.ordered_quantity-input\.recordedGoodQuantity/,"only remaining required quantity enters the successor");
assert.match(prepress,/reworkCycleId/,"Prepress owns a distinct successor identity");
assert.match(prepress,/successor_production_work_id/,"handoff links successor Production work without route rewind");
assert.doesNotMatch(migration,/UPDATE v2_production_works SET ordered_quantity/i,"historical Production work quantities remain immutable");
console.log("Production rework successor migration contract passed.");
