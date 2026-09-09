import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const [migration, destinationSnapshot, repository, lifecycle, production] = await Promise.all([
  readFile(new URL("../../../server/db/migrations_v2/0264_v2_order_line_workflow_exceptions.sql", import.meta.url), "utf8"),
  readFile(new URL("../../../server/db/migrations_v2/0266_v2_frozen_route_destination_snapshot.sql", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresOrderWorkflowTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresOrderAutomaticLifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/production/postgresProductionTransaction.ts", import.meta.url), "utf8"),
]);
assert.match(migration, /v2_sales_line_workflow_exceptions/);
assert.match(migration, /workflow\.override/);
assert.match(migration, /production_requirement.*not_required/s);
assert.match(repository, /FOR UPDATE/, "line and route state are locked before exception mutation");
assert.match(repository, /id=\$3 FOR UPDATE OF l,o/, "the workflow lock must exclude the nullable Product Version outer-join side");
assert.match(repository, /hasProductionWork/, "no-production rejects started Production history");
assert.match(repository, /assertProductionArtworkComplete/, "direct Production requires actual current Artwork evidence");
assert.match(repository, /assertCurrentProofApproved/, "proof-required direct Production requires current approval evidence");
assert.match(destinationSnapshot, /production_destination_station_key/, "the explicit production station is snapshotted onto the immutable Route Instance");
assert.match(repository, /production_destination_station_key/, "direct actions resolve the frozen station snapshot, never a mutable template step");
assert.doesNotMatch(repository, /source_template_step_id/, "direct workflow must not rely on the historical column dropped by M0194");
assert.match(repository, /eligibleActions/, "the backend, not React, projects currently eligible line actions");
assert.match(repository, /nextProductionStep/, "direct Production requires a frozen production destination in the Route");
assert.match(repository, /nextFulfillmentStep/, "no-production routes only to canonical Fulfillment");
assert.match(lifecycle, /v2_sales_line_workflow_exceptions/, "automatic closure reads the explicit no-production fact");
assert.match(production, /production_destination/, "a direct destination constrains the first Production attempt and queue visibility");
console.log("Order workflow exception persistence contracts passed.");
