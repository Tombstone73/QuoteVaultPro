import type {
  AssistantContextEnvelope,
  AssistantCreateConversationRequest,
  AssistantResponsePresentation,
  AssistantStructuredCard,
  AssistantUpdateConversationRequest,
  AssistantTurnRequest,
} from "@shared/assistantContracts";
import { formatAssistantDisplayValue } from "@shared/assistantDisplay";
import { assistantTurnRequestSchema } from "@shared/assistantContracts";
import { AssistantOrchestrationService, type AssistantToolExecutionAudit } from "./orchestration";
import { AssistantPlanningError, ConfiguredAssistantPlanner, type AssistantPlanner } from "./providerPlanning";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import { OpenAiCompatibleBugReviewProvider } from "../ai/providers/configuredProvider";
import { resolveQuoteInternalNoteIntent } from "./execution/quoteInternalNoteIntent";
import { productManagementSkillService } from "./productManagementSkill";
import {
  assistantCapabilityCommandDescriptions,
  assistantCapabilityCommandPermissions,
  assistantCapabilityProductionCommands,
  assistantCapabilityReadTools,
  isAssistantCapabilityProductionCommand,
} from "./assistantCapabilities";
import { deterministicOrderLookupTarget, deterministicSearchTarget, resolveDeterministicReadPlan } from "./deterministicReadRouting";

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
  listConversations(scope: AssistantScope): Promise<AssistantConversationRecord[]>;
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
    provider?: string | null;
    model?: string | null;
    mode?: string;
    promptVersion?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    toolExecutions?: Array<{
      toolName: string; toolVersion: string; status: "succeeded" | "failed" | "disabled";
      errorCode?: string; auditStatus: string; durationMs: number;
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
    return { title: "Assistant capabilities", response: `I can search your customers, orders, quotes, products, invoices, and production jobs. I can summarize records, show your operational backlog, and explain the current workspace.${actionSentence} I can't activate products, edit active products, perform external research, or make unconfirmed changes yet.` };
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
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 96) || "New conversation";
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
        ? (resolved.unavailableReason ?? "Business questions are unavailable until AI configuration is complete.")
        : writeActionsEnabled
          ? "Business lookups and confirmed actions are enabled. Changes require a preview and the dedicated GO button. External research is disabled."
          : "Business lookups are enabled. Write actions and external research are disabled.",
      assistantVersion: "stage-5",
      unavailableReason: resolved.unavailableReason ?? (resolved.enabled ? null : "The assistant is disabled for this organization."),
      actorScope: scope,
    };
  }

  async listConversations(scope: AssistantScope) {
    return this.repo.listConversations(scope);
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
    let cards: AssistantResultCard[] = [];
    const audits: AssistantToolExecutionAudit[] = [];
    try {
      const capabilityReply = resolveAssistantCapabilityQuestion(request.message, capability);
      if (capabilityReply) {
        response = capabilityReply.response;
        cards = [{ kind: "tool_warning", title: capabilityReply.title, summary: response, sourceLinks: [] }];
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
      if (planned.plan.intent === "unsupported_write") {
        response = ASSISTANT_WRITE_REFUSAL_REPLY;
        cards = [{ kind: "tool_warning", title: "Read-only assistant", summary: response, sourceLinks: [], toolStatus: "permission_denied" }];
      } else if (planned.plan.clarificationRequired) {
        response = planned.plan.clarificationQuestion ?? "Please clarify what you want to look up.";
        cards = [{ kind: "tool_warning", title: "Clarification needed", summary: response, sourceLinks: [] }];
      } else {
        const orchestration = this.createOrchestrator((event) => { audits.push(event); });
        const executed = await orchestration.executePlan(planned.plan, {
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
    } catch (error) {
      status = "failed";
      errorCode = error instanceof AssistantPlanningError ? error.code : "provider_unavailable";
      response = error instanceof AssistantPlanningError ? error.message : "The assistant is temporarily unavailable. Please retry.";
      cards = [{ kind: "provider_unavailable", title: "Business questions unavailable", summary: response, sourceLinks: [], toolStatus: "failed" }];
    }
    const result = await this.repo.createFoundationTurn({
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
      })),
    });
    if (!result) throw this.notFound();

    return result;
  }

  private notFound(): AssistantServiceError {
    // The same response covers cross-user, cross-org, and unknown IDs.
    return new AssistantServiceError("ASSISTANT_CONVERSATION_NOT_FOUND", "Conversation not found.", 404);
  }

  private async persistResponse(input: {
    scope: AssistantScope; conversationId: string; actor: AssistantActor; request: AssistantTurnRequest; correlationId: string;
    response: string; status: "responded" | "failed"; errorCode?: string; structuredCards: AssistantResultCard[];
  }) {
    const result = await this.repo.createFoundationTurn({
      ...input.scope, conversationId: input.conversationId, actor: input.actor, message: input.request.message,
      context: input.request.context, clientRequestId: input.request.clientRequestId, response: input.response,
      correlationId: input.correlationId, status: input.status,
      structuredCards: input.structuredCards,
      provider: null, model: null, mode: "stage_2_read_only", promptVersion: "assistant-stage-2-planner-v1",
      errorCode: input.errorCode ?? null, errorMessage: input.status === "failed" ? input.response : null,
    });
    if (!result) throw this.notFound();
    return result;
  }
}

