import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { createCustomerRouter, type CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const staff = (organizationId = "org-a", capabilities = ["customer.view", "customer.edit"]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});

const created = {
  customerId: "customer-a", displayName: "DEV QA - Sales Operator Fixture", presentation: {
    customerDisplayName: "DEV QA - Sales Operator Fixture", companyName: "DEV QA - Sales Operator Fixture",
  }, contacts: [],
};

const app = (actor: StaffPrincipal, calls: Array<Record<string, unknown>>) => express().use(express.json()).use(
  "/v2/organizations/:organizationId/customers",
  createCustomerRouter({
    principals: { principal: async () => actor },
    customers: {
      list: async () => calls.length ? [{ customerId: created.customerId, displayName: created.displayName, companyName: created.presentation.companyName }] : [],
      read: async (_organizationId, customerId) => customerId === created.customerId ? created : null,
    },
    creation: { create: async (context, input) => { calls.push({ organizationId: context.organizationId, actor: context.principal.kind, ...input }); return created; } },
  } satisfies CustomerHttpDependencies),
);

const calls: Array<Record<string, unknown>> = [];
const createResponse = await request(app(staff(), calls)).post("/v2/organizations/org-a/customers").send({
  companyName: "  DEV QA - Sales Operator Fixture  ",
  displayName: "  DEV QA - Sales Operator Fixture  ",
  organizationId: "org-b",
}).expect(201);
assert.deepEqual(createResponse.body, { ok: true, data: created });
assert.deepEqual(calls, [{ organizationId: "org-a", actor: "staff", companyName: "DEV QA - Sales Operator Fixture", displayName: "DEV QA - Sales Operator Fixture" }]);
const listResponse = await request(app(staff(), calls)).get(`/v2/organizations/org-a/customers?q=${encodeURIComponent("DEV QA")}`).expect(200);
assert.equal(listResponse.body.data.items[0].customerId, created.customerId);

for (const body of [{}, { companyName: " " }, { companyName: 42 }]) {
  await request(app(staff(), [])).post("/v2/organizations/org-a/customers").send(body).expect(400, { ok: false, error: { code: "VALIDATION_ERROR", message: body.companyName === 42 ? "Company name must be text." : "Company name is required." } });
}
await request(app(staff("org-a", ["customer.view"]), [])).post("/v2/organizations/org-a/customers").send({ companyName: "Denied" }).expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Customer creation is unavailable." } });
await request(app(staff("org-b"), [])).post("/v2/organizations/org-a/customers").send({ companyName: "Foreign" }).expect(403);

const canonicalRepository = await readFile(new URL("../../../server/storage/customers.repo.ts", import.meta.url), "utf8");
assert.match(canonicalRepository, /\.insert\(customers\)\s*\.values\(customerInsert\)/);
assert.doesNotMatch(canonicalRepository, /\.values\(\s*\[\s*\]\s*\)/);

console.log("Customer create HTTP ownership and validation tests passed.");
