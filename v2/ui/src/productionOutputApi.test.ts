import assert from "node:assert/strict";
import { productionApi } from "./api";

const originalFetch = globalThis.fetch;
const seen: { url?: string; init?: RequestInit } = {};
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  seen.url = String(url);
  seen.init = init;
  return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  await productionApi.output("org a", "attempt a", "request-a", { goodQuantityDelta: 0, wasteQuantityDelta: 3 });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(seen.url, "/v2/organizations/org%20a/production/attempts/attempt%20a/output");
assert.deepEqual(JSON.parse(String(seen.init?.body)), { businessRequestId: "request-a", goodQuantityDelta: 0, wasteQuantityDelta: 3 });
console.log("Production output API waste contract passed.");
