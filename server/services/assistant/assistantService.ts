import {
  assistantToolNameValues,
  type AssistantContextEnvelope,
  type AssistantCreateConversationRequest,
  type AssistantResponsePresentation,
  type AssistantResponseState,
  type AssistantStructuredCard,
  type AssistantBulkArchiveConversationsRequest,
  type AssistantUpdateConversationRequest,
  type AssistantTurnRequest,
  type AssistantReportResolutionSelectionRequest,
  type AssistantReportResolutionCancelRequest,
} from "@shared/assistantContracts";
import { formatAssistantDisplayValue } from "@shared/assistantDisplay";
import { assistantReportResolutionCancelRequestSchema, assistantReportResolutionSelectionRequestSchema, assistantTurnRequestSchema } from "@shared/assistantContracts";
import { AssistantOrchestrationService, type AssistantToolExecutionAudit } from "./orchestration";
import { ConfiguredAssistantPlanner, type AssistantPlanner } from "./providerPlanning";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import { AssistantOperatorRuntime, parseAssistantOperatorDecisionText, type AssistantOperatorBusinessContext, type AssistantOperatorDecisionProvider, type AssistantOperatorObservation, type AssistantOperatorTrustedObservation } from "./operatorRuntime";
import { ConfiguredAssistantOperatorDecisionProvider } from "./operatorDecisionProvider";
import { runOperatorAnalysis } from "./operatorAnalysisWorkspace";
import { createAssistantOperatorToolExecutor, type AssistantOperatorSemanticTool } from "./operatorToolExecutor";
import type { AssistantOperatorToolExecutor } from "./operatorRuntime";
import { DrizzleAssistantOperatorTaskStore, type AssistantOperatorTaskStore } from "./operatorTaskContext";
import { createQuoteInternalNoteCompositeSemanticTool } from "./execution/quoteInternalNoteCompositeTool";
import { createPublicWebResearchTools, isPublicWebResearchConfigured } from "./publicWebResearch";
import { OpenAiCompatibleBugReviewProvider } from "../ai/providers/configuredProvider";
import { aiProviderResolver } from "../ai/aiProviderResolver";
import { resolveAiProviderCapabilities } from "../ai/providers/providerCapabilities";
import { productManagementSkillService, type ActiveSemanticProductDraftContext } from "./productManagementSkill";
import { ExistingProductEditError, existingProductEditOperationsSchema, existingProductEditService, type TrustedExistingProductEditContext } from "./existingProductEditService";
import { existingProductEditProviderInputSchema, existingProductEditValidationDetails } from "./existingProductEditContract";
import { currentTurnProductResolution, existingProductIdForMutation, isProductResolutionObservation } from "./trustedProductState";
import { quoteDraftIntakeService } from "./quoteDraftIntakeService";
import { orderIntakeService } from "./orderIntakeService";
import { crmManagementService } from "./crmManagementService";
import { productionOperationsService } from "./productionOperationsService";
import { fulfillmentOperationsService } from "./fulfillmentOperationsService";
import { billingInvoiceOperationsService } from "./billingInvoiceOperationsService";
import { paymentOperationsService } from "./paymentOperationsService";
import { persistAiDiagnostic } from "../aiDiagnosticsService";
import {
  getAssistantCapabilityProjection,
} from "./assistantCapabilities";
import { AnalyticalCustomerResolutionService, type PersistedAnalyticalResolution } from "./analyticalCustomerResolution";
import { resolveSystemGuideAnswer } from "./systemGuide";
import {
  getAssistantCapability,
  type AssistantIntentPlan,
} from "./assistantIntentPlanner";
import {
  ConfiguredAssistantIntentPlannerProvider,
  type AssistantIntentPlannerProvider,
} from "./intentPlannerProvider";

type AssistantResultCard = Extract<AssistantStructuredCard, { summary: string }>;

export const ASSISTANT_UNAVAILABLE_REPLY = "I can't answer that until a compatible AI provider is configured.";

export class AssistantServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface AssistantActor {
  userId: string;
  email: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  permissions?: readonly string[];
}

export interface AssistantScope {
  organizationId: string;
  userId: string;
}

