import assert from "node:assert/strict";
import {
  assertM72eWriteFreeRuntime,
  m72eRequiredAuthorities,
  type RuntimeAuthorityObservation,
} from "../../src/modules/cutover/writeFreeRuntimeGate.js";

const now = Date.parse("2026-09-05T16:00:00.000Z");
const requiredSources: Record<RuntimeAuthorityObservation["authority"], RuntimeAuthorityObservation["evidence"]> = {
  "v1-http-mutation-ingress": [{ source: "railway-read-only", reference: "service:api stopped" }, { source: "http-probe", reference: "probe:maintenance-503" }],
  "v1-background-workers": [{ source: "railway-read-only", reference: "service:api stopped" }],
  "v1-standalone-prepress": [{ source: "railway-read-only", reference: "service:prepress stopped" }],
  "v1-migration-runner": [{ source: "database-read-only", reference: "lock:none" }],
  "stripe-webhook-application": [{ source: "railway-read-only", reference: "service:api stopped" }, { source: "provider-console-read-only", reference: "stripe:retry-policy-recorded" }],
  "quickbooks-workers": [{ source: "railway-read-only", reference: "service:api stopped" }],
  "email-delivery-workers": [{ source: "railway-read-only", reference: "service:api stopped" }],
  "financial-outbox-consumer": [{ source: "railway-read-only", reference: "service:api stopped" }],
  "mcp-production": [{ source: "mcp-registry-read-only", reference: "endpoint:inventory" }],
  "mcp-development": [{ source: "mcp-registry-read-only", reference: "endpoint:inventory" }],
  "v2-writers": [{ source: "railway-read-only", reference: "service:v2 absent" }],
  "reconciliation-executor": [{ source: "database-read-only", reference: "lock:none" }],
};

const safe: RuntimeAuthorityObservation[] = m72eRequiredAuthorities.map((authority) => ({
  authority,
  admission: authority === "v1-http-mutation-ingress" || authority === "stripe-webhook-application" ? "closed" : "not_applicable",
  process: "stopped",
  canMutate: false,
  capturedAt: new Date(now).toISOString(),
  evidence: requiredSources[authority],
}));

assert.equal(assertM72eWriteFreeRuntime(safe, now).pass, true);
assert.equal(assertM72eWriteFreeRuntime(safe.slice(1), now).pass, false, "missing authority fails closed");
assert.equal(assertM72eWriteFreeRuntime([{ ...safe[0], process: "running" }, ...safe.slice(1)], now).pass, false, "a running writer fails closed");
assert.equal(assertM72eWriteFreeRuntime([{ ...safe[0], capturedAt: "2026-09-05T15:00:00.000Z" }, ...safe.slice(1)], now).pass, false, "stale evidence fails closed");
assert.equal(assertM72eWriteFreeRuntime([{ ...safe[0], evidence: [] }, ...safe.slice(1)], now).pass, false, "missing source-specific evidence fails closed");

console.log("M7.2E write-free runtime gate pure checks passed");
