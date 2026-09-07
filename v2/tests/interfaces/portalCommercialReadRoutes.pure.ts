import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createPortalInvoiceRouter } from "../../src/interfaces/http/portalInvoiceRoutes.js";

const portal: any = { kind: "portal", organizationId: "org-a", customerId: "customer-a", subjectId: "portal-user-a", capabilities: ["order.view", "quote.view"] };
const calls: any[] = [];
const commercial: any = {
  listOrders: async (principal: unknown, cursor?: string) => { calls.push({ kind: "orders", principal, cursor }); return { items: [] }; },
  ordersDashboard: async (principal: unknown) => { calls.push({ kind: "dashboard", principal }); return { recentOrders: [], currentOrderCount: 1, historicalOrderCount: 2, openBalanceOrderCount: 1 }; },
  getOrder: async () => null,
  listQuotes: async (principal: unknown, cursor?: string) => { calls.push({ kind: "quotes", principal, cursor }); return { items: [] }; },
  getQuote: async () => null,
};
const app = express().use("/v2/portal", createPortalInvoiceRouter({ portalPrincipal: { principal: async () => portal }, commercial } as any));

await request(app).get("/v2/portal/orders?cursor=opaque-page").expect(200);
await request(app).get("/v2/portal/orders/dashboard").expect(200);
await request(app).get("/v2/portal/quotes?cursor=quote-page").expect(200);
assert.deepEqual(calls.map(call => call.kind), ["orders", "dashboard", "quotes"]);
assert.equal(calls[0].cursor, "opaque-page");
assert.equal(calls[2].cursor, "quote-page");
for (const call of calls) assert.equal(call.principal, portal, "Portal scope must derive from the authenticated principal.");
console.log("Portal commercial read routes preserve authenticated customer scope and paging.");