export interface AssistantConversationRecord {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  status: "active" | "archived";
  lastMessagePreview?: string | null;
  lastActivityAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface AssistantMessageRecord {
  id: string;
  conversationId: string;
  turnId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  presentation?: AssistantResponsePresentation;
  structuredCards?: unknown[];
  provider?: string | null;
  model?: string | null;
  correlationId?: string | null;
  createdAt: Date | string;
}

export interface AssistantConversationDetailRecord extends AssistantConversationRecord {
  messages: AssistantMessageRecord[];
}

export interface AssistantTurnResult {
  turnId: string;
  correlationId: string;
  status: "responded" | "failed";
  conversation: AssistantConversationDetailRecord;
  userMessage: AssistantMessageRecord;
  assistantMessage: AssistantMessageRecord;
}

export interface AssistantRepository {
  listConversations(scope: AssistantScope, status?: "active" | "archived"): Promise<AssistantConversationRecord[]>;
  createConversation(input: AssistantScope & { title?: string | null }): Promise<AssistantConversationRecord>;
  getConversation(scope: AssistantScope & { conversationId: string }): Promise<AssistantConversationDetailRecord | null>;
  updateConversation(input: AssistantScope & { conversationId: string; patch: AssistantUpdateConversationRequest }): Promise<AssistantConversationRecord | null>;
  archiveConversations(input: AssistantScope & { conversationIds: string[] }): Promise<AssistantConversationRecord[]>;
  /** Replaces the canonical Product Intent cards on the assistant turn that
   * already owns this proposal. This keeps interaction revisions bound to a
   * persisted turn instead of trusting a browser-created action envelope. */
  replaceCanonicalProductIntentCards?(input: AssistantScope & {
    conversationId: string;
    proposalId: string;
    cards: AssistantStructuredCard[];
  }): Promise<AssistantMessageRecord | null>;
  createFoundationTurn(input: AssistantScope & {
    conversationId: string;
    actor: AssistantActor;
    message: string;
    context: AssistantContextEnvelope;
    clientRequestId?: string;
    response: string;
    correlationId: string;
    status?: "responded" | "failed";
    structuredCards?: AssistantStructuredCard[];
    presentation?: AssistantResponsePresentation;
    /** A deterministic title applied only by the repository to an untouched
     * fallback conversation. User-provided titles always remain authoritative. */
    initialTitle?: string;
    provider?: string | null;
    model?: string | null;
    mode?: string;
    promptVersion?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    toolExecutions?: Array<{
      toolName: string; toolVersion: string; status: "succeeded" | "failed" | "disabled";
      errorCode?: string; auditStatus: string; durationMs: number;
      failureCategory?: string; failingStep?: string; coreResultSucceeded?: boolean;
    }>;
  }): Promise<AssistantTurnResult | null>;
  /** A continuation writes only the resumed assistant output. It must not add
   * another user message, and its implementation owns the atomic resolution
   * transition/result reference with that assistant message. */
  createReportResolutionContinuation?(input: AssistantScope & {
    resolutionId: string;
    actor: AssistantActor;
    plan: unknown;
    context: AssistantContextEnvelope;
    response: string;
    structuredCards: AssistantStructuredCard[];
    correlationId: string;
    provider: string | null;
    model: string | null;
    toolExecutions: Array<{
      toolName: string; toolVersion: string; status: "succeeded" | "failed" | "disabled";
      errorCode?: string; auditStatus: string; durationMs: number;
      failureCategory?: string; failingStep?: string; coreResultSucceeded?: boolean;
    }>;
  }): Promise<AssistantTurnResult | null>;
}

export interface AssistantCapabilityResolver {
  getCapabilities(organizationId: string): Promise<{ enabled: boolean; toolsEnabled?: boolean; providerConfigured?: boolean; externalResearchEnabled?: boolean; unavailableReason?: string | null }>;
}

type AssistantCapabilitySummary = Awaited<ReturnType<AssistantService["getCapabilities"]>>;

function hasPermission(actor: AssistantActor | undefined, permission: string): boolean {
  return Boolean(actor?.permissions?.includes(permission));
}

/** A named request that also states one or more concrete Product Builder
 * facts must enter the canonical flow with those facts.  This is a narrow
 * creation guard, not a prose-to-patch parser: the provider still supplies
 * the schema-validated business operations. */
function newProductRequestRequiresInitialOperations(message: string): boolean {
  const hasExplicitName = /\b(?:named|called)\s+(?:["“][^"”]{1,160}["”]|[^.!?]{1,160})/i.test(message);
  const hasProductDetail = /\b(?:requires?\s+dimensions|per[-\s]?square[-\s]?foot|per[-\s]?piece|option|default|pricing|price|category)\b/i.test(message);
  return hasExplicitName && hasProductDetail;
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function titleFromMessage(message: string): string {
  const normalized = message
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[`*_#<>\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  if (!normalized) return "New chat";

  if (/^(?:summari[sz]e|give me (?:a )?(?:summary|overview)|tell me about|what is) (?:this|the current) order\b/i.test(normalized)) {
    return "Current Order Summary";
  }
  const orderLookup = /^(?:find|show|look up|lookup|get)\s+(?:order\s+)?(?:ord[\s-]*)?(\d{1,12})\b/i.exec(normalized);
  if (orderLookup) return `Find Order ORD-${orderLookup[1]}`;
  if (/\b(?:create|start|set up|setup)\b.*\bproduct\b/i.test(normalized)) return "Product Draft Setup";
  const namedLookup = /^(?:find|show|look up|lookup|get)\s+(?:customer|product)\s+(.+)$/i.exec(normalized);
  if (namedLookup?.[1]) return `${namedLookup[1].replace(/[.!?]+$/, "").slice(0, 72)} Lookup`;
  return normalized.slice(0, 96);
}

/** Conversation cards are presentation-only, but their server-created intake
 * session reference lets a later plain-language reply continue the canonical
 * Product Intake state rather than reconstructing a product from chat text. */
function activeProductIntakeSession(messages: AssistantMessageRecord[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    for (const card of [...(message.structuredCards ?? [])].reverse()) {
      const candidate = card as { kind?: unknown; details?: { sessionId?: unknown; proposalId?: unknown }; plan?: { action?: unknown; intakeSessionId?: unknown } };
      if (candidate.kind === "canonical_product_intent_proposal" && typeof candidate.details?.proposalId === "string") return candidate.details.proposalId;
      if (candidate.kind === "action_proposal" && candidate.plan?.action === "products.create_inactive_draft" && typeof candidate.plan.intakeSessionId === "string") return candidate.plan.intakeSessionId;
      if (candidate.kind === "action_proposal" && candidate.plan?.action === "products.update_inactive_draft" && typeof candidate.plan.intakeSessionId === "string") return candidate.plan.intakeSessionId;
      if (candidate.kind === "product_intake_summary" && typeof candidate.details?.sessionId === "string") return candidate.details.sessionId;
    }
  }
  return null;
}

/** Persist only reduced, server-validated entity references. These are a
 * continuity aid for a later conversational turn, never a source of tenant
 * scope or authorization. */
function mergeOperatorEntityReferences(
  existing: Array<{ type: string; id: string; label?: string }>,
  observations: readonly AssistantOperatorObservation[],
): Array<{ type: string; id: string; label?: string }> {
  const references = new Map<string, { type: string; id: string; label?: string }>();
  const add = (type: unknown, id: unknown, label?: unknown) => {
    if (typeof type !== "string" || !/^(?:quote|customer|order|product|invoice)$/.test(type)) return;
    if (typeof id !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)) return;
    references.set(`${type}:${id}`, { type, id, ...(typeof label === "string" && label.trim() ? { label: label.trim().slice(0, 240) } : {}) });
  };
  const currentProduct = currentTurnProductResolution(observations);
  for (const reference of existing) if (!(currentProduct.attempted && reference.type === "product")) add(reference.type, reference.id, reference.label);
  for (const observation of observations) {
    for (const link of observation.result?.provenance?.sourceLinks ?? []) {
      add(link.entityType, link.entityId, link.label);
    }
    // quotes.search has a strict shared result schema. Reading its reduced
    // rows here retains every returned reference even when provenance is
    // intentionally capped at ten source links.
    if (observation.toolName !== "quotes.search" || !observation.result?.data || typeof observation.result.data !== "object") continue;
    const rows = (observation.result.data as { quotes?: unknown }).quotes;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const quote = row as { quoteId?: unknown; quoteNumber?: unknown; customer?: { id?: unknown; name?: unknown }; relatedOrderId?: unknown };
      add("quote", quote.quoteId, typeof quote.quoteNumber === "string" ? `Quote ${quote.quoteNumber}` : undefined);
      add("customer", quote.customer?.id, quote.customer?.name);
      add("order", quote.relatedOrderId);
    }
  }
  if (currentProduct.productId && !references.has(`product:${currentProduct.productId}`)) add("product", currentProduct.productId);
  return Array.from(references.values()).slice(-25);
}

const registeredReadToolNames = new Set<string>([...assistantToolNameValues, "analysis.run", "web.search", "web.open"]);
const trustedObservationStorageKey = "trustedReadObservations";
const MAX_TRUSTED_OPERATOR_OBSERVATIONS = 5;
const MAX_TRUSTED_OPERATOR_OBSERVATION_BYTES = 16_000;
const recentOperationStorageKey = "recentOperatorOperations";
const MAX_RECENT_OPERATOR_OPERATIONS = 12;
const completedTurnStorageKey = "recentCompletedOperatorTurn";
const MAX_RETAINED_COMPLETED_TURN_CHARS = 6_000;

/** The only Product planning structure exposed to an Operator function call.
 * It deliberately contains business labels and values, never patch paths,
 * IDs, revisions, fingerprints, serverOwnedFields, or PBV2 state. The
 * Canonical Capability Registry and shared operation schemas remain capability
 * and business-validity authority. */
const semanticProductOperationsToolInputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["operations"],
  properties: {
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "value"], properties: { op: { const: "set_option_default" }, optionGroup: { type: "string" }, value: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "category"], properties: { op: { const: "set_category" }, category: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "material"], properties: { op: { const: "set_material" }, material: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op"], properties: { op: { const: "clear_material" } } },
          { type: "object", additionalProperties: false, required: ["op", "mode"], properties: { op: { const: "set_measurement_mode" }, mode: { enum: ["dimensions_required", "quantity_only"] } } },
          { type: "object", additionalProperties: false, required: ["op", "basis"], properties: { op: { const: "set_pricing_basis" }, basis: { enum: ["per_piece", "per_square_foot"] } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "required", "selectionMode"], properties: { op: { const: "add_option_group" }, optionGroup: { type: "string" }, required: { type: "boolean" }, selectionMode: { enum: ["single", "multiple"] } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "name"], properties: { op: { const: "rename_option_group" }, optionGroup: { type: "string" }, name: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "value"], properties: { op: { const: "add_option_value" }, optionGroup: { type: "string" }, value: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "label", "multiline", "required"], properties: { op: { const: "add_text_input" }, optionGroup: { type: "string" }, label: { type: "string" }, multiline: { type: "boolean" }, required: { type: "boolean" }, whenOptionGroup: { type: "string" }, whenValue: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "value", "priceCents"], properties: { op: { const: "set_option_rate" }, optionGroup: { type: "string" }, value: { type: "string" }, priceCents: { type: "integer", minimum: 0 }, basis: { enum: ["per_piece", "per_square_foot"] } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "basis", "rows"], properties: { op: { const: "set_option_quantity_tiers" }, optionGroup: { type: "string" }, basis: { enum: ["per_piece", "per_square_foot"] }, rows: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["value", "tiers"], properties: { value: { type: "string" }, tiers: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["minimumQuantity", "priceCents"], properties: { minimumQuantity: { type: "integer", minimum: 1 }, priceCents: { type: "integer", minimum: 0 } } } } } } } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "value", "percent"], properties: { op: { const: "set_option_price_impact" }, optionGroup: { type: "string" }, value: { type: "string" }, percent: { type: "number", minimum: -100, maximum: 100 }, replacesPercentageWhen: { type: "object", additionalProperties: false, required: ["optionGroup", "value"], properties: { optionGroup: { type: "string" }, value: { type: "string" } } } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "whenOptionGroup", "whenValue"], properties: { op: { const: "set_option_group_availability" }, optionGroup: { type: "string" }, whenOptionGroup: { type: "string" }, whenValue: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup", "value"], properties: { op: { const: "remove_option_value" }, optionGroup: { type: "string" }, value: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "optionGroup"], properties: { op: { const: "remove_option_group" }, optionGroup: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "name"], properties: { op: { const: "set_product_name" }, name: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "description"], properties: { op: { const: "set_product_description" }, description: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["op", "priceCents", "basis"], properties: { op: { const: "set_scalar_price" }, priceCents: { type: "integer", minimum: 0 }, basis: { enum: ["per_piece", "per_square_foot"] } } },
          { type: "object", additionalProperties: false, required: ["op", "detail"], properties: { op: { const: "record_unsupported_detail" }, detail: { enum: ["customer_specific_availability", "grommet_quantity"] } } },
          { type: "object", additionalProperties: false, required: ["op", "requiresProofApproval"], properties: { op: { const: "set_proof_requirement" }, requiresProofApproval: { type: "boolean" } } },
        ],
      },
    },
  },
};
/** The initial-create capability deliberately reuses the exact operation-array
 * schema published by products.apply_operations. */
const beginProductDraftToolInputSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false,
  properties: { target: { enum: ["new_product"] }, initialOperations: (semanticProductOperationsToolInputSchema.properties as Record<string, unknown>).operations },
};

/** Read-only draft pricing accepts business labels only. A single bounded
 * batch keeps ordinary multi-scenario questions inside one Operator call. */
const draftPricingPreviewToolInputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios"],
  properties: {
    scenarios: {
      type: "array", minItems: 1, maxItems: 12,
      items: {
        type: "object", additionalProperties: false, required: ["squareFeet"],
        properties: {
          squareFeet: { type: "number", exclusiveMinimum: 0 },
          quantity: { type: "integer", minimum: 1 },
          selections: {
            type: "array", maxItems: 12,
            items: {
              type: "object", additionalProperties: false, required: ["optionGroup", "value"],
              properties: { optionGroup: { type: "string", minLength: 1, maxLength: 160 }, value: { type: "string", minLength: 1, maxLength: 160 } },
            },
          },
        },
      },
    },
  },
};

type DraftPricingScenario = { squareFeet: number; quantity?: number; selections?: Array<{ optionGroup: string; value: string }> };

function parseDraftPricingScenarios(value: unknown): DraftPricingScenario[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const scenarios: DraftPricingScenario[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const scenario = item as Record<string, unknown>;
    if (typeof scenario.squareFeet !== "number" || !Number.isFinite(scenario.squareFeet) || scenario.squareFeet <= 0) return null;
    if (scenario.quantity !== undefined && (typeof scenario.quantity !== "number" || !Number.isInteger(scenario.quantity) || scenario.quantity <= 0)) return null;
    if (scenario.selections !== undefined && (!Array.isArray(scenario.selections) || scenario.selections.length > 12 || !scenario.selections.every((selection) => selection && typeof selection === "object" && !Array.isArray(selection) && typeof (selection as Record<string, unknown>).optionGroup === "string" && typeof (selection as Record<string, unknown>).value === "string"))) return null;
    scenarios.push({ squareFeet: scenario.squareFeet, ...(typeof scenario.quantity === "number" ? { quantity: scenario.quantity } : {}), ...(Array.isArray(scenario.selections) ? { selections: scenario.selections as Array<{ optionGroup: string; value: string }> } : {}) });
  }
  return scenarios;
}

/** Financial reads require authorization at every retrieval. Never retain an
 * analytics observation for a later direct-answer turn, because a user's role
 * may have changed since the original read. */
function mayPersistTrustedObservation(toolName: string): boolean {
  return !toolName.startsWith("analytics.");
}

function persistedTrustedObservations(semanticChanges: Record<string, unknown>): AssistantOperatorTrustedObservation[] {
  const candidate = semanticChanges[trustedObservationStorageKey];
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    return typeof value.toolName === "string" && mayPersistTrustedObservation(value.toolName) && typeof value.capturedAt === "string" && "data" in value
      ? [{ toolName: value.toolName, data: value.data, capturedAt: value.capturedAt }]
      : [];
  }).slice(-MAX_TRUSTED_OPERATOR_OBSERVATIONS);
}

function persistedRecentOperatorOperations(semanticChanges: Record<string, unknown>): string[] {
  const candidate = semanticChanges[recentOperationStorageKey];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 160).slice(-MAX_RECENT_OPERATOR_OPERATIONS)
    : [];
}

type RetainedCompletedOperatorTurn = {
  goal: string;
  response: string;
  workingSummary: string | null;
  capturedAt: string;
};

function retainedCompletedOperatorTurn(semanticChanges: Record<string, unknown>): RetainedCompletedOperatorTurn | null {
  const candidate = semanticChanges[completedTurnStorageKey];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const value = candidate as Record<string, unknown>;
  if (typeof value.goal !== "string" || typeof value.response !== "string" || typeof value.capturedAt !== "string") return null;
  if (!value.goal.trim() || !value.response.trim() || value.goal.length > MAX_RETAINED_COMPLETED_TURN_CHARS || value.response.length > MAX_RETAINED_COMPLETED_TURN_CHARS) return null;
  return {
    goal: value.goal,
    response: value.response,
    workingSummary: typeof value.workingSummary === "string" && value.workingSummary.trim() ? value.workingSummary : null,
    capturedAt: value.capturedAt,
  };
}

function completedOperatorTurn(input: { goal: string; response: string; workingSummary: string | null }): RetainedCompletedOperatorTurn | null {
  const goal = input.goal.trim().slice(0, MAX_RETAINED_COMPLETED_TURN_CHARS);
  const response = input.response.trim().slice(0, MAX_RETAINED_COMPLETED_TURN_CHARS);
  if (!goal || !response) return null;
  return {
    goal,
    response,
    workingSummary: input.workingSummary?.trim().slice(0, 2_000) || null,
    capturedAt: new Date().toISOString(),
  };
}

function operatorBusinessContext(input: {
  domain: string | null;
  workingSummary: string | null;
  missingInformation: string[];
  semanticChanges: Record<string, unknown>;
  activeSemanticProductDraft: ActiveSemanticProductDraftContext | null;
  canBeginProductDraft: boolean;
  canApplyProductOperations: boolean;
  existingProduct: TrustedExistingProductEditContext | null;
  canEditExistingProduct: boolean;
}): AssistantOperatorBusinessContext {
  const product = input.activeSemanticProductDraft;
  const unresolvedDecisions = product
    ? product.outstandingDecisions.map((decision) => ({ item: decision.path, question: decision.question, choices: decision.choices }))
    : input.missingInformation.map((item) => ({ item }));
  return {
    taskType: input.existingProduct ? "existing_product" : product ? "product_draft" : input.domain ?? "general_assistance",
    businessStateSummary: product
      ? `Product draft \"${product.name}\" is ${product.readyForReview ? "ready for review" : "still collecting business decisions"}.`
      : input.existingProduct ? `Existing persisted product \"${input.existingProduct.name}\" is ${input.existingProduct.lifecycle}; its current pricing configuration is PBV2 ${input.existingProduct.pricingLifecycle}.`
        : input.workingSummary,
    // A fresh tenant-scoped Product read is authoritative. Older prose may
    // describe a proposal that never reached GO, so it must not compete with
    // persisted lifecycle/configuration facts on existing-Product turns.
    recentCompletedTurn: input.existingProduct ? null : retainedCompletedOperatorTurn(input.semanticChanges),
    unresolvedDecisions,
    recentOperations: product?.recentBusinessOperations ?? persistedRecentOperatorOperations(input.semanticChanges).filter((operation) => operation !== "products.apply_existing_operations"),
    trustedSelections: product?.trustedSelections ?? [],
    readiness: product ? (product.readyForReview ? "ready" : product.outstandingDecisions.length ? "needs_input" : "in_progress") : unresolvedDecisions.length ? "needs_input" : "unknown",
    constraints: input.existingProduct
      ? ["This is an existing persisted product, not a new Product Builder draft.", "Use products.apply_existing_operations for a requested edit; it creates a protected preview and requires GO.", "Use products.begin_draft only when the user intends to create a new product, including a new product based on this one."]
      : product
      ? ["Use only products.apply_operations for a draft edit.", "Do not regenerate the product or expose canonical persistence data.", "Product creation remains review/GO-gated."]
      : ["Use registered, permission-aware tools only.", "Trusted observations are not authorization or freshness authority."],
    capabilities: [
      ...(input.canBeginProductDraft ? ["products.begin_draft"] : []),
      ...(input.canApplyProductOperations ? ["products.apply_operations"] : []),
      ...(input.canApplyProductOperations ? ["products.preview_draft_pricing"] : []),
      ...(input.canEditExistingProduct && input.existingProduct ? ["products.apply_existing_operations"] : []),
    ],
    existingProduct: input.existingProduct,
  };
}

/** Persist only validated static read results. Semantic planning output and
 * presentation/action cards are intentionally excluded. */
function mergeTrustedOperatorObservations(
  semanticChanges: Record<string, unknown>,
  observations: readonly AssistantOperatorObservation[],
  recentCompletedTurn: RetainedCompletedOperatorTurn | null,
  clearCompletedTurn = false,
): Record<string, unknown> {
  const hasCurrentProductEvidence = observations.some(isProductResolutionObservation);
  const retained = persistedTrustedObservations(semanticChanges).filter((item) => !hasCurrentProductEvidence || (item.toolName !== "products.get_summary" && item.toolName !== "products.get_pricing" && item.toolName !== "search.global"));
  const additions = observations.flatMap((observation) => {
    if (!registeredReadToolNames.has(observation.toolName) || !mayPersistTrustedObservation(observation.toolName) || observation.status !== "succeeded" || !observation.result?.provenance) return [];
    try {
      const data = JSON.parse(JSON.stringify(observation.result.data));
      if (JSON.stringify(data).length > MAX_TRUSTED_OPERATOR_OBSERVATION_BYTES) return [];
      return [{ toolName: observation.toolName, data, capturedAt: observation.result.provenance.freshness.capturedAt }];
    } catch {
      return [];
    }
  });
  const recent = [...persistedRecentOperatorOperations(semanticChanges), ...observations
    .filter((observation) => observation.status === "succeeded" || observation.status === "partial")
    .filter((observation) => observation.toolName !== "products.apply_existing_operations")
    .map((observation) => observation.toolName)]
    .slice(-MAX_RECENT_OPERATOR_OPERATIONS);
  return {
    ...semanticChanges,
    [trustedObservationStorageKey]: [...retained, ...additions].slice(-MAX_TRUSTED_OPERATOR_OBSERVATIONS),
    [recentOperationStorageKey]: recent,
    ...(recentCompletedTurn ? { [completedTurnStorageKey]: recentCompletedTurn } : clearCompletedTurn ? { [completedTurnStorageKey]: null } : {}),
  };
}

function operatorFailureKind(response: string): string {
  if (/provider did not return (?:a )?usable investigation result/i.test(response)) return "provider_result_unusable";
  if (/provider returned an unusable investigation result/i.test(response)) return "provider_operator_result_invalid";
  if (/provider did not finish.*timed out/i.test(response)) return "provider_timeout";
  if (/could not complete.*Operator could not complete its investigation/i.test(response)) return "operator_decision_unavailable";
  if (/within the configured safety limit/i.test(response)) return "operator_step_limit";
  return "operator_failed";
}

export class AssistantService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly capabilities: AssistantCapabilityResolver,
    private readonly planner: AssistantPlanner = new ConfiguredAssistantPlanner(new OpenAiCompatibleBugReviewProvider()),
    private readonly createOrchestrator: (audit: (event: AssistantToolExecutionAudit) => void) => AssistantOrchestrationService =
      (audit) => new AssistantOrchestrationService(createStage2AssistantToolAdapters(), audit),
    /** Installed by the Stage 8.2 composition root once the durable resolution
     * repository is available. Optional during migration rollout so normal
     * assistant turns do not depend on an unfinished table. */
    private readonly reportResolutionService?: AnalyticalCustomerResolutionService,
    /** This planner owns free-text interpretation. Structured UI routes do not
     * enter createTurn and therefore remain server-bound direct actions. */
    private readonly intentPlanner: AssistantIntentPlannerProvider = new ConfiguredAssistantIntentPlannerProvider(new OpenAiCompatibleBugReviewProvider()),
    /** Injectable only for composition and isolated routing tests; production
     * always uses the canonical compiler-backed singleton. */
    private readonly productIntentDispatcher: Pick<typeof productManagementSkillService, "respondPlannedCanonicalProductIntent" | "applyCanonicalProductOperations" | "beginCanonicalProductDraft"> & Partial<Pick<typeof productManagementSkillService, "getActiveSemanticProductDraftContext" | "previewActiveSemanticProductDraftPricing">> = productManagementSkillService,
    /** Ordinary free text always enters this provider/runtime path. Tests can
     * supply deterministic decisions without initializing a real provider. */
    private readonly operatorDecisionProvider: (organizationId: string) => AssistantOperatorDecisionProvider =
      (organizationId) => new ConfiguredAssistantOperatorDecisionProvider(organizationId, new OpenAiCompatibleBugReviewProvider()),
    private readonly operatorTasks: AssistantOperatorTaskStore = new DrizzleAssistantOperatorTaskStore(),
    /** Composite semantic tools are separately injectable so the free-text
     * integration path can be tested without a database. */
    private readonly operatorCompositeTool: () => AssistantOperatorSemanticTool = () => createQuoteInternalNoteCompositeSemanticTool(),
    /** Injectable only for end-to-end operator-path tests. Production always
     * uses the static read registry plus reviewed semantic tools. */
    private readonly createOperatorToolExecutor: (audit: (event: AssistantToolExecutionAudit) => void, semanticTools: readonly AssistantOperatorSemanticTool[]) => AssistantOperatorToolExecutor =
      (audit, semanticTools) => createAssistantOperatorToolExecutor(audit, semanticTools),
    /** Injectable for isolated runtime tests; production resolves the same
     * organization-scoped configuration at the Operator boundary. */
    private readonly operatorProviderResolver: Pick<typeof aiProviderResolver, "resolveProvider"> = aiProviderResolver,
  ) {}

  async getCapabilities(scope: AssistantScope, actor?: AssistantActor) {
    const resolved = await this.capabilities.getCapabilities(scope.organizationId);
    const providerConfigured = Boolean(resolved.enabled && (resolved.providerConfigured ?? resolved.toolsEnabled));
    const readToolsEnabled = Boolean(resolved.enabled && resolved.toolsEnabled);
    const writeFrameworkEnabled = readToolsEnabled;
    const projection = writeFrameworkEnabled ? await getAssistantCapabilityProjection() : null;
    const productionCommandsEnabled = projection ? [...projection.productionCommands] : [];
    const productionCommandsPermittedForUser = productionCommandsEnabled.filter((command) =>
      hasPermission(actor, projection!.commandPermissions[command]),
    );
    const writeActionsEnabled = productionCommandsPermittedForUser.length > 0;
    return {
      enabled: resolved.enabled,
      conversationsEnabled: resolved.enabled,
      toolsEnabled: readToolsEnabled,
      providerConfigured,
      readToolsEnabled,
      registeredReadTools: projection ? [...projection.readTools] : [],
      writeFrameworkEnabled,
      writeActionsEnabled,
      productionCommandsEnabled,
      productionCommandsPermittedForUser,
      externalResearchEnabled: Boolean(resolved.enabled && resolved.externalResearchEnabled),
      mcpEnabled: false,
      productActivationEnabled: Boolean(writeFrameworkEnabled && hasPermission(actor, "assistant.products.update_existing_product")),
      activeProductEditingEnabled: hasPermission(actor, "assistant.products.update_existing_product"),
      diagnosticsEnabled: hasPermission(actor, "assistant.diagnostics.view"),
      composerHelperText: !readToolsEnabled
        ? "System Guide help is available. " + (resolved.unavailableReason ?? "Business record questions are unavailable until AI configuration is complete.")
        : writeActionsEnabled
          ? `Business lookups and confirmed actions are enabled. Changes require a preview and the dedicated GO button. External research is ${resolved.externalResearchEnabled ? "enabled" : "disabled"}.`
          : resolved.externalResearchEnabled
            ? "Business lookups and external research are enabled. Write actions require additional permission."
            : "Business lookups are enabled. Write actions and external research are disabled.",
      assistantVersion: "stage-9-system-guide",
      unavailableReason: resolved.unavailableReason ?? (resolved.enabled ? null : "The assistant is disabled for this organization."),
      actorScope: scope,
    };
  }

  /** Server-bound continuation for the typed PBV2 option card. The browser
   * supplies canonical identifiers only; this service reloads the scoped
   * intake session and persists the resulting assistant turn. */
  async submitOrderOptionSelections(
    scope: AssistantScope,
    conversationId: string,
    actor: AssistantActor,
    input: { orderIntakeSessionId: string; productId: string; pbv2TreeVersionId: string; selections: Array<{ nodeId: string; valueId: string }>; useRemainingDefaults: boolean; context: AssistantContextEnvelope },
  ) {
    const conversation = await this.repo.getConversation({ ...scope, conversationId });
    if (!conversation) throw this.notFound();
    const rendered = await orderIntakeService.submitOptionSelections({
      organizationId: scope.organizationId,
      userId: actor.userId,
      conversationId: conversation.id,
      orderIntakeSessionId: input.orderIntakeSessionId,
      productId: input.productId,
      pbv2TreeVersionId: input.pbv2TreeVersionId,
      selections: input.selections,
      useRemainingDefaults: input.useRemainingDefaults,
    });
    const correlationId = crypto.randomUUID();
    const result = await this.persistFoundationTurn({
      ...scope,
      conversationId: conversation.id,
      actor,
      message: "Selected order options.",
      context: input.context,
      response: rendered.response,
      correlationId,
      status: "responded",
      structuredCards: rendered.cards as AssistantStructuredCard[],
      provider: "local_order_intake",
      model: "conversational-order-intake-v1",
      mode: "assistant_order_option_continuation",
      promptVersion: "assistant-order-option-continuation-v1",
    });
    if (!result) throw this.notFound();
    return result;
  }

  async listConversations(scope: AssistantScope, status?: "active" | "archived") {
    return this.repo.listConversations(scope, status);
  }

  async createConversation(scope: AssistantScope, data: AssistantCreateConversationRequest) {
    return this.repo.createConversation({ ...scope, title: data.title ?? null });
  }

  async getConversation(scope: AssistantScope, conversationId: string) {
    const conversation = await this.repo.getConversation({ ...scope, conversationId });
    if (!conversation) throw this.notFound();
    return conversation;
  }

  async updateConversation(scope: AssistantScope, conversationId: string, patch: AssistantUpdateConversationRequest) {
    const conversation = await this.repo.updateConversation({ ...scope, conversationId, patch });
    if (!conversation) throw this.notFound();
    return conversation;
  }

  async archiveConversations(scope: AssistantScope, data: AssistantBulkArchiveConversationsRequest) {
    const conversationIds = [...new Set(data.conversationIds)];
    const archived = await this.repo.archiveConversations({ ...scope, conversationIds });
    const archivedIds = archived.map((conversation) => conversation.id);
    return {
      archivedIds,
      unavailableIds: conversationIds.filter((conversationId) => !archivedIds.includes(conversationId)),
    };
  }

  /** Server-only selection continuation. The route supplies only opaque
   * candidateId/version; all company IDs, stored context, and immutable report
   * properties are recovered from the durable resolution state. */
  async selectReportResolution(
    scope: AssistantScope,
    resolutionId: string,
    actor: AssistantActor,
    data: AssistantReportResolutionSelectionRequest,
  ) {
    const selection = assistantReportResolutionSelectionRequestSchema.parse(data);
    if (!this.reportResolutionService || !this.repo.createReportResolutionContinuation) {
      throw new AssistantServiceError("REPORT_RESOLUTION_UNAVAILABLE", "Report selection is temporarily unavailable.", 503);
    }
    const capability = await this.getCapabilities(scope, actor);
    if (!capability.toolsEnabled) {
      throw new AssistantServiceError("ASSISTANT_DISABLED", capability.unavailableReason ?? "The assistant is unavailable.", 503);
    }
    const persisted = await this.reportResolutionService.findSelection({ ...scope, resolutionId });
    if (!persisted) {
      // Do not distinguish another user's/tenant's resolution from an
      // unknown id. The persisted scope provides the conversation internally.
      throw new AssistantServiceError("REPORT_RESOLUTION_NOT_FOUND", "That report selection is no longer available.", 404);
    }
    const continuation = await this.reportResolutionService.continuePersistedPlan({
      ...scope, conversationId: persisted.conversationId,
      resolutionId,
      candidateId: selection.candidateId,
      expectedVersion: selection.expectedVersion,
      execute: async (plan, resolution) => this.executePersistedAnalyticalPlan(scope, resolutionId, actor, plan, resolution),
    });
    if (continuation.kind === "rejected") {
      const status = continuation.code === "not_found" ? 404 : continuation.code === "invalid_candidate" ? 400 : 409;
      throw new AssistantServiceError(`REPORT_RESOLUTION_${continuation.code.toUpperCase()}`, "That report selection is no longer available.", status);
    }
    if (continuation.kind === "failed") {
      throw new AssistantServiceError("REPORT_RESOLUTION_CONTINUATION_FAILED", continuation.message, 409);
    }
    return { result: continuation.result as AssistantTurnResult, replayed: continuation.replayed };
  }

  async cancelReportResolution(
    scope: AssistantScope,
    resolutionId: string,
    _actor: AssistantActor,
    data: AssistantReportResolutionCancelRequest,
  ) {
    const request = assistantReportResolutionCancelRequestSchema.parse(data);
    if (!this.reportResolutionService) throw new AssistantServiceError("REPORT_RESOLUTION_UNAVAILABLE", "Report selection is temporarily unavailable.", 503);
    const cancelled = await this.reportResolutionService.cancelPersistedResolution({ ...scope, resolutionId, expectedVersion: request.expectedVersion });
    if (!cancelled) throw new AssistantServiceError("REPORT_RESOLUTION_NOT_FOUND", "That report selection is no longer available.", 404);
    return { resolutionId, cancelled: true };
  }

  private async executePersistedAnalyticalPlan(
    scope: AssistantScope,
    resolutionId: string,
    actor: AssistantActor,
    plan: unknown,
    resolution: PersistedAnalyticalResolution,
  ): Promise<AssistantTurnResult> {
    const correlationId = crypto.randomUUID();
    const audits: AssistantToolExecutionAudit[] = [];
    const orchestration = this.createOrchestrator((event) => { audits.push(event); });
    const executed = await orchestration.executePlan(plan, {
      scope,
      actor: { userId: actor.userId, email: actor.email },
      permissions: actor.permissions ?? [],
      context: resolution.context,
      correlationId,
    });
    const rendered = renderToolResults(executed.executions);
    const result = await this.repo.createReportResolutionContinuation!({
      ...scope,
      resolutionId,
      actor,
      plan: executed.plan,
      context: resolution.context,
      response: rendered.response,
      structuredCards: rendered.cards,
      correlationId,
      provider: "persisted_analytical_plan",
      model: "stage-8.2-continuation-v1",
      toolExecutions: audits.map((audit) => ({
        toolName: audit.toolName,
        toolVersion: audit.toolVersion,
        status: audit.status === "succeeded" || audit.status === "not_found" || audit.status === "partial" ? "succeeded" : audit.status === "rejected" ? "disabled" : "failed",
        errorCode: audit.failureCode,
        auditStatus: audit.status,
        durationMs: audit.durationMs,
        failureCategory: audit.failureCategory,
        failingStep: audit.failingStep,
        coreResultSucceeded: audit.coreResultSucceeded,
      })),
    });
    if (!result) throw this.notFound();
    return result;
  }

  async createTurn(
    scope: AssistantScope,
    conversationId: string,
    actor: AssistantActor,
    data: AssistantTurnRequest,
  ) {
    // Routes validate this too; retain a service boundary so future callers
    // cannot persist arbitrary context, form data, or identity fields.
    const request = assistantTurnRequestSchema.parse(data);
    const capability = await this.getCapabilities(scope, actor);
    if (!capability.conversationsEnabled) {
      throw new AssistantServiceError(
        "ASSISTANT_DISABLED",
        capability.unavailableReason ?? "The assistant is unavailable.",
        503,
      );
    }

    const correlationId = crypto.randomUUID();
    return this.createOperatorTurn({ scope, conversationId, actor, request, correlationId });
  }

  /** Primary ordinary free-text path. Exact structured routes never call
   * createTurn and remain deterministic server actions. The former planner /
   * specialist path remains below solely as an isolated compatibility path. */
  private async createOperatorTurn(input: {
    scope: AssistantScope; conversationId: string; actor: AssistantActor; request: AssistantTurnRequest; correlationId: string;
  }): Promise<AssistantTurnResult> {
    const { scope, conversationId, actor, request, correlationId } = input;
    const capability = await this.getCapabilities(scope, actor);
    if (!capability.toolsEnabled) {
      return this.persistOperatorResponse(input, { response: capability.unavailableReason ?? ASSISTANT_UNAVAILABLE_REPLY, status: "failed", cards: [{ kind: "provider_unavailable", title: "AI Operator unavailable", summary: capability.unavailableReason ?? ASSISTANT_UNAVAILABLE_REPLY, sourceLinks: [], toolStatus: "failed" }], errorCode: "operator_unavailable", audits: [] });
    }
    const conversation = await this.repo.getConversation({ ...scope, conversationId });
    if (!conversation) throw this.notFound();
    let task = await this.operatorTasks.getActive({ organizationId: scope.organizationId, userId: actor.userId, conversationId: conversation.id });
    if (!task) task = await this.operatorTasks.create({ organizationId: scope.organizationId, userId: actor.userId, conversationId: conversation.id, goal: request.message });
    const audits: AssistantToolExecutionAudit[] = [];
    const providerConfig = await this.operatorProviderResolver.resolveProvider({ orgId: scope.organizationId, feature: "assistant" });
    const providerCapabilities = resolveAiProviderCapabilities(providerConfig);
    // Native search and the server-owned search are intentionally mutually
    // exclusive in a turn. This is capability selection, not phrase routing.
    const fallbackWebTools = !providerCapabilities.nativeWebSearch && isPublicWebResearchConfigured()
      ? createPublicWebResearchTools()
      : [];
    const mayBeginProductDraft = hasPermission(actor, "assistant.products.create_inactive_draft");
    const mayApplyProductOperations = mayBeginProductDraft
      || hasPermission(actor, "assistant.products.update_inactive_draft")
      || hasPermission(actor, "assistant.products.update_inactive_draft_batch");
    const existingProductId = existingProductIdForMutation({ context: request.context, task });
    const mayEditExistingProduct = hasPermission(actor, "assistant.products.update_existing_product");
    const existingProduct = existingProductId && mayEditExistingProduct
      ? await existingProductEditService.trustedContext({ organizationId: scope.organizationId, productId: existingProductId }).catch(() => null)
      : null;
    const activeProductProposalIdForContext = task.canonicalProductIntentProposalId;
    const activeSemanticProductDraft = activeProductProposalIdForContext
      ? await (async () => {
        try {
          if (!this.productIntentDispatcher.getActiveSemanticProductDraftContext) return null;
          return await this.productIntentDispatcher.getActiveSemanticProductDraftContext({
            organizationId: scope.organizationId, userId: actor.userId, conversationId: conversation.id, proposalId: activeProductProposalIdForContext,
          });
        } catch { return null; }
      })()
      : null;
    console.info("[ASSISTANT_OPERATOR_PRODUCT_CONTINUITY]", {
      correlationId, conversationId: conversation.id, taskId: task.id,
      activeSemanticDraft: Boolean(activeSemanticProductDraft),
      outstandingDecisionCount: activeSemanticProductDraft?.outstandingDecisions.length ?? 0,
      trustedExistingProduct: Boolean(existingProduct),
      compatibilityFallback: "bypassed",
    });
    // Ordinary Operator product creation uses these direct business doors.
    // The legacy compiler router remains callable only by legacy callers; it
    // is intentionally absent from the Operator catalog.
    let activeProductProposalId = task.canonicalProductIntentProposalId;
    const beginProductIntentTools: AssistantOperatorSemanticTool[] = mayBeginProductDraft ? [{
      name: "products.begin_draft",
      description: "Establish one NEW authoritative unfinished product draft. Use only when the user intends to create a new product. Never use this to modify an existing persisted product; use products.apply_existing_operations for that. When a trusted existing product is in context and the user explicitly wants a new product based on it, set target to new_product. When the user already supplied product details, include every understood supported business change as initialOperations so the new draft is populated in this call. Preserve enumerated unsupported details with record_unsupported_detail instead of dropping supported work. Do not use if an unfinished new-product draft is already active.",
      inputSchema: beginProductDraftToolInputSchema,
      execute: async ({ arguments: args, context }) => {
        const resolvedExistingProductId = existingProductIdForMutation(context);
        if (resolvedExistingProductId && args.target !== "new_product") return { status: "rejected" as const, warning: "This request resolved to an existing product. Use the existing-product edit capability unless the user explicitly creates a distinct new product." };
        const initialOperations = Array.isArray(args.initialOperations) ? args.initialOperations : undefined;
        if (activeProductProposalId) {
          const draftContext = this.productIntentDispatcher.getActiveSemanticProductDraftContext
            ? await this.productIntentDispatcher.getActiveSemanticProductDraftContext({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: conversation.id, proposalId: activeProductProposalId }).catch(() => null)
            : null;
          return {
            status: "partial" as const,
            failureCode: "draft_already_active",
            warning: "An unfinished product draft is already active. Continue that draft with products.apply_operations; do not begin another draft.",
            result: { status: "partial", data: { proposalId: activeProductProposalId, taskDomain: "products", draftContext, continuation: { draftAlreadyActive: true, draftEstablished: false, mayApplyBusinessOperations: true } } } as any,
          };
        }
        if (!initialOperations?.length && newProductRequestRequiresInitialOperations(context.goal)) {
          return {
            status: "rejected" as const,
            failureCode: "initial_operations_required",
            warning: "This named new-product request already includes business details. Include every understood detail as ordered initialOperations when beginning its draft; do not create an empty draft.",
          };
        }
        const product = await this.productIntentDispatcher.beginCanonicalProductDraft({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: conversation.id, message: context.goal, ...(initialOperations?.length ? { initialOperations } : {}) });
        const proposalId = product.cards.flatMap((card) => [((card as any).details?.proposalId), ((card as any).plan?.proposalId)]).find((id): id is string => typeof id === "string") ?? null;
        if (proposalId) activeProductProposalId = proposalId;
        const draftContext = proposalId && this.productIntentDispatcher.getActiveSemanticProductDraftContext
          ? await this.productIntentDispatcher.getActiveSemanticProductDraftContext({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: conversation.id, proposalId }).catch(() => null)
          : null;
        const resumed = product.draftState === "resumed";
        const failedInitialOperations = product.cards.some((card) => card.kind === "product_validation_errors");
        return {
          status: resumed || failedInitialOperations ? "partial" as const : "succeeded" as const,
          ...(resumed ? { failureCode: "draft_already_active", warning: "An unfinished product draft is already active. Continue that draft with products.apply_operations; do not begin another draft." } : failedInitialOperations ? { failureCode: "initial_operations_partially_applied", warning: product.response } : {}),
          result: { status: resumed || failedInitialOperations ? "partial" : "succeeded", data: { response: product.response, proposalId, taskDomain: "products", draftContext, continuation: { draftAlreadyActive: resumed, draftEstablished: Boolean(proposalId) && !resumed, mayApplyBusinessOperations: Boolean(proposalId) } } } as any,
          presentation: { cards: product.cards as AssistantStructuredCard[] },
        };
      },
      }] : [];
    const applyProductIntentTools: AssistantOperatorSemanticTool[] = mayApplyProductOperations ? [{
      name: "products.apply_operations",
      description: "Apply one atomic batch of one or more business changes to the current unfinished product draft. Use the original request and current draft context to include every supported change; do not make the user repeat supplied facts. Preserve an enumerated unsupported detail with record_unsupported_detail while retaining independent supported changes. Shared Product/PBV2/pricing/material proposal schemas validate migrated configuration; contained compatibility handles safe removals. Begin a draft first when none is active. Draft edits do not require GO; final product creation remains review/GO-gated. Pass only displayed business labels and values; never pass IDs, patch paths, persistence data, or PBV2 structures.",
      inputSchema: semanticProductOperationsToolInputSchema,
      execute: async ({ arguments: args, context }) => {
        const operations = Array.isArray(args.operations) ? args.operations : null;
        if (!operations) return { status: "rejected" as const, warning: "The product change must contain one or more business operations." };
        if (!activeProductProposalId) return { status: "rejected" as const, warning: "Begin an unfinished product draft before applying product changes." };
        const product = await this.productIntentDispatcher.applyCanonicalProductOperations({
          organizationId: context.scope.organizationId,
          userId: context.actor.userId,
          conversationId: conversation.id,
          message: context.goal,
          operations,
        });
        const proposalId = product.cards.flatMap((card) => [((card as any).details?.proposalId), ((card as any).plan?.proposalId)]).find((id): id is string => typeof id === "string") ?? activeProductProposalId;
        activeProductProposalId = proposalId;
        const draftContext = this.productIntentDispatcher.getActiveSemanticProductDraftContext
          ? await this.productIntentDispatcher.getActiveSemanticProductDraftContext({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: conversation.id, proposalId }).catch(() => null)
          : null;
        const rejected = product.cards.some((card) => card.kind === "product_validation_errors");
        const recovery = product.recovery;
        const failedOperation = recovery?.validation.semanticBatch?.failingOperation;
        return {
          status: rejected ? "rejected" as const : "succeeded" as const,
          ...(rejected ? {
            failureCategory: recovery?.retryable ? "recoverable_validation" : "product_validation",
            failureCode: "product_operations_rejected",
            warning: product.response,
            ...(recovery ? {
              failingStep: recovery.stage,
              validationSchema: "SemanticProductOperations",
              validationIssuePaths: recovery.validation.issuePaths,
              validationIssueCodes: recovery.validation.issueCodes,
              ...(failedOperation ? { operationType: failedOperation.type } : {}),
            } : {}),
          } : {}),
          result: {
            status: rejected ? "failed" : "succeeded",
            data: {
              response: product.response,
              proposalId,
              taskDomain: "products",
              draftContext,
              ...(recovery ? { validation: recovery } : {}),
              continuation: { mayApplyBusinessOperations: true, ...(recovery?.retryable ? { revisePlan: true } : {}) },
            },
          } as any,
          presentation: { cards: product.cards as AssistantStructuredCard[] },
        };
      },
      }] : [];
    const previewProductIntentTools: AssistantOperatorSemanticTool[] = mayApplyProductOperations ? [{
      name: "products.preview_draft_pricing",
      description: "Calculate read-only PBV2 prices for one or more scenarios on the current unfinished product draft before GO. Make one call with scenarios; each scenario has squareFeet, optional quantity, and selected business option labels. Use labels only, never IDs or PBV2 data. Use this when the user asks how the active draft will price; do not ask them to restate pricing rules already shown in the draft context.",
      inputSchema: draftPricingPreviewToolInputSchema,
      execute: async ({ arguments: args, context }) => {
        if (!activeProductProposalId || !this.productIntentDispatcher.previewActiveSemanticProductDraftPricing) return { status: "rejected" as const, warning: "An active product draft is required for draft pricing." };
        const scenarios = parseDraftPricingScenarios(args.scenarios);
        if (!scenarios) {
          console.warn("[AI_OPERATOR_TRACE]", { stage: "argument_validation", correlationId: context.correlationId, toolName: "products.preview_draft_pricing", succeeded: false });
          return { status: "rejected" as const, warning: "Draft pricing requires one to twelve positive square-foot scenarios with business-label selections." };
        }
        console.info("[AI_OPERATOR_TRACE]", { stage: "argument_validation", correlationId: context.correlationId, toolName: "products.preview_draft_pricing", succeeded: true, scenarioCount: scenarios.length });
        try {
          const data = await this.productIntentDispatcher.previewActiveSemanticProductDraftPricing({ organizationId: context.scope.organizationId, userId: context.actor.userId, conversationId: conversation.id, proposalId: activeProductProposalId, scenarios, correlationId: context.correlationId });
          return { status: "succeeded" as const, result: { status: "succeeded", data, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } } as any };
        } catch (error) { return { status: "rejected" as const, warning: error instanceof Error ? error.message : "The active product draft could not be priced." }; }
      },
    }] : [];
    const existingProductEditTools: AssistantOperatorSemanticTool[] = mayEditExistingProduct ? [{
      name: "products.apply_existing_operations",
      description: "Prepare a protected edit to one trusted existing persisted product. Lifecycle activation may transparently propose publishing its current valid PBV2 DRAFT first; publish warnings are displayed in the protected plan and acknowledged by GO. Pricing Engine rotation is separate from customer options. Nothing changes before GO, and the server revalidates state at GO.",
      inputSchema: existingProductEditProviderInputSchema,
      execute: async ({ arguments: args, context }) => {
        const parsed = existingProductEditOperationsSchema.safeParse({ operations: args.operations });
        if (!parsed.success) {
          const validation = existingProductEditValidationDetails(parsed.error);
          const operation = Array.isArray(args.operations) && args.operations[0] && typeof args.operations[0] === "object" && !Array.isArray(args.operations[0])
            ? (args.operations[0] as { op?: unknown }).op
            : null;
          return {
            status: "rejected" as const,
            warning: "Existing-product edits require one or more supported business operations.",
            failureCategory: "argument_validation",
            failureCode: "invalid_arguments",
            failingStep: "ExistingProductEditOperations",
            validationSchema: "ExistingProductEditOperations",
            validationIssuePaths: validation.paths,
            validationIssueCodes: validation.codes,
            ...(typeof operation === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(operation) ? { operationType: operation } : {}),
          };
        }
        try {
          const resolvedExistingProductId = existingProductIdForMutation(context);
          const operationType = parsed.data.operations[0]?.op;
          if (!resolvedExistingProductId) return { status: "rejected" as const, warning: "Resolve exactly one existing product before preparing an edit.", failureCategory: "entity_resolution", failureCode: "existing_product_target_unresolved", failingStep: "existing_product_resolution", ...(operationType ? { operationType } : {}) };
          const resolvedExistingProduct = await existingProductEditService.trustedContext({ organizationId: context.scope.organizationId, productId: resolvedExistingProductId });
          if (!resolvedExistingProduct) return { status: "rejected" as const, warning: "The resolved existing product is no longer available for editing.", failureCategory: "entity_resolution", failureCode: "existing_product_not_found", failingStep: "existing_product_resolution", ...(operationType ? { operationType } : {}) };
          const proposal = await existingProductEditService.buildProposal({ organizationId: context.scope.organizationId, productId: resolvedExistingProductId, operations: parsed.data });
          const summary = proposal.changes.map((change) => `${change.field}: ${change.before} → ${change.after}`).join("; ");
          return { status: "succeeded" as const, result: { status: "succeeded", data: { response: `Prepared protected existing-product edit: ${summary}. GO is required before any change.`, taskDomain: "products", targetType: "existing_product" }, provenance: { sourceLinks: [{ label: proposal.productName, href: `/products/${encodeURIComponent(proposal.productId)}/edit`, entityType: "product", entityId: proposal.productId }], freshness: { capturedAt: new Date().toISOString() } } } as any, presentation: { cards: [{ kind: "action_proposal", title: `Review existing product edit: ${proposal.productName}`, summary: `${summary}. No change has been made; GO is required.`, sourceLinks: [{ label: `Open ${proposal.productName}`, href: `/products/${encodeURIComponent(proposal.productId)}/edit`, entityType: "product", entityId: proposal.productId }], plan: { action: "products.update_existing_product", productId: proposal.productId, operations: parsed.data.operations, proposalFingerprint: proposal.fingerprint } } as any] } };
        } catch (error) {
          const operationType = parsed.data.operations[0]?.op;
          return { status: "rejected" as const, warning: error instanceof ExistingProductEditError ? error.message : "The existing product could not be prepared for editing.", failureCategory: error instanceof ExistingProductEditError ? "business_validation" : "operation_preparation", failureCode: error instanceof ExistingProductEditError ? error.code : "existing_product_preparation_failed", failingStep: "existing_product_proposal", ...(operationType ? { operationType } : {}) };
        }
      },
    }] : [];
    const productIntentTools: AssistantOperatorSemanticTool[] = [...beginProductIntentTools, ...applyProductIntentTools, ...previewProductIntentTools, ...existingProductEditTools];
    const semanticTools: AssistantOperatorSemanticTool[] = [...productIntentTools, {
      name: "analysis.run",
      description: "Safely calculate over an already-authorized observation only. Arguments: purpose, dataset {source current_turn|trusted_task, toolName, optional array path}, and a declarative program. Available operations are filter, classify_range (AI-selected inclusive start/exclusive end labels), project, group, pivot, calculate (add/subtract/multiply/divide/average/percent_change), sort, limit, and summarize. Use classify_range + group + pivot + calculate for comparable-period analysis. It cannot run code, SQL, network, filesystem, or application-service access.",
      execute: async ({ arguments: args, context }) => {
        try {
          const data = runOperatorAnalysis(args, context);
          return { status: "succeeded", result: { status: "succeeded", data, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } } as any };
        } catch (error) {
          return { status: "rejected", warning: error instanceof Error ? error.message : "The requested analysis could not be run safely." };
        }
      },
    }, ...fallbackWebTools, this.operatorCompositeTool()];
    const runtime = new AssistantOperatorRuntime(this.operatorDecisionProvider(scope.organizationId), this.createOperatorToolExecutor((audit) => { audits.push(audit); }, semanticTools));
    const run = await runtime.run({
      goal: request.message,
      taskId: task.id,
      initialWorkingSummary: existingProduct ? null : task.workingSummary,
      trustedContext: { scope, conversationId: conversation.id, actor: { userId: actor.userId, email: actor.email }, permissions: actor.permissions ?? [], context: request.context, correlationId, goal: request.message, task: { id: task.id, domain: task.domain, canonicalProductIntentProposalId: task.canonicalProductIntentProposalId, activeSemanticProductDraft, businessContext: operatorBusinessContext({ domain: task.domain, workingSummary: task.workingSummary, missingInformation: task.missingInformation, semanticChanges: task.semanticChanges, activeSemanticProductDraft, canBeginProductDraft: mayBeginProductDraft, canApplyProductOperations: mayApplyProductOperations, existingProduct, canEditExistingProduct: mayEditExistingProduct }), entityReferences: task.entityReferences, trustedObservations: persistedTrustedObservations(task.semanticChanges), missingInformation: task.missingInformation } },
    });
    const productObservation = [...run.observations].reverse().find((item) => (item.toolName === "products.begin_draft" || item.toolName === "products.apply_operations" || item.toolName === "products.apply_existing_operations") && item.result?.data && typeof item.result.data === "object") as AssistantOperatorObservation | undefined;
    const productData = productObservation?.result?.data as { response?: unknown; proposalId?: unknown; taskDomain?: unknown } | undefined;
    const compositeCards = run.observations.flatMap((observation) => observation.presentation?.cards ?? []);
    const cards = Array.isArray(productObservation?.presentation?.cards)
      ? productObservation.presentation.cards
      : [...renderToolResults(run.observations).cards, ...compositeCards];
    const compositeResponse = [...run.observations].reverse().map((observation) => observation.result?.data).find((data): data is { response?: unknown } => Boolean(data && typeof data === "object" && typeof (data as any).response === "string"));
    const response = typeof productData?.response === "string" ? productData.response : typeof compositeResponse?.response === "string" ? compositeResponse.response : run.response;
    const status = run.status === "failed" ? "failed" : "responded" as const;
    const proposalId = typeof productData?.proposalId === "string" ? productData.proposalId : null;
    // A completed read-only detour must not close an unfinished authoritative
    // product task. The task record merely remembers that active intent; it
    // never duplicates its canonical Product Intent state.
    const entityReferences = mergeOperatorEntityReferences(task.entityReferences, run.observations);
    const quoteInvestigation = run.observations.some((observation) => observation.toolName === "quotes.search" && observation.status === "succeeded");
    const productInvestigation = task.domain === "products" || run.observations.some((observation) => observation.toolName.startsWith("products.") || observation.result?.provenance?.sourceLinks.some((link) => link.entityType === "product"));
    const continuesQuoteInvestigation = task.domain === "quotes" || quoteInvestigation;
    const continuesTrustedEntityInvestigation = entityReferences.length > 0 && (task.entityReferences.length > 0 || run.observations.some((observation) => observation.status === "succeeded"));
    const hasPendingProtectedProductProposal = run.observations.some((observation) => observation.toolName === "products.apply_existing_operations" && observation.presentation?.cards.some((card) => card.kind === "action_proposal"));
    const recentCompletedTurn = run.status === "completed" && !hasPendingProtectedProductProposal ? completedOperatorTurn({ goal: request.message, response, workingSummary: run.safeWorkingSummary }) : null;
    const activeStatus = run.status === "awaiting_input" || proposalId || task.canonicalProductIntentProposalId || Boolean(recentCompletedTurn) || (continuesQuoteInvestigation && entityReferences.length > 0) || continuesTrustedEntityInvestigation
      ? "active"
      : run.status === "completed" ? "completed" : "blocked";
    await this.operatorTasks.update({ organizationId: scope.organizationId, userId: actor.userId, taskId: task.id, patch: {
      ...(typeof productData?.taskDomain === "string" ? { domain: productData.taskDomain } : productInvestigation ? { domain: "products" } : quoteInvestigation ? { domain: "quotes" } : {}),
      workingSummary: hasPendingProtectedProductProposal ? null : run.safeWorkingSummary,
      entityReferences,
      semanticChanges: mergeTrustedOperatorObservations(task.semanticChanges, run.observations, recentCompletedTurn, hasPendingProtectedProductProposal),
      missingInformation: run.missingInformation,
      ...(proposalId ? { canonicalProductIntentProposalId: proposalId } : {}),
      lastObservationSummary: run.observations.at(-1)?.warning ?? null,
      status: activeStatus,
    } });
    const hasFailedTool = run.observations.some((observation) => observation.status === "rejected" || observation.status === "failed" || observation.status === "timed_out");
    const diagnostic = (run.status === "failed" || hasFailedTool)
      ? await persistAiDiagnostic({
        version: 1, referenceId: correlationId, correlationId, diagnosticType: "operator_runtime",
        tenantId: scope.organizationId, actorId: actor.userId, conversationId: conversation.id,
        provider: providerConfig.provider ?? null, model: providerConfig.model ?? null, providerRequestId: null,
        stage: "operator_runtime_failure", errorCode: hasFailedTool ? "operator_tool_failure" : operatorFailureKind(run.response),
        providerResponseState: run.observations.length ? "received" : "not_received",
        parseMethod: "none", repairAttempted: false, repairResult: "not_attempted",
        ...(() => {
          const validationFailure = run.observations.find((observation) => observation.failureCategory === "argument_validation");
          return {
            validationSchema: validationFailure?.validationSchema ?? null,
            validationIssuePaths: validationFailure?.validationIssuePaths ?? [],
            validationIssueCodes: validationFailure?.validationIssueCodes ?? [],
          };
        })(), returnedTopLevelKeys: [], missingRequiredKeys: [], unknownKeys: [],
        plannerOperation: null, selectedCapability: null, specialistName: "operator_runtime", optionNormalizationStage: null, resolverStage: null,
        persistenceAttempted: true, persistenceResult: "succeeded", createdAt: new Date().toISOString(),
        operatorRuntime: {
          ...(() => {
            const toolObservations = run.observations.slice(-12).map((observation) => ({ toolName: observation.toolName.slice(0, 160), status: observation.status, failureCode: observation.failureCode ?? null, failureCategory: observation.failureCategory ?? null, failingStep: observation.failingStep ?? null, validationSchema: observation.validationSchema ?? null, validationIssuePaths: observation.validationIssuePaths ?? [], validationIssueCodes: observation.validationIssueCodes ?? [], operationType: observation.operationType ?? null }));
            const firstFailed = run.observations.find((observation) => observation.status === "rejected" || observation.status === "failed" || observation.status === "timed_out");
            return {
              toolObservations,
              firstFailedTool: firstFailed ? { toolName: firstFailed.toolName.slice(0, 160), status: firstFailed.status, failureCode: firstFailed.failureCode ?? null, failureCategory: firstFailed.failureCategory ?? null, failingStep: firstFailed.failingStep ?? null, validationSchema: firstFailed.validationSchema ?? null, validationIssuePaths: firstFailed.validationIssuePaths ?? [], validationIssueCodes: firstFailed.validationIssueCodes ?? [], operationType: firstFailed.operationType ?? null } : null,
            };
          })(),
          step: Math.max(1, Math.min(25, run.diagnostics.stepsConsumed)),
          decisionType: run.status === "completed" ? "complete" : run.response === "I couldn't complete the request because the AI Operator could not complete its investigation." ? null : "fail",
          toolName: run.observations.at(-1)?.toolName ?? null,
          argumentValidationSucceeded: run.observations.length > 0 && !run.observations.some((observation) => observation.failureCategory === "argument_validation"),
          handlerEntered: run.observations.length > 0, observationReturned: run.observations.length > 0,
          continuationStarted: run.diagnostics.providerDecisionCount > 1,
          finalResultAccepted: run.status === "completed", failureKind: hasFailedTool ? "operator_tool_failure" : operatorFailureKind(run.response),
          providerDecisionShape: run.diagnostics.providerDecisionShape ?? null,
        },
      }).catch(() => null)
      : null;
    console.info("[ASSISTANT_OPERATOR_RUNTIME] Ordinary free-text turn handled.", { correlationId, conversationId: conversation.id, taskId: task.id, outcome: run.status, toolCount: run.observations.length, ...run.diagnostics, legacyFallback: false });
    return this.persistOperatorResponse(input, { response, status, cards, errorCode: run.status === "failed" ? diagnostic ? "operator_failed" : "operator_failed_diagnostic_unavailable" : null, audits });
  }

