import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";

/** Dedicated mutation boundary for the ProductDraftIntent architecture. */
export const canonicalProductIntentDraftCommandName = "products.create_from_canonical_intent" as const;
export const canonicalProductIntentDraftInputSchema = z.object({
  proposalId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export type CanonicalProductIntentDraftInput = z.infer<typeof canonicalProductIntentDraftInputSchema>;

const resultSchema = z.object({ productId: z.string().min(1), pbv2TreeVersionId: z.string().min(1), reused: z.boolean(), sourceLink: z.string().min(1) }).strict();
export type CanonicalProductIntentDraftResult = z.infer<typeof resultSchema>;

export interface CanonicalProductIntentDraftService {
  execute(input: CanonicalProductIntentDraftInput & { organizationId: string; actorUserId: string; planId: string; idempotencyKey: string; correlationId: string }): Promise<CanonicalProductIntentDraftResult>;
}

export function createCanonicalProductIntentDraftCommandDefinition(service: CanonicalProductIntentDraftService): AssistantCommandDefinition<CanonicalProductIntentDraftInput, unknown, CanonicalProductIntentDraftResult> {
  const adapter: AssistantCanonicalCommandAdapter<CanonicalProductIntentDraftInput, CanonicalProductIntentDraftResult> = {
    execute: (raw, context: AssistantCommandExecutionContext) => service.execute({ ...canonicalProductIntentDraftInputSchema.parse(raw), organizationId: context.organizationId, actorUserId: context.actorUserId, planId: context.planId, idempotencyKey: context.idempotencyKey, correlationId: context.correlationId }),
  };
  return {
    name: canonicalProductIntentDraftCommandName, version: "v1", domain: "products", mode: "write",
    description: "Create exactly one inactive PBV2 DRAFT from a confirmed canonical Product Intent.", risk: "high",
    requiredCapability: "assistant.products.create_inactive_draft", allowedRoles: ["owner", "admin"],
    inputSchema: canonicalProductIntentDraftInputSchema, previewSchema: z.unknown(), resultSchema,
    maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: true,
    confirmationExpiresInMs: 10 * 60_000, idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "forbid",
    auditCategory: "assistant_canonical_product_intent_draft", undoSupport: "none", abandonmentPolicy: "session_abandonment_only",
    testOnly: false, devEnabled: true, mainEnabled: true, adapter,
  };
}
