import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { createComplexProductDraft } from "../complexProductDraftPersistence";

export const configurableProductDraftCommandName = "products.create_configurable_draft" as const;
export const configurableProductDraftInputSchema = z.object({ proposalId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type ConfigurableProductDraftInput = z.infer<typeof configurableProductDraftInputSchema>;
const resultSchema = z.object({ productId: z.string(), pbv2TreeVersionId: z.string(), reused: z.boolean() }).strict();

export function createConfigurableProductDraftCommandDefinition(): AssistantCommandDefinition<ConfigurableProductDraftInput, unknown, z.infer<typeof resultSchema>> {
  const adapter: AssistantCanonicalCommandAdapter<ConfigurableProductDraftInput, z.infer<typeof resultSchema>> = { execute: (input, context: AssistantCommandExecutionContext) => createComplexProductDraft({ organizationId: context.organizationId, proposalId: configurableProductDraftInputSchema.parse(input).proposalId, fingerprint: configurableProductDraftInputSchema.parse(input).fingerprint, actorUserId: context.actorUserId, idempotencyKey: context.idempotencyKey }) };
  return { name: configurableProductDraftCommandName, version: "v1", domain: "products", mode: "write", description: "Create one persisted configurable inactive PBV2 DRAFT product.", risk: "high", requiredCapability: "assistant.products.create_inactive_draft", allowedRoles: ["owner", "admin"], inputSchema: configurableProductDraftInputSchema, previewSchema: z.unknown(), resultSchema, maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: 10 * 60_000, idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "record_and_stop", auditCategory: "assistant_configurable_product_draft", undoSupport: "none", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true, adapter };
}