  /**
   * The only free-text AI-first dispatch boundary.  It receives one strict
   * provider-neutral plan, verifies server-owned constraints, and then gives
   * the selected specialist the original message without rewriting it.  A
   * planning failure is persisted as a safe failure; it never falls through
   * to a keyword router.
   */
  private async createAiFirstTurn(input: {
    scope: AssistantScope;
    conversationId: string;
    actor: AssistantActor;
    request: AssistantTurnRequest;
    correlationId: string;
  }): Promise<AssistantTurnResult> {
    const { scope, conversationId, actor, request, correlationId } = input;
    const capability = await this.getCapabilities(scope, actor);
    if (!capability.toolsEnabled) {
      return this.persistAiFirstResponse(input, {
        response: capability.unavailableReason ?? ASSISTANT_UNAVAILABLE_REPLY,
        status: "failed",
        errorCode: "provider_unavailable",
        cards: [{ kind: "provider_unavailable", title: "AI planning unavailable", summary: capability.unavailableReason ?? ASSISTANT_UNAVAILABLE_REPLY, sourceLinks: [], toolStatus: "failed" }],
      });
    }
    const conversation = await this.repo.getConversation({ ...scope, conversationId });
    if (!conversation) throw this.notFound();
    const activeSessionId = activeProductIntakeSession(conversation.messages);
    const plannerResult = await this.intentPlanner.plan({
      organizationId: scope.organizationId,
      promptVersion: "ai-first-intent-planner-v1",
      timeoutUseCase: "ai_first_intent_planner",
      currentEntityId: request.context.entityId ?? null,
      activeSessionId,
      system: "You are the PrintersHero typed intent planner. Return exactly one schema-valid JSON object and no markdown or prose. Select only from the server-provided capability ID enum; a capability selection is an untrusted proposal, never authority or execution. Skills and workspace context explain workflow but cannot grant capability, tenant access, or permissions. The server resolves actor authority, tenant scope, entity identity, lifecycle, GO, idempotency, and canonical execution. A capability question is read-only: select assistant_capabilities with operation explain, domain system, mode read, and target none. Treat the current message as primary and workspace as supporting only. When trusted context says an active canonical product session exists and the message changes that intent, use canonical_product_intent_compiler with continue_session and target active_session; unrelated new product requests use create and target new_entity. Always include entityId and activeSessionId, using null when unknown. Never return product fields, executable arguments, tenant identity, permissions, or prose.",
      user: JSON.stringify({
        originalMessage: request.message,
        trustedContext: {
          route: request.context.route,
          pageTitle: request.context.pageTitle,
          entityType: request.context.entityType ?? null,
          entityId: request.context.entityId ?? null,
          hasActiveCanonicalSession: Boolean(activeSessionId),
        },
        contract: "Return only semantic planner fields: operation, capabilityId when a registered capability is selected, confidence when useful, target.kind, requiresClarification, and clarificationQuestion. The server derives version, domain, mode, reasonCode, target entity ID, trusted context, authorization, and execution metadata. For general help use general_conversation with target kind none. For a capability question select assistant_capabilities with operation explain and target kind none. If hasActiveCanonicalSession is true and the message changes the current product intent, select canonical_product_intent_compiler with continue_session and target active_session. For a detailed unrelated new product select canonical_product_intent_compiler with create and target new_entity.",
      }),
    });
    if (!plannerResult.ok) {
      return this.persistAiFirstResponse(input, {
        response: plannerResult.error.message,
        status: "failed",
        errorCode: plannerResult.error.code,
        cards: [{ kind: "provider_unavailable", title: "AI planning unavailable", summary: plannerResult.error.message, sourceLinks: [], toolStatus: "failed" }],
        provider: plannerResult.diagnostics.provider,
        model: plannerResult.diagnostics.model,
      });
    }

    const plan = plannerResult.plan;
    const validation = this.validateAiFirstPlan(plan, activeSessionId, actor);
    if (validation) {
      return this.persistAiFirstResponse(input, {
        response: validation,
        status: "failed",
        errorCode: "invalid_intent_plan",
        cards: [{ kind: "tool_warning", title: "AI plan rejected", summary: validation, sourceLinks: [], toolStatus: "permission_denied" }],
        provider: plannerResult.diagnostics.provider,
        model: plannerResult.diagnostics.model,
      });
    }

    if (plan.requiresClarification) {
      return this.persistAiFirstResponse(input, {
        response: plan.clarificationQuestion ?? "Please clarify what you need.", status: "responded", errorCode: null,
        cards: [{ kind: "tool_warning", title: "Clarification needed", summary: plan.clarificationQuestion ?? "Please clarify what you need.", sourceLinks: [] }],
        provider: plannerResult.diagnostics.provider, model: plannerResult.diagnostics.model,
      });
    }
    if (!plan.capabilityId) {
      const response = plan.operation === "unsupported"
        ? "I can’t safely complete that request here."
        : "How can I help with your products, quotes, orders, or operations?";
      return this.persistAiFirstResponse(input, { response, status: "responded", errorCode: null, cards: [], provider: plannerResult.diagnostics.provider, model: plannerResult.diagnostics.model });
    }

    let response = "I couldn't complete that request.";
    let cards: AssistantStructuredCard[] = [];
    const plannedCapability = plan.capabilityId;
    if (plannedCapability === "assistant_capabilities") {
      response = "Yes. I can help create inactive Product Builder drafts from a natural-language description. I’ll ask for genuinely missing information, show the configuration for review, and require confirmation and GO before creating anything. Activation is a separate admin workflow.";
      cards = [{ kind: "notice", title: "Assistant capabilities", body: response, tone: "info" }];
    } else if (plannedCapability === "system_guide") {
      const guide = resolveSystemGuideAnswer(request.message, request.context);
      response = guide?.response ?? "I can help explain the supported PrintersHero workflows.";
      cards = (guide?.cards ?? [{ kind: "notice", title: "System Guide", body: response, tone: "info" }]) as AssistantStructuredCard[];
    } else if (plannedCapability === "canonical_product_intent_compiler") {
      const product = await this.productIntentDispatcher.respondPlannedCanonicalProductIntent({
        organizationId: scope.organizationId, userId: actor.userId, conversationId: conversation.id,
        message: request.message,
        operation: plan.operation as "create" | "continue_session" | "correct" | "select_candidate" | "accept_recommendation" | "request_confirmation" | "execute_go",
      });
      response = product.response;
      cards = product.cards as AssistantStructuredCard[];
    } else {
      let specialist: { handled: boolean; response: string; cards: unknown[] } | null = null;
      try {
        specialist = await this.dispatchAiFirstSpecialist(plannedCapability, { organizationId: scope.organizationId, userId: actor.userId, conversationId: conversation.id, message: request.message });
      } catch {
        await persistAiDiagnostic({ version: 1, referenceId: correlationId, correlationId, diagnosticType: "specialist_dispatch", tenantId: scope.organizationId, actorId: actor.userId, conversationId: conversation.id, provider: plannerResult.diagnostics.provider, model: plannerResult.diagnostics.model, providerRequestId: null, stage: "specialist_exception", errorCode: "specialist_dispatch_failed", providerResponseState: "accepted", parseMethod: "none", repairAttempted: false, repairResult: "not_attempted", validationSchema: null, validationIssuePaths: [], validationIssueCodes: [], returnedTopLevelKeys: [], missingRequiredKeys: [], unknownKeys: [], plannerOperation: plan.operation, selectedCapability: plannedCapability, specialistName: plannedCapability, optionNormalizationStage: null, resolverStage: null, persistenceAttempted: false, persistenceResult: "not_attempted", createdAt: new Date().toISOString() }).catch(() => undefined);
        specialist = { handled: true, response: "That planned workflow could not be completed. Nothing was changed.", cards: [{ kind: "tool_warning", title: "Workflow unavailable", summary: "That planned workflow could not be completed. Nothing was changed.", sourceLinks: [], toolStatus: "failed" }] };
      }
      if (specialist) {
        response = specialist.response;
        cards = specialist.cards as AssistantStructuredCard[];
      } else if (plan.mode === "read") {
        // The typed planner selected a read capability first. The existing
        // read planner is now a post-selection tool-argument compiler only;
        // it cannot decide a mutation route or act as a fallback router.
        const readPlan = await this.planner.plan({ organizationId: scope.organizationId, message: request.message, context: request.context });
        if (readPlan.plan.clarificationRequired) {
          response = readPlan.plan.clarificationQuestion ?? "Please clarify what you want to look up.";
          cards = [{ kind: "tool_warning", title: "Clarification needed", summary: response, sourceLinks: [] }];
        } else {
          const audits: AssistantToolExecutionAudit[] = [];
          const orchestration = this.createOrchestrator((event) => audits.push(event));
          const executed = await orchestration.executePlan(readPlan.plan, { scope, actor: { userId: actor.userId, email: actor.email }, permissions: actor.permissions ?? [], context: request.context, correlationId });
          const rendered = renderToolResults(executed.executions);
          response = rendered.response;
          cards = rendered.cards;
        }
      } else {
        response = "That planned workflow is not available in this deployment. Nothing was changed.";
        cards = [{ kind: "tool_warning", title: "Workflow unavailable", summary: response, sourceLinks: [], toolStatus: "permission_denied" }];
      }
    }
    console.info("[ASSISTANT_INTENT_PLANNER] Dispatched validated plan.", {
      correlationId, capabilityId: plannedCapability, operation: plan.operation,
      provider: plannerResult.diagnostics.provider, model: plannerResult.diagnostics.model,
      activeSession: Boolean(activeSessionId),
    });
    return this.persistAiFirstResponse(input, { response, status: "responded", errorCode: null, cards, provider: plannerResult.diagnostics.provider, model: plannerResult.diagnostics.model });
  }

