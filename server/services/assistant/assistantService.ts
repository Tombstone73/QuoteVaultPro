import type {
  AssistantContextEnvelope,
  AssistantCreateConversationRequest,
  AssistantStructuredCard,
  AssistantUpdateConversationRequest,
  AssistantTurnRequest,
} from "@shared/assistantContracts";
import { assistantTurnRequestSchema } from "@shared/assistantContracts";
import { AssistantOrchestrationService, type AssistantToolExecutionAudit } from "./orchestration";
import { AssistantPlanningError, ConfiguredAssistantPlanner, type AssistantPlanner } from "./providerPlanning";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import { OpenAiCompatibleBugReviewProvider } from "../ai/providers/configuredProvider";

type AssistantResultCard = Extract<AssistantStructuredCard, { summary: string }>;

export const ASSISTANT_UNAVAILABLE_REPLY = "Business questions are unavailable until a compatible AI provider is configured.";
export const ASSISTANT_WRITE_REFUSAL_REPLY = "I can help you look up information, but I cannot make changes or run GO actions.";

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
  getCapabilities(organizationId: string): Promise<{ enabled: boolean; toolsEnabled?: boolean; unavailableReason?: string | null }>;
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function titleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 96) || "New conversation";
}

export class AssistantService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly capabilities: AssistantCapabilityResolver,
    private readonly planner: AssistantPlanner = new ConfiguredAssistantPlanner(new OpenAiCompatibleBugReviewProvider()),
    private readonly createOrchestrator: (audit: (event: AssistantToolExecutionAudit) => void) => AssistantOrchestrationService =
      (audit) => new AssistantOrchestrationService(createStage2AssistantToolAdapters(), audit),
  ) {}

  async getCapabilities(scope: AssistantScope) {
    const resolved = await this.capabilities.getCapabilities(scope.organizationId);
    return {
      enabled: resolved.enabled,
      conversationsEnabled: resolved.enabled,
      toolsEnabled: Boolean(resolved.enabled && resolved.toolsEnabled),
      writeActionsEnabled: false,
      externalResearchEnabled: false,
      assistantVersion: "stage-2",
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
    const capability = await this.getCapabilities(scope);
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
      const planned = await this.planner.plan({ organizationId: scope.organizationId, message: request.message, context: request.context });
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
        const rendered = renderToolResults(executed.executions);
        response = rendered.response;
        cards = rendered.cards;
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
      correlationId: input.correlationId, status: input.status, structuredCards: input.structuredCards,
      provider: null, model: null, mode: "stage_2_read_only", promptVersion: "assistant-stage-2-planner-v1",
      errorCode: input.errorCode ?? null, errorMessage: input.status === "failed" ? input.response : null,
    });
    if (!result) throw this.notFound();
    return result;
  }
}

function renderToolResults(executions: Array<{ toolName: string; status: string; result?: any; warning?: string }>) {
  const cards: AssistantResultCard[] = [];
  for (const execution of executions) {
    if (!execution.result) {
      cards.push({ kind: execution.status === "permission_denied" ? "permission_denied" : "tool_warning", title: execution.toolName, summary: execution.warning ?? "The lookup could not be completed.", sourceLinks: [], toolStatus: execution.status === "rejected" ? "failed" : execution.status as any });
      continue;
    }
    const result = execution.result;
    if (result.status === "not_found") {
      cards.push({ kind: "not_found", title: execution.toolName, summary: "No matching record was found.", sourceLinks: [], toolStatus: "not_found" });
      continue;
    }
    const names: Record<string, AssistantResultCard["kind"]> = {
      "search.global": "search_results", "customers.get_summary": "customer_summary", "orders.get_summary": "order_summary",
      "products.get_summary": "product_summary", "reports.operational_summary": "operational_metrics", "navigation.get_current_context": "current_context",
    };
    const summary = summaryForTool(execution.toolName, result.data);
    cards.push({ kind: names[execution.toolName] ?? "partial_result", title: execution.toolName, summary, freshness: result.provenance?.freshness.capturedAt, sourceLinks: result.provenance?.sourceLinks ?? [], toolStatus: result.status });
  }
  if (!cards.length) return { response: "I need a little more detail to find the right information.", cards };
  const completed = cards.filter((card) => !["tool_warning", "permission_denied", "not_found"].includes(card.kind));
  return { response: completed.length ? `I found ${completed.length} read-only result${completed.length === 1 ? "" : "s"}.` : cards[0]!.summary, cards };
}

function summaryForTool(toolName: string, data: any): string {
  if (toolName === "search.global") return `${data.matches?.length ?? 0} matching record${data.matches?.length === 1 ? "" : "s"}.`;
  if (toolName === "customers.get_summary") return `Customer: ${data.customer?.label ?? "record"}.`;
  if (toolName === "orders.get_summary") return `Order: ${data.order?.label ?? "record"}.`;
  if (toolName === "products.get_summary") return `Product: ${data.product?.label ?? "record"}.`;
  if (toolName === "reports.operational_summary") return `${data.metrics?.length ?? 0} operational counters.`;
  if (toolName === "navigation.get_current_context") return `Current page: ${data.pageTitle ?? "workspace"}.`;
  return "Read-only result available.";
}

export { titleFromMessage };
