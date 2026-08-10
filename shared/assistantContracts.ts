import { z } from "zod";
export {
  analyticsCustomerProductSalesInputSchema,
  analyticsCustomerProductSalesResultSchema,
  analyticsCustomerUninvoicedOrdersInputSchema,
  analyticsCustomerUninvoicedOrdersResultSchema,
  analyticsInvoiceActivityInputSchema,
  analyticsInvoiceActivityResultSchema,
  analyticsResolveCustomerInputSchema,
  analyticsResolveCustomerResultSchema,
} from "./aiReportingContracts";

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
  "quotes.search",
  "quotes.get_detail",
  "customers.get_summary",
  "orders.get_summary",
  "products.get_summary",
  "products.get_pricing",
  "reports.operational_summary",
  "navigation.get_current_context",
  "production.get_queue_summary",
  "operations.get_attention_summary",
  "orders.get_due_summary",
  "production.get_completed_jobs",
  "analytics.resolve_customer",
  "analytics.customer_product_sales",
  "analytics.customer_uninvoiced_orders",
  "analytics.invoice_activity",
] as const;
export const assistantPlannerIntentValues = ["lookup", "operational_summary", "production_reporting", "analytical_reporting", "navigation", "unsupported_write", "clarification"] as const;
/** Reporting scope is independent from tool selection. Keeping it typed avoids
 * silently replacing an order question with a production-job answer. */
export const assistantReportingScopeValues = [
  "order",
  "order_line",
  "production_job",
  "production_station",
  "print_quantity",
  "customer",
  "contact",
  "invoice",
  "posted_revenue",
  "order_value",
] as const;

export type AssistantContextVersion = (typeof assistantContextVersionValues)[number];
export type AssistantPresentationMode = (typeof assistantPresentationModeValues)[number];
export type AssistantConversationStatus = (typeof assistantConversationStatusValues)[number];
export type AssistantTurnStatus = (typeof assistantTurnStatusValues)[number];
export type AssistantMessageRole = (typeof assistantMessageRoleValues)[number];
export type AssistantToolName = (typeof assistantToolNameValues)[number];
export type AssistantPlannerIntent = (typeof assistantPlannerIntentValues)[number];
export type AssistantReportingScope = (typeof assistantReportingScopeValues)[number];

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
  /** True only when the configured provider can serve the internal assistant. */
  providerConfigured: z.boolean(),
  readToolsEnabled: z.boolean(),
  registeredReadTools: z.array(z.enum(assistantToolNameValues)).max(16),
  /** Whether the reviewed confirmation framework is available to this organization. */
  writeFrameworkEnabled: z.boolean(),
  // Stage 4 enables a server-owned, explicitly allowlisted write action. The
  // capability is informational only; it never grants browser authorization.
  writeActionsEnabled: z.boolean(),
  /** Reviewed production commands enabled for this organization, never client supplied. */
  productionCommandsEnabled: z.array(z.enum([
    "quotes.add_internal_note",
    "products.create_inactive_draft",
    "products.update_inactive_draft",
  ])).max(3),
  /** Subset of enabled commands that this authenticated actor may plan. */
  productionCommandsPermittedForUser: z.array(z.enum([
    "quotes.add_internal_note",
    "products.create_inactive_draft",
    "products.update_inactive_draft",
  ])).max(3),
  /** True when the selected provider offers native public research or the
   * separately configured server-owned fallback is available. */
  externalResearchEnabled: z.boolean(),
  mcpEnabled: z.literal(false),
  productActivationEnabled: z.literal(false),
  activeProductEditingEnabled: z.boolean(),
  /** Enables expandable implementation details for authorized staff only. */
  diagnosticsEnabled: z.boolean(),
  /** Presentation text derived from this exact server object. */
  composerHelperText: z.string().trim().min(1).max(240),
  assistantVersion: z.string().trim().min(1).max(64),
  unavailableReason: z.string().trim().min(1).max(240).nullable(),
  // Returned only to the authenticated internal actor. It lets the UI safely
  // namespace local layout preferences without accepting either identity back.
  actorScope: assistantActorScopeSchema.optional(),
}).strict();
export type AssistantCapability = z.infer<typeof assistantCapabilitySchema>;

/** Server-owned display intent for an assistant turn. The browser consumes
 * this metadata and never infers business meaning from response prose. */
export const assistantResponsePresentationValues = [
  "conversational",
  "collection",
  "record_summary",
  "analytical",
  "proposed_action",
  "execution_result",
  "diagnostic",
] as const;
export type AssistantResponsePresentation = (typeof assistantResponsePresentationValues)[number];

/** Server-derived outcome state. This is intentionally independent from visual
 * presentation so the browser never mistakes supporting provenance for an
 * error or offers a retry for a safe validation/not-found response. */
