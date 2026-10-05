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
  getQuotePdf: async (principal: unknown, quoteId: string, checkpointId?: string) => {
    calls.push({ kind: "quote-pdf", principal, quoteId, checkpointId });
    return quoteId === "quote-a" && checkpointId === "published-a" ? { bytes: new Uint8Array([37, 80, 68, 70]), number: "QT-1", evidence: "archived-pdf" } : null;
  },
};
const app = express().use("/v2/portal", createPortalInvoiceRouter({ portalPrincipal: { principal: async () => portal }, commercial } as any));

await request(app).get("/v2/portal/orders?cursor=opaque-page").expect(200);
await request(app).get("/v2/portal/orders/dashboard").expect(200);
await request(app).get("/v2/portal/quotes?cursor=quote-page").expect(200);
assert.deepEqual(calls.map(call => call.kind), ["orders", "dashboard", "quotes"]);
assert.equal(calls[0].cursor, "opaque-page");
assert.equal(calls[2].cursor, "quote-page");
for (const call of calls) assert.equal(call.principal, portal, "Portal scope must derive from the authenticated principal.");
const binding = structuredClone(portal);
const pdf = await request(app).get("/v2/portal/quotes/quote-a/document.pdf?checkpointId=published-a&customerId=foreign&organizationId=foreign").expect(200);
assert.equal(pdf.headers["cache-control"], "private, no-store"); assert.equal(pdf.headers["x-quote-document-evidence"], "archived-pdf");
assert.equal(calls.at(-1).principal, portal); assert.equal(calls.at(-1).checkpointId, "published-a");
await request(app).get("/v2/portal/quotes/foreign-quote/document.pdf?checkpointId=published-a").expect(404);
const beforeDenied = calls.length; portal.capabilities = [];
await request(app).get("/v2/portal/quotes/quote-a/document.pdf?checkpointId=published-a").expect(403);
assert.equal(calls.length, beforeDenied); portal.capabilities = binding.capabilities;
assert.deepEqual(portal, binding, "Publication reads/downloads must never mutate or derive a Portal identity binding.");
console.log("Portal commercial read routes preserve authenticated customer scope and paging.");