function renderToolResults(
  executions: Array<{ toolName: string; status: string; result?: any; warning?: string }>,
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
        : exactOrderLookup
          ? "I couldn't complete that lookup right now. Nothing was changed. Please retry."
          : execution.warning ?? "The lookup could not be completed.";
      cards.push({ kind: permissionDenied ? "permission_denied" : "tool_warning", title: execution.toolName, summary, sourceLinks: [], toolStatus: execution.status === "rejected" ? "failed" : execution.status as any });
      continue;
    }
    const result = execution.result;
    if (result.status === "not_found") {
      cards.push({ kind: "not_found", title: execution.toolName, summary: exactOrderLookup ? `I couldn't find order ${exactOrderLookup.orderNumber} in the current organization.` : "No matching record was found.", sourceLinks: [], toolStatus: "not_found" });
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
    };
    const summary = summaryForTool(execution.toolName, result.data, { exactOrderLookup, currentOrderSummary });
    cards.push({ kind: names[execution.toolName] ?? "partial_result", title: execution.toolName, summary, freshness: result.provenance?.freshness.capturedAt, sourceLinks: result.provenance?.sourceLinks ?? [], toolStatus: result.status, details: result.data });
  }
  if (!cards.length) return { response: "I need a little more detail to find the right information.", cards };
  const completed = cards.filter((card) => !["tool_warning", "permission_denied", "not_found"].includes(card.kind));
  return { response: completed.length ? completed.map((card) => card.summary).join(" ") : cards[0]!.summary, cards };
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
    if (options.exactOrderLookup && order) {
      const orderLabel = order.label ?? order.number ?? options.exactOrderLookup.orderNumber;
      const displayOrder = /^order\b/i.test(orderLabel) ? orderLabel : `Order ${orderLabel}`;
      return `I found ${displayOrder}${data.customer?.label ? ` for ${data.customer.label}` : ""}.`;
    }
    if (options.currentOrderSummary) {
      const blockers = Array.isArray(data.blockingIssues) ? data.blockingIssues : [];
      return blockers.length
        ? `${order?.label ?? "This order"} is currently ${formatAssistantDisplayValue(order?.status)}. ${blockers.join(" ")}`
        : `I can see ${order?.label ?? "this order"}'s current status, but the system does not expose a reliable blocking reason yet.`;
    }
    return `${order?.label ?? "This order"} is currently ${formatAssistantDisplayValue(order?.status)}${data.dueDate ? ` and due ${new Date(data.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}.`;
  }
  if (toolName === "products.get_summary") return `${data.product?.label ?? "This product"} is ${data.active === false ? "inactive" : data.product?.status ?? "available"}${data.category ? ` in ${data.category}` : ""}.`;
  if (toolName === "reports.operational_summary") return "Here's the current operational picture.";
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
        : kinds.has("operational_metrics") ? "analytical"
          : kinds.has("search_results") ? "collection"
            : kinds.has("order_summary") || kinds.has("customer_summary") || kinds.has("product_summary") ? "record_summary"
              : kinds.has("provider_unavailable") || kinds.has("tool_warning") || kinds.has("permission_denied") ? "diagnostic"
                : "conversational";
}

export { titleFromMessage };
