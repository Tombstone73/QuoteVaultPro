import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createCustomerRouter, type CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes.js";
import { createContactRouter, type ContactHttpDependencies } from "../../src/interfaces/http/contactRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const principal = (caps: readonly string[]): StaffPrincipal => ({ kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "member-a", capabilities: caps } } as StaffPrincipal);
const customer = { customerId: "customer-a", displayName: "Acme", revision: "1", editable: { companyName: "Acme" }, presentation: { customerDisplayName: "Acme", companyName: "Acme" }, contacts: [{ contactId: "contact-a", displayName: "Ada", primary: true, status: "active" as const, revision: "1" }], contactReadiness: { status: "ready" as const, reasons: [] } };
const contact = { contactId: "contact-a", displayName: "Ada", firstName: "Ada", lastName: "Lovelace", customerId: "customer-a", customerName: "Acme", primary: true, status: "active" as const, revision: "1", customerRevision: "1", customerPresentation: customer.presentation, relatedContacts: [] };
const calls: unknown[] = [];
const customers: CustomerHttpDependencies = { principals: { principal: async () => principal(["customer.view", "customer.edit"]) }, customers: { list: async () => [], read: async () => customer }, administration: { updateCustomer: async (_org, _actor, id, input) => { calls.push({ kind: "update", id, input }); }, setPrimaryContact: async (_org, _actor, input) => { calls.push({ kind: "primary", input }); } } };
const contacts: ContactHttpDependencies = { principals: { principal: async () => principal(["customer.view", "customer.edit"]) }, contacts: { list: async () => ({ items: [], total: 0, accounts: 0 }), read: async () => contact }, administration: { createContact: async (_org, _actor, input) => { calls.push({ kind: "create", input }); return "contact-a"; }, updateContact: async (_org, _actor, id, input) => { calls.push({ kind: "contact-update", id, input }); } } };
const app = express().use(express.json()).use("/v2/organizations/:organizationId/customers", createCustomerRouter(customers)).use("/v2/organizations/:organizationId/contacts", createContactRouter(contacts));

await request(app).put("/v2/organizations/org-a/customers/customer-a/primary-contact").send({ businessRequestId: "primary-1", expectedCustomerRevision: "1", contactId: "contact-b" }).expect(200);
await request(app).patch("/v2/organizations/org-a/customers/customer-a").send({ businessRequestId: "customer-1", expectedRevision: "1", companyName: "Acme Updated", billingAddress: { street1: "1 Main", state: "IN" } }).expect(200);
await request(app).post("/v2/organizations/org-a/contacts").send({ businessRequestId: "contact-1", expectedCustomerRevision: "1", customerId: "customer-a", firstName: "Grace", lastName: "Hopper" }).expect(201);
await request(app).patch("/v2/organizations/org-a/contacts/contact-a").send({ businessRequestId: "contact-update-1", expectedCustomerRevision: "1", expectedContactRevision: "1", customerId: "customer-a", firstName: "Ada", lastName: "Lovelace", active: true }).expect(200);
assert.deepEqual(calls.map((entry: any) => entry.kind), ["primary", "update", "create", "contact-update"]);
assert.deepEqual((calls[0] as any).input, { businessRequestId: "primary-1", expectedCustomerRevision: "1", customerId: "customer-a", contactId: "contact-b" });

const readOnly = express().use(express.json()).use("/v2/organizations/:organizationId/customers", createCustomerRouter({ ...customers, principals: { principal: async () => principal(["customer.view"]) } }));
await request(readOnly).patch("/v2/organizations/org-a/customers/customer-a").send({}).expect(403);
console.log("Customer/contact correction, primary selection, durable request context, stale revisions, and RBAC route contracts passed.");
