import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import type { StaffPrincipal } from "../../src/authorization/principals";
import { createCustomerRouter, type CustomerHttpDependencies } from "../../src/interfaces/http/customerRoutes";

const principal: StaffPrincipal = { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["customer.view"] } };
const calls: unknown[] = [];
const dependencies: CustomerHttpDependencies = {
  principals: { principal: async () => principal },
  customers: {
    list: async (organizationId, catalogRequest) => {
      calls.push({ organizationId, catalogRequest });
      return { items: [{ customerId: "customer-125", displayName: "Deep Customer", companyName: "Deep Customer" }], totalMatching: 125, nextCursor: "opaque-next" };
    },
    read: async () => null,
  },
};
const app = express().use("/v2/organizations/:organizationId/customers", createCustomerRouter(dependencies));
const response = await request(app).get("/v2/organizations/org-a/customers?q=Deep&cursor=opaque-current&limit=25").expect(200);
assert.deepEqual(calls, [{ organizationId: "org-a", catalogRequest: { query: "Deep", cursor: "opaque-current", limit: 25 } }]);
assert.deepEqual(response.body.data, { items: [{ customerId: "customer-125", displayName: "Deep Customer", companyName: "Deep Customer" }], totalMatching: 125, nextCursor: "opaque-next" });
await request(app).get("/v2/organizations/org-b/customers").expect(403);

console.log("Customer catalog pagination HTTP tests passed.");
