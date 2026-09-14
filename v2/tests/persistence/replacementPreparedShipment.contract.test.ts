import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [container, fulfillment, fulfillmentApplication, replacementService, production, lifecycle] = await Promise.all([
  readFile(new URL("../../infrastructure/fulfillment/postgresShipmentContainerTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/fulfillment/postgresFulfillmentTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/modules/fulfillment/fulfillmentApplication.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/fulfillment/postgresReplacementObligations.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/production/postgresProductionTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresOrderAutomaticLifecycle.ts", import.meta.url), "utf8"),
]);

assert.match(container, /replacement_obligation_id IS NULL/, "original reservations exclude replacement reservations");
assert.match(container, /Prepared replacement shipment quantity exceeds the accepted-good authority/, "replacement prepared reservations are capped separately");
assert.match(container, /replacementObligationId:allocation\.replacementObligationId/, "prepared revision reads preserve replacement authority");
assert.match(container, /replacement_obligation_id,completed_principal_kind/, "finalization creates a distinct replacement handoff");
assert.match(container, /FOR UPDATE/, "replacement authority is locked while reservation capacity is checked");
assert.match(fulfillment, /replacement_obligation_id IS NULL/, "ordinary fulfillment availability excludes replacement handoffs and reservations");
assert.match(fulfillmentApplication, /this\.require\(c,"fulfillment\.replace"/, "replacement handoffs require replacement authority in addition to shipment/pickup authority");
assert.match(replacementService, /c\.principal\.kind!=="staff"/, "portal principals cannot create, list, or cancel replacement obligations");
assert.match(replacementService, /organization_id=\$1/, "replacement reads and writes remain tenant-scoped");
assert.match(production, /reservation\.replacement_obligation_id IS NOT DISTINCT FROM/, "rejection blocks the matching prepared authority only");
assert.match(production, /Correct or void the prepared replacement shipment reservation before requesting Prepress rework/, "rework fails closed while replacement output is reserved");
assert.match(lifecycle, /handoff\.replacement_obligation_id IS NULL/, "replacement handoffs do not inflate original order-line fulfillment");
assert.doesNotMatch(container, /UPDATE v2_fulfillment_handoff_lines/, "container finalization never rewrites historical handoff allocations");

console.log("replacement prepared-shipment authority contracts passed.");
