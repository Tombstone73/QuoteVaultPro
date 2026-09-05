type RecordValue = Record<string, unknown>;

export type ProductionExecutorPreparation = {
  schemaVersion: "m7.3b-production-executor-preparation-v1";
  mode: "prepare-only";
  expectedProductionEndpointHostSha256_16: string;
  operatorRunId: string;
  operatorApprovalReference: string;
  executorSourceRevision: string;
  logRetentionReference: string;
  launchReference: string;
};

export type ProductionExecutorPreparationGate = {
  pass: boolean;
  failures: readonly string[];
};

const endpointFingerprint = /^[a-f0-9]{16}$/u;
const revision = /^[a-f0-9]{40}$/u;
const runId = /^m8-cutover-[a-z0-9][a-z0-9-]{2,78}$/u;
const forbiddenSecretMaterial = /(?:postgres(?:ql)?:\/\/|(?:password|api[_-]?key|secret|token|database_url)\s*[:=]|authorization\s*:\s*bearer|npg_[a-z0-9]+)/iu;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function sanitizedReference(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !forbiddenSecretMaterial.test(value);
}

/**
 * This is deliberately a preparation-only contract. It has no database or
 * provider imports and cannot turn an ordinary CI, Railway, or V2 process
 * into a production migration executor. A separately approved M8 process
 * must consume this attested preparation, connect directly, then acquire and
 * retain the existing durable reconciliation row lock before any SQL.
 */
export function assertM73BProductionExecutorPreparation(
  value: unknown,
  independentlySuppliedProductionEndpointHostSha256_16: string,
): ProductionExecutorPreparationGate {
  const failures: string[] = [];
  const input = record(value);
  if (!input) return { pass: false, failures: ["production executor preparation must be an object."] };

  if (input.schemaVersion !== "m7.3b-production-executor-preparation-v1") {
    failures.push("unsupported production executor preparation schema version.");
  }
  if (input.mode !== "prepare-only") {
    failures.push("production executor preparation must use prepare-only mode.");
  }
  if (!endpointFingerprint.test(independentlySuppliedProductionEndpointHostSha256_16)) {
    failures.push("independently supplied production endpoint fingerprint is malformed.");
  }
  if (input.expectedProductionEndpointHostSha256_16 !== independentlySuppliedProductionEndpointHostSha256_16) {
    failures.push("production executor preparation is not pinned to the independently supplied endpoint fingerprint.");
  }
  if (typeof input.operatorRunId !== "string" || !runId.test(input.operatorRunId)) {
    failures.push("production executor preparation requires an attributable M8 cutover run ID.");
  }
  if (!sanitizedReference(input.operatorApprovalReference)) {
    failures.push("production executor preparation requires a sanitized operator approval reference.");
  }
  if (typeof input.executorSourceRevision !== "string" || !revision.test(input.executorSourceRevision)) {
    failures.push("production executor preparation requires an immutable executor source revision.");
  }
  if (!sanitizedReference(input.logRetentionReference)) {
    failures.push("production executor preparation requires a sanitized durable log-retention reference.");
  }
  if (!sanitizedReference(input.launchReference)) {
    failures.push("production executor preparation requires a sanitized controlled-launch reference.");
  }
  return { pass: failures.length === 0, failures };
}
