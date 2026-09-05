import assert from "node:assert/strict";
import { assertM73ACutoverEvidenceBoundary, cutoverWorkCategories } from "../../src/modules/cutover/cutoverEvidenceGate.js";
import { currentProdWriteFreeAuthorities, type RuntimeAuthorityObservation } from "../../src/modules/cutover/writeFreeRuntimeGate.js";

const now = Date.parse("2026-09-05T16:00:00.000Z");
const endpoint = "0123456789abcdef";
const at = "2026-09-05T15:59:30.000Z";
const digest = "a".repeat(64);

const evidence: Record<RuntimeAuthorityObservation["authority"], RuntimeAuthorityObservation["evidence"]> = {
  "maintenance-ingress": [{ source: "edge-probe", reference: "maintenance:write-blocked:503" }],
  "railway-v1-runtime": [{ source: "railway-read-only", reference: "service:printershero; replicas:0" }],
  "mcp-production": [{ source: "source-read-only", reference: "mcp:no-current-write-authority" }],
  "mcp-development": [{ source: "source-read-only", reference: "mcp:no-current-write-authority" }],
  "v2-prod-runtime": [{ source: "railway-read-only", reference: "service:v2; state:not-deployed" }],
  "reconciliation-executor": [{ source: "database-read-only", reference: "ledger:no-active-attempt" }],
};

const runtimeAuthorities: RuntimeAuthorityObservation[] = currentProdWriteFreeAuthorities.map((authority) => ({
  authority,
  admission: authority === "maintenance-ingress" ? "closed" : "not_applicable",
  process: authority === "maintenance-ingress" ? "read_only" : authority.includes("mcp") || authority === "v2-prod-runtime" || authority === "reconciliation-executor" ? "not_deployed" : "stopped",
  canMutate: false,
  capturedAt: at,
  evidence: evidence[authority],
}));

function manifest(): unknown {
  return {
    schemaVersion: "m7.3a-cutover-evidence-v1",
    target: { environment: "production", observedEndpointHostSha256_16: endpoint, expectedEndpointHostSha256_16: endpoint },
    runtimeAuthorities,
    railwayV1ReplicaProof: { capturedAt: "2026-09-05T15:59:40.000Z", replicas: 0, evidence: [{ source: "railway-read-only", reference: "service:printershero; replicas:0" }] },
    activeWorkManifest: {
      manifestId: "cutover-aggregate-001",
      capturedAt: "2026-09-05T15:59:35.000Z",
      sourceEndpointHostSha256_16: endpoint,
      evidence: [{ source: "manifest-read-only", reference: "aggregate-query-fingerprint:abcd" }],
      categories: cutoverWorkCategories.map((category) => ({ category, recordCount: 0, statusDigest: digest })),
    },
    finalRestorePoint: {
      state: "verified",
      restorePointId: "neon-restore-point-sanitized-id",
      parentEndpointHostSha256_16: endpoint,
      recoveryProcedureReference: "runbook:restore-neon-branch",
      verifiedAt: "2026-09-05T15:59:45.000Z",
      evidence: [{ source: "neon-read-only", reference: "branch-metadata:restore-point-present" }],
    },
    reconciliationOwnership: {
      state: "not_active",
      endpointHostSha256_16: endpoint,
      capturedAt: "2026-09-05T15:59:50.000Z",
      evidence: [{ source: "database-read-only", reference: "m7-lock:no-active-holder" }],
    },
  };
}

const passes = (value: unknown) => assertM73ACutoverEvidenceBoundary(value, now, endpoint);

assert.equal(passes(manifest()).pass, true, "complete sanitized cutover evidence passes");
assert.equal(passes({ ...manifest() as object, runtimeAuthorities: runtimeAuthorities.slice(1) }).pass, false, "maintenance evidence is mandatory");
assert.equal(passes({ ...manifest() as object, railwayV1ReplicaProof: { capturedAt: at, replicas: 1, evidence: [{ source: "railway-read-only", reference: "replicas:1" }] } }).pass, false, "nonzero V1 replicas fail closed");
assert.equal(passes({ ...manifest() as object, finalRestorePoint: { state: "pending" } }).pass, false, "unverified restore point fails closed");
assert.equal(passes({ ...manifest() as object, activeWorkManifest: { ...((manifest() as any).activeWorkManifest), categories: [] } }).pass, false, "incomplete active-work manifest fails closed");
assert.equal(passes({ ...manifest() as object, target: { environment: "production", observedEndpointHostSha256_16: endpoint, expectedEndpointHostSha256_16: "fedcba9876543210" } }).pass, false, "wrong endpoint fails closed");
assert.equal(assertM73ACutoverEvidenceBoundary(manifest(), now, "fedcba9876543210").pass, false, "manifest endpoint must match independently supplied target fingerprint");
assert.equal(passes({ ...manifest() as object, railwayV1ReplicaProof: { capturedAt: "2026-09-05T15:00:00.000Z", replicas: 0, evidence: [{ source: "railway-read-only", reference: "replicas:0" }] } }).pass, false, "stale evidence fails closed");
assert.equal(passes({ ...manifest() as object, reconciliationOwnership: { state: "active", endpointHostSha256_16: endpoint, capturedAt: at, evidence: [{ source: "database-read-only", reference: "m7-lock:held" }] } }).pass, false, "active reconciliation owner fails closed");

console.log("M7.3A cutover evidence gate pure checks passed");
