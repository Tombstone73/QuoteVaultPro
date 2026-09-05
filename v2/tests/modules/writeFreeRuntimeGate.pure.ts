import assert from "node:assert/strict";
import {
  assertCurrentProdWriteFreeBoundary,
  currentProdWriteFreeAuthorities,
  type RuntimeAuthorityObservation,
} from "../../src/modules/cutover/writeFreeRuntimeGate.js";

const now = Date.parse("2026-09-05T16:00:00.000Z");
const requiredSources: Record<RuntimeAuthorityObservation["authority"], RuntimeAuthorityObservation["evidence"]> = {
  "maintenance-ingress": [{ source: "edge-probe", reference: "probe:maintenance-503" }],
  "railway-v1-runtime": [{ source: "railway-read-only", reference: "service:v1 stopped replicas=0" }],
  "independent-prod-writer": [{ source: "railway-read-only", reference: "services:only-v1" }],
  "mcp-production": [{ source: "source-read-only", reference: "mcp:disabled-no-bridge" }],
  "mcp-development": [{ source: "source-read-only", reference: "mcp:disabled-no-bridge" }],
  "v2-prod-runtime": [{ source: "railway-read-only", reference: "service:v2 absent" }],
  "reconciliation-executor": [{ source: "database-read-only", reference: "lock:none" }],
};

const safe: RuntimeAuthorityObservation[] = currentProdWriteFreeAuthorities.map((authority) => ({
  authority,
  admission: authority === "maintenance-ingress" ? "closed" : "not_applicable",
  process: authority === "maintenance-ingress" ? "read_only" : authority.includes("mcp") || authority === "v2-prod-runtime" || authority === "independent-prod-writer" || authority === "reconciliation-executor" ? "not_deployed" : "stopped",
  canMutate: false,
  capturedAt: new Date(now).toISOString(),
  evidence: requiredSources[authority],
}));

assert.equal(assertCurrentProdWriteFreeBoundary(safe, now).pass, true);
assert.equal(assertCurrentProdWriteFreeBoundary(safe.slice(1), now).pass, false, "missing authority fails closed");
assert.equal(assertCurrentProdWriteFreeBoundary([{ ...safe[1], process: "running" }, safe[0], ...safe.slice(2)], now).pass, false, "a running V1 runtime fails closed");
assert.equal(assertCurrentProdWriteFreeBoundary([{ ...safe[0], capturedAt: "2026-09-05T15:00:00.000Z" }, ...safe.slice(1)], now).pass, false, "stale evidence fails closed");
assert.equal(assertCurrentProdWriteFreeBoundary([{ ...safe[0], evidence: [] }, ...safe.slice(1)], now).pass, false, "missing source-specific evidence fails closed");

console.log("M7.2F write-free runtime gate pure checks passed");
