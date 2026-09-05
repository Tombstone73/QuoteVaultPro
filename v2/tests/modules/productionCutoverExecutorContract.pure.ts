import assert from "node:assert/strict";
import { assertM73BProductionExecutorPreparation } from "../../src/modules/cutover/productionCutoverExecutorContract.js";

const endpoint = "0123456789abcdef";
const valid = () => ({
  schemaVersion: "m7.3b-production-executor-preparation-v1",
  mode: "prepare-only",
  expectedProductionEndpointHostSha256_16: endpoint,
  operatorRunId: "m8-cutover-20260905-001",
  operatorApprovalReference: "change:approved-m8-window",
  executorSourceRevision: "a".repeat(40),
  logRetentionReference: "audit-store:m8-cutover-20260905-001",
  launchReference: "controlled-operator-shell:ephemeral",
});

const passes = (value: unknown) => assertM73BProductionExecutorPreparation(value, endpoint);

assert.equal(passes(valid()).pass, true, "attributable prepare-only invocation is accepted");
assert.equal(passes({ ...valid(), mode: "execute" }).pass, false, "any execution mode is rejected");
assert.equal(passes({ ...valid(), expectedProductionEndpointHostSha256_16: "fedcba9876543210" }).pass, false, "endpoint must be independently pinned");
assert.equal(passes({ ...valid(), operatorRunId: "manual" }).pass, false, "ad-hoc run IDs are rejected");
assert.equal(passes({ ...valid(), executorSourceRevision: "not-immutable" }).pass, false, "mutable executor revisions are rejected");
assert.equal(passes({ ...valid(), operatorApprovalReference: "postgres://secret-host" }).pass, false, "secret-bearing references are rejected");
assert.equal(passes({ ...valid(), launchReference: "DATABASE_URL=redacted" }).pass, false, "environment-secret references are rejected");
assert.equal(passes({ ...valid(), logRetentionReference: "" }).pass, false, "durable log retention is mandatory");

console.log("M7.3B production cutover executor preparation contract pure checks passed");