  private validateAiFirstPlan(plan: AssistantIntentPlan, activeSessionId: string | null, actor: AssistantActor): string | null {
    if (plan.contextUsage.activeSessionId !== null && plan.contextUsage.activeSessionId !== activeSessionId) return "The requested session could not be verified. Nothing was changed.";
    if (!plan.capabilityId) return null;
    const capability = getAssistantCapability(plan.capabilityId);
    if (capability.domain !== plan.domain || capability.mode !== plan.mode || !capability.operations.includes(plan.operation)) return "The AI plan selected an incompatible capability. Nothing was changed.";
    if (capability.requiredContext === "active_session" && !activeSessionId) return "This request needs an active assistant session.";
    if (capability.requiredContext === "current_entity" && plan.contextUsage.workspaceRelevance !== "entity_reference") return "This request needs a server-verified current record.";
    if (capability.requiredPermissions.some((permission) => !hasPermission(actor, permission))) return "You don't have permission for that assistant workflow.";
    return null;
  }

  private async dispatchAiFirstSpecialist(capabilityId: Exclude<NonNullable<AssistantIntentPlan["capabilityId"]>, "canonical_product_intent_compiler" | "system_guide">, input: { organizationId: string; userId: string; conversationId: string; message: string }): Promise<{ handled: boolean; response: string; cards: unknown[] } | null> {
    switch (capabilityId) {
      case "create_quote": case "update_quote": return quoteDraftIntakeService.respond(input);
      case "create_order": case "update_order": case "orders_workflow": return orderIntakeService.respond({ ...input, pendingRequest: undefined });
      case "crm_management": return crmManagementService.respond(input);
      case "production_operations": return productionOperationsService.respond(input);
      case "fulfillment_operations": return fulfillmentOperationsService.respond(input);
      case "billing_operations": return billingInvoiceOperationsService.respond(input);
      case "payment_operations": return paymentOperationsService.respond(input);
      default: return null;
    }
  }

