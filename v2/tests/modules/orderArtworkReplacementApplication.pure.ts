import assert from "node:assert/strict";
import { ArtworkApplicationService, type ArtworkTransaction } from "../../src/modules/artwork/artworkApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const organizationId = "org-artwork-replacement";
const predecessorId = brandedId<"ArtworkAssignmentId">("assignment-inherited");
const predecessor = { id: predecessorId, organizationId: brandedId<"OrganizationId">(organizationId), artworkFileId: brandedId<"ArtworkFileId">("file-inherited"), orderId: brandedId<"OrderId">("order-1"), orderLineId: brandedId<"OrderLineId">("line-1"), purpose: "customer_supplied" as const, side: "front" as const, createdAt: "2026-01-01T00:00:00.000Z" };
let successor: unknown;
const transaction = {
  reserve: async () => ({ kind: "new" as const, request: { id: "request-1", resultJson: null } }),
  succeed: async (_org: string, _request: string, result: unknown) => { successor = result; },
  attribute: async () => undefined,
  audit: async () => undefined,
  createOrGetFile: async (input: any) => ({ id: input.id, organizationId: input.organizationId, objectReference: input.file.objectReference, originalFilename: input.file.originalFilename, displayFilename: input.file.displayFilename ?? input.file.originalFilename, contentType: input.file.contentType, byteSize: input.file.byteSize, source: input.file.source, createdAt: "2026-01-01T00:00:00.000Z" }),
  createOrGetReplacementAssignment: async (input: any) => ({ id: input.id, organizationId: input.organizationId, artworkFileId: input.artworkFileId, orderId: input.usage.orderId, orderLineId: input.usage.orderLineId, purpose: input.usage.purpose, side: input.usage.side, supersedesArtworkAssignmentId: input.supersedesArtworkAssignmentId, createdAt: "2026-01-01T00:00:00.000Z" }),
} as unknown as ArtworkTransaction;

const service = new ArtworkApplicationService({ transaction: async (action) => action(transaction) });
const context = { organizationId, operationId: "replacement", businessRequest: { id: "request-1", payloadFingerprint: "replacement" }, principal: { kind: "staff" as const, organizationId, userId: "staff-1", authority: { membershipId: "membership-1", capabilities: ["artwork.adopt"] as const } } };
const result = await service.replace(context, {
  businessRequestId: "request-1",
  supersedesArtworkAssignmentId: predecessor.id,
  objectReference: { storageProvider: "test", objectKey: "replacement.pdf" },
  originalFilename: "replacement.pdf",
  contentType: "application/pdf",
  byteSize: 12,
  source: "customer_upload",
  usage: { orderId: predecessor.orderId, orderLineId: predecessor.orderLineId, purpose: "customer_supplied", side: "front" },
});

assert.equal(result.ok, true);
if (result.ok) assert.equal(result.value.assignment.supersedesArtworkAssignmentId, predecessor.id);
assert.ok(successor);
console.log("order Artwork replacement application contract: PASS");
