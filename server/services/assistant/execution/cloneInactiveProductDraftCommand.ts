import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { CloneInactiveProductDraftService, cloneInactiveProductExecutionResultSchema, type CloneInactiveProductDraftStore } from "../cloneInactiveProductDraftService";
import { createDrizzleCloneInactiveProductDraftStore } from "../cloneInactiveProductDraftPersistence";

export const cloneInactiveProductDraftCommandName = "products.clone_to_inactive_draft" as const;
export const cloneInactiveProductDraftInputSchema = z.object({ proposalId: z.string().uuid(), proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type CloneInactiveProductDraftCommandInput = z.infer<typeof cloneInactiveProductDraftInputSchema>;

export function createCloneInactiveProductDraftCommandDefinition(store: CloneInactiveProductDraftStore = createDrizzleCloneInactiveProductDraftStore()): AssistantCommandDefinition<CloneInactiveProductDraftCommandInput, unknown, z.infer<typeof cloneInactiveProductExecutionResultSchema>> {
  const service = new CloneInactiveProductDraftService(store);
  const adapter: AssistantCanonicalCommandAdapter<CloneInactiveProductDraftCommandInput, z.infer<typeof cloneInactiveProductExecutionResultSchema>> = {
    execute: (raw, context: AssistantCommandExecutionContext) => {
      const input = cloneInactiveProductDraftInputSchema.parse(raw);
      return service.execute({ organizationId: context.organizationId, actorUserId: context.actorUserId, proposalId: input.proposalId, proposalFingerprint: input.proposalFingerprint, idempotencyKey: context.idempotencyKey });
    },
  };
  return { name: cloneInactiveProductDraftCommandName, version: "v1", domain: "products", mode: "write", description: "Clone one exact source product into an inactive PBV2 DRAFT.", risk: "high", requiredCapability: "assistant.products.clone_to_inactive_draft", allowedRoles: ["owner", "admin"], inputSchema: cloneInactiveProductDraftInputSchema, previewSchema: z.unknown(), resultSchema: cloneInactiveProductExecutionResultSchema, maxAffectedRecords: 2, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: 10 * 60_000, idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "forbid", auditCategory: "assistant_clone_inactive_product_draft", undoSupport: "none", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true, adapter };
}