  private async persistOperatorResponse(
    input: { scope: AssistantScope; conversationId: string; actor: AssistantActor; request: AssistantTurnRequest; correlationId: string },
    result: { response: string; status: "responded" | "failed"; errorCode: string | null; cards: AssistantStructuredCard[]; audits: AssistantToolExecutionAudit[] },
  ): Promise<AssistantTurnResult> {
    // Defense in depth: a known raw control decision is never a presentable
    // assistant message. Do not broadly suppress JSON, because users may
    // legitimately ask for JSON; this catches only exact schema-valid
    // Operator protocol text.
    if (parseAssistantOperatorDecisionText(result.response)) {
      console.warn("[ASSISTANT_OPERATOR] Prevented raw control protocol from persistence.", {
        correlationId: input.correlationId,
      });
      result = {
        response: "I couldn't safely present an internal investigation result. Please try again.",
        status: "failed",
        errorCode: "operator_protocol_leak_prevented",
        cards: [],
        audits: result.audits,
      };
    }
    const persisted = await this.persistFoundationTurn({
      ...input.scope, conversationId: input.conversationId, actor: input.actor, message: input.request.message, context: input.request.context,
      clientRequestId: input.request.clientRequestId, response: result.response, correlationId: input.correlationId, status: result.status,
      structuredCards: result.cards, initialTitle: titleFromMessage(input.request.message), provider: "operator_runtime", model: null,
      mode: "ai_operator_runtime", promptVersion: "ai-operator-runtime-v1", errorCode: result.errorCode,
      errorMessage: result.status === "failed" ? result.response : null,
      toolExecutions: result.audits.map((audit) => ({
        toolName: audit.toolName, toolVersion: audit.toolVersion,
        status: audit.status === "succeeded" || audit.status === "not_found" || audit.status === "partial" ? "succeeded" : audit.status === "rejected" ? "disabled" : "failed",
        errorCode: audit.failureCode, auditStatus: audit.status, durationMs: audit.durationMs,
        failureCategory: audit.failureCategory, failingStep: audit.failingStep, coreResultSucceeded: audit.coreResultSucceeded,
      })),
    });
    if (!persisted) throw this.notFound();
    return persisted;
  }

