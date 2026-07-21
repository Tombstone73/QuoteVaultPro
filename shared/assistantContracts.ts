import { z } from "zod";

/**
 * Versioned, presentation-safe contracts for the internal PrintersHero
 * assistant. These contracts intentionally contain identifiers and UI context
 * only; canonical business records are never embedded in an assistant prompt.
 */

export const assistantContextVersionValues = ["v1"] as const;
export const assistantPresentationModeValues = [
  "floating",
  "dock_left",
  "dock_right",
  "dock_bottom",
  "minimized",
  "fullscreen",
] as const;
export const assistantConversationStatusValues = ["active", "archived"] as const;
export const assistantTurnStatusValues = [
  "pending",
  "processing",
  "responded",
  "failed",
  "cancelled",
] as const;
export const assistantMessageRoleValues = ["user", "assistant", "system"] as const;
export const assistantToolExecutionStatusValues = ["not_run", "succeeded", "failed", "disabled"] as const;
export const assistantToolNameValues = [
  "search.global",
  "customers.get_summary",
  "orders.get_summary",
  "products.get_summary",
  "reports.operational_summary",
  "navigation.get_current_context",
] as const;
export const assistantPlannerIntentValues = ["lookup", "operational_summary", "navigation", "unsupported_write", "clarification"] as const;

export type AssistantContextVersion = (typeof assistantContextVersionValues)[number];
export type AssistantPresentationMode = (typeof assistantPresentationModeValues)[number];
export type AssistantConversationStatus = (typeof assistantConversationStatusValues)[number];
export type AssistantTurnStatus = (typeof assistantTurnStatusValues)[number];
export type AssistantMessageRole = (typeof assistantMessageRoleValues)[number];
export type AssistantToolName = (typeof assistantToolNameValues)[number];
export type AssistantPlannerIntent = (typeof assistantPlannerIntentValues)[number];

const assistantIsoDateTimeSchema = z.string().datetime({ offset: true });
export const assistantSafeIdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Identifier contains unsupported characters");

export const assistantActorScopeSchema = z.object({
  organizationId: assistantSafeIdentifierSchema,
  userId: assistantSafeIdentifierSchema,
}).strict();

export const assistantCapabilitySchema = z.object({
  enabled: z.boolean(),
  conversationsEnabled: z.boolean(),
  toolsEnabled: z.boolean(),
  // Stage 4 enables a server-owned, explicitly allowlisted write action. The
  // capability is informational only; it never grants browser authorization.
  writeActionsEnabled: z.boolean(),
  externalResearchEnabled: z.literal(false),
  assistantVersion: z.string().trim().min(1).max(64),
  unavailableReason: z.string().trim().min(1).max(240).nullable(),
  // Returned only to the authenticated internal actor. It lets the UI safely
  // namespace local layout preferences without accepting either identity back.
  actorScope: assistantActorScopeSchema.optional(),
}).strict();
export type AssistantCapability = z.infer<typeof assistantCapabilitySchema>;

export const assistantFloatingBoundsSchema = z.object({
  x: z.number().finite().min(0).max(100_000),
  y: z.number().finite().min(0).max(100_000),
  width: z.number().finite().min(280).max(4_000),
  height: z.number().finite().min(240).max(4_000),
}).strict();

export const assistantPresentationStateSchema = z.object({
  mode: z.enum(assistantPresentationModeValues),
  isOpen: z.boolean(),
  previousMode: z.enum(assistantPresentationModeValues).optional(),
  floatingBounds: assistantFloatingBoundsSchema.optional(),
  dockSize: z.number().finite().min(240).max(4_000).optional(),
}).strict();
export type AssistantPresentationState = z.infer<typeof assistantPresentationStateSchema>;

export const assistantEntityTypeValues = [
  "customer",
  "order",
  "quote",
  "product",
  "invoice",
  "production_job",
  "unknown",
] as const;

export const assistantActiveFilterSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  value: z.string().trim().max(256),
}).strict();

