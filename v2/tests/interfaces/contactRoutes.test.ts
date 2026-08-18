import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createContactRouter, type ContactHttpDependencies } from "../../src/interfaces/http/contactRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const staff = (organizationId: string, capabilities: readonly ("customer.view")[] = ["customer.view"]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});
const item = { contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", phone: "555-0111", customerId: "customer-a", customerName: "Acme", primary: true };
const detail = { ...item, customerPresentation: { customerDisplayName: "Acme", companyName: "Acme Printing" }, relatedContacts: [item] };
const app = (principal: StaffPrincipal) => {
  const dependencies: ContactHttpDependencies = {
    principals: { principal: async () => principal },
    contacts: {
      list: async (organizationId, query) => organizationId === "org-a" && query === "Ada" ? { items: [item], total: 1, accounts: 1 } : { items: [], total: 0, accounts: 0 },
      read: async (organizationId, contactId) => organizationId === "org-a" && contactId === "contact-a" ? detail : null,
    },
  };
  return express().use("/v2/organizations/:organizationId/contacts", createContactRouter(dependencies));
};

describe("Contacts workspace HTTP projection", () => {
  test("lists tenant-scoped Contacts with a server aggregate", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/contacts?q=Ada").expect(200, { ok: true, data: { items: [item], total: 1, accounts: 1 } });
  });
  test("reads one active Contact and its Customer relationship", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/contacts/contact-a").expect(200, { ok: true, data: detail });
  });
  test("fails closed across tenant, malformed identifier, and missing customer.view", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-b/contacts?q=Ada").expect(403);
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/contacts/%2Fwrong").expect(404);
    await request(app(staff("org-a", []))).get("/v2/organizations/org-a/contacts").expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Contact access is unavailable." } });
  });
});