export const assistantResponseStateKindValues = [
  "success",
  "partial",
  "retryable_failure",
  "validation_error",
  "permission_denied",
  "not_found",
] as const;
export const assistantResponseStateSchema = z.object({
  kind: z.enum(assistantResponseStateKindValues),
  retryable: z.boolean(),
  diagnosticsAvailable: z.boolean(),
}).strict();
export type AssistantResponseState = z.infer<typeof assistantResponseStateSchema>;

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
  "contact",
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
  /** Server-selected discriminator for deterministic exact customer/product lookup. */
  entityType: z.enum(["customer", "product"]).optional(),
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

/** A business-level quote investigation. The caller can supply a customer
 * name when that is part of the question, but tenant-wide reads deliberately
 * require no customer identifier. */
export const assistantQuoteSearchInputSchema = z.object({
  customer: z.string().trim().min(1).max(240).optional(),
  quoteNumber: z.string().trim().min(1).max(64).optional(),
  lifecycle: z.enum(["open", "closed"]).optional(),
  status: z.enum(["draft", "pending_approval", "sent", "approved", "rejected", "expired", "converted"]).optional(),
  createdAtRange: z.object({
    start: assistantIsoDateTimeSchema,
    end: assistantIsoDateTimeSchema,
  }).strict().optional(),
  sort: z.enum(["newest", "oldest", "total_desc", "total_asc"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.lifecycle && value.status) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "lifecycle and status cannot be combined" });
  }
  if (value.createdAtRange && value.createdAtRange.start > value.createdAtRange.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["createdAtRange", "end"], message: "created date range end must not precede start" });
  }
});
export const assistantQuoteSearchRowSchema = z.object({
  quoteId: assistantSafeIdentifierSchema,
  quoteNumber: z.string().trim().min(1).max(64),
  customer: z.object({
    id: assistantSafeIdentifierSchema.optional(),
    name: z.string().trim().min(1).max(240),
    sourceLink: assistantSourceLinkSchema.optional(),
  }).strict(),
  total: z.number().finite().nonnegative(),
  status: z.enum(["draft", "pending_approval", "sent", "approved", "rejected", "expired", "converted"]),
  open: z.boolean(),
  createdAt: assistantIsoDateTimeSchema,
  relatedOrderId: assistantSafeIdentifierSchema.optional(),
  sourceLink: assistantSourceLinkSchema,
}).strict();
export const assistantQuoteSearchResultSchema = z.object({
  totalMatchingQuotes: z.number().int().nonnegative(),
  quotes: z.array(assistantQuoteSearchRowSchema).max(20),
  appliedFilters: z.object({
    lifecycle: z.enum(["open", "closed"]).optional(),
    status: z.enum(["draft", "pending_approval", "sent", "approved", "rejected", "expired", "converted"]).optional(),
    customer: z.string().trim().min(1).max(240).optional(),
    recencyField: z.literal("createdAt"),
    sentAtAvailable: z.literal(false),
  }).strict(),
}).strict();

/** One tenant-authorized quote detail read.  It intentionally reports an
 * authoritative relationship state instead of making a missing conversion
 * look like a failed lookup. */
export const assistantQuoteDetailInputSchema = z.object({
  quoteId: assistantSafeIdentifierSchema,
}).strict();
export const assistantQuoteDetailLineItemSchema = z.object({
  id: assistantSafeIdentifierSchema,
  description: z.string().trim().min(1).max(500),
  productName: z.string().trim().min(1).max(255).optional(),
  quantity: z.number().int().positive(),
  dimensions: z.object({ widthInches: z.number().positive(), heightInches: z.number().positive() }).strict().optional(),
  options: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
}).strict();
export const assistantQuoteDetailResultSchema = z.object({
  quote: assistantEntitySummarySchema,
  customer: assistantEntitySummarySchema.optional(),
  contact: z.object({ name: z.string().trim().min(1).max(240), email: z.string().trim().email().max(320).optional(), phone: z.string().trim().min(1).max(80).optional() }).strict().optional(),
  total: z.number().finite().nonnegative(),
  status: z.enum(["draft", "pending_approval", "sent", "approved", "rejected", "expired", "converted"]),
  lineItems: z.array(assistantQuoteDetailLineItemSchema).max(50),
  relatedOrder: z.discriminatedUnion("state", [
    z.object({ state: z.literal("linked"), order: assistantEntitySummarySchema }).strict(),
    z.object({ state: z.literal("none") }).strict(),
  ]),
}).strict();

