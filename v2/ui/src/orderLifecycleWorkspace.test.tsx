import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrderRead } from "./api";

// A few established presentational modules rely on Vite's React JSX runtime.
// Match that runtime before importing the full Order workspace in this pure SSR test.
(globalThis as { React?: typeof React }).React = React;
const [{ OrderWorkspace }, { salesKeys }] = await Promise.all([
  import("./OrderWorkspace"),
  import("./quoteFormQueries"),
]);

const order = (commercialState: "open" | "completed" | "cancelled", eligible = true, archived = false): OrderRead => ({
  order: {
    organizationId: "org-a",
    orderId: "order-a",
    customerContact: { organizationId: "org-a", customerId: "customer-a" },
    terms: {},
    currency: "USD",
    commercialState,
    ...(commercialState === "completed" ? { completedAt: "2026-09-03T12:00:00.000Z" } : {}),
    ...(archived ? { archivedAt: "2026-09-03T13:00:00.000Z" } : {}),
    billingInvoiceReference: "invoice-a",
    lines: [],
  },
  number: { display: "ORD-1001", core: "1001" },
  revision: "7",
  totals: { calculated: { cents: 10000, currency: "USD" }, selling: { cents: 10000, currency: "USD" } },
  routes: [],
  completionEligibility: {
    eligible,
    blockers: eligible ? [] : [{ orderLineId: "line-a", kind: "fulfillment_remaining", reason: "Fixture: 1 item remains to be fulfilled." }],
    lines: [],
  },
});
const markup = (value: OrderRead) => {
  const client = new QueryClient();
  client.setQueryData(salesKeys.order("scope-a", "org-a", "order-a"), value);
  return renderToStaticMarkup(<QueryClientProvider client={client}><OrderWorkspace organizationId="org-a" sessionScope="scope-a" orderId="order-a" canEdit canCreate canCancel canOverridePrice canViewInvoice canViewArtwork canViewProofing canViewProduction csrfReady onBack={() => undefined} /></QueryClientProvider>);
};

const eligibleOpen = markup(order("open"));
assert.match(eligibleOpen, /Mark Order Complete/);
assert.doesNotMatch(eligibleOpen, /Archive Order|Unarchive Order/);

const blockedOpen = markup(order("open", false));
assert.match(blockedOpen, /Order completion unavailable/);
assert.match(blockedOpen, /1 item remains to be fulfilled/);
assert.match(blockedOpen, /Mark Order Complete/);

const completed = markup(order("completed"));
assert.match(completed, /Archive Order/);
assert.doesNotMatch(completed, /Mark Order Complete/);
assert.match(completed, /<button class="button" type="button" disabled="">Save<\/button>/);

const archived = markup(order("completed", true, true));
assert.match(archived, /Unarchive Order/);
assert.match(archived, />Archived</);
assert.doesNotMatch(archived, /Archive Order|Mark Order Complete/);

console.log("Order completion/archive workspace presentation tests passed.");
