import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";

export const productInactiveDraftBatchCommandName = "products.create_inactive_draft_batch" as const;
export const productInactiveDraftBatchCommandVersion = "v1" as const;
export const productInactiveDraftBatchConfirmationTtlMs = 5 * 60_000;

const childSchema = z.object({
  rowNumber: z.number().int().min(1).max(25),
  productName: z.string().trim().min(1).max(255),
  intakeSessionId: z.string().trim().min(1).max(128),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export const productInactiveDraftBatchCommandInputSchema = z.object({
  batchFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  children: z.array(childSchema).min(2).max(25),
}).strict().superRefine((value, context) => {
  if (new Set(value.children.map((child) => child.rowNumber)).size !== value.children.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Each batch row must be unique." });
});
export type ProductInactiveDraftBatchCommandInput = z.infer<typeof productInactiveDraftBatchCommandInputSchema>;

export const productInactiveDraftBatchResultSchema = z.object({
  children: z.array(z.object({ rowNumber: z.number().int(), productId: z.string().min(1), productName: z.string().min(1), pbv2TreeVersionId: z.string().min(1), readinessStatus: z.string().min(1), reused: z.boolean() }).strict()).max(25),
}).strict();
export type ProductInactiveDraftBatchResult = z.infer<typeof productInactiveDraftBatchResultSchema>;

export interface ProductInactiveDraftBatchCanonicalService {
  createInactiveDraftBatch(input: ProductInactiveDraftBatchCommandInput & { organizationId: string; actorUserId: string; assistantPlanId: string; idempotencyKey: string; correlationId: string }): Promise<ProductInactiveDraftBatchResult>;
}

export function createProductInactiveDraftBatchCanonicalAdapter(service: ProductInactiveDraftBatchCanonicalService): AssistantCanonicalCommandAdapter<ProductInactiveDraftBatchCommandInput, ProductInactiveDraftBatchResult> {
  return { execute: async (input, context: AssistantCommandExecutionContext) => productInactiveDraftBatchResultSchema.parse(await service.createInactiveDraftBatch({ ...productInactiveDraftBatchCommandInputSchema.parse(input), organizationId: context.organizationId, actorUserId: context.actorUserId, assistantPlanId: context.planId, idempotencyKey: context.idempotencyKey, correlationId: context.correlationId })) };
}

export function createProductInactiveDraftBatchCommandDefinition(service: ProductInactiveDraftBatchCanonicalService): AssistantCommandDefinition<ProductInactiveDraftBatchCommandInput, unknown, ProductInactiveDraftBatchResult> {
  return {
    name: productInactiveDraftBatchCommandName, version: productInactiveDraftBatchCommandVersion, domain: "products", mode: "write",
    description: "Create up to 25 server-validated inactive product drafts through Product Intake.", risk: "high",
    requiredCapability: "assistant.products.create_inactive_draft_batch", allowedRoles: ["owner", "admin"],
    inputSchema: productInactiveDraftBatchCommandInputSchema, previewSchema: z.unknown(), resultSchema: productInactiveDraftBatchResultSchema,
    maxAffectedRecords: 25, bulkAllowed: true, confirmationRequired: true, reauthenticationRequired: true,
    confirmationExpiresInMs: productInactiveDraftBatchConfirmationTtlMs, idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "best_effort", partialFailurePolicy: "record_and_stop",
    auditCategory: "assistant_product_inactive_draft_batch", undoSupport: "metadata_only", abandonmentPolicy: "session_abandonment_only",
    testOnly: false, devEnabled: true, mainEnabled: true, adapter: createProductInactiveDraftBatchCanonicalAdapter(service),
  };
}