export const assistantOrderSummaryInputSchema = z.object({
  orderId: assistantSafeIdentifierSchema.optional(),
  orderNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict().refine((value) => Boolean(value.orderId || value.orderNumber), {
  message: "orderId or orderNumber is required",
});

/** A suggestion is a text-only continuation. It never carries an executable
 * tool call, confirmation token, or implicit authority. The backend receives
 * the prompt as an ordinary user message and resolves scope again. */
export const assistantSuggestedPromptSchema = z.object({
  id: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(500),
  intent: z.enum(["lookup", "operational_summary", "production_reporting", "analytical_reporting"]),
  contextReference: z.object({
    entityType: z.enum(["customer", "contact", "order", "invoice", "production_job"]),
    label: z.string().trim().min(1).max(160),
  }).strict().optional(),
  presentationPriority: z.number().int().min(1).max(4),
}).strict();
export type AssistantSuggestedPrompt = z.infer<typeof assistantSuggestedPromptSchema>;

export const assistantOperationalOrderLineSchema = z.object({
  sequence: z.number().int().positive(),
  label: z.string().trim().min(1).max(500),
  productName: z.string().trim().min(1).max(255).nullable(),
  materialName: z.string().trim().min(1).max(255).nullable(),
  orderedPieces: z.number().int().nonnegative(),
  dimensions: z.object({ widthInches: z.number().positive(), heightInches: z.number().positive() }).strict().nullable(),
  finishedSquareFeet: z.number().finite().nonnegative().nullable(),
  sidedness: z.enum(["single_sided", "double_sided", "unavailable"]),
  status: z.string().trim().min(1).max(120),
  workflowState: z.string().trim().min(1).max(120),
  stations: z.array(z.string().trim().min(1).max(160)).max(10),
}).strict();
export const assistantOperationalOrderSummarySchema = z.object({
  priority: z.string().trim().min(1).max(120),
  statusPill: z.string().trim().min(1).max(160).nullable(),
  poNumber: z.string().trim().min(1).max(120).nullable(),
  jobLabel: z.string().trim().min(1).max(500).nullable(),
  lineItems: z.array(assistantOperationalOrderLineSchema).max(25),
  production: z.object({
    totalJobs: z.number().int().nonnegative(),
    queuedJobs: z.number().int().nonnegative(),
    inProductionJobs: z.number().int().nonnegative(),
    completedJobs: z.number().int().nonnegative(),
    stations: z.array(z.object({ stationLabel: z.string().trim().min(1).max(160), jobCount: z.number().int().nonnegative() }).strict()).max(10),
    printProgressAvailable: z.boolean(),
    printProgressWarning: z.string().trim().min(1).max(300).optional(),
  }).strict(),
  fulfillmentStatus: z.string().trim().min(1).max(160),
  billingStatus: z.string().trim().min(1).max(160),
  orderTotal: z.number().finite().nonnegative().optional(),
}).strict();

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
  operational: assistantOperationalOrderSummarySchema.optional(),
  suggestedPrompts: z.array(assistantSuggestedPromptSchema).max(4).optional(),
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

export const assistantProductPricingInputSchema = z.object({
  productId: assistantSafeIdentifierSchema.optional(),
  query: z.string().trim().min(1).max(160).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  widthIn: z.number().finite().max(10_000).optional(),
  heightIn: z.number().finite().max(10_000).optional(),
  width: z.number().finite().max(10_000).optional(),
  height: z.number().finite().max(10_000).optional(),
  unit: z.enum(["in", "ft"]).optional(),
  optionSelections: z.record(z.unknown()).optional(),
}).strict().refine((value) => Boolean(value.productId || value.query), {
  message: "productId or query is required",
});
export const assistantProductPricingResultSchema = z.object({
  product: assistantEntitySummarySchema,
  active: z.boolean(),
  pricing: z.object({
    status: z.enum(["configuration", "priced", "input_needed", "unavailable"]),
    pricingMethod: z.string().trim().min(1).max(160).nullable(),
    treeVersionId: assistantSafeIdentifierSchema.nullable(),
    quantity: z.number().int().positive(),
    dimensions: z.object({ widthIn: z.number().finite().positive(), heightIn: z.number().finite().positive() }).strict().nullable(),
    totalCents: z.number().int().nonnegative().nullable(),
    averageUnitCents: z.number().int().nonnegative().nullable(),
    configuration: z.object({
      pricingStrategy: z.enum(["scalar", "matrix", "tiered", "formula", "configured"]),
      pricingBasis: z.enum(["per_square_foot", "per_piece", "mixed", "formula", "configured"]),
      measurementMode: z.enum(["dimensions_required", "quantity_only"]),
      dimensionsRequired: z.boolean(), fixedDimensions: z.object({ widthIn: z.number().positive(), heightIn: z.number().positive() }).strict().nullable(),
      baseRates: z.object({ perSquareFootCents: z.number().nonnegative().nullable(), perPieceCents: z.number().nonnegative().nullable(), minimumChargeCents: z.number().nonnegative().nullable() }).strict(),
      quantityBehavior: z.enum(["linear", "tiered", "matrix_tiered"]),
      quantityTiers: z.array(z.object({ minimumQuantity: z.number().int().positive().nullable(), maximumQuantity: z.number().int().positive().nullable(), minimumSquareFeet: z.number().positive().nullable(), perSquareFootCents: z.number().nonnegative().nullable(), perPieceCents: z.number().nonnegative().nullable(), minimumChargeCents: z.number().nonnegative().nullable() }).strict()).max(30),
      matrix: z.object({ dimensions: z.array(z.string().min(1)).max(12), rowCount: z.number().int().nonnegative(), pricingUnit: z.enum(["per_square_foot", "per_piece"]), cells: z.array(z.object({ selections: z.array(z.object({ axis: z.string().min(1), value: z.string().min(1) }).strict()).max(12), rateCents: z.number().int().nonnegative().nullable() }).strict()).max(120) }).strict().nullable(),
      options: z.array(z.object({ label: z.string().min(1), required: z.boolean(), defaultSelection: z.string().nullable(), availableWhen: z.object({ optionGroup: z.string().min(1), value: z.string().min(1) }).strict().nullable(), choices: z.array(z.object({ label: z.string().min(1), pricingImpactSummary: z.string().nullable() }).strict()).max(30) }).strict()).max(40),
      treeVersionId: assistantSafeIdentifierSchema, lifecycle: z.string().min(1).max(40),
    }).strict().nullable(),
    inputNeeded: z.array(z.object({ field: z.string().min(1).max(160), label: z.string().min(1).max(160), reason: z.string().min(1).max(500), allowedValues: z.array(z.string().min(1).max(160)).max(30) }).strict()).max(20),
    message: z.string().trim().min(1).max(500),
  }).strict(),
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

const assistantProductionStationKeySchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/i, "Station key contains unsupported characters");
/** A model may nominate a human station phrase, but the server resolves it
 * against the active organization-scoped station list before querying. */
const assistantProductionStationReferenceSchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, "Station reference contains unsupported characters");
const assistantProductionDateFilterSchema = z.enum(["overdue", "today", "tomorrow"]);
export const assistantProductionQueueInputSchema = z.object({
  stationKey: assistantProductionStationReferenceSchema.optional(),
  status: z.enum(["queued", "in_progress", "paused"]).optional(),
  due: assistantProductionDateFilterSchema.optional(),
  includeOverdue: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict();
export const assistantProductionUrgentJobSchema = z.object({
  jobId: assistantSafeIdentifierSchema,
  orderId: assistantSafeIdentifierSchema,
  orderNumber: z.string().trim().min(1).max(64),
  customerName: z.string().trim().min(1).max(240).optional(),
  /** Canonical line identity is distinct from an order or product label. */
  orderLineItemId: assistantSafeIdentifierSchema.nullable().optional(),
  lineItemSequence: z.number().int().positive().optional(),
  lineItemLabel: z.string().trim().min(1).max(300).optional(),
  productName: z.string().trim().min(1).max(255).optional(),
  orderedQuantity: z.number().int().nonnegative().nullable().optional(),
  /** No quantity completion is inferred from workflow state. Until a
   * migration-backed source exists these values remain null/false. */
  productionRequiredQuantity: z.number().int().nonnegative().nullable().optional(),
  completedQuantity: z.number().int().nonnegative().nullable().optional(),
  remainingQuantity: z.number().int().nonnegative().nullable().optional(),
  quantityUnit: z.string().trim().min(1).max(80).nullable().optional(),
  progressAvailable: z.boolean().optional(),
  progressSource: z.string().trim().min(1).max(160).optional(),
  progressWarning: z.string().trim().min(1).max(300).optional(),
  label: z.string().trim().min(1).max(300),
  stationKey: assistantProductionStationKeySchema,
  stationLabel: z.string().trim().min(1).max(160),
  productionStep: z.string().trim().min(1).max(160).optional(),
  status: z.string().trim().min(1).max(120),
  dueDate: assistantIsoDateTimeSchema.optional(),
  dueState: z.enum(["overdue", "due_today", "due_tomorrow", "future", "undated"]).optional(),
  overdue: z.boolean(),
  inclusionReason: z.string().trim().min(1).max(240).optional(),
  orderSourceLink: assistantSourceLinkSchema.optional(),
  sourceLink: assistantSourceLinkSchema,
}).strict();
/** Attention can include an order-level canonical queue (for example
 * fulfillment), where no current production-job UUID exists. The reduced DTO
 * still has a human-readable order and a safe internal source link. */
export const assistantAttentionItemSchema = z.object({
  jobId: assistantSafeIdentifierSchema.optional(),
  orderId: assistantSafeIdentifierSchema,
  orderNumber: z.string().trim().min(1).max(64),
  customerName: z.string().trim().min(1).max(240).optional(),
  orderLineItemId: assistantSafeIdentifierSchema.nullable().optional(),
  lineItemSequence: z.number().int().positive().optional(),
  lineItemLabel: z.string().trim().min(1).max(300).optional(),
  productName: z.string().trim().min(1).max(255).optional(),
  orderedQuantity: z.number().int().nonnegative().nullable().optional(),
  productionRequiredQuantity: z.number().int().nonnegative().nullable().optional(),
  completedQuantity: z.number().int().nonnegative().nullable().optional(),
  remainingQuantity: z.number().int().nonnegative().nullable().optional(),
  quantityUnit: z.string().trim().min(1).max(80).nullable().optional(),
  progressAvailable: z.boolean().optional(),
  progressSource: z.string().trim().min(1).max(160).optional(),
  progressWarning: z.string().trim().min(1).max(300).optional(),
  label: z.string().trim().min(1).max(300),
  stationKey: assistantProductionStationReferenceSchema.optional(),
  stationLabel: z.string().trim().min(1).max(160),
  productionStep: z.string().trim().min(1).max(160).optional(),
  status: z.string().trim().min(1).max(120),
  dueDate: assistantIsoDateTimeSchema.optional(),
  dueState: z.enum(["overdue", "due_today", "due_tomorrow", "future", "undated"]).optional(),
  overdue: z.boolean(),
  reason: z.string().trim().min(1).max(240),
  inclusionReason: z.string().trim().min(1).max(240).optional(),
  orderSourceLink: assistantSourceLinkSchema.optional(),
  sourceLink: assistantSourceLinkSchema,
}).strict();
export const assistantProductionStationSummarySchema = z.object({
  stationKey: assistantProductionStationKeySchema,
  stationLabel: z.string().trim().min(1).max(160),
  active: z.boolean(),
  activeJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  inProductionJobs: z.number().int().nonnegative(),
  overdueJobs: z.number().int().nonnegative(),
  dueTodayJobs: z.number().int().nonnegative(),
  dueTomorrowJobs: z.number().int().nonnegative(),
  uniqueLineItems: z.number().int().nonnegative().optional(),
  uniqueOrders: z.number().int().nonnegative().optional(),
  remainingQuantity: z.number().int().nonnegative().nullable().optional(),
  progressAvailableJobs: z.number().int().nonnegative().optional(),
  earliestDueJob: assistantProductionUrgentJobSchema.optional(),
  oldestActiveJob: assistantProductionUrgentJobSchema.optional(),
  boardLink: assistantSourceLinkSchema,
}).strict();

export const assistantProductionOrderGroupSchema = z.object({
  orderId: assistantSafeIdentifierSchema,
  orderNumber: z.string().trim().min(1).max(64),
  customerName: z.string().trim().min(1).max(240).optional(),
  dueDate: assistantIsoDateTimeSchema.optional(),
  dueState: z.enum(["overdue", "due_today", "due_tomorrow", "future", "undated"]),
  orderSourceLink: assistantSourceLinkSchema,
  items: z.array(assistantProductionUrgentJobSchema).min(1).max(25),
}).strict();
export const assistantProductionQueueResultSchema = z.object({
  stations: z.array(assistantProductionStationSummarySchema).min(1).max(20),
  urgentJobs: z.array(assistantProductionUrgentJobSchema).max(20),
  orderGroups: z.array(assistantProductionOrderGroupSchema).max(20).optional(),
  timezone: z.string().trim().min(1).max(80),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
}).strict();

export const assistantAttentionCategorySchema = z.object({
  key: z.enum(["overdue", "due_today", "due_tomorrow", "waiting_artwork", "waiting_proof", "waiting_prepress", "in_production", "ready_for_fulfillment"]),
  label: z.string().trim().min(1).max(160),
  count: z.number().int().nonnegative().nullable(),
  available: z.boolean(),
  note: z.string().trim().min(1).max(300).optional(),
}).strict();
export const assistantAttentionSummaryInputSchema = z.object({
  filter: z.enum(["today", "tomorrow", "due_today", "due_tomorrow", "overdue", "waiting_artwork", "waiting_proof", "waiting_prepress", "in_production", "ready_for_fulfillment", "urgent", "all_attention"]).optional(),
  dueWithinDays: z.number().int().min(1).max(31).optional(),
  stationKey: assistantProductionStationKeySchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict();
export const assistantAttentionSummaryResultSchema = z.object({
  totalActiveJobs: z.number().int().nonnegative(),
  totalActiveLineItems: z.number().int().nonnegative().optional(),
  totalActiveOrders: z.number().int().nonnegative().optional(),
  remainingQuantity: z.number().int().nonnegative().nullable().optional(),
  progressAvailableJobs: z.number().int().nonnegative().optional(),
  categories: z.array(assistantAttentionCategorySchema).min(1).max(8),
  mostLoadedStation: assistantProductionStationSummarySchema.optional(),
  earliestDueJob: assistantProductionUrgentJobSchema.optional(),
  attentionItems: z.array(assistantAttentionItemSchema).max(20),
  orderGroups: z.array(assistantProductionOrderGroupSchema).max(20).optional(),
  timezone: z.string().trim().min(1).max(80),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
}).strict();

/** Order due reporting deliberately has its own order-level contract. It
 * prevents a production-job queue from being used as the headline answer to
 * an order due-date question. */
export const assistantOrderDueFilterValues = ["overdue", "due_today", "due_tomorrow", "due_within_days", "date_range", "last_week_through_current_week"] as const;
export const assistantOrderDueCustomerFilterSchema = z.object({
  id: assistantSafeIdentifierSchema.optional(),
  name: z.string().trim().min(1).max(240).optional(),
}).strict().refine((value) => Boolean(value.id || value.name), {
  message: "customer id or name is required",
});
export const assistantOrderDueSummaryInputSchema = z.object({
  due: z.enum(assistantOrderDueFilterValues).optional(),
  dueWithinDays: z.number().int().min(1).max(31).optional(),
  dateRange: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict().optional(),
  customer: assistantOrderDueCustomerFilterSchema.optional(),
  status: z.enum(["new", "in_production", "on_hold", "ready_for_shipment", "completed", "closed", "canceled", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  includeOperationalSummary: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.due === "due_within_days" && !value.dueWithinDays) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dueWithinDays"], message: "dueWithinDays is required for due_within_days." });
  }
  if (value.due === "date_range" && !value.dateRange) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateRange"], message: "dateRange is required for date_range." });
  }
  if (value.dateRange && value.dateRange.start > value.dateRange.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateRange", "end"], message: "date range end must not precede start." });
  }
});
export const assistantOrderDueSummaryOrderSchema = z.object({
  orderId: assistantSafeIdentifierSchema,
  orderNumber: z.string().trim().min(1).max(64),
  customerName: z.string().trim().min(1).max(240),
  status: z.string().trim().min(1).max(120),
  dueDate: assistantIsoDateTimeSchema,
  dueState: z.enum(["overdue", "due_today", "due_tomorrow", "future"]),
  daysFromDue: z.number().int(),
  lineItemCount: z.number().int().nonnegative().nullable(),
  incompleteLineItemCount: z.number().int().nonnegative().nullable(),
  productionJobCount: z.number().int().nonnegative().nullable(),
  activeProductionJobCount: z.number().int().nonnegative().nullable(),
  fulfillmentState: z.string().trim().min(1).max(120).nullable(),
  invoiceState: z.string().trim().min(1).max(120).nullable(),
  billingReadiness: z.string().trim().min(1).max(120).nullable(),
  orderTotal: z.number().nonnegative().nullable().optional(),
  sourceLink: assistantSourceLinkSchema,
}).strict();
export const assistantOrderDueSummaryResultSchema = z.object({
  totalMatchingOrders: z.number().int().nonnegative(),
  orders: z.array(assistantOrderDueSummaryOrderSchema).max(20),
  timezone: z.string().trim().min(1).max(80),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
}).strict();

/** Completed-job reporting is intentionally distinct from due-date and
 * uninvoiced-order reporting. Its time filter always applies to the canonical
 * production completion timestamp, not an order status or billing state. */
export const assistantCompletedJobReportInputSchema = z.object({
  completed: z.literal("last_week_through_current_week"),
  customer: assistantOrderDueCustomerFilterSchema,
  limit: z.number().int().min(1).max(10).optional(),
}).strict();
export const assistantCompletedJobReportRowSchema = z.object({
  productionJobId: assistantSafeIdentifierSchema,
  orderId: assistantSafeIdentifierSchema,
  orderNumber: z.string().trim().min(1).max(64),
  customerName: z.string().trim().min(1).max(240),
  productOrLineItemDescription: z.string().trim().min(1).max(500),
  completedAt: assistantIsoDateTimeSchema,
  quantity: z.number().nonnegative().nullable(),
  productionStatus: z.string().trim().min(1).max(120),
  invoiceState: z.string().trim().min(1).max(120).nullable(),
  sourceLink: assistantSourceLinkSchema,
  orderSourceLink: assistantSourceLinkSchema,
}).strict();
export const assistantCompletedJobReportResultSchema = z.object({
  totalMatchingJobs: z.number().int().nonnegative(),
  jobs: z.array(assistantCompletedJobReportRowSchema).max(10),
  timezone: z.string().trim().min(1).max(80),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
}).strict();

export const assistantNavigationCurrentContextInputSchema = z.object({}).strict();
/** A current-record summary is always server-resolved.  The UI context only
 * nominates a record; it never supplies record attributes or source links. */
const assistantCurrentContextRecordBaseSchema = z.object({
  entityId: assistantSafeIdentifierSchema,
  sourceLink: assistantSourceLinkSchema,
  freshness: assistantIsoDateTimeSchema,
}).strict();

export const assistantCurrentContextOrderSchema = assistantCurrentContextRecordBaseSchema.extend({
  entityType: z.literal("order"),
  orderNumber: z.string().trim().min(1).max(64),
  customer: z.string().trim().min(1).max(240),
  status: z.string().trim().min(1).max(120),
  dueDate: assistantIsoDateTimeSchema.optional(),
}).strict();
export const assistantCurrentContextCustomerSchema = assistantCurrentContextRecordBaseSchema.extend({
  entityType: z.literal("customer"),
  customerName: z.string().trim().min(1).max(240),
  status: z.string().trim().min(1).max(120).optional(),
}).strict();
export const assistantCurrentContextQuoteSchema = assistantCurrentContextRecordBaseSchema.extend({
  entityType: z.literal("quote"),
  quoteNumber: z.string().trim().min(1).max(64),
  customer: z.string().trim().min(1).max(240).optional(),
  status: z.string().trim().min(1).max(120).optional(),
}).strict();
export const assistantCurrentContextProductSchema = assistantCurrentContextRecordBaseSchema.extend({
  entityType: z.literal("product"),
  productName: z.string().trim().min(1).max(255),
  active: z.boolean(),
}).strict();
export const assistantNavigationCurrentContextResultSchema = z.object({
  route: z.string().trim().min(1).max(512).startsWith("/"),
  pageTitle: z.string().trim().min(1).max(240),
  entityType: z.enum(assistantEntityTypeValues).optional(),
  entityId: assistantSafeIdentifierSchema.optional(),
  currentRecord: z.discriminatedUnion("entityType", [
    assistantCurrentContextOrderSchema,
    assistantCurrentContextCustomerSchema,
    assistantCurrentContextQuoteSchema,
    assistantCurrentContextProductSchema,
  ]).optional(),
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
  "order_option_selection",
  "product_intake_summary",
  "product_missing_information",
  "product_comparison",
  "product_material_selection",
  "product_options_summary",
  "product_pricing_summary",
  "product_routing_summary",
  "product_validation_errors",
  "product_validation_warnings",
  "product_draft_preview",
  "product_draft_created",
  "product_draft_snapshot",
  "product_draft_changes",
  "product_draft_update_preview",
  "product_draft_updated",
  "product_draft_update_failed",
  "product_draft_update_unsupported",
  "product_active_product_unsupported",
  "production_queue_summary",
  "station_comparison",
  "attention_summary",
  "order_due_summary",
  "completed_job_summary",
  "urgent_job_list",
  "customer_resolution",
  "customer_product_sales",
  "uninvoiced_order_summary",
  "revenue_gap_explanation",
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
  /** Bounded, server-produced presentation data for a Product Intake session.
   * It is deliberately never an execution input. */
  details: z.record(z.unknown()).optional(),
  cancellationAvailable: z.boolean().optional(),
}).strict();
/** Stage 2 extends (rather than replaces) the persisted Stage 1 card union. */
export const assistantStructuredCardSchema = z.union([
  assistantStage1StructuredCardSchema,
  assistantStage2StructuredCardSchema,
]);
export type AssistantStructuredCard = z.infer<typeof assistantStructuredCardSchema>;

// Stage 8.2 reporting entity selection is deliberately separate from the
// mutation-plan framework above.  The browser receives a short-lived opaque
// candidate identifier, never a customer primary key or a report plan.
export const assistantReportResolutionStatusValues = [
  "awaiting_entity_resolution",
  "resolved",
  "resuming",
  "resumed",
  "expired",
  "cancelled",
  "failed",
] as const;
export type AssistantReportResolutionStatus = (typeof assistantReportResolutionStatusValues)[number];

export const assistantOpaqueReportCandidateSchema = z.object({
  candidateId: assistantSafeIdentifierSchema,
  companyName: z.string().trim().min(1).max(240),
  companyStatus: z.string().trim().min(1).max(120).nullable().optional(),
  location: z.string().trim().min(1).max(240).nullable().optional(),
  matchReason: z.string().trim().min(1).max(500),
  relatedContactNames: z.array(z.string().trim().min(1).max(240)).max(10).default([]),
  companyLink: assistantSourceLinkSchema,
}).strict();
export type AssistantOpaqueReportCandidate = z.infer<typeof assistantOpaqueReportCandidateSchema>;

export const assistantPendingReportResolutionSchema = z.object({
  resolutionId: assistantSafeIdentifierSchema,
  conversationId: assistantSafeIdentifierSchema,
  version: z.number().int().positive(),
  status: z.enum(assistantReportResolutionStatusValues),
  expiresAt: assistantIsoDateTimeSchema,
  candidates: z.array(assistantOpaqueReportCandidateSchema).min(2).max(10),
  cancellationAvailable: z.boolean(),
}).strict();
export type AssistantPendingReportResolution = z.infer<typeof assistantPendingReportResolutionSchema>;

export const assistantCustomerResolutionSelectionCardSchema = z.object({
  kind: z.literal("customer_resolution"),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2_000),
  resolution: assistantPendingReportResolutionSchema,
  sourceLinks: z.array(assistantSourceLinkSchema).max(10).default([]),
}).strict();
export type AssistantCustomerResolutionSelectionCard = z.infer<typeof assistantCustomerResolutionSelectionCardSchema>;

export const assistantReportResolutionSelectionRequestSchema = z.object({
  candidateId: assistantSafeIdentifierSchema,
  expectedVersion: z.number().int().positive(),
}).strict();
export type AssistantReportResolutionSelectionRequest = z.infer<typeof assistantReportResolutionSelectionRequestSchema>;

export const assistantReportResolutionCancelRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();
export type AssistantReportResolutionCancelRequest = z.infer<typeof assistantReportResolutionCancelRequestSchema>;


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

export const ASSISTANT_MESSAGE_MAX_CONTENT_CHARS = 32_000;

export const assistantMessageSchema = z.object({
  id: assistantSafeIdentifierSchema,
  role: z.enum(assistantMessageRoleValues),
  content: z.string().max(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS),
  /** Server-derived rendering intent; this is metadata, not a visible card. */
  presentation: z.enum(assistantResponsePresentationValues).optional(),
  /** Server-derived interaction state; never infer this from card titles. */
  responseState: assistantResponseStateSchema.optional(),
  structuredCards: z.array(assistantStructuredCardSchema).max(20).default([]),
  provider: z.string().trim().min(1).max(80).nullable(),
  model: z.string().trim().min(1).max(160).nullable(),
  correlationId: assistantSafeIdentifierSchema.nullable(),
  createdAt: assistantIsoDateTimeSchema,
}).strict();
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantReportResolutionContinuationResultSchema = z.object({
  resolutionId: assistantSafeIdentifierSchema,
  version: z.number().int().positive(),
  status: z.literal("resumed"),
  turnId: assistantSafeIdentifierSchema,
  correlationId: assistantSafeIdentifierSchema,
  message: assistantMessageSchema,
}).strict();
export type AssistantReportResolutionContinuationResult = z.infer<typeof assistantReportResolutionContinuationResultSchema>;

export const assistantReportResolutionSelectionResponseSchema = z.object({
  resolution: assistantPendingReportResolutionSchema,
  continuation: assistantReportResolutionContinuationResultSchema.optional(),
}).strict();
export type AssistantReportResolutionSelectionResponse = z.infer<typeof assistantReportResolutionSelectionResponseSchema>;

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

export const assistantConversationTitleSchema = z.string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), "Conversation title contains control characters")
  .refine((value) => !/[<>]/.test(value), "Conversation title cannot contain markup delimiters");

export const assistantUpdateConversationRequestSchema = z.object({
  title: assistantConversationTitleSchema.optional(),
  status: z.enum(assistantConversationStatusValues).optional(),
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
  productInactiveDraft: z.object({
    intakeSessionId: assistantSafeIdentifierSchema,
    proposalFingerprint: z.string().trim().length(64).regex(/^[a-f0-9]+$/i),
    productName: z.string().trim().min(1).max(255),
    sourceLink: assistantSourceLinkSchema,
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(50),
    unchanged: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
    proposedFields: z.object({
      category: z.string().trim().min(1).max(160).nullable(),
      measurementMode: z.string().trim().min(1).max(120),
      requiresDimensions: z.boolean(),
      fixedDimensions: z.string().trim().min(1).max(120).nullable(),
      pricingModel: z.string().trim().min(1).max(120),
      perSqftCents: z.number().int().nonnegative().nullable(),
      perPieceCents: z.number().int().nonnegative().nullable(),
      minimumChargeCents: z.number().int().nonnegative().nullable(),
      material: z.string().trim().min(1).max(255).nullable(),
      productionRoute: z.string().trim().min(1).max(120).nullable(),
      sheetOrRollConstraints: z.string().trim().min(1).max(160).nullable(),
      allowRotation: z.boolean().nullable(),
      quantityBehavior: z.string().trim().min(1).max(120),
      workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]).nullable(),
      requiresProductionJob: z.boolean().nullable(),
      taxable: z.literal(true),
      commonOptions: z.array(z.string().trim().min(1).max(160)).max(12),
      status: z.literal("inactive_draft"),
    }).strict(),
  }).strict().optional(),
  productInactiveDraftUpdate: z.object({
    productId: assistantSafeIdentifierSchema,
    productName: z.string().trim().min(1).max(255),
    draftStatus: z.literal("Inactive PBV2 DRAFT"),
    sessionId: assistantSafeIdentifierSchema,
    editorLink: z.string().trim().startsWith("/"),
    changes: z.array(z.object({ field: z.string().trim().min(1).max(160), before: z.union([z.string(), z.number(), z.boolean(), z.null()]), after: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict()).min(1).max(30),
    readinessBefore: z.string().trim().min(1).max(120),
    expectedReadinessAfter: z.string().trim().min(1).max(120),
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(50),
    validationErrors: z.array(z.string().trim().min(1).max(1_000)).max(50),
    unchanged: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  }).strict().optional(),
  /** Versioned, fail-closed UI payload for configurable inactive PBV2 drafts. */
  configurableProduct: z.unknown().optional(),
  cloneInactiveDraft: z.unknown().optional(),
  inactivePbv2MatrixEdit: z.unknown().optional(),
  inactivePbv2TierEdit: z.unknown().optional(),
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
  "report_resolution_not_found",
  "report_resolution_expired",
  "report_resolution_cancelled",
  "report_resolution_stale",
  "report_resolution_invalid_candidate",
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
