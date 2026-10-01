import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrderBillingSummary, OrderWorkspace } from "./OrderWorkspace";
import type { OrderRead } from "./api";
import { salesKeys } from "./quoteFormQueries";
import { createSalesWorkspaceClient } from "./salesWorkspaceApi";

Object.assign(globalThis, { React });
const workspaceClient = createSalesWorkspaceClient({ request: async () => { throw new Error("Canonical read-only presentation cannot mutate"); }, commandHeaders: () => ({ "x-v2-csrf-token": "test-csrf" }) });
const canonical = (permitted: boolean) => {
  const cache = new QueryClient();
  const value: OrderRead = { order: { organizationId: "org-a", orderId: "order-a", customerContact: { organizationId: "org-a", customerId: "customer-a" }, purchaseOrderNumber: "PO-1010", requestedDueDate: "2026-10-20T00:00:00.000Z", terms: { termsCode: "net_30", commercialNotes: "Existing commercial notes" }, currency: "USD", commercialState: "open", lines: [{ lineId: "line-a", productId: "product-a", description: "Window decals", operationalNote: "Retain frozen line evidence", quantity: 2, position: 1, resolvedConfiguration: { selections: { color: "blue" } }, calculatedUnitAmount: { cents: 5000, currency: "USD" }, calculatedLineAmount: { cents: 10000, currency: "USD" }, sellingUnitAmount: { cents: 4000, currency: "USD" }, sellingLineAmount: { cents: 8000, currency: "USD" }, sellingPriceDecision: { kind: "locked" } }] }, number: { display: "ORD-1010", core: "1010" }, revision: "7", totals: { calculated: { cents: 10000, currency: "USD" }, selling: { cents: 8000, currency: "USD" } }, routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } };
  cache.setQueryData(salesKeys.order("scope-a", "org-a", "order-a"), value);
  return renderToStaticMarkup(<QueryClientProvider client={cache}><OrderWorkspace organizationId="org-a" sessionScope="scope-a" userId="user-a" orderId="order-a" workspaceClient={workspaceClient} workspaceCapabilities={{ quoteCreate: false, orderCreate: false, quoteOverridePrice: false, orderView: true, orderEdit: permitted }} canEdit={permitted} canCreate={false} canCancel={false} canOverridePrice={false} canViewInvoice={false} canViewArtwork={false} canViewProofing={false} canViewProduction={false} csrfReady onBack={() => undefined} /></QueryClientProvider>);
};
const readonly = canonical(true);
assert.match(readonly, /Window decals/);
assert.match(readonly, /<input[^>]*aria-label="PO #"[^>]*disabled=""[^>]*value="PO-1010"/);
assert.match(readonly, /<input[^>]*aria-label="Requested Due"[^>]*value="2026-10-20"/, "readonly dates display the current canonical day from its timestamp");
assert.match(readonly, /<button class="button" type="button">Edit Order<\/button>/);
assert.doesNotMatch(readonly, /Save description|Save quantity or price|Save requested fulfillment|>Remove<\/button>|>Save<\/button>/);
assert.match(canonical(false), /<button class="button" type="button" disabled="">Edit Order<\/button>/, "read permission does not grant commercial mutation authority");

const billing = renderToStaticMarkup(
  <OrderBillingSummary
    invoice={{ invoiceId: "invoice-1", sourceOrderNumber: "ORD-1010", lifecycle: "draft", total: { cents: 11008, currency: "USD" } } as never}
    settlement={{ settlement: { paid: { cents: 0, currency: "USD" }, balance: { cents: 11008, currency: "USD" } } } as never}
    onOpen={() => undefined}
  />,
);
assert.match(billing, /<h3>Billing<\/h3>/);
assert.match(billing, /<strong>Invoice ORD-1010<\/strong>/);
assert.match(billing, /Order-backed/);
assert.doesNotMatch(billing, /Draft/);
assert.match(billing, /Paid/);
assert.doesNotMatch(billing, /BillingInvoice/);

const workspace = await readFile(new URL("./OrderWorkspace.tsx", import.meta.url), "utf8");
assert.doesNotMatch(workspace, /orderApi\.patch|kind: "update_description"|showConfigurationFields=\{false\}/);
assert.match(workspace, /<TransactionalSalesWorkspace/);
assert.match(workspace, /onClick=\{props\.onEnterEdit\}/);
assert.match(workspace, /Frozen configuration recorded on this Order line/);
const temporary = await readFile(new URL("./TransactionalSalesWorkspace.tsx", import.meta.url), "utf8");
assert.match(temporary, /client\.updateLine/);
assert.match(temporary, /Historical pricing and configuration are retained|Historical quantity/);
assert.match(workspace, /Fulfillment method/);
assert.match(workspace, /Available to fulfill/);
assert.match(workspace, /v2-order-owner-summaries/);
assert.match(workspace, /"order-invoice"/);
assert.match(workspace, /"order-invoice-settlement"/);
assert.match(workspace, /invoice=\{billing\.data\}/, "the Order Billing tab uses the canonical invoice-for-order read, including issued invoices");
assert.match(workspace, /billing\.data &&\s*props\.openInvoice\?\.\(billing\.data\.invoiceId\)/, "the Order Billing tab opens the canonical invoice-for-order identity");
assert.doesNotMatch(workspace, /requestedFulfillment\.method\.replaceAll/);

console.log("Order saved workspace presentation tests passed.");
