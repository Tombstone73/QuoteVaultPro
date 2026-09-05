import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { orderApi } from "./api";
import { OrderOperationalSummary, OrdersList } from "./OrdersList";

const markup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><OrdersList organizationId="organization-a" sessionScope="session-a" onOpenV2={() => undefined} onOpenLegacy={() => undefined} /></QueryClientProvider>);
assert.match(markup, /<h1[^>]*>Orders<\/h1>/);
assert.match(markup, />New Order</);
assert.match(markup, /Filter by number, PO, customer/);
for (const column of ["Order #", "Customer", "PO", "Contact", "Lines", "Due", "Status", "Operations", "Total"]) assert.match(markup, new RegExp(`>${column}<`));
for (const filter of ["All", "Open", "Completed", "Cancelled", "Archived"]) assert.match(markup, new RegExp(`>${filter}<`));
for (const workflow of ["All work", "Needs artwork", "Prepress", "Production", "Flatbed", "Roll", "Ready for fulfillment", "Fulfillment", "Open balance"]) assert.match(markup, new RegExp(`>${workflow}<`));
assert.match(markup, /Due from/);
assert.match(markup, /Updated: newest/);
assert.match(markup, /Actions/);
assert.doesNotMatch(markup, /Organization ID|Open Order ID|Authenticated route scope/);

const operationalMarkup = renderToStaticMarkup(<OrderOperationalSummary row={{
  source: "v2", recordId: "order-a", orderId: "order-a", number: "ORD-100", customerDisplayName: "Acme", lifecycle: "open", sellingTotalCents: 10000, currency: "USD", updatedAt: "2026-09-05T00:00:00.000Z", routing: "routed",
  operational: {
    primaryContact: { contactId: "contact-a", displayName: "Taylor Example" },
    artwork: { state: "present", assignmentCount: 2, representative: { artworkFileId: "file-a", displayFilename: "front.pdf", sides: ["front", "back"] } },
    notes: { hasOrderNotes: true }, prepress: "in_progress", production: { state: "in_progress", destinations: ["flatbed"] }, fulfillment: "required",
    billing: { state: "open_balance", openBalanceCents: 5000 }, attention: { overdue: true, needsArtwork: true },
  },
}} />);
for (const value of ["2 artworks · front/back", "Prepress · in progress", "Production · in progress · flatbed", "Fulfillment · required", "Billing · open balance · $50.00", "Overdue · Artwork needed · Notes"]) assert.match(operationalMarkup, new RegExp(value.replaceAll("$", "\\$")));
assert.doesNotMatch(operationalMarkup, /file-a|front\.pdf/, "the list does not expose opaque Artwork identifiers or original filenames as visible data");

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
  await orderApi.list("organization-a", { q: "ORD-20126", archive: "archived", lifecycle: "completed", operational: "needs_artwork" });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(requests.length, 1);
assert.match(requests[0]!, /archive=archived/);
assert.match(requests[0]!, /lifecycle=completed/);
assert.match(requests[0]!, /q=ORD-20126/);
assert.match(requests[0]!, /operational=needs_artwork/);
console.log("Orders list visual contract tests passed.");