export const assistantContextEnvelopeSchema = z.object({
  contextVersion: z.enum(assistantContextVersionValues),
  route: z.string().trim().min(1).max(512).startsWith("/"),
  pageTitle: z.string().trim().min(1).max(240),
  entityType: z.enum(assistantEntityTypeValues).optional(),
  entityId: assistantSafeIdentifierSchema.optional(),
  selectedRecordIds: z.array(assistantSafeIdentifierSchema).max(25).default([]),
  activeFilters: z.array(assistantActiveFilterSchema).max(20).default([]),
  capturedAt: assistantIsoDateTimeSchema,
  unsavedChanges: z.boolean(),
  focusedFieldId: assistantSafeIdentifierSchema.optional(),
  dialogId: assistantSafeIdentifierSchema.optional(),
}).strict().superRefine((context, ctx) => {
  if (!context.entityType && context.entityId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entityId"],
      message: "entityId requires entityType",
    });
  }

  // A final serialized-size guard prevents context expansion through many small
  // values while retaining readable field-level validation errors above.
  if (JSON.stringify(context).length > 12_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Assistant context exceeds the 12 KB limit",
    });
  }
});
export type AssistantContextEnvelope = z.infer<typeof assistantContextEnvelopeSchema>;

export const assistantSourceLinkSchema = z.object({
  label: z.string().trim().min(1).max(160),
  href: z.string().trim().min(1).max(512).startsWith("/"),
  entityType: z.enum(assistantEntityTypeValues).optional(),
  entityId: assistantSafeIdentifierSchema.optional(),
  capturedAt: assistantIsoDateTimeSchema.optional(),
}).strict();
export type AssistantSourceLink = z.infer<typeof assistantSourceLinkSchema>;

/** A reduced, presentation-safe provenance object required for every Stage 2
 * business result.  It deliberately never accepts external URLs. */
export const assistantResultProvenanceSchema = z.object({
  sourceLinks: z.array(assistantSourceLinkSchema).max(10),
  freshness: z.object({
    capturedAt: assistantIsoDateTimeSchema,
    label: z.string().trim().min(1).max(120).optional(),
  }).strict(),
}).strict();
export type AssistantResultProvenance = z.infer<typeof assistantResultProvenanceSchema>;

export const assistantToolResultStatusValues = [
  "succeeded",
  "not_found",
  "permission_denied",
  "partial",
  "failed",
] as const;
export type AssistantToolResultStatus = (typeof assistantToolResultStatusValues)[number];

export const assistantToolResultEnvelopeSchema = z.object({
  status: z.enum(assistantToolResultStatusValues),
  data: z.unknown(),
  provenance: assistantResultProvenanceSchema.optional(),
  warning: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((result, ctx) => {
  if ((result.status === "succeeded" || result.status === "partial") && !result.provenance) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["provenance"],
      message: "Successful business tool results require provenance.",
    });
  }
});
export type AssistantToolResultEnvelope = z.infer<typeof assistantToolResultEnvelopeSchema>;

export const assistantGlobalSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(20).optional(),
}).strict();
export const assistantEntitySummarySchema = z.object({
  entityType: z.enum(assistantEntityTypeValues),
  recordId: assistantSafeIdentifierSchema,
  label: z.string().trim().min(1).max(240),
  secondaryDescription: z.string().trim().min(1).max(500).optional(),
  status: z.string().trim().min(1).max(120).optional(),
  sourceLink: assistantSourceLinkSchema,
  freshness: assistantIsoDateTimeSchema,
}).strict();
export const assistantGlobalSearchResultSchema = z.object({
  matches: z.array(assistantEntitySummarySchema).max(100),
}).strict();

