import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { InactivePbv2QuantityTierEditService, inactivePbv2QuantityTierExecutionResultSchema, inactivePbv2QuantityTierPreviewSchema, type InactivePbv2QuantityTierEditStore } from "../inactivePbv2QuantityTierEditService";
import { createDrizzleInactivePbv2QuantityTierEditStore } from "../inactivePbv2QuantityTierEditPersistence";

export const inactivePbv2QuantityTierEditCommandName = "products.replace_inactive_quantity_tiers" as const;
export const inactivePbv2QuantityTierEditInputSchema = z.object({ proposalId: z.string().uuid(), proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type InactivePbv2QuantityTierEditCommandInput = z.infer<typeof inactivePbv2QuantityTierEditInputSchema>;

export function createInactivePbv2QuantityTierEditCommandDefinition(store: InactivePbv2QuantityTierEditStore = createDrizzleInactivePbv2QuantityTierEditStore()): AssistantCommandDefinition<InactivePbv2QuantityTierEditCommandInput, z.infer<typeof inactivePbv2QuantityTierPreviewSchema>, z.infer<typeof inactivePbv2QuantityTierExecutionResultSchema>> {
  const service = new InactivePbv2QuantityTierEditService(store);
  const adapter: AssistantCanonicalCommandAdapter<InactivePbv2QuantityTierEditCommandInput, z.infer<typeof inactivePbv2QuantityTierExecutionResultSchema>> = {
    execute: (raw, context: AssistantCommandExecutionContext) => service.execute({ organizationId: context.organizationId, actorUserId: context.actorUserId, ...inactivePbv2QuantityTierEditInputSchema.parse(raw), idempotencyKey: context.idempotencyKey }),
  };
  return { name: inactivePbv2QuantityTierEditCommandName, version: "v1", domain: "products", mode: "write", description: "Replace one complete quantity-tier family on one exact inactive PBV2 DRAFT.", risk: "high", requiredCapability: "assistant.products.replace_inactive_quantity_tiers", allowedRoles: ["owner", "admin"], inputSchema: inactivePbv2QuantityTierEditInputSchema, previewSchema: inactivePbv2QuantityTierPreviewSchema, resultSchema: inactivePbv2QuantityTierExecutionResultSchema, maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: 10 * 60_000, idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "forbid", auditCategory: "assistant_replace_inactive_quantity_tiers", undoSupport: "none", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true, adapter };
}
