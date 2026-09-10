import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { createPortalArtworkRouter } from "../../src/interfaces/http/portalArtworkRoutes.js";
import { PortalArtworkApplicationService, type CanonicalArtworkUploadPort, type PortalArtworkOwnershipRead } from "../../src/modules/portal/portalArtwork.js";

const portal = { kind: "portal" as const, organizationId: "org-a", customerId: "customer-a", subjectId: "portal-user-a", capabilities: ["order.create"] as const };
const uploads: any[] = [];
const replacements: any[] = [];
const ownership: PortalArtworkOwnershipRead = { assertActiveOwnedOrderLine: async (principal, orderId, lineId) => {
  assert.equal(principal.customerId, "customer-a");
  assert.equal(orderId, "order-a");
  assert.equal(lineId, "line-a");
}, assertCurrentOwnedCustomerSuppliedArtwork: async (principal, orderId, lineId, assignmentId) => {
  assert.equal(principal.customerId, "customer-a");
  assert.equal(orderId, "order-a");
  assert.equal(lineId, "line-a");
  assert.equal(assignmentId, "assignment-a");
} };
const canonical: CanonicalArtworkUploadPort = { upload: async (context, input) => {
  uploads.push({ context, input });
  return { ok: true, value: { artworkFile: { id: "file-a" }, assignment: { id: "assignment-a", purpose: input.purpose } } } as any;
}, replace: async (context, input) => {
  replacements.push({ context, input });
  return { ok: true, value: { artworkFile: { id: "file-b" }, assignment: { id: "assignment-b", purpose: input.purpose, supersedesArtworkAssignmentId: input.supersedesArtworkAssignmentId } } } as any;
} };
const service = new PortalArtworkApplicationService(ownership, canonical);
const app = express().use("/v2/portal", createPortalArtworkRouter({ portalPrincipal: { principal: async () => portal }, service }));

await request(app)
  .post("/v2/portal/orders/order-a/lines/line-a/artwork")
  .field("businessRequestId", "portal-artwork-1")
  .field("side", "front")
  .attach("file", Buffer.from("%PDF-1.7\nportal artwork"), { filename: "customer-art.pdf", contentType: "application/pdf" })
  .expect(201);
assert.equal(uploads.length, 1);
assert.equal(uploads[0].input.purpose, "customer_supplied");
assert.equal(uploads[0].context.principal.kind, "portal");
assert.equal(uploads[0].context.principal.subjectId, "portal-user-a");
assert.ok(uploads[0].context.principal.capabilities.includes("artwork.adopt"), "only the vetted portal boundary delegates the canonical adoption capability");

await request(app)
  .post("/v2/portal/orders/order-a/lines/line-a/artwork")
  .field("businessRequestId", "portal-artwork-replacement-1")
  .field("side", "front")
  .field("supersedesArtworkAssignmentId", "assignment-a")
  .attach("file", Buffer.from("%PDF-1.7\nportal revised artwork"), { filename: "customer-art-revised.pdf", contentType: "application/pdf" })
  .expect(201);
assert.equal(replacements.length, 1);
assert.equal(replacements[0].input.supersedesArtworkAssignmentId, "assignment-a");
assert.ok(replacements[0].context.principal.capabilities.includes("artwork.adopt"), "replacement stays within the same bounded canonical adoption authority");

await request(app)
  .post("/v2/portal/orders/order-a/lines/line-a/artwork")
  .field("businessRequestId", "portal-artwork-production-attempt")
  .field("purpose", "production")
  .attach("file", Buffer.from("%PDF-1.7\nproduction attempt"), { filename: "not-production.pdf", contentType: "application/pdf" })
  .expect(400);
assert.equal(uploads.length, 1, "production Artwork must never reach the customer source boundary");

const denied = express().use("/v2/portal", createPortalArtworkRouter({
  portalPrincipal: { principal: async () => portal },
  service: new PortalArtworkApplicationService({
    assertActiveOwnedOrderLine: async () => { throw new V2ApplicationError("FORBIDDEN", "Artwork upload is unavailable for this Order line."); },
    assertCurrentOwnedCustomerSuppliedArtwork: async () => { throw new V2ApplicationError("FORBIDDEN", "Artwork replacement is unavailable for this Order line."); },
  }, canonical),
}));
await request(denied)
  .post("/v2/portal/orders/order-b/lines/line-b/artwork")
  .field("businessRequestId", "portal-artwork-idor")
  .attach("file", Buffer.from("%PDF-1.7\nidor"), { filename: "other-customer.pdf", contentType: "application/pdf" })
  .expect(403);
assert.equal(uploads.length, 1, "a rejected ownership check cannot write a canonical file");

const foreignPredecessor = express().use("/v2/portal", createPortalArtworkRouter({
  portalPrincipal: { principal: async () => portal },
  service: new PortalArtworkApplicationService({
    assertActiveOwnedOrderLine: async () => undefined,
    assertCurrentOwnedCustomerSuppliedArtwork: async () => { throw new V2ApplicationError("FORBIDDEN", "Artwork replacement is unavailable for this Order line."); },
  }, canonical),
}));
await request(foreignPredecessor)
  .post("/v2/portal/orders/order-a/lines/line-a/artwork")
  .field("businessRequestId", "portal-artwork-foreign-predecessor")
  .field("supersedesArtworkAssignmentId", "assignment-b")
  .attach("file", Buffer.from("%PDF-1.7\nforeign predecessor"), { filename: "foreign-predecessor.pdf", contentType: "application/pdf" })
  .expect(403);
assert.equal(replacements.length, 1, "a foreign or stale predecessor cannot reach canonical replacement");
console.log("Portal customer Artwork boundary tests passed.");
