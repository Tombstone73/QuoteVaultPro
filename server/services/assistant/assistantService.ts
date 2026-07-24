import type {
  AssistantContextEnvelope,
  AssistantCreateConversationRequest,
  AssistantResponsePresentation,
  AssistantResponseState,
  AssistantStructuredCard,
  AssistantUpdateConversationRequest,
  AssistantTurnRequest,
  AssistantReportResolutionSelectionRequest,
  AssistantReportResolutionCancelRequest,
} from "@shared/assistantContracts";
import { formatAssistantDisplayValue } from "@shared/assistantDisplay";
import { assistantReportResolutionCancelRequestSchema, assistantReportResolutionSelectionRequestSchema, assistantTurnRequestSchema } from "@shared/assistantContracts";
import { AssistantOrchestrationService, type AssistantToolExecutionAudit } from "./orchestration";
import { AssistantPlanningError, ConfiguredAssistantPlanner, type AssistantPlanner } from "./providerPlanning";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import { OpenAiCompatibleBugReviewProvider } from "../ai/providers/configuredProvider";
import { resolveQuoteInternalNoteIntent } from "./execution/quoteInternalNoteIntent";
import { productManagementSkillService } from "./productManagementSkill";
import { quoteDraftIntakeService } from "./quoteDraftIntakeService";
import { orderIntakeService } from "./orderIntakeService";
import { crmManagementService } from "./crmManagementService";
import {
  assistantCapabilityCommandDescriptions,
  assistantCapabilityCommandPermissions,
  assistantCapabilityProductionCommands,
  assistantCapabilityReadTools,
  isAssistantCapabilityProductionCommand,
} from "./assistantCapabilities";
import { deterministicOrderLookupTarget, deterministicSearchTarget, resolveDeterministicReadPlan } from "./deterministicReadRouting";
import { AnalyticalCustomerResolutionService, type PersistedAnalyticalResolution } from "./analyticalCustomerResolution";
import { resolveSystemGuideAnswer } from "./systemGuide";

type AssistantResultCard = Extract<AssistantStructuredCard, { summary: string }>;

export const ASSISTANT_UNAVAILABLE_REPLY = "I can't answer that until a compatible AI provider is configured.";
export const ASSISTANT_WRITE_REFUSAL_REPLY = "I can't make that change here. I can still help you look up the record or explain what needs attention.";

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
  getCapabilities(organizationId: string): Promise<{ enabled: boolean; toolsEnabled?: boolean; providerConfigured?: boolean; unavailableReason?: string | null }>;
}

type AssistantCapabilitySummary = Awaited<ReturnType<AssistantService["getCapabilities"]>>;

function hasPermission(actor: AssistantActor | undefined, permission: string): boolean {
  return Boolean(actor?.permissions?.includes(permission));
}

/** Returns a local-only reply for the two capability questions that must never
 * depend on provider planning. The response derives entirely from the same
 * server summary used by the capability endpoint and composer. */