export const assistantCustomerSummaryInputSchema = z.object({
  customerId: assistantSafeIdentifierSchema,
}).strict();
export const assistantCustomerSummaryResultSchema = z.object({
  customer: assistantEntitySummarySchema,
  active: z.boolean().optional(),
  pricingClassification: z.string().trim().min(1).max(160).optional(),
  taxStatus: z.string().trim().min(1).max(160).optional(),
  contactSummary: z.array(z.object({
    name: z.string().trim().min(1).max(240),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().min(1).max(80).optional(),
  }).strict()).max(10).optional(),
  recentRecords: z.array(assistantEntitySummarySchema).max(10).optional(),
  openBalanceSummary: z.object({
    label: z.string().trim().min(1).max(160),
    amount: z.number().finite(),
  }).strict().optional(),
}).strict();

export const assistantOrderSummaryInputSchema = z.object({
  orderId: assistantSafeIdentifierSchema.optional(),
  orderNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict().refine((value) => Boolean(value.orderId || value.orderNumber), {
  message: "orderId or orderNumber is required",
});
export const assistantOrderSummaryResultSchema = z.object({
  order: assistantEntitySummarySchema,
  customer: assistantEntitySummarySchema.optional(),
  dueDate: assistantIsoDateTimeSchema.optional(),
  lineItemSummary: z.string().trim().min(1).max(1_000).optional(),
  artworkState: z.string().trim().min(1).max(160).optional(),
  productionState: z.string().trim().min(1).max(160).optional(),
  fulfillmentState: z.string().trim().min(1).max(160).optional(),
  invoice: assistantEntitySummarySchema.optional(),
  blockingIssues: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
}).strict();

export const assistantProductSummaryInputSchema = z.object({
  productId: assistantSafeIdentifierSchema.optional(),
  query: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) => Boolean(value.productId || value.query), {
  message: "productId or query is required",
});
export const assistantProductSummaryResultSchema = z.object({
  product: assistantEntitySummarySchema,
  active: z.boolean().optional(),
  category: z.string().trim().min(1).max(160).optional(),
  pricingMethod: z.string().trim().min(1).max(160).optional(),
  pbv2Summary: z.string().trim().min(1).max(500).optional(),
  materialSummary: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  optionSummary: z.string().trim().min(1).max(1_000).optional(),
  productionRoutingSummary: z.string().trim().min(1).max(1_000).optional(),
}).strict();

export const assistantOperationalSummaryInputSchema = z.object({
  timezone: z.string().trim().min(1).max(80).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export const assistantOperationalMetricSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().trim().min(1).max(160),
  value: z.number().int().nonnegative(),
  definition: z.string().trim().min(1).max(500),
  sourceLink: assistantSourceLinkSchema.optional(),
}).strict();
export const assistantOperationalSummaryResultSchema = z.object({
  metrics: z.array(assistantOperationalMetricSchema).min(1).max(20),
  appliedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().trim().min(1).max(80),
}).strict();

export const assistantNavigationCurrentContextInputSchema = z.object({}).strict();
export const assistantNavigationCurrentContextResultSchema = z.object({
  route: z.string().trim().min(1).max(512).startsWith("/"),
  pageTitle: z.string().trim().min(1).max(240),
  entityType: z.enum(assistantEntityTypeValues).optional(),
  entityId: assistantSafeIdentifierSchema.optional(),
  selectedCount: z.number().int().nonnegative().max(25),
  unsavedChanges: z.boolean(),
  contextFreshness: assistantIsoDateTimeSchema,
}).strict();

export const assistantPlannerToolCallSchema = z.object({
  toolName: z.enum(assistantToolNameValues),
  arguments: z.record(z.unknown()),
}).strict();
export const assistantProviderPlanSchema = z.object({
  intent: z.enum(assistantPlannerIntentValues),
  selectedSkill: z.string().trim().min(1).max(120).nullable(),
  toolCalls: z.array(assistantPlannerToolCallSchema).max(5),
  clarificationRequired: z.boolean(),
  clarificationQuestion: z.string().trim().min(1).max(500).nullable(),
  responseStyle: z.enum(["concise", "standard"]).default("standard"),
}).strict().superRefine((plan, ctx) => {
  if (plan.clarificationRequired && !plan.clarificationQuestion) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clarificationQuestion"], message: "Clarification question is required." });
  }
  if (plan.intent === "unsupported_write" && plan.toolCalls.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolCalls"], message: "Write intent cannot invoke tools." });
  }
});
export type AssistantProviderPlan = z.infer<typeof assistantProviderPlanSchema>;

const assistantStage1StructuredCardSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("notice"),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(2_000),
    tone: z.enum(["info", "warning", "error"]),
  }).strict(),
  z.object({
    kind: z.literal("source"),
    title: z.string().trim().min(1).max(160),
    sources: z.array(assistantSourceLinkSchema).min(1).max(10),
  }).strict(),
  z.object({
    kind: z.literal("tool_status"),
    toolName: z.string().trim().min(1).max(120),
    status: z.enum(assistantToolExecutionStatusValues),
    detail: z.string().trim().min(1).max(1_000).optional(),
  }).strict(),
]);
export const assistantStage2CardKindValues = [
  "search_results",
  "customer_summary",
  "order_summary",
  "product_summary",
  "operational_metrics",
  "current_context",
  "tool_warning",
  "partial_result",
  "permission_denied",
  "not_found",
  "provider_unavailable",
  "action_plan",
  "missing_information",
  "execution_progress",
  "execution_result",
  "stale_plan",
  "action_proposal",
] as const;
export const assistantStage2StructuredCardSchema = z.object({
  kind: z.enum(assistantStage2CardKindValues),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2_000),
  freshness: assistantIsoDateTimeSchema.optional(),
  sourceLinks: z.array(assistantSourceLinkSchema).max(10).default([]),
  toolStatus: z.enum(assistantToolResultStatusValues).optional(),
  // The exact execution-plan API contract is declared below. Cards keep a
  // bounded presentation payload so conversation history never becomes an
  // authority for execution.
  plan: z.record(z.unknown()).optional(),
  cancellationAvailable: z.boolean().optional(),
}).strict();
/** Stage 2 extends (rather than replaces) the persisted Stage 1 card union. */
export const assistantStructuredCardSchema = z.union([
  assistantStage1StructuredCardSchema,
  assistantStage2StructuredCardSchema,
]);
export type AssistantStructuredCard = z.infer<typeof assistantStructuredCardSchema>;

