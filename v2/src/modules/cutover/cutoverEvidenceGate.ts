import {
  assertCurrentProdWriteFreeBoundary,
  currentProdWriteFreeAuthorities,
  type RuntimeAuthorityObservation,
} from "./writeFreeRuntimeGate.js";

export const cutoverWorkCategories = [
  "orders",
  "production-jobs",
  "prepress",
  "fulfillment",
  "invoices",
  "payments",
  "financial-provider-jobs",
  "email-delivery-queues",
] as const;

type CutoverWorkCategory = (typeof cutoverWorkCategories)[number];
type EvidenceReference = { source: "railway-read-only" | "database-read-only" | "edge-probe" | "mcp-registry-read-only" | "source-read-only" | "neon-read-only" | "vercel-read-only" | "manifest-read-only"; reference: string };
type RecordValue = Record<string, unknown>;

export type CutoverEvidenceGate = { pass: boolean; failures: readonly string[] };

const fingerprint = /^[a-f0-9]{16}$/u;
const digest = /^[a-f0-9]{16,64}$/u;
const forbiddenSecretMaterial = /(?:postgres(?:ql)?:\/\/|password\s*=|api[_-]?key\s*=|secret\s*=)/iu;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function nonSecretText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !forbiddenSecretMaterial.test(value);
}

function timestamp(value: unknown, label: string, nowMs: number, maximumEvidenceAgeMs: number, failures: string[]): number | undefined {
  if (typeof value !== "string") {
    failures.push(`${label} timestamp is missing.`);
    return undefined;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs || nowMs - parsed > maximumEvidenceAgeMs) {
    failures.push(`${label} evidence is missing, invalid, or stale.`);
    return undefined;
  }
  return parsed;
}

function references(value: unknown, label: string, requiredSource: EvidenceReference["source"], failures: string[]): void {
  if (!Array.isArray(value) || !value.some((entry) => {
    const candidate = record(entry);
    return candidate?.source === requiredSource && nonSecretText(candidate.reference);
  })) {
    failures.push(`${label} lacks sanitized ${requiredSource} evidence.`);
  }
  if (Array.isArray(value) && value.some((entry) => {
    const candidate = record(entry);
    return !candidate || !nonSecretText(candidate.reference);
  })) {
    failures.push(`${label} contains an invalid or secret-bearing evidence reference.`);
  }
}

function runtimeObservations(value: unknown, failures: string[]): RuntimeAuthorityObservation[] | undefined {
  if (!Array.isArray(value)) {
    failures.push("runtime authority observations are missing.");
    return undefined;
  }
  const observations: RuntimeAuthorityObservation[] = [];
  for (const [index, entry] of value.entries()) {
    const candidate = record(entry);
    if (!candidate || typeof candidate.authority !== "string" || typeof candidate.admission !== "string" ||
      typeof candidate.process !== "string" || typeof candidate.capturedAt !== "string" ||
      (candidate.canMutate !== false && candidate.canMutate !== true && candidate.canMutate !== "unknown") ||
      !Array.isArray(candidate.evidence)) {
      failures.push(`runtime authority observation ${index} has an invalid shape.`);
      continue;
    }
    if (!currentProdWriteFreeAuthorities.includes(candidate.authority as RuntimeAuthorityObservation["authority"])) {
      failures.push(`unexpected runtime authority observation: ${candidate.authority}`);
      continue;
    }
    if (candidate.evidence.some((evidence) => !record(evidence) || typeof record(evidence)?.source !== "string" || !nonSecretText(record(evidence)?.reference))) {
      failures.push(`runtime authority observation ${index} contains invalid or secret-bearing evidence.`);
      continue;
    }
    observations.push(candidate as unknown as RuntimeAuthorityObservation);
  }
  return observations;
}

/**
 * Validates the complete, sanitized M7.3A evidence package before a future
 * production reconciliation invocation. It discovers nothing and performs no
 * database or provider work; missing, stale, ambiguous, or secret-bearing
 * evidence fails closed.
 */
