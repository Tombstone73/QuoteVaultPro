import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";

export const productInactiveDraftBulkUpdateCommandName = "products.update_inactive_draft_batch" as const;
export const productInactiveDraftBulkUpdateCommandVersion = "v1" as const;
export const productInactiveDraftBulkUpdateConfirmationTtlMs = 5 * 60_000;

// Deliberately no target IDs or patch here: confirmation is bound to the
// server-persisted proposal and cannot accept client-side replacements.
export const productInactiveDraftBulkUpdateCommandInputSchema = z.object({ bulkUpdateId: z.string().trim().min(1).max(128), bulkFingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type ProductInactiveDraftBulkUpdateCommandInput = z.infer<typeof productInactiveDraftBulkUpdateCommandInputSchema>;
export const productInactiveDraftBulkUpdateCommandResultSchema = z.object({ updated: z.number().int().min(0).max(25), noChange: z.number().int().min(0).max(25), failures: z.number().int().min(0).max(25), stale: z.number().int().min(0).max(25), pending: z.number().int().min(0).max(25) }).strict();
export type ProductInactiveDraftBulkUpdateCommandResult = z.infer<typeof productInactiveDraftBulkUpdateCommandResultSchema>;

export interface ProductInactiveDraftBulkUpdateCanonicalService { updateInactiveDraftBatch(input: ProductInactiveDraftBulkUpdateCommandInput & { organizationId: string; actorUserId: string; assistantPlanId: string; idempotencyKey: string; correlationId: string }): Promise<ProductInactiveDraftBulkUpdateCommandResult>; }
export function createProductInactiveDraftBulkUpdateCanonicalAdapter(service: ProductInactiveDraftBulkUpdateCanonicalService): AssistantCanonicalCommandAdapter<ProductInactiveDraftBulkUpdateCommandInput, ProductInactiveDraftBulkUpdateCommandResult> { return { execute: (input, context: AssistantCommandExecutionContext) => service.updateInactiveDraftBatch({ ...productInactiveDraftBulkUpdateCommandInputSchema.parse(input), organizationId: context.organizationId, actorUserId: context.actorUserId, assistantPlanId: context.planId, idempotencyKey: context.idempotencyKey, correlationId: context.correlationId }) }; }
export function createProductInactiveDraftBulkUpdateCommandDefinition(service: ProductInactiveDraftBulkUpdateCanonicalService): AssistantCommandDefinition<ProductInactiveDraftBulkUpdateCommandInput, unknown, ProductInactiveDraftBulkUpdateCommandResult> {
  return { name: productInactiveDraftBulkUpdateCommandName, version: productInactiveDraftBulkUpdateCommandVersion, domain: "products", mode: "write", description: "Apply one persisted, confirmed patch domain to up to 25 existing inactive PBV2 DRAFT products.", risk: "high", requiredCapability: "assistant.products.update_inactive_draft_batch", allowedRoles: ["owner", "admin"], inputSchema: productInactiveDraftBulkUpdateCommandInputSchema, previewSchema: z.unknown(), resultSchema: productInactiveDraftBulkUpdateCommandResultSchema, maxAffectedRecords: 25, bulkAllowed: true, confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: productInactiveDraftBulkUpdateConfirmationTtlMs, idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "best_effort", partialFailurePolicy: "record_and_continue", auditCategory: "assistant_product_inactive_draft_bulk_update", undoSupport: "metadata_only", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true, adapter: createProductInactiveDraftBulkUpdateCanonicalAdapter(service) };
}