export const assistantUsageCorrelationSchema = z.object({
  correlationId: assistantSafeIdentifierSchema,
  conversationId: assistantSafeIdentifierSchema,
  turnId: assistantSafeIdentifierSchema.optional(),
  usageId: assistantSafeIdentifierSchema.optional(),
  provider: z.string().trim().min(1).max(80).nullable(),
  model: z.string().trim().min(1).max(160).nullable(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
}).strict();
export type AssistantUsageCorrelation = z.infer<typeof assistantUsageCorrelationSchema>;

export const assistantMessageSchema = z.object({
  id: assistantSafeIdentifierSchema,
  role: z.enum(assistantMessageRoleValues),
  content: z.string().max(8_000),
  structuredCards: z.array(assistantStructuredCardSchema).max(20).default([]),
  provider: z.string().trim().min(1).max(80).nullable(),
  model: z.string().trim().min(1).max(160).nullable(),
  correlationId: assistantSafeIdentifierSchema.nullable(),
  createdAt: assistantIsoDateTimeSchema,
}).strict();
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantConversationSummarySchema = z.object({
  id: assistantSafeIdentifierSchema,
  title: z.string().trim().min(1).max(240),
  status: z.enum(assistantConversationStatusValues),
  lastMessagePreview: z.string().max(240).nullable(),
  lastActivityAt: assistantIsoDateTimeSchema,
  createdAt: assistantIsoDateTimeSchema,
  updatedAt: assistantIsoDateTimeSchema,
}).strict();
export type AssistantConversationSummary = z.infer<typeof assistantConversationSummarySchema>;

export const assistantConversationDetailSchema = assistantConversationSummarySchema.extend({
  messages: z.array(assistantMessageSchema).max(500),
}).strict();
export type AssistantConversationDetail = z.infer<typeof assistantConversationDetailSchema>;

export const assistantCreateConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
}).strict();
export type AssistantCreateConversationRequest = z.infer<typeof assistantCreateConversationRequestSchema>;

