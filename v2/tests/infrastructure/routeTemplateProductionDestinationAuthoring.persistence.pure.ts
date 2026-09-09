import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = readFileSync(resolve(import.meta.dirname, "../../infrastructure/routing/postgresRouteTemplateProductionDestinationAuthoring.ts"), "utf8");
const auditInsert = repository.match(/INSERT INTO v2_audit_events\([^\n]+\) VALUES\(([^)]+)\)/)?.[1];

assert.ok(auditInsert, "route-destination attribution must persist its audit event");
assert.equal(
  auditInsert.split(",").length,
  10,
  "the route-destination audit insert must provide exactly one expression for each audit column",
);
assert.match(auditInsert, /\$8::jsonb$/, "the changes payload must be bound as the eighth input after fixed event metadata");
assert.doesNotMatch(auditInsert, /\$9::jsonb/, "the audit insert must not have an unmatched ninth bind parameter");

console.log("Route template production-destination persistence contracts passed.");
