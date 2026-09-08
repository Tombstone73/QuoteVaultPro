import type { AiCommandHandler } from "../../src/modules/ai/assistantApplication.js";
import type { AiExecutionContext, AiPreparedCommand } from "../../src/modules/ai/contracts.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ProductVersionLifecycleApplicationService } from "../../src/modules/products/productVersionLifecycle.js";

/**
 * Deliberately narrow Product lifecycle commands for the AI command plane.
 *
 * These adapters do not author Product configuration, pricing, routing, or
 * publication.  They delegate only to the revision-guarded lifecycle service,
 * which owns durable request reservation/replay, actor attribution, and audit.
 */
const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : undefined;

const record = (raw: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new V2ApplicationError("VALIDATION_ERROR", "A typed Product lifecycle command is required.");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new V2ApplicationError("VALIDATION_ERROR", "The Product lifecycle command contains unsupported fields.");
  return value;
};

/** The revision token must be an exact, UTC ISO timestamp returned by V2. */
const revision = (value: unknown, label: string): string => {
  const candidate = text(value, 40);
  if (!candidate || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate) || Number.isNaN(Date.parse(candidate)))
    throw new V2ApplicationError("VALIDATION_ERROR", `An exact current ${label} revision timestamp is required.`);
  return candidate;
};

type CreateDraft = Readonly<{
  productId: string;
  expectedActiveVersionUpdatedAt: string;
}>;

const createDraft = (raw: unknown): CreateDraft => {
  const value = record(raw, ["productId", "expectedActiveVersionUpdatedAt"]);
  const productId = text(value.productId, 128);
  if (!productId)
    throw new V2ApplicationError("VALIDATION_ERROR", "An exact Product is required.");
  return {
    productId,
    expectedActiveVersionUpdatedAt: revision(value.expectedActiveVersionUpdatedAt, "Active Product Version"),
  };
};

type AbandonDraft = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
}>;

const abandonDraft = (raw: unknown): AbandonDraft => {
  const value = record(raw, ["productId", "draftVersionId", "expectedDraftUpdatedAt"]);
  const productId = text(value.productId, 128);
  const draftVersionId = text(value.draftVersionId, 128);
  if (!productId || !draftVersionId)
    throw new V2ApplicationError("VALIDATION_ERROR", "Exact Product and Draft Version identities are required.");
  return {
    productId,
    draftVersionId,
    expectedDraftUpdatedAt: revision(value.expectedDraftUpdatedAt, "Draft Product Version"),
  };
};

const prepared = (
  commandName: string,
  input: unknown,
  proposal: string,
  expectedEntityReferences: AiPreparedCommand["expectedEntityReferences"],
): AiPreparedCommand => ({
  commandName,
  capability: "product.edit",
  normalizedInput: input,
  proposal,
  expectedEntityReferences,
  expiresAt: new Date(Date.now() + 5 * 60_000),
});

const execution = (
  context: Parameters<AiCommandHandler["execute"]>[0],
  commandName: string,
) => ({
  principal: context.delegatedPrincipal,
  organizationId: context.organizationId,
  operationId: `ai:${commandName}:${context.businessRequestId}`,
  businessRequest: {
    id: context.businessRequestId,
    payloadFingerprint: `ai:${commandName}:canonical-request`,
  },
});

export const productCreateDraftAiCommand = (
  lifecycle: ProductVersionLifecycleApplicationService,
): AiCommandHandler => ({
  name: "product.create_draft",
  capability: "product.edit",
  prepare: async (_context: AiExecutionContext, raw: unknown) => {
    const input = createDraft(raw);
    return prepared(
      "product.create_draft",
      input,
      `Create Product Draft\n\nProduct: ${input.productId}\nExpected Active Version revision: ${input.expectedActiveVersionUpdatedAt}\n\nThis creates an editable Draft copied from the exact current Active Product Version. The Active Product, pricing, routing, and publication state remain unchanged.\n\nNo changes have been made yet.`,
      [{ type: "product", id: input.productId }],
    );
  },
  execute: async (context, raw) => {
    const input = createDraft(raw);
    const result = await lifecycle.createDraft(execution(context, "product.create_draft"), {
      ...input,
      businessRequestId: context.businessRequestId,
    });
    if (!result.ok) throw result.error;
    return result.value;
  },
});

export const productAbandonDraftAiCommand = (
  lifecycle: ProductVersionLifecycleApplicationService,
): AiCommandHandler => ({
  name: "product.abandon_draft",
  capability: "product.edit",
  prepare: async (_context: AiExecutionContext, raw: unknown) => {
    const input = abandonDraft(raw);
    return prepared(
      "product.abandon_draft",
      input,
      `Abandon Product Draft\n\nProduct: ${input.productId}\nDraft Version: ${input.draftVersionId}\nExpected Draft revision: ${input.expectedDraftUpdatedAt}\n\nThis archives only the exact current editable Draft as immutable history. The Active Product, pricing, routing, and publication state remain unchanged.\n\nNo changes have been made yet.`,
      [
        { type: "product", id: input.productId },
        { type: "product_version", id: input.draftVersionId },
      ],
    );
  },
  execute: async (context, raw) => {
    const input = abandonDraft(raw);
    const result = await lifecycle.abandonDraft(execution(context, "product.abandon_draft"), {
      ...input,
      businessRequestId: context.businessRequestId,
    });
    if (!result.ok) throw result.error;
    return result.value;
  },
});
