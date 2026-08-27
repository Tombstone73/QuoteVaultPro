import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createProductionRouter } from "../../src/interfaces/http/productionRoutes.js";
import { createFulfillmentRouter } from "../../src/interfaces/http/fulfillmentRoutes.js";
import { createInvoiceRouter } from "../../src/interfaces/http/invoiceRoutes.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const actor = (organizationId: string, capabilities: readonly string[]): StaffPrincipal => ({ kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: capabilities as any } });
const principal = (staff: StaffPrincipal) => async (_request: unknown, organizationId: string) => {
  if (organizationId !== staff.organizationId) throw new V2ApplicationError("WRONG_TENANT", "Foreign tenant.");
  return staff;
};
const bytes = new Uint8Array([37, 80, 68, 70, 45]);

let rendered = 0;
const production = express().use("/v2/organizations/:organizationId/production", createProductionRouter({
  principals: { principal: principal(actor("org-a", ["production.view"])) },
  service: { listStationQueue: async () => ({ ok: true, value: [] }), listOrderWorks: async () => ({ ok: true, value: [] }), getWork: async () => ({ ok: true, value: {} }), open: async () => ({ ok: true, value: {} }), start: async () => ({ ok: true, value: {} }), recordOutput: async () => ({ ok: true, value: {} }), complete: async () => ({ ok: true, value: {} }) },
  consumption: {} as any, inventory: {} as any,
  documents: { travelerPdf: async () => { rendered += 1; return bytes; }, filename: async () => "Traveler_ORD-1010.pdf" },
}));
let response = await request(production).get("/v2/organizations/org-a/production/works/work-a/traveler.pdf");
assert.equal(response.status, 200); assert.match(response.headers["content-type"] ?? "", /application\/pdf/); assert.equal(response.headers["cache-control"], "private, no-store"); assert.equal(rendered, 1);
response = await request(production).get("/v2/organizations/org-b/production/works/work-a/traveler.pdf");
assert.equal(response.status, 404); assert.equal(rendered, 1);

const travelerFailure = express().use("/v2/organizations/:organizationId/production", createProductionRouter({
  principals: { principal: principal(actor("org-a", ["production.view"])) },
  service: { listStationQueue: async () => ({ ok: true, value: [] }), listOrderWorks: async () => ({ ok: true, value: [] }), getWork: async () => ({ ok: true, value: {} }), open: async () => ({ ok: true, value: {} }), start: async () => ({ ok: true, value: {} }), recordOutput: async () => ({ ok: true, value: {} }), complete: async () => ({ ok: true, value: {} }) },
  consumption: {} as any, inventory: {} as any,
  documents: { travelerPdf: async () => { const error = new Error('column "purchase_order_number" does not exist'); (error as Error & { code?: string }).code = "42703"; throw error; }, filename: async () => "unused.pdf" },
}));
const previousError = console.error; const diagnostics: unknown[][] = []; console.error = (...args: unknown[]) => { diagnostics.push(args); };
try { response = await request(travelerFailure).get("/v2/organizations/org-a/production/works/work-a/traveler.pdf"); } finally { console.error = previousError; }
assert.equal(response.status, 500); assert.deepEqual(response.body, { ok: false, error: { code: "INTERNAL_ERROR", message: "Production operation is unavailable." } });
assert.deepEqual(diagnostics, [["v2.production.operation.failed", { operation: "production.traveler.pdf", organizationId: "org-a", productionWorkId: "work-a", error: { name: "Error", code: "42703", message: 'column "purchase_order_number" does not exist' } }]]);

const fulfillment = express().use("/v2/organizations/:organizationId/fulfillment", createFulfillmentRouter({
  principals: { principal: principal(actor("org-a", ["fulfillment.view"])) }, service: {} as any, workspace: {} as any,
  documents: { customerId: async () => "customer-a", pdf: async () => bytes, filename: async () => "PackingSlip_ORD-1010.pdf" },
}));
response = await request(fulfillment).get("/v2/organizations/org-a/fulfillment/handoffs/handoff-a/document.pdf");
assert.equal(response.status, 200); assert.match(response.headers["content-type"] ?? "", /application\/pdf/); assert.match(response.headers["content-disposition"] ?? "", /PackingSlip_ORD-1010/);
response = await request(fulfillment).get("/v2/organizations/org-b/fulfillment/handoffs/handoff-a/document.pdf");
assert.equal(response.status, 404);

rendered = 0;
const billing = express().use("/v2/organizations/:organizationId/invoices", createInvoiceRouter({
  principals: { principal: principal(actor("org-a", ["invoice.view"])) }, service: { readInvoice: async () => ({ ok: true, value: {} }) } as any,
  documents: { pdf: async () => { rendered += 1; return bytes; }, filename: async () => "Invoice_ORD-1010.pdf" },
}));
response = await request(billing).get("/v2/organizations/org-a/invoices/invoice-a/document.pdf");
assert.equal(response.status, 200); assert.match(response.headers["content-type"] ?? "", /application\/pdf/); assert.equal(response.headers["cache-control"], "private, no-store");
response = await request(billing).get("/v2/organizations/org-b/invoices/invoice-a/document.pdf");
assert.equal(response.status, 404); assert.equal(rendered, 1);
console.log("Owner document route tests passed.");
