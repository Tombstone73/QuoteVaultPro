import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("v2/infrastructure/inbound/postgresInboundIntakeStore.ts", "utf8");
const transition = source.match(/UPDATE v2_inbound_intakes SET intake_state=.*?RETURNING \*/u)?.[0] ?? "";
assert.match(transition, /intake_state=\$4::varchar/u, "state transition parameter has one explicit SQL type");
assert.match(transition, /CASE WHEN \$4::varchar IN/u, "CASE branch reuses the same explicit state type");
assert.match(transition, /decision_reason=\$5::text/u, "optional reason has an explicit SQL type");
console.log("Inbound Postgres transition parameter typing tests passed");
