import { createHash } from "crypto";
import { z } from "zod";

/**
 * Provider-neutral boundary for AI-first free-text planning. This is a plan
 * only: it never contains executable arguments, provider prose, or authority
 * to bind a tenant, actor, entity, or confirmation token.
 */
export const assistantIntentPlanVersion = 1 as const;

export const assistantIntentOperationValues = [
  "lookup",
  "report",
  "explain",
  "create",
  "update",
  "continue_session",
  "correct",
  "select_candidate",
  "accept_recommendation",
  "request_confirmation",
  "execute_go",
  "general_conversation",
  "unrelated_conversation",
  "clarify",
  "unsupported",
] as const;
export type AssistantIntentOperation = (typeof assistantIntentOperationValues)[number];

export const assistantIntentDomainValues = [
  "products",
  "quotes",
  "orders",
  "production",
  "fulfillment",
  "billing",
  "payments",
  "customers",
  "reporting",
  "system",
  "conversation",
  "unknown",
] as const;
export type AssistantIntentDomain = (typeof assistantIntentDomainValues)[number];

export const assistantIntentModeValues = ["read", "mutation", "none"] as const;
export type AssistantIntentMode = (typeof assistantIntentModeValues)[number];

/** These values are capability identifiers, not model-callable tool names. */
export const assistantIntentCapabilityIdValues = [
  "system_guide",
  "search_customers",
  "search_products",
  "search_orders",
  "operational_summary",
  "read_tooling",
  "canonical_product_intent_compiler",
  "products_workflow",
  "clone_product",
  "update_inactive_product",
  "replace_product_matrix",
  "replace_product_tiers",
  "create_quote",
  "update_quote",
  "convert_quote",
  "create_order",
  "update_order",
  "orders_workflow",
  "production_operations",
  "fulfillment_operations",
  "billing_operations",
  "payment_operations",
  "crm_management",
  "general_conversation",
] as const;
export type AssistantIntentCapabilityId = (typeof assistantIntentCapabilityIdValues)[number];

export const assistantIntentReasonCodeValues = [
  "explicit_new_entity_request",
  "explicit_existing_entity_request",
  "active_session_continuation",
  "explicit_correction",
  "explicit_candidate_action",
  "explicit_recommendation_action",
  "explicit_confirmation_request",
  "explicit_go_request",
  "read_only_lookup_request",
  "reporting_request",
  "help_or_explanation_request",
  "general_conversation",
  "unrelated_conversation",
  "ambiguous_request",
  "unsupported_request",
] as const;
export type AssistantIntentReasonCode = (typeof assistantIntentReasonCodeValues)[number];

const plannerEntityIdSchema = z.string().trim().min(1).max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Entity identifiers must be opaque safe identifiers");

export const assistantIntentTargetSchema = z.object({
  kind: z.enum(["new_entity", "existing_entity", "active_session", "none"]),
  entityId: plannerEntityIdSchema.nullable(),
}).strict().superRefine((target, ctx) => {
  if (target.kind === "existing_entity" && !target.entityId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entityId"], message: "Existing entity targets require an entity identifier." });
  }
  if (target.kind !== "existing_entity" && target.entityId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entityId"], message: "Only existing entity targets may include an entity identifier." });
  }
});
export type AssistantIntentTarget = z.infer<typeof assistantIntentTargetSchema>;

/** Workspace context may inform a plan but is never an authoritative route. */
export const assistantIntentContextUsageSchema = z.object({
  workspaceIsAuthoritative: z.literal(false),
  workspaceRelevance: z.enum(["none", "supporting", "entity_reference"]),
  activeSessionId: plannerEntityIdSchema.nullable(),
}).strict();
export type AssistantIntentContextUsage = z.infer<typeof assistantIntentContextUsageSchema>;

export const assistantIntentPlanSchema = z.object({
  version: z.literal(assistantIntentPlanVersion),
  operation: z.enum(assistantIntentOperationValues),
  domain: z.enum(assistantIntentDomainValues),
  mode: z.enum(assistantIntentModeValues),
  capabilityId: z.enum(assistantIntentCapabilityIdValues).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  target: assistantIntentTargetSchema,
  contextUsage: assistantIntentContextUsageSchema,
  requiresClarification: z.boolean(),
  clarificationQuestion: z.string().trim().min(1).max(500).nullable(),
  reasonCode: z.enum(assistantIntentReasonCodeValues),
}).strict().superRefine((plan, ctx) => {
  const readOperations: readonly AssistantIntentOperation[] = ["lookup", "report", "explain"];
  const mutationOperations: readonly AssistantIntentOperation[] = ["create", "update", "continue_session", "correct", "select_candidate", "accept_recommendation", "request_confirmation", "execute_go"];
  const noOpOperations: readonly AssistantIntentOperation[] = ["general_conversation", "unrelated_conversation", "clarify", "unsupported"];

  if (readOperations.includes(plan.operation) && plan.mode !== "read") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mode"], message: "Read operations require read mode." });
  }
  if (mutationOperations.includes(plan.operation) && plan.mode !== "mutation") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mode"], message: "Mutation operations require mutation mode." });
  }
  if (noOpOperations.includes(plan.operation) && plan.mode !== "none") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mode"], message: "Non-dispatch operations require none mode." });
  }
  if (plan.requiresClarification !== (plan.operation === "clarify")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requiresClarification"], message: "Clarification state must match the clarify operation." });
  }
  if (plan.requiresClarification !== (plan.clarificationQuestion !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clarificationQuestion"], message: "Clarification questions must be present only when clarification is required." });
  }
  if ((plan.operation === "clarify" || plan.operation === "general_conversation" || plan.operation === "unrelated_conversation" || plan.operation === "unsupported") && plan.capabilityId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilityId"], message: "This operation must not select a specialist capability." });
  }
  if (plan.operation === "create" && plan.target.kind !== "new_entity") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target", "kind"], message: "Create operations require a new entity target." });
  }
  if (plan.operation === "continue_session" && (plan.target.kind !== "active_session" || !plan.contextUsage.activeSessionId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contextUsage", "activeSessionId"], message: "Session continuation requires a trusted active-session reference." });
  }
});
export type AssistantIntentPlan = z.infer<typeof assistantIntentPlanSchema>;

/** Parse and return a detached, canonical object before any dispatch logic sees it. */
export function normalizeAssistantIntentPlan(value: unknown): AssistantIntentPlan {
  return assistantIntentPlanSchema.parse(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A server-calculated correlation aid for telemetry and stale-plan checks.
 * It fingerprints the validated typed plan only; it is never an authorization
 * token and deliberately does not include the customer's original message.
 */
export function fingerprintAssistantIntentPlan(plan: AssistantIntentPlan): string {
  return createHash("sha256").update(stableJson(normalizeAssistantIntentPlan(plan))).digest("hex");
}
