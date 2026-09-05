import { readFile } from "node:fs/promises";
import {
  assertM72eWriteFreeRuntime,
  type RuntimeAuthorityObservation,
} from "../src/modules/cutover/writeFreeRuntimeGate.js";

function fail(message: string): never {
  throw new Error(`[M7.2E] ${message}`);
}

function observationsFromJson(value: unknown): RuntimeAuthorityObservation[] {
  if (!Array.isArray(value)) fail("evidence manifest must be a JSON array.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`evidence entry ${index} must be an object.`);
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.authority !== "string" || typeof candidate.admission !== "string" ||
      typeof candidate.process !== "string" || typeof candidate.capturedAt !== "string" ||
      !Array.isArray(candidate.evidence)) {
      fail(`evidence entry ${index} has an invalid required shape.`);
    }
    if (candidate.canMutate !== false && candidate.canMutate !== true && candidate.canMutate !== "unknown") {
      fail(`evidence entry ${index} has an invalid canMutate value.`);
    }
    for (const evidence of candidate.evidence) {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
        typeof (evidence as Record<string, unknown>).source !== "string" ||
        typeof (evidence as Record<string, unknown>).reference !== "string") {
        fail(`evidence entry ${index} contains an invalid evidence reference.`);
      }
    }
    return candidate as unknown as RuntimeAuthorityObservation;
  });
}

async function main(): Promise<void> {
  const path = process.env.M72E_EVIDENCE_FILE;
  if (!path) fail("M72E_EVIDENCE_FILE is required and must name a sanitized JSON evidence manifest.");
  const observations = observationsFromJson(JSON.parse(await readFile(path, "utf8")));
  const result = assertM72eWriteFreeRuntime(observations, Date.now());
  if (!result.pass) fail(`WRITE-FREE GATE FAILED: ${result.failures.join(" | ")}`);
  console.log(`[M7.2E] WRITE-FREE GATE PASSED for ${observations.length} authorities.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "[M7.2E] unknown gate failure");
  process.exitCode = 1;
});
