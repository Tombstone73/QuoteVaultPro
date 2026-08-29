import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createCustomerRouter, type CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes";
import { createContactRouter, type ContactHttpDependencies } from "../../src/interfaces/http/contactRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const editor = (capabilities: readonly string[]): StaffPrincipal => ({ kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities } } as StaffPrincipal);
const customer = {
  customerId: "customer-a", displayName: "Acme", revision: "2026-08-29T00:00:00.000Z",
  editable: { companyName: "Acme" }, presentation: { customerDisplayName: "Acme", companyName: "Acme" },
  contacts: [{ contactId: "contact-a", displayName: "Ada", primary: true, status: "active" as const, revision: "2026-08-29T00:00:00.000Z" }],
  contactReadiness: { status: "ready" as const, reasons: [] },
};
const contact = { contactId: "contact-a", displayName: "Ada", firstName: "Ada", lastName: "Lovelace", customerId: "customer-a", customerName: "Acme", primary: true, status: "active" as const, revision: "2026-08-29T00:00:00.000Z", customerRevision: customer.revision, customerPresentation: customer.presentation, relatedContacts: [] };

describe("V2 Customer/Contact administration HTTP contracts", () => {
  test("primary Contact replacement is edit-gated and carries durable/stale context", async () => {
    const calls: unknown[] = [];
    const deps: CustomerHttpDependencies = {
      principals: { principal: async () => editor(["customer.view", "customer.edit"]) },
      customers: { list: async () => [], read: async () => customer },
      administration: { updateCustomer: async () => undefined, setPrimaryContact: async (_org, _principal, input) => { calls.push(input); } },
    };
    const app = express().use(express.json()).use("/v2/organizations/:organizationId/customers", createCustomerRouter(deps));
    await request(app).put("/v2/organizations/org-a/customers/customer-a/primary-contact").send({ businessRequestId: "request-1", expectedCustomerRevision: customer.revision, contactId: "contact-b" }).expect(200, { ok: true, data: customer });
    expect(calls).toEqual([{ businessRequestId: "request-1", expectedCustomerRevision: customer.revision, customerId: "customer-a", contactId: "contact-b" }]);
  });

  test("Customer correction is denied without customer.edit", async () => {
    const deps: CustomerHttpDependencies = {
      principals: { principal: async () => editor(["customer.view"]) }, customers: { list: async () => [], read: async () => customer },
      administration: { updateCustomer: async () => undefined, setPrimaryContact: async () => undefined },
    };
    const app = express().use(express.json()).use("/v2/organizations/:organizationId/customers", createCustomerRouter(deps));
    await request(app).patch("/v2/organizations/org-a/customers/customer-a").send({}).expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Customer correction is unavailable." } });
  });

  test("Contact create requires a durable request and Customer revision", async () => {
    const calls: unknown[] = [];
    const deps: ContactHttpDependencies = {
      principals: { principal: async () => editor(["customer.view", "customer.edit"]) },
      contacts: { list: async () => ({ items: [], total: 0, accounts: 0 }), read: async () => contact },
      administration: { createContact: async (_org, _principal, input) => { calls.push(input); return "contact-a"; }, updateContact: async () => undefined },
    };
    const app = express().use(express.json()).use("/v2/organizations/:organizationId/contacts", createContactRouter(deps));
    await request(app).post("/v2/organizations/org-a/contacts").send({ customerId: "customer-a", firstName: "Ada", lastName: "Lovelace" }).expect(400);
    await request(app).post("/v2/organizations/org-a/contacts").send({ businessRequestId: "request-2", expectedCustomerRevision: customer.revision, customerId: "customer-a", firstName: "Ada", lastName: "Lovelace" }).expect(201, { ok: true, data: contact });
    expect(calls).toEqual([{ businessRequestId: "request-2", expectedCustomerRevision: customer.revision, customerId: "customer-a", firstName: "Ada", lastName: "Lovelace" }]);
  });
});
