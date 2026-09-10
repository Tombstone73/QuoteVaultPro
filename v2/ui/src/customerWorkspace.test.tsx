import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerWorkspace } from "./CustomerWorkspace";

const listClient = new QueryClient();
listClient.setQueryData(["v2", "scope-a", "org-a", "customers", "catalog", "", ""], {
  items: [{ customerId: "customer-a", displayName: "Acme", companyName: "Acme Printing", email: "billing@acme.test", phone: "555-0100", primaryContact: { contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111", primary: true } }],
  totalMatching: 259,
  nextCursor: "next-page",
});
const list = renderToStaticMarkup(<QueryClientProvider client={listClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="" canView canCreate openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
assert.match(list, /Customers/);
assert.match(list, /Acme/);
assert.match(list, /Ada Lovelace/);
assert.match(list, /259 customer accounts/);
assert.match(list, /1 shown · 259 matching/);
assert.match(list, /Next/);
assert.match(list, /New Customer/);
assert.doesNotMatch(list, /customer-a/);
assert.doesNotMatch(list, /contact-a/);

const detailClient = new QueryClient();
detailClient.setQueryData(["v2", "scope-a", "org-a", "customers", "detail", "customer-a"], {
  customerId: "customer-a", displayName: "Acme", presentation: {
    customerDisplayName: "Acme", companyName: "Acme Printing", contactDisplayName: "Ada Lovelace", email: "billing@acme.test", phone: "555-0100",
    billingAddress: { lines: ["1 Main Street"], city: "Boston", region: "MA", postalCode: "02110" },
  }, contacts: [{ contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111", primary: true }],
});
detailClient.setQueryData(["v2", "scope-a", "org-a", "customers", "activity", "customer-a", ""], {
  items: [{ kind: "order", entityId: "order-a", occurredAt: "2026-09-07T12:00:00.000Z", title: "Order O-100", detail: "open" }], totalMatching: 1,
});
const detail = renderToStaticMarkup(<QueryClientProvider client={detailClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="customer-a" canView canCreate openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["Account Details", "Contacts", "Activity", "Billing Address", "Ada Lovelace", "Primary", "Order O-100"]) assert.match(detail, new RegExp(text));
assert.match(detail, /href="\/orders\/order-a"/, "Activity must link to the owning operational workspace.");
assert.doesNotMatch(detail, /customer-a/);
assert.doesNotMatch(detail, /contact-a/);
assert.match(detail, /Add Contact/);
assert.doesNotMatch(detail, /Available Credit|Log Activity|Account note|customer-keyed read projection is not available yet/);

const unlinkedPrimaryClient = new QueryClient();
unlinkedPrimaryClient.setQueryData(["v2", "scope-a", "org-a", "customers", "detail", "customer-b"], {
  customerId: "customer-b", displayName: "No Primary", presentation: { customerDisplayName: "No Primary", companyName: "No Primary" },
  contacts: [{ contactId: "contact-b", displayName: "Unmarked Contact", primary: false }],
});
const unlinkedPrimary = renderToStaticMarkup(<QueryClientProvider client={unlinkedPrimaryClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="customer-b" canView canCreate openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
assert.match(unlinkedPrimary, /<dt>Primary Contact<\/dt><dd>—<\/dd>/);
assert.doesNotMatch(unlinkedPrimary, /<em>Primary<\/em>/);

const commercialClient = new QueryClient();
commercialClient.setQueryData(["v2", "scope-a", "org-a", "customers", "detail", "customer-a"], detailClient.getQueryData(["v2", "scope-a", "org-a", "customers", "detail", "customer-a"]));
commercialClient.setQueryData(["v2", "scope-a", "org-a", "customers", "activity", "customer-a", ""], { items: [], totalMatching: 0 });
commercialClient.setQueryData(["v2", "scope-a", "org-a", "customer-commercial", "customer-a", "entitlements"], [{ productId: "product-a", enabled: true, updatedAt: "2026-09-10T12:00:00.000Z" }]);
commercialClient.setQueryData(["v2", "scope-a", "org-a", "customer-commercial", "customer-a", "agreements"], [{ id: "agreement-a", productId: "product-a", currency: "USD", mode: "fixed_unit", value: 125, active: true, effectiveFrom: "2026-09-10T12:00:00.000Z", createdAt: "2026-09-10T12:00:00.000Z" }]);
commercialClient.setQueryData(["v2", "scope-a", "org-a", "customer-commercial", "products", ""], { items: [{ productId: "product-a", displayName: "Rigid Sign", lifecycle: "active", measurementMode: "quantity_only", pricingSummary: "Per piece", hasDraft: false }], page: 1, pageSize: 50, total: 1, hasMore: false });
const commercial = renderToStaticMarkup(<QueryClientProvider client={commercialClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="customer-a" canView canCreate canManageCommercial openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["Portal catalog", "Portal enabled", "Save pricing agreement", "$1.25 per unit"]) assert.match(commercial, new RegExp(text.replace(/[$]/g, "\\$")));

const workspaceSource = readFileSync(new URL("./CustomerWorkspace.tsx", import.meta.url), "utf8");
assert.match(workspaceSource, /"catalog", search, cursor/, "Customer page/search cursors must have distinct React Query cache keys");
assert.match(workspaceSource, /setSearch\(event\.target\.value\); setCursor\(""\); setCursorHistory\(\[\]\)/, "changing Customer search must reset paging");
assert.match(workspaceSource, /"customers", "activity", customerId, cursor/, "Customer activity must be scoped and cursor-paged in its own cache key");
assert.match(workspaceSource, /workspacePath\("proofing"\)/, "Proof activity must link through the canonical Proofing workspace.");
assert.match(workspaceSource, /customerCommercialApi\.setEntitlement/, "catalog visibility must call the server-owned commercial policy");
assert.match(workspaceSource, /customerCommercialApi\.setPricingAgreement/, "customer pricing must call the server-owned commercial policy");

console.log("Customer workspace visual contract tests passed.");
