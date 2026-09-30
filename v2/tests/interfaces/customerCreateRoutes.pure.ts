import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { createCustomerRouter, type CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const staff = (organizationId = "org-a", capabilities = ["customer.view", "customer.edit"]): StaffPrincipal => ({
  kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities },
});

const created = {
  customerId: brandedId<"CustomerId">("customer-a"), displayName: "DEV QA - Sales Operator Fixture", presentation: {
    customerDisplayName: "DEV QA - Sales Operator Fixture", companyName: "DEV QA - Sales Operator Fixture",
  }, contacts: [], revision: "1", editable: { companyName: "DEV QA - Sales Operator Fixture" },
  commercial: { paymentTerms: "due_on_receipt", taxExempt: false, openReceivableCents: 0 },
  internalNotes: [], contactReadiness: { status: "needs_attention", reasons: ["no_contacts"] },
} satisfies NonNullable<Awaited<ReturnType<CustomerHttpDependencies["customers"]["read"]>>>;

const reads: Array<{ organizationId: string; request: Parameters<CustomerHttpDependencies["customers"]["list"]>[1] }> = [];

const app = (actor: StaffPrincipal, calls: Array<Record<string, unknown>>) => express().use(express.json()).use(
  "/v2/organizations/:organizationId/customers",
  createCustomerRouter({
    principals: { principal: async () => actor },
    customers: {
      list: async (organizationId, request) => {
        reads.push({ organizationId, request });
        return { items: calls.length && !request?.cursor ? [{ customerId: created.customerId, displayName: created.displayName, companyName: created.presentation.companyName }] : [], totalMatching: calls.length ? 1 : 0, ...(calls.length && !request?.cursor ? { nextCursor: "next-page" } : {}) };
      },
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
assert.deepEqual(listResponse.body, { ok: true, data: { items: [{ customerId: created.customerId, displayName: created.displayName, companyName: created.presentation.companyName }], totalMatching: 1, nextCursor: "next-page" } });
assert.deepEqual(reads, [{ organizationId: "org-a", request: { query: "DEV QA" } }]);
const lastPage = await request(app(staff(), calls)).get("/v2/organizations/org-a/customers?q=DEV%20QA&cursor=next-page&limit=25").expect(200);
assert.deepEqual(lastPage.body, { ok: true, data: { items: [], totalMatching: 1 } });
assert.deepEqual(reads.at(-1), { organizationId: "org-a", request: { query: "DEV QA", cursor: "next-page", limit: 25 } });
const emptyList = await request(app(staff(), [])).get("/v2/organizations/org-a/customers?limit=invalid").expect(200);
assert.deepEqual(emptyList.body, { ok: true, data: { items: [], totalMatching: 0 } });
assert.deepEqual(reads.at(-1), { organizationId: "org-a", request: { query: "" } });
const readCount = reads.length;
for (const actor of [staff("org-b"), staff("org-a", [])]) {
  await request(app(actor, calls)).get("/v2/organizations/org-a/customers").expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Customer access is unavailable." } });
}
assert.equal(reads.length, readCount, "foreign-tenant and unauthorized list requests must not reach the reader");
assert.equal(calls.length, 1, "list requests never create or mutate Customers");

const rejectedCalls: Array<Record<string, unknown>> = [];
for (const body of [{}, { companyName: " " }, { companyName: 42 }]) {
  await request(app(staff(), rejectedCalls)).post("/v2/organizations/org-a/customers").send(body).expect(400, { ok: false, error: { code: "VALIDATION_ERROR", message: body.companyName === 42 ? "Company name must be text." : "Company name is required." } });
}
await request(app(staff("org-a", ["customer.view"]), rejectedCalls)).post("/v2/organizations/org-a/customers").send({ companyName: "Denied" }).expect(403, { ok: false, error: { code: "FORBIDDEN", message: "Customer creation is unavailable." } });
await request(app(staff("org-b"), rejectedCalls)).post("/v2/organizations/org-a/customers").send({ companyName: "Foreign" }).expect(403);
assert.deepEqual(rejectedCalls, [], "validation and authority failures must not invoke Customer creation");

const canonicalRepository = await readFile(new URL("../../../server/storage/customers.repo.ts", import.meta.url), "utf8");
assert.match(canonicalRepository, /\.insert\(customers\)\s*\.values\(customerInsert\)/);
assert.doesNotMatch(canonicalRepository, /\.values\(\s*\[\s*\]\s*\)/);

console.log("Customer create HTTP ownership and validation tests passed.");
