import { readFile } from "node:fs/promises";
import { assertM73ACutoverEvidenceBoundary } from "../src/modules/cutover/cutoverEvidenceGate.js";
import {
  assertM73BProductionExecutorPreparation,
  type ProductionExecutorPreparation,
} from "../src/modules/cutover/productionCutoverExecutorContract.js";

function fail(message: string): never {
  throw new Error(`[M7.3B] ${message}`);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

/**
 * Intentionally preparation-only. Do not add a PostgreSQL client, a database
 * URL, or a migration invocation here: M7.3B must not execute production.
 */
async function main(): Promise<void> {
  const evidencePath = required("M73A_CUTOVER_EVIDENCE_FILE");
  const expectedEndpoint = required("M73A_EXPECTED_PROD_HOST_SHA256_16");
  const evidence: unknown = JSON.parse(await readFile(evidencePath, "utf8"));
  const evidenceGate = assertM73ACutoverEvidenceBoundary(evidence, Date.now(), expectedEndpoint);
  if (!evidenceGate.pass) fail(`CUTOVER EVIDENCE GATE FAILED: ${evidenceGate.failures.join(" | ")}`);

  const preparation: ProductionExecutorPreparation = {
    schemaVersion: "m7.3b-production-executor-preparation-v1",
    mode: required("M73B_EXECUTOR_MODE") as ProductionExecutorPreparation["mode"],
    expectedProductionEndpointHostSha256_16: expectedEndpoint,
    operatorRunId: required("M73B_OPERATOR_RUN_ID"),
    operatorApprovalReference: required("M73B_OPERATOR_APPROVAL_REFERENCE"),
    executorSourceRevision: required("M73B_EXECUTOR_SOURCE_REVISION"),
    logRetentionReference: required("M73B_LOG_RETENTION_REFERENCE"),
    launchReference: required("M73B_LAUNCH_REFERENCE"),
  };
  const preparationGate = assertM73BProductionExecutorPreparation(preparation, expectedEndpoint);
  if (!preparationGate.pass) fail(`PRODUCTION EXECUTOR PREPARATION FAILED: ${preparationGate.failures.join(" | ")}`);

  console.log(`[M7.3B] PREPARATION PASSED for ${preparation.operatorRunId} at source ${preparation.executorSourceRevision}.`);
  console.log("[M7.3B] No database connection, provider call, or migration was attempted.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[M7.3B] unknown production executor preparation failure");
  process.exitCode = 1;
});
