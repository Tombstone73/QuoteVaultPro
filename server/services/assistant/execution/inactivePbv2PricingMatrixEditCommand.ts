import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import {
  InactivePbv2PricingMatrixEditService,
  inactivePbv2PricingMatrixExecutionResultSchema,
  inactivePbv2PricingMatrixPreviewSchema,
  type InactivePbv2PricingMatrixEditStore,
} from "../inactivePbv2PricingMatrixEditService";
import { createDrizzleInactivePbv2PricingMatrixEditStore } from "../inactivePbv2PricingMatrixEditPersistence";

export const inactivePbv2PricingMatrixEditCommandName = "products.replace_inactive_matrix" as const;
export const inactivePbv2PricingMatrixEditInputSchema = z.object({
  proposalId: z.string().uuid(), proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export type InactivePbv2PricingMatrixEditCommandInput = z.infer<typeof inactivePbv2PricingMatrixEditInputSchema>;

export function createInactivePbv2PricingMatrixEditCommandDefinition(store: InactivePbv2PricingMatrixEditStore = createDrizzleInactivePbv2PricingMatrixEditStore()): AssistantCommandDefinition<InactivePbv2PricingMatrixEditCommandInput, z.infer<typeof inactivePbv2PricingMatrixPreviewSchema>, z.infer<typeof inactivePbv2PricingMatrixExecutionResultSchema>> {
  const service = new InactivePbv2PricingMatrixEditService(store);
  const adapter: AssistantCanonicalCommandAdapter<InactivePbv2PricingMatrixEditCommandInput, z.infer<typeof inactivePbv2PricingMatrixExecutionResultSchema>> = {
    execute: (raw, context: AssistantCommandExecutionContext) => {
      const input = inactivePbv2PricingMatrixEditInputSchema.parse(raw);
      return service.execute({ organizationId: context.organizationId, actorUserId: context.actorUserId, proposalId: input.proposalId, proposalFingerprint: input.proposalFingerprint, idempotencyKey: context.idempotencyKey });
    },
  };
  return {
    name: inactivePbv2PricingMatrixEditCommandName, version: "v1", domain: "products", mode: "write",
    description: "Replace the complete pricing matrix on one exact inactive PBV2 DRAFT.", risk: "high",
    requiredCapability: "assistant.products.replace_inactive_matrix", allowedRoles: ["owner", "admin"],
    inputSchema: inactivePbv2PricingMatrixEditInputSchema, previewSchema: inactivePbv2PricingMatrixPreviewSchema,
    resultSchema: inactivePbv2PricingMatrixExecutionResultSchema, maxAffectedRecords: 2, bulkAllowed: false,
    confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: 10 * 60_000,
    idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash",
    transactionPolicy: "required", partialFailurePolicy: "forbid", auditCategory: "assistant_replace_inactive_pbv2_matrix",
    undoSupport: "none", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true, adapter,
  };
}