  private async persistAiFirstResponse(input: { scope: AssistantScope; conversationId: string; actor: AssistantActor; request: AssistantTurnRequest; correlationId: string }, result: { response: string; status: "responded" | "failed"; errorCode: string | null; cards: AssistantStructuredCard[]; provider?: string | null; model?: string | null }): Promise<AssistantTurnResult> {
    const persisted = await this.persistFoundationTurn({
      ...input.scope, conversationId: input.conversationId, actor: input.actor, message: input.request.message, context: input.request.context,
      clientRequestId: input.request.clientRequestId, response: result.response, correlationId: input.correlationId, status: result.status,
      structuredCards: result.cards, initialTitle: titleFromMessage(input.request.message), provider: result.provider ?? null, model: result.model ?? null,
      mode: "ai_first_typed_intent_planner", promptVersion: "ai-first-intent-planner-v1", errorCode: result.errorCode,
      errorMessage: result.status === "failed" ? result.response : null,
    });
    if (!persisted) throw this.notFound();
    return persisted;
  }

  private async readPausedResolutionTurn(
    scope: AssistantScope,
    conversationId: string,
    resolution: PersistedAnalyticalResolution,
  ): Promise<AssistantTurnResult> {
    if (!resolution.sourceTurnId || !resolution.sourceCorrelationId) {
      // This is a server integration error, not a reason to execute tools or
      // synthesize a second pause card outside the durable transaction.
      throw new AssistantServiceError("REPORT_RESOLUTION_PERSISTENCE_INVALID", "The report selection could not be saved safely.", 503);
    }
    const conversation = await this.repo.getConversation({ ...scope, conversationId });
    if (!conversation) throw this.notFound();
    const messages = conversation.messages.filter((message) => message.turnId === resolution.sourceTurnId);
    const userMessage = messages.find((message) => message.role === "user");
    const assistantMessage = messages.find((message) => message.role === "assistant");
    if (!userMessage || !assistantMessage) {
      throw new AssistantServiceError("REPORT_RESOLUTION_PERSISTENCE_INVALID", "The report selection could not be saved safely.", 503);
    }
    return {
      turnId: resolution.sourceTurnId,
      correlationId: resolution.sourceCorrelationId,
      status: "responded",
      conversation,
      userMessage,
      assistantMessage,
    };
  }

