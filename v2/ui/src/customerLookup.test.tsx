import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerLookup } from "./CustomerLookup";
import { customerLookupKeys, customerLookupQueryOptions } from "./quoteFormQueries";

assert.notDeepEqual(
  customerLookupKeys.search("scope-a", "tenant-a", "Brain"),
  customerLookupKeys.search("scope-a", "tenant-b", "Brain"),
  "customer searches must remain tenant-scoped",
);
assert.notDeepEqual(
  customerLookupKeys.search("scope-a", "tenant-a", "Brain"),
  customerLookupKeys.search("scope-a", "tenant-a", "Vision"),
  "different partial terms must not share stale results",
);
assert.equal(customerLookupQueryOptions("scope-a", "tenant-a", "", true).enabled, false);
assert.equal(customerLookupQueryOptions("scope-a", "tenant-a", "brain", true).enabled, true);

const calls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  calls.push(String(input));
  return new Response(JSON.stringify({ ok: true, data: { items: [{ customerId: "brainstorm", displayName: "Brainstorm Print", companyName: "Brainstorm Print" }] } }), {
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
try {
  const result = await customerLookupQueryOptions("scope-a", "tenant-a", "brain", true).queryFn();
  assert.equal(result.items[0]?.displayName, "Brainstorm Print");
} finally {
  globalThis.fetch = originalFetch;
}
assert.deepEqual(calls, ["/v2/organizations/tenant-a/customers?q=brain"]);

const markup = renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <CustomerLookup organizationId="tenant-a" sessionScope="scope-a" customerId="" onChange={() => undefined} />
  </QueryClientProvider>,
);
assert.match(markup, /aria-label="Customer"/);
assert.match(markup, /role="combobox"/);
assert.match(markup, /Search customers/);
console.log("CRM-backed Customer lookup tests passed.");
