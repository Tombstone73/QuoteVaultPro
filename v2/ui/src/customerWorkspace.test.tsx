import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerWorkspace } from "./CustomerWorkspace";

const listClient = new QueryClient();
listClient.setQueryData(["v2", "scope-a", "org-a", "customers", ""], {
  items: [{ customerId: "customer-a", displayName: "Acme", companyName: "Acme Printing", email: "billing@acme.test", phone: "555-0100", primaryContact: { contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111", primary: true } }],
});
const list = renderToStaticMarkup(<QueryClientProvider client={listClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="" canView openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
assert.match(list, /Customers/);
assert.match(list, /Acme/);
assert.match(list, /Ada Lovelace/);
assert.match(list, /1 customer accounts/);
assert.doesNotMatch(list, /customer-a/);
assert.doesNotMatch(list, /contact-a/);

const detailClient = new QueryClient();
detailClient.setQueryData(["v2", "scope-a", "org-a", "customers", "customer-a"], {
  customerId: "customer-a", displayName: "Acme", presentation: {
    customerDisplayName: "Acme", companyName: "Acme Printing", contactDisplayName: "Ada Lovelace", email: "billing@acme.test", phone: "555-0100",
    billingAddress: { lines: ["1 Main Street"], city: "Boston", region: "MA", postalCode: "02110" },
  }, contacts: [{ contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111", primary: true }],
});
const detail = renderToStaticMarkup(<QueryClientProvider client={detailClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="customer-a" canView openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["Account Details", "Contacts", "Commercial Context", "Billing Address", "Ada Lovelace", "Primary", "customer-keyed read projection is not available yet"]) assert.match(detail, new RegExp(text));
assert.doesNotMatch(detail, /customer-a/);
assert.doesNotMatch(detail, /contact-a/);
assert.doesNotMatch(detail, /Available Credit|Log Activity|Add Contact|Account note/);

const unlinkedPrimaryClient = new QueryClient();
unlinkedPrimaryClient.setQueryData(["v2", "scope-a", "org-a", "customers", "customer-b"], {
  customerId: "customer-b", displayName: "No Primary", presentation: { customerDisplayName: "No Primary", companyName: "No Primary" },
  contacts: [{ contactId: "contact-b", displayName: "Unmarked Contact", primary: false }],
});
const unlinkedPrimary = renderToStaticMarkup(<QueryClientProvider client={unlinkedPrimaryClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="customer-b" canView openCustomer={() => {}} openContact={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
assert.match(unlinkedPrimary, /<dt>Primary Contact<\/dt><dd>—<\/dd>/);
assert.doesNotMatch(unlinkedPrimary, /<em>Primary<\/em>/);

console.log("Customer workspace visual contract tests passed.");