  private notFound(): AssistantServiceError {
    // The same response covers cross-user, cross-org, and unknown IDs.
    return new AssistantServiceError("ASSISTANT_CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
  }

  /**
   * A read result and the durable conversation response are separate concerns.
   * We cannot claim a lookup failed when only response persistence failed.
   */
  private async persistFoundationTurn(input: Parameters<AssistantRepository["createFoundationTurn"]>[0]) {
    try {
      return await this.repo.createFoundationTurn(input);
    } catch {
      throw new AssistantServiceError(
        "ASSISTANT_MESSAGE_PERSISTENCE_FAILED",
        "The lookup completed, but the assistant response could not be saved. Please retry.",
        503,
      );
    }
  }
}

function renderToolResults(executions: Array<{ toolName: string; status: string; result?: any; warning?: string; failureCategory?: string; failureCode?: string; failingStep?: string; coreResultSucceeded?: boolean }>) {
  const cards: AssistantResultCard[] = [];
  for (const execution of executions) {
    if (!execution.result) {
      const permissionDenied = execution.status === "permission_denied";
      cards.push({ kind: permissionDenied ? "permission_denied" : "tool_warning", title: displayToolTitle(execution.toolName), summary: permissionDenied ? "You don't have permission to view that record." : execution.warning ?? "The lookup could not be completed.", sourceLinks: [], toolStatus: execution.status === "rejected" ? "failed" : execution.status as any });
      continue;
    }
    const result = execution.result;
    if (result.status === "not_found") {
      cards.push({ kind: "not_found", title: displayToolTitle(execution.toolName), summary: execution.toolName === "production.get_queue_summary" ? result.warning ?? "No matching production station was found." : "No matching record was found.", sourceLinks: [], toolStatus: "not_found" });
      continue;
    }
    const names: Record<string, AssistantResultCard["kind"]> = { "search.global": "search_results", "customers.get_summary": "customer_summary", "orders.get_summary": "order_summary", "products.get_summary": "product_summary", "reports.operational_summary": "operational_metrics", "navigation.get_current_context": "current_context", "production.get_queue_summary": "production_queue_summary", "operations.get_attention_summary": "attention_summary", "orders.get_due_summary": "order_due_summary", "production.get_completed_jobs": "completed_job_summary", "analytics.resolve_customer": "customer_resolution", "analytics.customer_product_sales": "customer_product_sales", "analytics.customer_uninvoiced_orders": "uninvoiced_order_summary" };
    cards.push({ kind: names[execution.toolName] ?? "partial_result", title: displayToolTitle(execution.toolName), summary: summaryForTool(execution.toolName, result.data), freshness: result.provenance?.freshness.capturedAt, sourceLinks: result.provenance?.sourceLinks ?? [], toolStatus: result.status, details: withSuggestedPrompts(execution.toolName, result.data) });
  }
  return { response: cards.length ? cards.map((card) => card.summary).join(" ") : "I need a little more detail to find the right information.", cards };
}

/** Suggestions remain ordinary, visible text prompts. They do not contain
 * identifiers, tool parameters, plan tokens, or an action path. */
function withSuggestedPrompts(toolName: string, data: any): any {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (Array.isArray(data.suggestedPrompts)) return data;
  if (toolName === "orders.get_due_summary") {
    const state = data.orders?.[0]?.dueState === "due_today" ? "today's" : data.orders?.[0]?.dueState === "due_tomorrow" ? "tomorrow's" : "overdue";
    return {
      ...data,
      suggestedPrompts: [
        { id: "show-incomplete-lines", label: "Show incomplete line items", prompt: `Show incomplete line items for ${state} orders.`, intent: "production_reporting", presentationPriority: 1 },
        { id: "summarize-due-orders", label: `Summarize ${state} orders`, prompt: `Summarize ${state} orders.`, intent: "operational_summary", presentationPriority: 2 },
        { id: "remaining-work-station", label: "Show remaining work by station", prompt: "Show remaining work by station.", intent: "production_reporting", presentationPriority: 3 },
      ],
    };
  }
  if (toolName === "analytics.customer_uninvoiced_orders") {
    const customer = typeof data.customer?.displayName === "string" ? data.customer.displayName : "this customer";
    return {
      ...data,
      suggestedPrompts: [
        { id: "show-uninvoiced-orders", label: "Show uninvoiced orders", prompt: `Show uninvoiced orders for ${customer}.`, intent: "analytical_reporting", presentationPriority: 1 },
        { id: "analyze-order-value", label: "Analyze order value instead", prompt: `Analyze ${customer} order value instead.`, intent: "analytical_reporting", presentationPriority: 2 },
        { id: "explain-billing-blockers", label: "Explain what is blocking invoicing", prompt: `Explain what is blocking invoicing for ${customer}.`, intent: "operational_summary", presentationPriority: 3 },
      ],
    };
  }
  return data;
}

function displayToolTitle(toolName: string): string {
  const titles: Record<string, string> = {
    "production.get_queue_summary": "Production queue",
    "operations.get_attention_summary": "Production attention",
    "reports.operational_summary": "Operational summary",
    "orders.get_summary": "Order summary",
    "orders.search": "Orders",
    "orders.get_due_summary": "Order due summary",
    "production.get_completed_jobs": "Completed production jobs",
    "products.get_summary": "Product summary",
    "customers.get_summary": "Customer summary",
    "search.global": "Record search",
    "navigation.get_current_context": "Current workspace",
    "analytics.resolve_customer": "Customer resolution",
    "analytics.customer_product_sales": "Customer product sales",
    "analytics.customer_uninvoiced_orders": "Uninvoiced orders",
  };
  return titles[toolName] ?? "Assistant result";
}

function summaryForTool(toolName: string, data: any): string {
  if (toolName === "search.global") {
    const count = data.matches?.length ?? 0;
    return count ? `I found ${count} matching ${count === 1 ? "record" : "records"}.` : "I couldn't find a matching record.";
  }
  if (toolName === "customers.get_summary") return `You're looking at ${data.customer?.label ?? "this customer"}${data.customer?.status ? `, currently ${formatAssistantDisplayValue(data.customer.status)}` : ""}.`;
  if (toolName === "orders.search") {
    const orders = Array.isArray(data.orders) ? data.orders : [];
    return orders.length ? `I found ${orders.length} matching order${orders.length === 1 ? "" : "s"}: ${orders.map((order: any) => `${order.orderNumber} — ${order.customer?.name}, ${formatAssistantDisplayValue(order.status)}, $${Number(order.total).toFixed(2)}, ${formatAssistantDate(order.createdAt)}`).join("; ")}.` : "There are no matching orders.";
  }
  if (toolName === "orders.get_summary") {
    const order = data.order;
    const operationalSummary = summarizeOperationalOrder(data);
    if (operationalSummary) return operationalSummary;
    return `${order?.label ?? "This order"} is currently ${formatAssistantDisplayValue(order?.status)}${data.dueDate ? ` and due ${formatAssistantDate(data.dueDate)}` : ""}.`;
  }
  if (toolName === "orders.get_due_summary") {
    const orders = Array.isArray(data.orders) ? data.orders as Array<{ orderNumber?: string }> : [];
    const total = Number(data.totalMatchingOrders ?? orders.length ?? 0);
    if (!total) return "There are no matching orders in that due-date window.";
    const labels = orders.map((order) => order.orderNumber).filter((value): value is string => Boolean(value));
    const listed = labels.length <= 3 ? labels.join(labels.length === 2 ? " and " : ", ") : `${labels.slice(0, 3).join(", ")}${total > 3 ? ", and more" : ""}`;
    const state = orders[0] && (data.orders[0] as { dueState?: string }).dueState;
    const phrase = state === "overdue" ? "overdue" : state === "due_today" ? "due today" : state === "due_tomorrow" ? "due tomorrow" : "matching";
    return `${total} ${total === 1 ? "order is" : "orders are"} ${phrase}: ${listed}.`;
  }
  if (toolName === "production.get_completed_jobs") {
    const jobs = Array.isArray(data.jobs) ? data.jobs as Array<{ orderNumber?: string; customerName?: string }> : [];
    const total = Number(data.totalMatchingJobs ?? jobs.length ?? 0);
    const customer = jobs[0]?.customerName ?? "This customer";
    if (!total) return `${customer} has no completed production jobs in the requested date range.`;
    const labels = jobs.map((job) => job.orderNumber).filter((value): value is string => Boolean(value));
    const listed = labels.length <= 3 ? labels.join(labels.length === 2 ? " and " : ", ") : `${labels.slice(0, 3).join(", ")}${total > 3 ? ", and more" : ""}`;
    return `${customer} has ${total} completed production ${total === 1 ? "job" : "jobs"}: ${listed}.`;
  }
  if (toolName === "products.get_summary") return `${data.product?.label ?? "This product"} is ${data.active === false ? "inactive" : data.product?.status ?? "available"}${data.category ? ` in ${data.category}` : ""}.`;
  if (toolName === "reports.operational_summary") return "Here's the current operational picture.";
  if (toolName === "analytics.resolve_customer") {
    if (data.confidence === "ambiguous") return "I found multiple matching customers. Please choose the correct customer before I run a financial report.";
    if (!data.customer?.displayName) return "I couldn't find a matching customer.";
    return data.customer.resolutionType === "contact" && data.customer.contactName
      ? `I found ${data.customer.contactName} at ${data.customer.displayName}. I'll analyze ${data.customer.displayName}'s purchasing history.`
      : `I found ${data.customer.displayName}.`;
  }
  if (toolName === "analytics.customer_product_sales") {
    const customer = data.customer?.displayName ?? "This customer";
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) return `${customer} has no posted native invoice-line sales in the requested date range.`;
    const first = rows[0];
    const dollars = typeof first?.revenueCents === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(first.revenueCents / 100) : null;
    return `${customer}'s leading product is ${first?.label ?? "the first listed product"}${dollars ? ` at ${dollars} in posted invoice-line revenue` : ""}.`;
  }
  if (toolName === "analytics.customer_uninvoiced_orders") {
    const customer = data.customer?.displayName ?? "This customer";
    const orders = Array.isArray(data.orders) ? data.orders : [];
    if (!orders.length) return `${customer} has no qualifying uninvoiced orders in the requested date range.`;
    const total = typeof data.totalOrderValueCents === "number"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(data.totalOrderValueCents / 100)
      : null;
    const first = orders[0] as { orderNumber?: string; fulfillmentState?: string } | undefined;
    return `${customer} has ${orders.length} uninvoiced ${orders.length === 1 ? "order" : "orders"}${total ? ` worth ${total}` : ""}${first?.fulfillmentState ? `; the first is ${first.orderNumber ?? "an order"} and is ${formatAssistantDisplayValue(first.fulfillmentState)}` : ""}. This operational order value is not posted revenue.`;
  }
  if (toolName === "production.get_queue_summary") {
    const stations = Array.isArray(data.stations) ? data.stations : [];
    if (!stations.length) return "I couldn't find an active production queue for that station.";
    if (stations.length > 1) {
      const candidates = stations.filter((station: any) => station?.active !== false);
      const ranked = [...(candidates.length ? candidates : stations)].sort((left: any, right: any) => (
        Number(right.activeJobs ?? 0) - Number(left.activeJobs ?? 0)
        || Number(right.overdueJobs ?? 0) - Number(left.overdueJobs ?? 0)
        || String(left.earliestDueJob?.dueDate ?? "9999-12-31").localeCompare(String(right.earliestDueJob?.dueDate ?? "9999-12-31"))
        || String(left.stationLabel ?? "").localeCompare(String(right.stationLabel ?? ""))
      ));
      const leading = ranked[0] as { stationLabel?: string; activeJobs?: number; overdueJobs?: number } | undefined;
      const overview = ranked.map((station: any) => `${station.stationLabel ?? "Station"}: ${station.activeJobs ?? 0}`).join(", ");
      return leading
        ? `${leading.stationLabel ?? "That station"} has the largest backlog with ${leading.activeJobs ?? 0} active jobs. Largest backlog means the highest active non-terminal job count; ties use overdue jobs, earliest due work, then station order. ${overview}.`
        : "There aren't any active production stations to compare right now.";
    }
    const station = stations[0] as { stationLabel?: string; activeJobs?: number; uniqueLineItems?: number; uniqueOrders?: number; remainingQuantity?: number | null; progressAvailableJobs?: number; earliestDueJob?: { orderNumber?: string; dueDate?: string; lineItemSequence?: number }; overdueJobs?: number; dueTodayJobs?: number; queuedJobs?: number; inProductionJobs?: number };
    const label = station.stationLabel ?? "that station";
    if (!station.activeJobs) return `There aren't any active jobs in ${label} right now.`;
    const scope = typeof station.uniqueLineItems === "number" && typeof station.uniqueOrders === "number"
      ? `, covering ${station.uniqueLineItems} unique production ${station.uniqueLineItems === 1 ? "line" : "lines"} across ${station.uniqueOrders} ${station.uniqueOrders === 1 ? "order" : "orders"}`
      : "";
    const earliest = station.earliestDueJob?.orderNumber ? ` The earliest is${station.earliestDueJob.lineItemSequence ? ` Line ${station.earliestDueJob.lineItemSequence} of` : ""} Order ${station.earliestDueJob.orderNumber}${station.earliestDueJob.dueDate ? `, due ${formatAssistantDate(station.earliestDueJob.dueDate)}` : ""}.` : " I can't reliably determine the earliest due job from the available data.";
    const progress = station.remainingQuantity !== null && station.remainingQuantity !== undefined
      ? ` ${station.remainingQuantity} confirmed production units remain.`
      : " Print progress is unavailable because production records do not store authoritative completed quantities.";
    return `There are ${station.activeJobs} active ${station.activeJobs === 1 ? "production job" : "production jobs"} in ${label}${scope}, with ${station.queuedJobs ?? 0} queued and ${station.inProductionJobs ?? 0} in production.${earliest}${station.overdueJobs ? ` ${station.overdueJobs} ${station.overdueJobs === 1 ? "job is" : "jobs are"} overdue.` : ""}${station.dueTodayJobs ? ` ${station.dueTodayJobs} ${station.dueTodayJobs === 1 ? "is" : "are"} due today.` : ""}${progress}`;
  }
  if (toolName === "operations.get_attention_summary") {
    const category = Array.isArray(data.categories) ? data.categories[0] as { label?: string; count?: number | null; available?: boolean } | undefined : undefined;
    if (!category) return "I couldn't find a production attention summary right now.";
    if (!category.available) return `${category.label ?? "That metric"} isn't reliably available from the current production data.`;
    const count = Number(category.count ?? 0);
    const items = Array.isArray(data.attentionItems) ? data.attentionItems : [];
    const first = items[0] as { orderNumber?: string; lineItemSequence?: number; dueDate?: string } | undefined;
    const activeOrders = typeof data.totalActiveOrders === "number" ? ` across ${data.totalActiveOrders} ${data.totalActiveOrders === 1 ? "order" : "orders"}` : "";
    const progress = data.remainingQuantity !== null && data.remainingQuantity !== undefined
      ? ` Together they have ${data.remainingQuantity} confirmed production units remaining.`
      : typeof data.progressAvailableJobs === "number" ? " Print progress is unavailable because production records do not store authoritative completed quantities." : "";
    const lead = count === 0 ? `There are no ${String(category.label ?? "matching items").toLowerCase()} right now.` : `There are ${count} ${String(category.label ?? "matching items").toLowerCase()}${activeOrders}.`;
    const firstDue = first?.orderNumber ? ` The first listed is${first.lineItemSequence ? ` Line ${first.lineItemSequence} of` : ""} Order ${first.orderNumber}${first.dueDate ? `, due ${formatAssistantDate(first.dueDate)}` : ""}.` : "";
    const urgency = String(category.label ?? "").toLowerCase().includes("urgent") ? " Urgent work is ordered by overdue due date, then due today, tomorrow, and other active work." : "";
    return `${lead}${firstDue}${progress}${urgency}`;
  }
  if (toolName === "navigation.get_current_context") {
    const record = data.currentRecord as {
      entityType?: string; orderNumber?: string; entityId?: string; customer?: string; customerName?: string;
      quoteNumber?: string; productName?: string; active?: boolean; status?: string; dueDate?: string;
    } | undefined;
    if (!record) return `You're on the ${data.pageTitle ?? "current workspace"} page.`;
    if (record.entityType === "order") {
      const dueDate = record.dueDate ? ` and due ${formatAssistantDate(record.dueDate)}` : "";
      return `You're viewing Order ${record.orderNumber ?? record.entityId ?? ""}${record.customer ? ` for ${record.customer}` : ""}. It is currently ${formatAssistantDisplayValue(record.status)}${dueDate}.`;
    }
    if (record.entityType === "customer") return `You're viewing customer ${record.customerName ?? record.entityId ?? ""}${record.status ? `, currently ${formatAssistantDisplayValue(record.status)}` : ""}.`;
    if (record.entityType === "quote") return `You're viewing Quote ${record.quoteNumber ?? record.entityId ?? ""}${record.customer ? ` for ${record.customer}` : ""}${record.status ? `, currently ${formatAssistantDisplayValue(record.status)}` : ""}.`;
    if (record.entityType === "product") return `You're viewing ${record.productName ?? "this product"}. It is currently ${record.active ? "active" : "inactive"}.`;
    return `You're viewing the ${data.pageTitle ?? "current"} page.`;
  }
  return "Here’s what I found.";
}

