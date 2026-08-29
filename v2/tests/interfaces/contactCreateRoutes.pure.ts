import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { createContactRouter, type ContactHttpDependencies } from "../../src/interfaces/http/contactRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const staff = (organizationId = "org-a", capabilities = ["customer.view", "customer.edit"]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});
const created = {
  contactId: "contact-a", displayName: "DEV QA Contact", firstName: "DEV", lastName: "QA Contact", email: "qa@example.test", customerId: "customer-a", customerName: "DEV QA - Sales Operator Fixture", primary: false, status: "active" as const, revision: "revision-1", customerRevision: "customer-revision-1",
  customerPresentation: { customerDisplayName: "DEV QA - Sales Operator Fixture", companyName: "DEV QA - Sales Operator Fixture" }, relatedContacts: [],
};
const app = (actor: StaffPrincipal, calls: Array<Record<string, unknown>>) => express().use(express.json()).use(
  "/v2/organizations/:organizationId/contacts",
  createContactRouter({
    principals: { principal: async () => actor },
    contacts: {
      list: async () => ({ items: calls.length ? [created] : [], total: calls.length, accounts: calls.length }),
      read: async (_organizationId, contactId) => contactId === created.contactId ? created : null,
    },
    administration: { createContact: async (organizationId, principal, input) => { calls.push({ organizationId, actor: principal.kind, ...input }); return created.contactId; }, updateContact: async () => undefined },
  } satisfies ContactHttpDependencies),
);

const calls: Array<Record<string, unknown>> = [];
const createdResponse = await request(app(staff(), calls)).post("/v2/organizations/org-a/contacts").send({
  businessRequestId: "request-1", expectedCustomerRevision: "customer-revision-1", customerId: " customer-a ", firstName: " DEV ", lastName: " QA Contact ", email: " qa@example.test ", organizationId: "org-b", isPrimary: true,
}).expect(201);
assert.deepEqual(createdResponse.body, { ok: true, data: created });
assert.deepEqual(calls, [{ organizationId: "org-a", actor: "staff", businessRequestId: "request-1", expectedCustomerRevision: "customer-revision-1", customerId: "customer-a", firstName: "DEV", lastName: "QA Contact", email: "qa@example.test" }]);
const listResponse = await request(app(staff(), calls)).get("/v2/organizations/org-a/contacts?q=DEV QA").expect(200);
assert.equal(listResponse.body.data.items[0].contactId, created.contactId);
const readResponse = await request(app(staff(), calls)).get("/v2/organizations/org-a/contacts/contact-a").expect(200);
assert.equal(readResponse.body.data.customerId, "customer-a");

const invalidBodies = [
  [{}, "Customer is required."],
  [{ customerId: "customer-a" }, "First name is required."],
  [{ customerId: "customer-a", firstName: "DEV" }, "Last name is required."],
  [{ customerId: "customer-a", firstName: 42, lastName: "QA" }, "First name must be text."],
] as const;
for (const [body, message] of invalidBodies) {
  await request(app(staff(), [])).post("/v2/organizations/org-a/contacts").send(body).expect(400, { ok: false, error: { code: "VALIDATION_ERROR", message } });
}
await request(app(staff("org-a", ["customer.view"]), [])).post("/v2/organizations/org-a/contacts").send({ customerId: "customer-a", firstName: "Denied", lastName: "Contact" }).expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Contact creation is unavailable." } });
await request(app(staff("org-b"), [])).post("/v2/organizations/org-a/contacts").send({ customerId: "customer-a", firstName: "Foreign", lastName: "Contact" }).expect(403);

const canonicalRepository = await readFile(new URL("../../../server/storage/customers.repo.ts", import.meta.url), "utf8");
assert.match(canonicalRepository, /createCustomerContactForOrganization/);
assert.match(canonicalRepository, /customerContactLinks/);
assert.doesNotMatch(canonicalRepository, /values\(\s*\[\s*\]\s*\)/);
const v2Operation = await readFile(new URL("../../infrastructure/customers/canonicalContactCreation.ts", import.meta.url), "utf8");
assert.match(v2Operation, /createCustomerContactForOrganization/);
assert.match(v2Operation, /auditLogs/);
console.log("Contact create HTTP ownership, validation, and canonical persistence tests passed.");
