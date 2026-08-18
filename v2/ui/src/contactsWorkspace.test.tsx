import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactsWorkspace } from "./ContactsWorkspace";

const item = { contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111", customerId: "customer-a", customerName: "Acme", primary: true };
const listClient = new QueryClient();
listClient.setQueryData(["v2", "scope-a", "org-a", "contacts", ""], { items: [item], total: 1, accounts: 1 });
const list = renderToStaticMarkup(<QueryClientProvider client={listClient}><ContactsWorkspace organizationId="org-a" sessionScope="scope-a" contactId="" canView openContact={() => {}} openCustomer={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["Contacts", "Ada Lovelace", "Acme", "Primary"]) assert.match(list, new RegExp(text));
assert.doesNotMatch(list, /customer-a/);
assert.doesNotMatch(list, /contact-a/);

const detailClient = new QueryClient();
detailClient.setQueryData(["v2", "scope-a", "org-a", "contacts", "contact-a"], { ...item, customerPresentation: { customerDisplayName: "Acme", companyName: "Acme Printing", billingAddress: { lines: ["1 Main Street"], city: "Boston", region: "MA", postalCode: "02110" } }, relatedContacts: [item, { ...item, contactId: "contact-b", displayName: "Grace Hopper", primary: false }] });
const detail = renderToStaticMarkup(<QueryClientProvider client={detailClient}><ContactsWorkspace organizationId="org-a" sessionScope="scope-a" contactId="contact-a" canView openContact={() => {}} openCustomer={() => {}} backToCatalog={() => {}} /></QueryClientProvider>);
for (const text of ["Contact Details", "Email", "Phone", "Address", "Other Contacts", "Grace Hopper", "Recent Documents", "Communication"]) assert.match(detail, new RegExp(text));
assert.doesNotMatch(detail, /customer-a/);

console.log("Contacts workspace visual contract tests passed.");
