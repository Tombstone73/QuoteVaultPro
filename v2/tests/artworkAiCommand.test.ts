import assert from "node:assert/strict";
import { artworkAssignExistingAiCommand } from "../infrastructure/ai/artworkAiCommand.js";

const staff = { kind: "staff", organizationId: "org-a", userId: "user-a", authority: { membershipId: "membership-a", capabilities: ["assistant.use", "artwork.assign", "artwork.view"] } } as const;
const preparation = { organizationId: "org-a", user: staff, conversationId: "conversation-a", requestId: "request-a" } as const;
const execution = { organizationId: "org-a", userId: "user-a", conversationId: "conversation-a", businessRequestId: "ai:command-a", delegatedPrincipal: { kind: "delegated_ai" } } as const;

let assigned = 0;
const command = artworkAssignExistingAiCommand({
  readFile: async (_context: unknown, artworkFileId: string) => ({ ok: true as const, value: { id: artworkFileId, displayFilename: "customer-art.pdf" } }),
  assign: async (context: any, input: any) => {
    assigned += 1;
    assert.equal(context.businessRequest.id, "ai:command-a");
    assert.equal(context.principal.kind, "delegated_ai");
    assert.equal(input.artworkFileId, "artwork-a");
    assert.equal(input.orderId, "order-a");
    assert.equal(input.orderLineId, "line-a");
    assert.equal(input.businessRequestId, "ai:command-a");
    return { ok: true as const, value: { artworkFile: { id: "artwork-a" }, assignment: { id: "assignment-a" } } };
  },
} as any);

const input = { artworkFileId: "artwork-a", orderId: "order-a", orderLineId: "line-a", purpose: "production", side: "front" };
const prepared = await command.prepare(preparation as any, input);
assert.equal(assigned, 0, "preparation only reads the existing Artwork file");
assert.match(prepared.proposal, /customer-art\.pdf/);
assert.deepEqual(prepared.expectedEntityReferences.map((reference) => reference.type), ["artwork_file", "order", "order_line"]);
await assert.rejects(command.prepare(preparation as any, { ...input, objectReference: { objectKey: "forbidden" } }), /identifiers and assignment metadata only/);
await command.execute(execution as any, input);
assert.equal(assigned, 1, "execution delegates only to the canonical Artwork assignment service");
console.log("Artwork AI command adapter tests passed");