export const assistantUpdateConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  status: z.enum(["archived"]).optional(),
}).strict().refine((value) => value.title !== undefined || value.status !== undefined, {
  message: "At least one conversation update is required",
});
export type AssistantUpdateConversationRequest = z.infer<typeof assistantUpdateConversationRequestSchema>;

export const assistantTurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  context: assistantContextEnvelopeSchema,
  clientRequestId: assistantSafeIdentifierSchema.optional(),
}).strict();
export type AssistantTurnRequest = z.infer<typeof assistantTurnRequestSchema>;

export const assistantTurnResponseSchema = z.object({
  turnId: assistantSafeIdentifierSchema,
  status: z.enum(assistantTurnStatusValues),
  message: assistantMessageSchema,
  usage: assistantUsageCorrelationSchema,
}).strict();
export type AssistantTurnResponse = z.infer<typeof assistantTurnResponseSchema>;

// Stage 3 controlled-action framework. These contracts intentionally model a
// proposed server-owned plan, never a browser- or model-authorized command.
export const assistantExecutionPlanStatusValues = [
  "draft", "resolving", "awaiting_input", "preview_ready", "awaiting_confirmation", "confirmed",
  "revalidating", "executing", "succeeded", "partially_failed", "failed", "cancelled", "expired", "invalidated",
] as const;
export const assistantExecutionRiskValues = ["low", "moderate", "high", "critical"] as const;
export const assistantExecutionStepStatusValues = ["pending", "running", "succeeded", "failed", "skipped", "blocked"] as const;
export const assistantIdempotencyStatusValues = ["locked", "completed", "failed", "unknown", "expired"] as const;
export type AssistantExecutionPlanStatus = (typeof assistantExecutionPlanStatusValues)[number];

export const assistantAffectedEntityReferenceSchema = z.object({
  entityType: z.enum(assistantEntityTypeValues),
  entityId: assistantSafeIdentifierSchema,
  label: z.string().trim().min(1).max(240),
  sourceLink: assistantSourceLinkSchema.optional(),
}).strict();
export const assistantExpectedRecordFingerprintSchema = z.object({
  entityType: z.enum(assistantEntityTypeValues),
  entityId: assistantSafeIdentifierSchema,
  fingerprint: z.string().trim().min(32).max(128).regex(/^[a-f0-9]+$/i),
  strategy: z.enum(["record_version", "updated_at_fields", "canonical_hash"]),
}).strict();
export const assistantSideEffectSummarySchema = z.object({
  label: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(1_000),
  affectedRecordCount: z.number().int().nonnegative().max(100),
  reversible: z.boolean(),
}).strict();
export const assistantUndoAvailabilitySchema = z.object({
  available: z.boolean(),
  label: z.string().trim().min(1).max(240).nullable(),
  expiresAt: assistantIsoDateTimeSchema.nullable(),
}).strict();
export const assistantExecutionPreviewSchema = z.object({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(2_000),
  affectedEntities: z.array(assistantAffectedEntityReferenceSchema).max(100),
  sideEffects: z.array(assistantSideEffectSummarySchema).max(30),
  undo: assistantUndoAvailabilitySchema,
  quoteInternalNote: z.object({
    quoteId: assistantSafeIdentifierSchema,
    quoteNumber: z.string().trim().min(1).max(64),
    customerName: z.string().trim().min(1).max(255).nullable(),
    noteText: z.string().trim().min(1).max(4_000),
    sourceLink: assistantSourceLinkSchema,
    unchanged: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  }).strict().optional(),
}).strict();
export const assistantMissingInformationSchema = z.object({
  field: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(500),
}).strict();
export const assistantExecutionStepResultSchema = z.object({
  id: assistantSafeIdentifierSchema,
  commandName: z.string().trim().min(1).max(120),
  status: z.enum(assistantExecutionStepStatusValues),
  summary: z.string().trim().min(1).max(1_000).nullable(),
  errorCode: z.string().trim().min(1).max(120).nullable(),
  startedAt: assistantIsoDateTimeSchema.nullable(),
  completedAt: assistantIsoDateTimeSchema.nullable(),
}).strict();
export const assistantExecutionPlanSchema = z.object({
  id: assistantSafeIdentifierSchema,
  conversationId: assistantSafeIdentifierSchema,
  turnId: assistantSafeIdentifierSchema.nullable(),
  action: z.string().trim().min(1).max(120),
  commandVersion: z.string().trim().min(1).max(64),
  status: z.enum(assistantExecutionPlanStatusValues),
  riskLevel: z.enum(assistantExecutionRiskValues),
  planVersion: z.number().int().positive(),
  contextVersion: z.enum(assistantContextVersionValues),
  preview: assistantExecutionPreviewSchema,
  missingInformation: z.array(assistantMissingInformationSchema).max(20),
  executable: z.boolean(),
  confirmationAvailable: z.boolean(),
  cancellationAvailable: z.boolean(),
  expiresAt: assistantIsoDateTimeSchema,
  staleReason: z.string().trim().min(1).max(500).nullable(),
  failureSummary: z.string().trim().min(1).max(1_000).nullable(),
  steps: z.array(assistantExecutionStepResultSchema).max(20),
  correlationId: assistantSafeIdentifierSchema,
  createdAt: assistantIsoDateTimeSchema,
  updatedAt: assistantIsoDateTimeSchema,
}).strict();
export type AssistantExecutionPlan = z.infer<typeof assistantExecutionPlanSchema>;

