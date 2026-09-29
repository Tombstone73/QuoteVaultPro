import assert from "node:assert/strict";
import { fulfillmentApi } from "./api";

const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; init?: RequestInit }> = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(url), init });
  return new Response(JSON.stringify({ ok: true, data: { handoff: { handoffId: "handoff-r", method: "pickup", completedAt: "2026-09-29T00:00:00.000Z" }, allocations: [{ orderLineId: "line-r", quantity: 1 }], availability: [] } }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

try {
  await fulfillmentApi.pickupReplacement("org r", "order r", "replacement-pickup-request", { replacementObligationId: "replacement-r", orderLineId: "line-r", quantity: 1 });
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(requests.length, 1);
assert.equal(requests[0]?.url, "/v2/organizations/org%20r/fulfillment/orders/order%20r/pickups");
assert.equal(requests[0]?.init?.method, "POST");
assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { businessRequestId: "replacement-pickup-request", allocations: [{ orderLineId: "line-r", quantity: 1 }], replacementObligationId: "replacement-r" });
console.log("replacement pickup API payload tests passed.");
