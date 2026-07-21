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

export type AssistantContextVersion = (typeof assistantContextVersionValues)[number];
export type AssistantPresentationMode = (typeof assistantPresentationModeValues)[number];
export type AssistantConversationStatus = (typeof assistantConversationStatusValues)[number];
export type AssistantTurnStatus = (typeof assistantTurnStatusValues)[number];
export type AssistantMessageRole = (typeof assistantMessageRoleValues)[number];

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
  toolsEnabled: z.literal(false),
  writeActionsEnabled: z.literal(false),
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

export const assistantStructuredCardSchema = z.discriminatedUnion("kind", [
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

export const assistantErrorCodeValues = [
  "assistant_unavailable",
  "assistant_disabled",
  "conversation_not_found",
  "context_invalid",
  "turn_failed",
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
