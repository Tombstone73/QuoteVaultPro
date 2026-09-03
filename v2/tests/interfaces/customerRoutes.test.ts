import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createCustomerRouter, type CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const staff = (organizationId: string, capabilities: readonly ("customer.view")[] = ["customer.view"]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});
const contact = { contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test" };
const catalog = { customerId: "customer-a", displayName: "Acme", companyName: "Acme Printing", email: "billing@acme.test", primaryContact: contact };
const detail = { ...catalog, presentation: { customerDisplayName: "Acme", companyName: "Acme Printing" }, contacts: [contact] };
const app = (principal: StaffPrincipal) => {
  const dependencies: CustomerHttpDependencies = {
    principals: { principal: async () => principal },
    customers: {
      list: async (organizationId, catalogRequest) => organizationId === "org-a" && catalogRequest?.query === "Acme"
        ? { items: [catalog], totalMatching: 1 }
        : { items: [], totalMatching: 0 },
      read: async (organizationId, customerId) => organizationId === "org-a" && customerId === "customer-a" ? detail : null,
    },
  };
  return express().use("/v2/organizations/:organizationId/customers", createCustomerRouter(dependencies));
};

describe("M4 Customer workspace HTTP projection", () => {
  test("lists the authenticated tenant's bounded Customer catalog and supports canonical search", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/customers?q=Acme&limit=25").expect(200, { ok: true, data: { items: [catalog], totalMatching: 1 } });
  });
  test("returns only Customer-owned detail and relationship-scoped Contacts", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/customers/customer-a").expect(200, { ok: true, data: detail });
  });
  test("fails closed for foreign organizations, unknown/malformed IDs, and absent customer.view", async () => {
    await request(app(staff("org-a"))).get("/v2/organizations/org-b/customers?q=Acme").expect(403);
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/customers/customer-b").expect(404, { ok: false, error: { code: "NOT_FOUND", message: "Customer is unavailable in this organization." } });
    await request(app(staff("org-a"))).get("/v2/organizations/org-a/customers/%2Fwrong").expect(404);
    await request(app(staff("org-a", []))).get("/v2/organizations/org-a/customers").expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Customer access is unavailable." } });
  });
});