function summarizeOperationalOrder(data: any): string | null {
  const order = data?.order;
  const operational = data?.operational;
  if (!order || !operational || !Array.isArray(operational.lineItems)) return null;
  const label = order.label ?? "This order";
  const status = formatAssistantDisplayValue(order.status ?? "unavailable");
  const due = data.dueDate ? ` and due ${formatAssistantDate(data.dueDate)}` : "";
  const lines = operational.lineItems as Array<any>;
  const productGroups = Array.from(new Set(lines.map((line) => line?.productName ?? line?.materialName).filter((value): value is string => typeof value === "string" && Boolean(value.trim()))));
  const pieces = lines.reduce((total, line) => total + (Number.isInteger(line?.orderedPieces) && line.orderedPieces >= 0 ? line.orderedPieces : 0), 0);
  const area = lines.reduce((total, line) => total + (typeof line?.finishedSquareFeet === "number" && Number.isFinite(line.finishedSquareFeet) ? line.finishedSquareFeet : 0), 0);
  const classified = lines.filter((line) => line?.sidedness === "single_sided" || line?.sidedness === "double_sided");
  const singleSided = classified.filter((line) => line.sidedness === "single_sided").length;
  const doubleSided = classified.filter((line) => line.sidedness === "double_sided").length;
  const unknownSidedness = lines.length - classified.length;
  const production = operational.production;
  const productionText = production
    ? `${production.totalJobs ?? 0} production ${production.totalJobs === 1 ? "job" : "jobs"}, with ${production.queuedJobs ?? 0} queued, ${production.inProductionJobs ?? 0} in production, and ${production.completedJobs ?? 0} completed.`
    : null;
  const sidednessText = lines.length
    ? unknownSidedness === 0
      ? `${singleSided} confirmed single-sided and ${doubleSided} confirmed double-sided.`
      : `${singleSided} confirmed single-sided; sidedness is unavailable for ${unknownSidedness} ${unknownSidedness === 1 ? "line" : "lines"}.`
    : null;
  const billing = typeof operational.billingStatus === "string" ? ` Billing is ${formatAssistantDisplayValue(operational.billingStatus)}.` : "";
  const areaText = area > 0 ? ` totaling ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(area)} finished square feet` : "";
  const productText = productGroups.length ? ` (${productGroups.slice(0, 3).join(", ")}${productGroups.length > 3 ? ", and more" : ""})` : "";
  const progressWarning = production?.printProgressAvailable === false && typeof production.printProgressWarning === "string" ? ` ${production.printProgressWarning}` : "";
  return `${label} is ${status}${due}. It has ${lines.length} line ${lines.length === 1 ? "item" : "items"}${productText}, ${pieces} ordered pieces${areaText}. ${[sidednessText, productionText].filter(Boolean).join(" ")}${billing}${progressWarning}`;
}

function formatAssistantDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
      ...(dateOnly ? { timeZone: "UTC" } : {}),
      month: "long",
      day: "numeric",
    });
}

export function responsePresentationForCards(cards: readonly unknown[]): AssistantResponsePresentation {
  const legacyPresentation = cards.find((card): card is { kind: string; presentation?: AssistantResponsePresentation } => Boolean(card && typeof card === "object" && (card as { kind?: unknown }).kind === "response_presentation"));
  if (legacyPresentation?.presentation) return legacyPresentation.presentation;
  const visibleCards = cards.filter((card): card is { kind: string } => Boolean(card && typeof card === "object" && typeof (card as { kind?: unknown }).kind === "string" && (card as { kind: string }).kind !== "response_presentation"));
  const kinds = new Set(visibleCards.map((card) => card.kind));
  return kinds.has("action_plan") || kinds.has("action_proposal") ? "proposed_action"
      : kinds.has("execution_result") ? "execution_result"
        : kinds.has("operational_metrics") || kinds.has("production_queue_summary") || kinds.has("station_comparison") || kinds.has("attention_summary") || kinds.has("completed_job_summary") || kinds.has("customer_product_sales") || kinds.has("uninvoiced_order_summary") ? "analytical"
          : kinds.has("search_results") ? "collection"
            : kinds.has("order_summary") || kinds.has("customer_summary") || kinds.has("product_summary") ? "record_summary"
              : kinds.has("provider_unavailable") || kinds.has("tool_warning") || kinds.has("permission_denied") ? "diagnostic"
                : "conversational";
}

/** Classify each persisted response independently. Presentation cards can
 * carry provenance or warnings, but may never make a successful response
 * retryable merely because an earlier turn failed. */
export function responseStateForCards(cards: readonly unknown[]): AssistantResponseState {
  const values = cards.filter((card): card is { kind: string; toolStatus?: string } => Boolean(card && typeof card === "object" && typeof (card as { kind?: unknown }).kind === "string"));
  const kinds = new Set(values.map((card) => card.kind));
  const canonicalContinuationDiagnostic = values.some((card) => {
    if (card.kind !== "product_validation_errors") return false;
    const details = card && typeof card === "object" && "details" in card ? (card as { details?: unknown }).details : null;
    const errors = details && typeof details === "object" && !Array.isArray(details) ? (details as { errors?: unknown }).errors : null;
    return Array.isArray(errors) && errors.some((value) => typeof value === "string" && /\bpic-[0-9a-f-]{36}\b/i.test(value));
  });
  if (kinds.has("provider_unavailable")) return { kind: "retryable_failure", retryable: true, diagnosticsAvailable: true };
  if (values.some((card) => card.kind === "tool_warning" && card.toolStatus === "failed")) {
    return { kind: "retryable_failure", retryable: true, diagnosticsAvailable: true };
  }
  if (kinds.has("permission_denied") || values.some((card) => card.kind === "tool_warning" && card.toolStatus === "permission_denied")) {
    return { kind: "permission_denied", retryable: false, diagnosticsAvailable: false };
  }
  if (kinds.has("not_found")) return { kind: "not_found", retryable: false, diagnosticsAvailable: false };
  if (kinds.has("partial_result")) return { kind: "partial", retryable: false, diagnosticsAvailable: true };
  if (kinds.has("tool_warning")) return { kind: "validation_error", retryable: false, diagnosticsAvailable: false };
  if (canonicalContinuationDiagnostic) return { kind: "validation_error", retryable: false, diagnosticsAvailable: true };
  return { kind: "success", retryable: false, diagnosticsAvailable: false };
}

export { titleFromMessage };
