import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { createOrderRouter, type OrderHttpDependencies } from "../../src/interfaces/http/orderRoutes.js";

const principal: StaffPrincipal = { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["order.edit", "order.view"] } };
const calls: Array<{ operation: string; contextOrganizationId: string; input: Record<string, unknown> }> = [];
const responseValue = { order: { order: { orderId: "order-a", commercialState: "completed" }, revision: "7" }, draftInvoiceId: "invoice-a", routeInstances: [] };
const operation = (name: string) => async (context: { organizationId: string }, input: Readonly<Record<string, unknown>>) => {
  calls.push({ operation: name, contextOrganizationId: context.organizationId, input: { ...input } });
  return { ok: true as const, value: responseValue };
};
const application = express().use(express.json()).use("/v2/organizations/:organizationId/orders", createOrderRouter({
  principals: { principal: async () => principal },
  service: { archive: operation("archive"), unarchive: operation("unarchive") } as OrderHttpDependencies["service"],
}));

for (const action of ["archive", "unarchive"] as const) {
  const result = await request(application).post(`/v2/organizations/org-a/orders/order-a/${action}`).send({ businessRequestId: `request-${action}`, expectedStateToken: "7", orderId: "body-cannot-retarget" });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
}
assert.deepEqual(calls.map((call) => call.operation), ["archive", "unarchive"]);
for (const call of calls) {
  assert.equal(call.contextOrganizationId, "org-a");
  assert.equal(call.input.orderId, "order-a", "the authoritative path identity replaces any browser-supplied Order identity");
  assert.equal(call.input.expectedStateToken, "7");
}
const retiredComplete = await request(application).post("/v2/organizations/org-a/orders/order-a/complete").send({ businessRequestId: "request-complete", expectedStateToken: "7" });
assert.equal(retiredComplete.status, 404, "routine completion cannot bypass the canonical reconciler");

const listCalls: Record<string, unknown>[] = [];
const listApplication = express().use("/v2/organizations/:organizationId/orders", createOrderRouter({
  principals: { principal: async () => principal },
  service: {} as OrderHttpDependencies["service"],
  workspace: { listOrdersForWorkspace: async (_organizationId, input) => { listCalls.push({ ...input }); return { items: [], totalMatching: 0 }; } } as OrderHttpDependencies["workspace"],
}));
await request(listApplication).get("/v2/organizations/org-a/orders?archive=archived&lifecycle=completed").expect(200);
assert.deepEqual(listCalls, [{ limit: 25, lifecycle: "completed", archive: "archived" }], "archive/lifecycle history scope is server-backed before paging");
await request(listApplication).get("/v2/organizations/org-a/orders?archive=deleted").expect(400);
await request(listApplication).get("/v2/organizations/org-a/orders?operational=open_balance").expect(200);
assert.deepEqual(listCalls.at(-1), { limit: 25, operationalFilter: "open_balance" }, "the HTTP adapter forwards only the validated operational scope to the canonical workspace port");
await request(listApplication).get("/v2/organizations/org-a/orders?operational=made-up").expect(400);

console.log("Order lifecycle HTTP route tests passed.");
