import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerWorkspace } from "./CustomerWorkspace";

const listClient = new QueryClient();
listClient.setQueryData(["v2", "scope-a", "org-a", "customers", ""], {
  items: [{ customerId: "customer-a", displayName: "Acme", companyName: "Acme Printing", email: "billing@acme.test", phone: "555-0100", primaryContact: { contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111" } }],
});
const list = renderToStaticMarkup(<QueryClientProvider client={listClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="" canView openCustomer={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
assert.match(list, /Customers/);
assert.match(list, /Acme/);
assert.match(list, /Ada Lovelace/);
assert.doesNotMatch(list, /customer-a/);
assert.doesNotMatch(list, /contact-a/);

const detailClient = new QueryClient();
detailClient.setQueryData(["v2", "scope-a", "org-a", "customers", "customer-a"], {
  customerId: "customer-a", displayName: "Acme", presentation: {
    customerDisplayName: "Acme", companyName: "Acme Printing", contactDisplayName: "Ada Lovelace", email: "billing@acme.test", phone: "555-0100",
    billingAddress: { lines: ["1 Main Street"], city: "Boston", region: "MA", postalCode: "02110" },
  }, contacts: [{ contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111" }],
});
const detail = renderToStaticMarkup(<QueryClientProvider client={detailClient}><CustomerWorkspace organizationId="org-a" sessionScope="scope-a" customerId="customer-a" canView openCustomer={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["Account Details", "Contacts", "Commercial Context", "Billing Address", "Ada Lovelace", "Primary"]) assert.match(detail, new RegExp(text));
assert.doesNotMatch(detail, /customer-a/);
assert.doesNotMatch(detail, /contact-a/);

console.log("Customer workspace visual contract tests passed.");