export const assistantCreateExecutionPlanRequestSchema = z.object({
  turnId: assistantSafeIdentifierSchema.optional(),
  context: assistantContextEnvelopeSchema,
}).strict();
export const assistantCancelExecutionPlanRequestSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
}).strict();
export const assistantConfirmationRequestSchema = z.object({
  confirmationToken: z.string().trim().min(32).max(256),
  expectedPlanVersion: z.number().int().positive(),
  context: assistantContextEnvelopeSchema,
}).strict();
export const assistantConfirmationResponseSchema = z.object({
  plan: assistantExecutionPlanSchema,
  accepted: z.boolean(),
  executionStarted: z.boolean(),
}).strict();
export const assistantPartialFailureResultSchema = z.object({
  planId: assistantSafeIdentifierSchema,
  succeededStepIds: z.array(assistantSafeIdentifierSchema).max(20),
  failedStepIds: z.array(assistantSafeIdentifierSchema).max(20),
  summary: z.string().trim().min(1).max(1_000),
}).strict();
export const assistantIdempotencyResultSchema = z.object({
  status: z.enum(assistantIdempotencyStatusValues),
  reused: z.boolean(),
  resultReference: assistantSafeIdentifierSchema.nullable(),
}).strict();

export const assistantStage3StructuredCardSchema = z.object({
  kind: z.enum(["action_plan", "missing_information", "execution_progress", "execution_result", "stale_plan"]),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2_000),
  plan: assistantExecutionPlanSchema,
}).strict();
export type AssistantStage3StructuredCard = z.infer<typeof assistantStage3StructuredCardSchema>;

export const assistantErrorCodeValues = [
  "assistant_unavailable",
  "assistant_disabled",
  "conversation_not_found",
  "context_invalid",
  "turn_failed",
  "plan_not_found",
  "plan_stale",
  "plan_permission_changed",
  "plan_record_changed",
  "confirmation_invalid",
  "confirmation_expired",
  "confirmation_used",
  "plan_transition_invalid",
] as const;

export const assistantErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(assistantErrorCodeValues),
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    correlationId: assistantSafeIdentifierSchema.optional(),
  }).strict(),
}).strict();
export type AssistantErrorResponse = z.infer<typeof assistantErrorResponseSchema>;
