import assert from "node:assert/strict";
import { V2ApplicationError } from "../src/errors/applicationError.js";
import type { ProductVersionLifecycleApplicationService } from "../src/modules/products/productVersionLifecycle.js";
import {
  productAbandonDraftAiCommand,
  productCreateDraftAiCommand,
} from "../infrastructure/ai/productLifecycleAiCommand.js";

const delegatedPrincipal = {
  kind: "delegated_ai" as const,
  organizationId: "org-a",
  userId: "staff-a",
  authority: { membershipId: "membership-a", capabilities: ["product.edit"] },
  delegation: {
    commandId: "pending-a",
    allowedCapabilities: ["product.edit"] as const,
    planApprovedAt: new Date(),
    goApprovedAt: new Date(),
    revalidatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  },
};

const executeContext = {
  organizationId: "org-a",
  userId: "staff-a",
  conversationId: "conversation-a",
  businessRequestId: "ai:conversation-a:request-a",
  delegatedPrincipal,
};

const activeRevision = "2026-09-08T12:00:00.000Z";
const draftRevision = "2026-09-08T12:01:00.000Z";

const calls: Array<{ kind: string; context: unknown; input: unknown }> = [];
const lifecycle = {
  createDraft: async (context: unknown, input: unknown) => {
    calls.push({ kind: "create", context, input });
    return { ok: true as const, value: { draftId: "draft-a" } };
  },
  abandonDraft: async (context: unknown, input: unknown) => {
    calls.push({ kind: "abandon", context, input });
    return { ok: true as const, value: { draftId: "draft-a", archived: true } };
  },
} as unknown as ProductVersionLifecycleApplicationService;

const create = productCreateDraftAiCommand(lifecycle);
const abandon = productAbandonDraftAiCommand(lifecycle);

const createInput = { productId: "product-a", expectedActiveVersionUpdatedAt: activeRevision };
const createPlan = await create.prepare({
  organizationId: "org-a",
  user: delegatedPrincipal as never,
  conversationId: "conversation-a",
  requestId: "prepare-a",
}, createInput);
assert.equal(createPlan.commandName, "product.create_draft");
assert.equal(createPlan.capability, "product.edit");
assert.deepEqual(createPlan.normalizedInput, createInput);
assert.match(createPlan.proposal, /Product: product-a/);
assert.match(createPlan.proposal, new RegExp(activeRevision));
assert.match(createPlan.proposal, /No changes have been made yet\./);
assert.deepEqual(createPlan.expectedEntityReferences, [{ type: "product", id: "product-a" }]);
assert.ok(createPlan.expiresAt > new Date());
await assert.rejects(
  () => create.prepare({ organizationId: "org-a", user: delegatedPrincipal as never, conversationId: "c", requestId: "r" }, { ...createInput, arbitrary: "forbidden" }),
  (error: unknown) => error instanceof V2ApplicationError && error.code === "VALIDATION_ERROR",
);
await assert.rejects(
  () => create.prepare({ organizationId: "org-a", user: delegatedPrincipal as never, conversationId: "c", requestId: "r" }, { ...createInput, expectedActiveVersionUpdatedAt: "2026-09-08" }),
  (error: unknown) => error instanceof V2ApplicationError && error.code === "VALIDATION_ERROR",
);
assert.deepEqual(await create.execute(executeContext, createInput), { draftId: "draft-a" });
assert.equal(calls.length, 1);
assert.deepEqual(calls[0]?.input, { ...createInput, businessRequestId: executeContext.businessRequestId });
assert.deepEqual(calls[0]?.context, {
  principal: delegatedPrincipal,
  organizationId: "org-a",
  operationId: `ai:product.create_draft:${executeContext.businessRequestId}`,
  businessRequest: {
    id: executeContext.businessRequestId,
    payloadFingerprint: "ai:product.create_draft:canonical-request",
  },
});

const abandonInput = {
  productId: "product-a",
  draftVersionId: "draft-a",
  expectedDraftUpdatedAt: draftRevision,
};
const abandonPlan = await abandon.prepare({
  organizationId: "org-a",
  user: delegatedPrincipal as never,
  conversationId: "conversation-a",
  requestId: "prepare-b",
}, abandonInput);
assert.equal(abandonPlan.commandName, "product.abandon_draft");
assert.deepEqual(abandonPlan.normalizedInput, abandonInput);
assert.match(abandonPlan.proposal, /Draft Version: draft-a/);
assert.match(abandonPlan.proposal, /immutable history/);
assert.deepEqual(abandonPlan.expectedEntityReferences, [
  { type: "product", id: "product-a" },
  { type: "product_version", id: "draft-a" },
]);
assert.deepEqual(await abandon.execute(executeContext, abandonInput), { draftId: "draft-a", archived: true });
assert.equal(calls.length, 2);
assert.deepEqual(calls[1]?.input, { ...abandonInput, businessRequestId: executeContext.businessRequestId });

console.log("Product lifecycle AI adapter tests passed.");
