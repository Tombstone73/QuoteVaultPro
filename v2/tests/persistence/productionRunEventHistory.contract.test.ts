import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../../infrastructure/production/postgresProductionRunTransaction.ts",import.meta.url),"utf8");
assert.match(source,/FROM v2_production_run_events WHERE organization_id=\$1 AND production_run_id=\$2 ORDER BY sequence,id/);
for(const kind of ["allocation_reserved","artwork_refreshed","attempt_linked","good_output","waste_output","member_released","reservation_released","cancelled","completed"])assert.match(source,new RegExp(`\"${kind}\"`));
assert.match(source,/terminal_resolution='released'/);
assert.match(source,/terminal_resolution='cancelled'/);
assert.match(source,/STALE_RUN_PREPARATION/);
console.log("Production Run durable event-history persistence contract passed.");