export function resolveAssistantCapabilityQuestion(
  message: string,
  capability: AssistantCapabilitySummary,
): { response: string; title: string } | null {
  const normalized = message.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
  const asksAvailable = /^(?:what|which) (?:can|do) (?:you|the assistant) (?:currently )?do\??$/.test(normalized)
    || /^(?:what are )?(?:your|the assistant's) capabilities\??$/.test(normalized);
  const asksUnavailable = /^(?:what|which) (?:can't|cannot) (?:you|the assistant) (?:currently )?do(?: yet)?\??$/.test(normalized)
    || /^(?:what|which) (?:can|do) (?:you|the assistant) (?:not|not yet) (?:currently )?do\??$/.test(normalized)
    || /^(?:what are )?(?:your|the assistant's) limitations\??$/.test(normalized);
  if (!asksAvailable && !asksUnavailable) return null;

  if (asksAvailable) {
    if (!capability.readToolsEnabled) {
      return { title: "Assistant capabilities", response: capability.unavailableReason ?? "Business lookups are currently unavailable." };
    }
    const confirmedActions: string[] = [];
    for (const command of capability.productionCommandsPermittedForUser) {
      if (isAssistantCapabilityProductionCommand(command)) confirmedActions.push(assistantCapabilityCommandDescriptions[command]);
    }
    const actionSentence = confirmedActions.length
      ? ` I can also ${confirmedActions.join(" and ")}.`
      : capability.productionCommandsEnabled.length
        ? " Confirmed changes are available to some roles, but not to your current role."
        : "";
    return { title: "Assistant capabilities", response: `I can search your records, summarize orders and products, show production queues, identify overdue or urgent jobs, compare station workloads, and show what needs attention today.${actionSentence} I can't activate products, edit active products, perform external research, or make unconfirmed changes yet.` };
  }

  const limits = [
    "product activation remains disabled",
    "active-product editing remains disabled",
    "external research remains disabled",
    "MCP integrations remain disabled",
  ];
  if (!capability.readToolsEnabled) limits.unshift(capability.unavailableReason ?? "business lookups are currently unavailable");
  if (capability.productionCommandsEnabled.length && !capability.productionCommandsPermittedForUser.length) {
    limits.unshift("confirmed actions are enabled for this organization, but your current role is not permitted to use them");
  } else if (!capability.productionCommandsEnabled.length) {
    limits.unshift("confirmed actions are unavailable because the assistant provider or organization setting is disabled");
  }
  return { title: "Assistant limitations", response: `I can't ${limits.join("; ")}.` };
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
      const candidate = card as { kind?: unknown; details?: { sessionId?: unknown }; plan?: { action?: unknown; intakeSessionId?: unknown } };
      if (candidate.kind === "action_proposal" && candidate.plan?.action === "products.create_inactive_draft" && typeof candidate.plan.intakeSessionId === "string") return candidate.plan.intakeSessionId;
      if (candidate.kind === "action_proposal" && candidate.plan?.action === "products.update_inactive_draft" && typeof candidate.plan.intakeSessionId === "string") return candidate.plan.intakeSessionId;
      if (candidate.kind === "product_intake_summary" && typeof candidate.details?.sessionId === "string") return candidate.details.sessionId;
    }
  }
  return null;
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
  ) {}

  async getCapabilities(scope: AssistantScope, actor?: AssistantActor) {
    const resolved = await this.capabilities.getCapabilities(scope.organizationId);
    const providerConfigured = Boolean(resolved.enabled && (resolved.providerConfigured ?? resolved.toolsEnabled));
    const readToolsEnabled = Boolean(resolved.enabled && resolved.toolsEnabled);
    const writeFrameworkEnabled = readToolsEnabled;
    const productionCommandsEnabled = writeFrameworkEnabled ? [...assistantCapabilityProductionCommands] : [];
    const productionCommandsPermittedForUser = productionCommandsEnabled.filter((command) =>
      isAssistantCapabilityProductionCommand(command)
      && hasPermission(actor, assistantCapabilityCommandPermissions[command]),
    );
    const writeActionsEnabled = productionCommandsPermittedForUser.length > 0;
    return {
      enabled: resolved.enabled,
      conversationsEnabled: resolved.enabled,
      toolsEnabled: readToolsEnabled,
      providerConfigured,
      readToolsEnabled,
      registeredReadTools: readToolsEnabled ? [...assistantCapabilityReadTools] : [],
      writeFrameworkEnabled,
      writeActionsEnabled,
      productionCommandsEnabled,
      productionCommandsPermittedForUser,
      externalResearchEnabled: false,
      mcpEnabled: false,
      productActivationEnabled: false,
      activeProductEditingEnabled: false,
      diagnosticsEnabled: hasPermission(actor, "assistant.diagnostics.view"),
      composerHelperText: !readToolsEnabled
        ? "System Guide help is available. " + (resolved.unavailableReason ?? "Business record questions are unavailable until AI configuration is complete.")
        : writeActionsEnabled
          ? "Business lookups and confirmed actions are enabled. Changes require a preview and the dedicated GO button. External research is disabled."
          : "Business lookups are enabled. Write actions and external research are disabled.",
      assistantVersion: "stage-9-system-guide",
      unavailableReason: resolved.unavailableReason ?? (resolved.enabled ? null : "The assistant is disabled for this organization."),
      actorScope: scope,
    };
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
    const rendered = renderToolResults(executed.executions, null, null, false);
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
    // System Guide answers are local, read-only, and sourced from the
    // versioned manifest/approved corpus. They intentionally remain useful
    // when a configured provider is unavailable; no business tool or mutation
    // is involved in this path.
    const systemGuide = resolveSystemGuideAnswer(request.message, request.context);
    if (systemGuide) {
      return this.persistResponse({
        scope, conversationId, actor, request, correlationId,
        response: systemGuide.response,
        status: "responded",
        structuredCards: systemGuide.cards,
      });
    }
    if (!capability.toolsEnabled) {
      return this.persistResponse({
        scope, conversationId, actor, request, correlationId,
        response: capability.unavailableReason ?? ASSISTANT_UNAVAILABLE_REPLY,
        status: "failed",
        errorCode: "provider_unavailable",
        structuredCards: [{ kind: "provider_unavailable", title: "Business questions unavailable", summary: capability.unavailableReason ?? ASSISTANT_UNAVAILABLE_REPLY, sourceLinks: [], toolStatus: "failed" }],
      });
    }

    let response = "I could not complete that business lookup.";
    let status: "responded" | "failed" = "responded";
    let provider: string | null = null;
    let model: string | null = null;
    let errorCode: string | null = null;
    let cards: AssistantStructuredCard[] = [];
    const audits: AssistantToolExecutionAudit[] = [];
    try {
      const capabilityReply = resolveAssistantCapabilityQuestion(request.message, capability);
      if (capabilityReply) {
        response = capabilityReply.response;
        // A local capability answer is a successful conversational response;
        // it is not a warning, retry target, or diagnostic disclosure.
        cards = [{ kind: "notice", title: capabilityReply.title, body: response, tone: "info" }];
        provider = "local_policy";
        model = "assistant-capabilities-v1";
      } else {
      // This runs before the read-only provider planner and is intentionally
      // narrower than a general write classifier. It can only propose the one
      // server-registered quote-note action; execution still requires a
      // server-created plan, confirmation token, reauthorization, and domain
      // service revalidation.
      const conversation = await this.repo.getConversation({ ...scope, conversationId });
      if (!conversation) throw this.notFound();
      const quoteDraft = await quoteDraftIntakeService.respond({
        organizationId: scope.organizationId,
        userId: actor.userId,
        conversationId,
        message: request.message,
      });
      if (quoteDraft.handled) {
        response = quoteDraft.response;
        cards = quoteDraft.cards as AssistantResultCard[];
        provider = "local_quote_intake";
        model = "conversational-quote-intake-v1";
      } else {
      const orderIntake = await orderIntakeService.respond({
        organizationId: scope.organizationId,
        userId: actor.userId,
        conversationId,
        message: request.message,
      });
      if (orderIntake.handled) {
        response = orderIntake.response;
        cards = orderIntake.cards as AssistantResultCard[];
        provider = "local_order_intake";
        model = "conversational-order-intake-v1";
      } else {
      const crmIntake = await crmManagementService.respond({
        organizationId: scope.organizationId,
        userId: actor.userId,
        conversationId,
        message: request.message,
      });
      if (crmIntake.handled) {
        response = crmIntake.response;
        cards = crmIntake.cards as AssistantResultCard[];
        provider = "local_crm_intake";
        model = "conversational-crm-intake-v1";
      } else {
      const productManagement = await productManagementSkillService.respond({
        organizationId: scope.organizationId,
        userId: actor.userId,
        message: request.message,
        activeSessionId: activeProductIntakeSession(conversation.messages),
      });
      if (productManagement.handled) {
        response = productManagement.response;
        cards = productManagement.cards as AssistantResultCard[];
        provider = "local_product_intake";
        model = "product-management-skill-v1";
      } else {
      const quoteNoteIntent = resolveQuoteInternalNoteIntent(request.message, request.context);
      if (quoteNoteIntent.kind === "resolved") {
        response = "I can prepare an internal-only quote note preview. Review it and use the dedicated GO control to continue.";
        cards = [{
          kind: "action_proposal",
          title: "Prepare internal quote note",
          summary: response,
          sourceLinks: [],
          plan: {
            action: "quotes.add_internal_note",
            preview: {
              quoteId: quoteNoteIntent.quoteId ?? null,
              quoteNumber: quoteNoteIntent.expectedQuoteNumber ?? null,
              noteText: quoteNoteIntent.noteText,
              quotePath: quoteNoteIntent.quoteId ? `/quotes/${quoteNoteIntent.quoteId}` : null,
              unchangedItems: ["Pricing", "Quote status", "Customer-facing notes", "Order state", "Production", "Invoice", "Payment"],
            },
          },
        }];
        provider = "local_policy";
        model = "stage-4-quote-note-intent";
      } else if (quoteNoteIntent.kind === "clarification") {
        response = quoteNoteIntent.message;
        cards = [{ kind: "missing_information", title: "Quote note needs clarification", summary: response, sourceLinks: [] }];
        provider = "local_policy";
        model = "stage-4-quote-note-intent";
      } else {
      // Exact, read-only lookups and current-context questions must not depend
      // on a provider producing a valid JSON plan. The selected plan still
      // traverses the same registry and orchestration enforcement as a
      // provider plan, including tenant scope, permissions, limits, audits,
      // timeouts, and result schemas.
      const deterministicPlan = resolveDeterministicReadPlan(request.message, request.context);
      const planned = deterministicPlan
        ? { plan: deterministicPlan, provider: "local_policy", model: "deterministic-read-routing-v1", metadata: { route: "exact_read" } }
        : await this.planner.plan({ organizationId: scope.organizationId, message: request.message, context: request.context });
      provider = planned.provider;
      model = planned.model;
      let executablePlan = planned.plan;
      if (this.reportResolutionService && planned.plan.intent === "analytical_reporting" && !planned.plan.clarificationRequired) {
        const preflight = await this.reportResolutionService.preflight({
          scope: { ...scope, conversationId },
          originalUserRequest: request.message,
          plan: planned.plan,
          context: request.context,
        });
        if (preflight.kind === "awaiting_entity_resolution") {
          // `pause` writes the user message, assistant card, context snapshot,
          // and resolution in one transaction. Never call createFoundationTurn
          // here or a duplicate, independently visible card could be created.
          return this.readPausedResolutionTurn(scope, conversationId, preflight.resolution);
        }
        if (preflight.kind === "persistence_failed") {
          status = "failed";
          errorCode = "report_resolution_persistence_failed";
          response = preflight.message;
          cards = [{ kind: "provider_unavailable", title: "Company selection unavailable", summary: response, sourceLinks: [], toolStatus: "failed" }];
        } else if (preflight.kind === "no_match") {
          response = preflight.message;
          cards = [{ kind: "not_found", title: "Company not found", summary: response, sourceLinks: [], toolStatus: "not_found" }];
        } else if (preflight.kind === "continue") {
          executablePlan = preflight.plan;
        }
      }
      if (planned.plan.intent === "unsupported_write") {
        response = ASSISTANT_WRITE_REFUSAL_REPLY;
        cards = [{ kind: "tool_warning", title: "Read-only assistant", summary: response, sourceLinks: [], toolStatus: "permission_denied" }];
      } else if (planned.plan.clarificationRequired) {
        response = planned.plan.clarificationQuestion ?? "Please clarify what you want to look up.";
        cards = [{ kind: "tool_warning", title: "Clarification needed", summary: response, sourceLinks: [] }];
      } else if (!cards.length) {
        const orchestration = this.createOrchestrator((event) => { audits.push(event); });
        const executed = await orchestration.executePlan(executablePlan, {
          scope,
          actor: { userId: actor.userId, email: actor.email },
          permissions: actor.permissions ?? [],
          context: request.context,
          correlationId,
        });
        const rendered = renderToolResults(
          executed.executions,
          deterministicPlan ? deterministicSearchTarget(deterministicPlan) : null,
          deterministicPlan ? deterministicOrderLookupTarget(deterministicPlan) : null,
          deterministicPlan?.selectedSkill === "deterministic_current_order_blocking",
        );
        response = rendered.response;
        cards = rendered.cards;
      }
      }
      }
      }
      }
      }
      }
    } catch (error) {
      status = "failed";
      errorCode = error instanceof AssistantPlanningError ? error.code : "provider_unavailable";
      response = error instanceof AssistantPlanningError ? error.message : "The assistant is temporarily unavailable. Please retry.";
      cards = [{ kind: "provider_unavailable", title: "Business questions unavailable", summary: response, sourceLinks: [], toolStatus: "failed" }];
    }
    const result = await this.persistFoundationTurn({
      ...scope,
      conversationId,
      actor,
      message: request.message,
      context: request.context,
      clientRequestId: request.clientRequestId,
      response,
      correlationId,
      status,
      structuredCards: cards,
      initialTitle: titleFromMessage(request.message),
      provider,
      model,
      mode: "stage_2_read_only",
      promptVersion: "assistant-stage-2-planner-v1",
      errorCode,
      errorMessage: status === "failed" ? response : null,
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

  private async persistResponse(input: {
    scope: AssistantScope; conversationId: string; actor: AssistantActor; request: AssistantTurnRequest; correlationId: string;
    response: string; status: "responded" | "failed"; errorCode?: string; structuredCards: AssistantStructuredCard[];
  }) {
    const result = await this.persistFoundationTurn({
      ...input.scope, conversationId: input.conversationId, actor: input.actor, message: input.request.message,
      context: input.request.context, clientRequestId: input.request.clientRequestId, response: input.response,
      correlationId: input.correlationId, status: input.status,
      structuredCards: input.structuredCards,
      initialTitle: titleFromMessage(input.request.message),
      provider: null, model: null, mode: "stage_2_read_only", promptVersion: "assistant-stage-2-planner-v1",
      errorCode: input.errorCode ?? null, errorMessage: input.status === "failed" ? input.response : null,
    });
    if (!result) throw this.notFound();
    return result;
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

function renderToolResults(
  executions: Array<{ toolName: string; status: string; result?: any; warning?: string; failureCategory?: string; failureCode?: string; failingStep?: string; coreResultSucceeded?: boolean }>,
  exactSearchTarget: import("./deterministicReadRouting").DeterministicSearchTarget | null = null,
  exactOrderLookup: import("./deterministicReadRouting").DeterministicOrderLookupTarget | null = null,
  currentOrderSummary = false,
) {
  const cards: AssistantResultCard[] = [];
  for (const execution of executions) {
    if (!execution.result) {
      const permissionDenied = execution.status === "permission_denied";
      const summary = permissionDenied
        ? "You don't have permission to view that order."
        : exactOrderLookup && execution.failureCategory === "timeout"
          ? "I couldn't complete that lookup before it timed out. Nothing was changed. Please retry."
          : exactOrderLookup
            ? "I couldn't complete the order lookup right now. Nothing was changed. Please retry."
          : execution.warning ?? "The lookup could not be completed.";
      cards.push({
        kind: permissionDenied ? "permission_denied" : "tool_warning",
        title: displayToolTitle(execution.toolName),
        summary,
        sourceLinks: [],
        toolStatus: execution.status === "rejected" ? "failed" : execution.status as any,
        ...(execution.failureCategory ? {
          details: {
            failureCategory: execution.failureCategory,
            failureCode: execution.failureCode ?? null,
            failingStep: execution.failingStep ?? null,
            coreResultSucceeded: execution.coreResultSucceeded ?? false,
          },
        } : {}),
      });
      continue;
    }
    const result = execution.result;
    if (result.status === "not_found") {
      const summary = exactOrderLookup
        ? `I couldn't find order ${exactOrderLookup.displayNumber} in the current organization.`
        : execution.toolName === "production.get_queue_summary"
          ? result.warning ?? "I couldn't find that active production station. Try the station name shown on your production board."
          : "No matching record was found.";
      cards.push({ kind: "not_found", title: displayToolTitle(execution.toolName), summary, sourceLinks: [], toolStatus: "not_found" });
      continue;
    }
    if (execution.toolName === "search.global" && exactSearchTarget) {
      const exactMatches = exactSearchMatches(result.data?.matches, exactSearchTarget);
      const entityLabel = exactSearchTarget.entityType;
      if (!exactMatches.length) {
        cards.push({ kind: "not_found", title: `No matching ${entityLabel}`, summary: `I couldn't find a matching ${entityLabel}.`, sourceLinks: [], toolStatus: "not_found" });
        continue;
      }
      const filteredResult = {
        ...result,
        data: { ...result.data, matches: exactMatches },
        provenance: result.provenance
          ? { ...result.provenance, sourceLinks: result.provenance.sourceLinks.filter((link: { entityId?: string; href?: string }) => exactMatches.some((match: { recordId: string; sourceLink?: { href?: string } }) => match.recordId === link.entityId || match.sourceLink?.href === link.href)) }
          : undefined,
      };
      if (exactMatches.length > 1) {
        cards.push({
          kind: "search_results",
          title: `Multiple matching ${entityLabel}s`,
          summary: `I found multiple ${entityLabel}s with that exact name. Please choose one from the results.`,
          freshness: filteredResult.provenance?.freshness.capturedAt,
          sourceLinks: filteredResult.provenance?.sourceLinks ?? [],
          toolStatus: result.status,
          details: filteredResult.data,
        });
        continue;
      }
      const match = exactMatches[0]!;
      cards.push({
        kind: "search_results",
        title: `${entityLabel[0]!.toUpperCase()}${entityLabel.slice(1)} found`,
        summary: `I found ${match.label}${match.status ? `, currently ${match.status}` : ""}.`,
        freshness: filteredResult.provenance?.freshness.capturedAt,
        sourceLinks: filteredResult.provenance?.sourceLinks ?? [],
        toolStatus: result.status,
        details: filteredResult.data,
      });
      continue;
    }
    const names: Record<string, AssistantResultCard["kind"]> = {
      "search.global": "search_results", "customers.get_summary": "customer_summary", "orders.get_summary": "order_summary",
      "products.get_summary": "product_summary", "reports.operational_summary": "operational_metrics", "navigation.get_current_context": "current_context",
      "production.get_queue_summary": "production_queue_summary", "operations.get_attention_summary": "attention_summary",
      "orders.get_due_summary": "order_due_summary",
      "analytics.resolve_customer": "customer_resolution", "analytics.customer_product_sales": "customer_product_sales",
      "analytics.customer_uninvoiced_orders": "uninvoiced_order_summary",
    };
    const summary = summaryForTool(execution.toolName, result.data, { exactOrderLookup, currentOrderSummary });
    cards.push({ kind: names[execution.toolName] ?? "partial_result", title: displayToolTitle(execution.toolName), summary, freshness: result.provenance?.freshness.capturedAt, sourceLinks: result.provenance?.sourceLinks ?? [], toolStatus: result.status, details: withSuggestedPrompts(execution.toolName, result.data) });
  }
  if (!cards.length) return { response: "I need a little more detail to find the right information.", cards };
  const completed = cards.filter((card) => !["tool_warning", "permission_denied", "not_found"].includes(card.kind));
  return { response: completed.length ? completed.map((card) => card.summary).join(" ") : cards[0]!.summary, cards };
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
    "orders.get_due_summary": "Order due summary",
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

function exactSearchMatches(matches: unknown, target: import("./deterministicReadRouting").DeterministicSearchTarget) {
  if (!Array.isArray(matches)) return [];
  const normalizedTarget = normalizeExactLookupValue(target.query);
  return matches.filter((match): match is { entityType: string; recordId: string; label: string; status?: string } => {
    if (!match || typeof match !== "object") return false;
    const candidate = match as { entityType?: unknown; label?: unknown };
    if (candidate.entityType !== target.entityType || typeof candidate.label !== "string") return false;
    const normalizedLabel = normalizeExactLookupValue(candidate.label);
    return target.entityType === "quote"
      ? normalizedLabel === normalizedTarget || normalizedLabel === `quote ${normalizedTarget}`
      : normalizedLabel === normalizedTarget;
  });
}

function normalizeExactLookupValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function summaryForTool(toolName: string, data: any, options: { exactOrderLookup: import("./deterministicReadRouting").DeterministicOrderLookupTarget | null; currentOrderSummary: boolean }): string {
  if (toolName === "search.global") {
    const count = data.matches?.length ?? 0;
    return count ? `I found ${count} matching ${count === 1 ? "record" : "records"}.` : "I couldn't find a matching record.";
  }
  if (toolName === "customers.get_summary") return `You're looking at ${data.customer?.label ?? "this customer"}${data.customer?.status ? `, currently ${formatAssistantDisplayValue(data.customer.status)}` : ""}.`;
  if (toolName === "orders.get_summary") {
    const order = data.order;
    const operationalSummary = summarizeOperationalOrder(data);
    if (operationalSummary) return operationalSummary;
    if (options.exactOrderLookup && order) {
      const orderLabel = order.label ?? order.number ?? options.exactOrderLookup.displayNumber;
      const displayOrder = /^order\b/i.test(orderLabel) ? orderLabel : `Order ${orderLabel}`;
      return `I found ${displayOrder}${data.customer?.label ? ` for ${data.customer.label}` : ""}.`;
    }
    if (options.currentOrderSummary) {
      const blockers = Array.isArray(data.blockingIssues) ? data.blockingIssues : [];
      return blockers.length
        ? `${order?.label ?? "This order"} is currently ${formatAssistantDisplayValue(order?.status)}. ${blockers.join(" ")}`
        : `I can see ${order?.label ?? "this order"}'s current status, but the system does not expose a reliable blocking reason yet.`;
    }
    return `${order?.label ?? "This order"} is currently ${formatAssistantDisplayValue(order?.status)}${data.dueDate ? ` and due ${formatAssistantDate(data.dueDate)}` : ""}.`;
  }
  if (toolName === "orders.get_due_summary") {
    const orders = Array.isArray(data.orders) ? data.orders as Array<{ orderNumber?: string }> : [];
    const total = Number(data.totalMatchingOrders ?? orders.length ?? 0);
    const filter = options.exactOrderLookup ? "matching" : undefined;
    if (!total) return "There are no matching orders in that due-date window.";
    const labels = orders.map((order) => order.orderNumber).filter((value): value is string => Boolean(value));
    const listed = labels.length <= 3 ? labels.join(labels.length === 2 ? " and " : ", ") : `${labels.slice(0, 3).join(", ")}${total > 3 ? ", and more" : ""}`;
    const state = orders[0] && (data.orders[0] as { dueState?: string }).dueState;
    const phrase = state === "overdue" ? "overdue" : state === "due_today" ? "due today" : state === "due_tomorrow" ? "due tomorrow" : filter ?? "matching";
    return `${total} ${total === 1 ? "order is" : "orders are"} ${phrase}: ${listed}.`;
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
        : kinds.has("operational_metrics") || kinds.has("production_queue_summary") || kinds.has("station_comparison") || kinds.has("attention_summary") || kinds.has("customer_product_sales") || kinds.has("uninvoiced_order_summary") ? "analytical"
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
  return { kind: "success", retryable: false, diagnosticsAvailable: false };
}

export { titleFromMessage };
