import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("v2/scripts/runM77BDevSchemaReconciliation.ts", "utf8");
const gate = readFileSync("server/runMigrations.ts", "utf8");
const apply = readFileSync("v2/scripts/applyV2Migrations.ts", "utf8");

for (const required of [
  "M77B_DEV_RECONCILIATION=1",
  "M77B_EXPECTED_DEV_HOST_SHA256_16",
  "PrintersHero-DEV / Development",
  "FOR UPDATE NOWAIT",
  "EXPECTED_LEDGER_COUNT = 268",
  "EXPECTED_LEDGER_MAX_CREATED_AT = 1788048000120",
  "D0270", "D0271", "D0272", "D0273",
  "__drizzle_migrations_v2",
]) assert.ok(source.includes(required), `M7.7B executor must retain ${required}`);

assert.ok(!source.includes("UPDATE public.__drizzle_migrations_v2"), "M7.7B must never rewrite Drizzle history");
assert.ok(gate.includes("DEV_RECONCILIATION_ATTESTATION_STAGE = \"D0273\""), "normal Drizzle must demand the DEV attestation");
assert.ok(gate.includes("isAuditedDevHorizon"), "the DEV gate must stay narrowly scoped to the audited ledger shape");
assert.ok(apply.includes('process.env.M77B_DEV_RECONCILIATION === "1"'), "the deployment runner must require an explicit reconciliation acknowledgement");

console.log("M7.7B DEV reconciliation guard contract passed.");
