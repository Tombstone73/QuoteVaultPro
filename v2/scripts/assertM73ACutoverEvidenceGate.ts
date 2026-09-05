import { readFile } from "node:fs/promises";
import { assertM73ACutoverEvidenceBoundary } from "../src/modules/cutover/cutoverEvidenceGate.js";

function fail(message: string): never {
  throw new Error(`[M7.3A] ${message}`);
}

async function main(): Promise<void> {
  const evidencePath = process.env.M73A_CUTOVER_EVIDENCE_FILE;
  if (!evidencePath) fail("M73A_CUTOVER_EVIDENCE_FILE is required and must name a sanitized JSON evidence manifest.");
  const expectedProductionEndpointHostSha256_16 = process.env.M73A_EXPECTED_PROD_HOST_SHA256_16;
  if (!expectedProductionEndpointHostSha256_16) fail("M73A_EXPECTED_PROD_HOST_SHA256_16 is required; it is a non-secret endpoint fingerprint.");
  const value: unknown = JSON.parse(await readFile(evidencePath, "utf8"));
  const result = assertM73ACutoverEvidenceBoundary(value, Date.now(), expectedProductionEndpointHostSha256_16);
  if (!result.pass) fail(`CUTOVER EVIDENCE GATE FAILED: ${result.failures.join(" | ")}`);
  console.log("[M7.3A] CUTOVER EVIDENCE GATE PASSED.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[M7.3A] unknown evidence-gate failure");
  process.exitCode = 1;
});
