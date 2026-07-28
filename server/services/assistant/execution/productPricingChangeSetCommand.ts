import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";

export const productPricingChangeSetCommandName = "products.adjust_pricing" as const;
export const productPricingChangeSetCommandVersion = "v1" as const;
export const productPricingRollbackCommandName = "products.rollback_pricing_change_set" as const;
export const productPricingChangeSetConfirmationTtlMs = 10 * 60_000;

export const productPricingChangeSetCommandInputSchema = z.object({ changeSetId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type ProductPricingChangeSetCommandInput = z.infer<typeof productPricingChangeSetCommandInputSchema>;
export const productPricingChangeSetResultSchema = z.object({ succeeded: z.number().int().min(0), failed: z.number().int().min(0), conflicted: z.number().int().min(0), excluded: z.number().int().min(0) }).strict();
export type ProductPricingChangeSetResult = z.infer<typeof productPricingChangeSetResultSchema>;

export interface ProductPricingChangeSetCommandService {
  execute(input: ProductPricingChangeSetCommandInput & { organizationId: string; actorUserId: string; planId: string; idempotencyKey: string; correlationId: string }): Promise<ProductPricingChangeSetResult>;
  rollback(input: { organizationId: string; actorUserId: string; changeSetId: string; correlationId: string }): Promise<{ restored: number; conflicted: number; failed: number }>;
}

export function createProductPricingChangeSetCommandDefinition(service: ProductPricingChangeSetCommandService): AssistantCommandDefinition<ProductPricingChangeSetCommandInput, unknown, ProductPricingChangeSetResult> {
  const adapter: AssistantCanonicalCommandAdapter<ProductPricingChangeSetCommandInput, ProductPricingChangeSetResult> = { execute: (input, context: AssistantCommandExecutionContext) => service.execute({ ...productPricingChangeSetCommandInputSchema.parse(input), organizationId: context.organizationId, actorUserId: context.actorUserId, planId: context.planId, idempotencyKey: context.idempotencyKey, correlationId: context.correlationId }) };
  return { name: productPricingChangeSetCommandName, version: productPricingChangeSetCommandVersion, domain: "products", mode: "write", description: "Apply one persisted pricing change set to exact tenant-scoped products without changing lifecycle or visibility.", risk: "high", requiredCapability: "assistant.products.adjust_pricing", allowedRoles: ["owner", "admin"], inputSchema: productPricingChangeSetCommandInputSchema, previewSchema: z.unknown(), resultSchema: productPricingChangeSetResultSchema, maxAffectedRecords: 100, bulkAllowed: true, confirmationRequired: true, reauthenticationRequired: true, confirmationExpiresInMs: productPricingChangeSetConfirmationTtlMs, idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "best_effort", partialFailurePolicy: "record_and_continue", auditCategory: "assistant_product_pricing_change_set", undoSupport: "compensating_command", abandonmentPolicy: "none", testOnly: false, devEnabled: true, mainEnabled: true, adapter };
}
