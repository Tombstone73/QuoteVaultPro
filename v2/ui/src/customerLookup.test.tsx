import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerLookup, customerLookupKeyAction } from "./CustomerLookup";
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
assert.equal(customerLookupQueryOptions("scope-a", "tenant-a", "", true).enabled, true);
assert.equal(customerLookupQueryOptions("scope-a", "tenant-a", "brain", true).enabled, true);
assert.equal(customerLookupQueryOptions("scope-a", "", "brain", true).enabled, false);

assert.deepEqual(customerLookupKeyAction("ArrowDown", false, 0, 3), { open: true, activeIndex: 0 });
assert.deepEqual(customerLookupKeyAction("ArrowDown", true, 0, 3), { open: true, activeIndex: 1 });
assert.deepEqual(customerLookupKeyAction("ArrowUp", true, 0, 3), { open: true, activeIndex: 0 });
assert.deepEqual(customerLookupKeyAction("Enter", true, 2, 3), { open: true, activeIndex: 2, selectActive: true });
assert.deepEqual(customerLookupKeyAction("Escape", true, 2, 3), { open: false, activeIndex: 0, close: true });
assert.equal(customerLookupKeyAction("Enter", true, 0, 0), undefined);

const calls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  calls.push(String(input));
  return new Response(JSON.stringify({ ok: true, data: { items: [{ customerId: "brainstorm", displayName: "Brainstorm Print", companyName: "Brainstorm Print" }] } }), {
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
try {
  const initial = await customerLookupQueryOptions("scope-a", "tenant-a", "", true).queryFn();
  const result = await customerLookupQueryOptions("scope-a", "tenant-a", "brain", true).queryFn();
  assert.equal(initial.items[0]?.displayName, "Brainstorm Print");
  assert.equal(result.items[0]?.displayName, "Brainstorm Print");
} finally {
  globalThis.fetch = originalFetch;
}
assert.deepEqual(calls, ["/v2/organizations/tenant-a/customers", "/v2/organizations/tenant-a/customers?q=brain"]);

const markup = renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <CustomerLookup organizationId="tenant-a" sessionScope="scope-a" customerId="" onChange={() => undefined} />
  </QueryClientProvider>,
);
assert.match(markup, /aria-label="Customer"/);
assert.match(markup, /role="combobox"/);
assert.match(markup, /Search or browse customers/);
assert.match(markup, /aria-haspopup="listbox"/);
console.log("CRM-backed Customer lookup tests passed.");
