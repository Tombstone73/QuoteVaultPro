import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { orderApi } from "./api";
import { OrdersList } from "./OrdersList";

const markup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><OrdersList organizationId="organization-a" sessionScope="session-a" onOpenV2={() => undefined} onOpenLegacy={() => undefined} /></QueryClientProvider>);
assert.match(markup, /<h1[^>]*>Orders<\/h1>/);
assert.match(markup, />New Order</);
assert.match(markup, /Filter by number, PO, customer/);
for (const column of ["Order #", "Customer", "PO", "Rep", "Lines", "Due", "Status", "Total"]) assert.match(markup, new RegExp(`>${column}<`));
for (const filter of ["All", "Open", "Completed", "Cancelled", "Archived"]) assert.match(markup, new RegExp(`>${filter}<`));
assert.match(markup, /Due from/);
assert.match(markup, /Updated: newest/);
assert.match(markup, /Actions/);
assert.doesNotMatch(markup, /Organization ID|Open Order ID|Authenticated route scope/);

const requests: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  requests.push(String(input));
  return new Response(JSON.stringify({ ok: true, data: { items: [], totalMatching: 0, summary: { itemCount: 0, sellingTotalCents: 0, currencies: [] } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
try {
  await orderApi.list("organization-a", { q: "ORD-20126", archive: "archived", lifecycle: "completed" });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(requests.length, 1);
assert.match(requests[0]!, /archive=archived/);
assert.match(requests[0]!, /lifecycle=completed/);
assert.match(requests[0]!, /q=ORD-20126/);
console.log("Orders list visual contract tests passed.");