export function assertM73ACutoverEvidenceBoundary(
  value: unknown,
  nowMs: number,
  expectedProductionEndpointHostSha256_16: string,
  maximumEvidenceAgeMs = 5 * 60_000,
): CutoverEvidenceGate {
  const failures: string[] = [];
  const manifest = record(value);
  if (!manifest) return { pass: false, failures: ["cutover evidence manifest must be an object."] };
  if (manifest.schemaVersion !== "m7.3b-cutover-evidence-v1") failures.push("unsupported cutover evidence manifest schema version.");

  const target = record(manifest.target);
  const observedEndpoint = target?.observedEndpointHostSha256_16;
  const expectedEndpoint = target?.expectedEndpointHostSha256_16;
  if (!fingerprint.test(expectedProductionEndpointHostSha256_16)) failures.push("configured expected production endpoint fingerprint is malformed.");
  if (target?.environment !== "production") failures.push("cutover evidence must explicitly name the production target.");
  if (typeof observedEndpoint !== "string" || !fingerprint.test(observedEndpoint) ||
    typeof expectedEndpoint !== "string" || !fingerprint.test(expectedEndpoint) || observedEndpoint !== expectedEndpoint ||
    expectedEndpoint !== expectedProductionEndpointHostSha256_16) {
    failures.push("target endpoint fingerprint is missing, malformed, or does not match the expected production endpoint.");
  }

  const observations = runtimeObservations(manifest.runtimeAuthorities, failures);
  if (observations) {
    const runtime = assertCurrentProdWriteFreeBoundary(observations, nowMs, maximumEvidenceAgeMs);
    failures.push(...runtime.failures);
  }

  const railway = record(manifest.railwayV1ReplicaProof);
  const zeroReplicasAt = timestamp(railway?.capturedAt, "Railway zero-replica", nowMs, maximumEvidenceAgeMs, failures);
  if (railway?.replicas !== 0) failures.push("PrintersHero V1 Railway replicas are not proven to be zero.");
  references(railway?.evidence, "Railway zero-replica proof", "railway-read-only", failures);

  const maintenance = record(manifest.maintenanceControlPlane);
  timestamp(maintenance?.verifiedAt, "maintenance control-plane", nowMs, maximumEvidenceAgeMs, failures);
  if (maintenance?.provider !== "vercel" || maintenance?.canonicalDomain !== "www.printershero.com" ||
    typeof maintenance?.projectIdHash !== "string" || !digest.test(maintenance.projectIdHash) ||
    typeof maintenance?.teamIdHash !== "string" || !digest.test(maintenance.teamIdHash) ||
    typeof maintenance?.currentProductionDeploymentIdHash !== "string" || !digest.test(maintenance.currentProductionDeploymentIdHash) ||
    !nonSecretText(maintenance?.maintenanceSwitchReference) || !nonSecretText(maintenance?.rollbackReference)) {
    failures.push("maintenance control-plane proof is incomplete or is not bound to the canonical production domain.");
  }
  references(maintenance?.evidence, "maintenance control-plane proof", "vercel-read-only", failures);

  const work = record(manifest.activeWorkManifest);
  const workCapturedAt = timestamp(work?.capturedAt, "active-work manifest", nowMs, maximumEvidenceAgeMs, failures);
  if (!nonSecretText(work?.manifestId) || typeof work?.sourceEndpointHostSha256_16 !== "string" || work.sourceEndpointHostSha256_16 !== observedEndpoint) {
    failures.push("active-work manifest lacks a sanitized identity tied to the expected production endpoint.");
  }
  references(work?.evidence, "active-work manifest", "manifest-read-only", failures);
  const categories = Array.isArray(work?.categories) ? work.categories : [];
  const seen = new Set<string>();
  for (const entry of categories) {
    const category = record(entry);
    if (!category || typeof category.category !== "string" || !cutoverWorkCategories.includes(category.category as CutoverWorkCategory) ||
      seen.has(category.category) || !Number.isSafeInteger(category.recordCount) || (category.recordCount as number) < 0 ||
      typeof category.statusDigest !== "string" || !digest.test(category.statusDigest)) {
      failures.push("active-work manifest contains an invalid aggregate category.");
      continue;
    }
    seen.add(category.category);
  }
  for (const category of cutoverWorkCategories) {
    if (!seen.has(category)) failures.push(`active-work manifest is missing aggregate category: ${category}`);
  }
  if (workCapturedAt !== undefined && zeroReplicasAt !== undefined && workCapturedAt > zeroReplicasAt) {
    failures.push("active-work manifest must be captured no later than zero-replica verification.");
  }

  const restore = record(manifest.finalRestorePoint);
  const restoreVerifiedAt = timestamp(restore?.verifiedAt, "final restore point", nowMs, maximumEvidenceAgeMs, failures);
  if (restore?.provider !== "neon" || restore?.state !== "verified" || !nonSecretText(restore?.restorePointId) ||
    typeof restore?.parentEndpointHostSha256_16 !== "string" || restore.parentEndpointHostSha256_16 !== observedEndpoint ||
    typeof restore?.projectIdHash !== "string" || !digest.test(restore.projectIdHash) ||
    typeof restore?.rootBranchIdHash !== "string" || !digest.test(restore.rootBranchIdHash) ||
    restore?.sourceBranchIsRoot !== true ||
    typeof restore?.createOperationIdHash !== "string" || !digest.test(restore.createOperationIdHash) ||
    restore?.createOperationState !== "succeeded" || !nonSecretText(restore?.retentionReference) ||
    !nonSecretText(restore?.recoveryProcedureReference)) {
    failures.push("final restore point is not verified for the expected production endpoint.");
  }
  references(restore?.evidence, "final restore point", "neon-read-only", failures);
  if (restoreVerifiedAt !== undefined && zeroReplicasAt !== undefined && restoreVerifiedAt < zeroReplicasAt) {
    failures.push("final restore point verification must follow zero-replica verification.");
  }

  const ownership = record(manifest.reconciliationOwnership);
  timestamp(ownership?.capturedAt, "reconciliation ownership", nowMs, maximumEvidenceAgeMs, failures);
  if (ownership?.state !== "not_active" || ownership?.endpointHostSha256_16 !== observedEndpoint) {
    failures.push("a competing reconciliation executor is active, unknown, or targets another endpoint.");
  }
  references(ownership?.evidence, "reconciliation ownership", "database-read-only", failures);

  return { pass: failures.length === 0, failures };
}
