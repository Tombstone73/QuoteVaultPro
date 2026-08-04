import type { AssistantContextEnvelope, AssistantProviderPlan } from "@shared/assistantContracts";
import { assistantProviderPlanSchema } from "@shared/assistantContracts";
import type { AiProviderAdapter, AiProviderResponse } from "../ai/providers/AiProviderAdapter";
import { AiProviderUnavailableError } from "../ai/providers/AiProviderAdapter";
import { aiProviderResolver, type ResolvedAiProvider } from "../ai/aiProviderResolver";

export class AssistantPlanningError extends Error {
  constructor(
    readonly code: "provider_unavailable" | "provider_invalid_response",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AssistantPlanningError";
  }
}

export interface AssistantPlanningInput {
  organizationId: string;
  message: string;
  context: AssistantContextEnvelope;
}

export interface AssistantPlanner {
  plan(input: AssistantPlanningInput): Promise<{ plan: AssistantProviderPlan; provider: string; model: string; metadata: Record<string, unknown> }>;
}

export interface AssistantProviderResolver {
  resolveProvider(input: { orgId: string; feature: "assistant" }): Promise<ResolvedAiProvider>;
}

const DEFAULT_ASSISTANT_PLANNING_TIMEOUT_MS = 20_000;
const MIN_ASSISTANT_PLANNING_TIMEOUT_MS = 5_000;
const MAX_ASSISTANT_PLANNING_TIMEOUT_MS = 60_000;

export function resolveAssistantPlanningTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AI_ASSISTANT_PLANNING_TIMEOUT_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_ASSISTANT_PLANNING_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ASSISTANT_PLANNING_TIMEOUT_MS;
  return Math.min(MAX_ASSISTANT_PLANNING_TIMEOUT_MS, Math.max(MIN_ASSISTANT_PLANNING_TIMEOUT_MS, Math.floor(parsed)));
}

const PLANNER_SYSTEM_PROMPT = `You are the PrintersHero read-only assistant planner. Return one strict JSON object only, with no markdown or prose.
You may choose only these read-only tools: search.global, customers.get_summary, orders.get_summary, orders.get_due_summary, production.get_completed_jobs, products.get_summary, reports.operational_summary, navigation.get_current_context, production.get_queue_summary, operations.get_attention_summary, analytics.resolve_customer, analytics.customer_product_sales, analytics.customer_uninvoiced_orders.
Allowed arguments only: search.global {query,limit?}; customers.get_summary {customerId?,query?}; orders.get_summary {orderId?,orderNumber?}; orders.get_due_summary {due?,dueWithinDays?,dateRange?,customer?:{id?,name?},status?,limit?,includeOperationalSummary?}; production.get_completed_jobs {completed:"last_week_through_current_week",customer:{id?,name?},limit?}; products.get_summary {productId?,query?}; reports.operational_summary {timezone?,date?}; navigation.get_current_context {}; production.get_queue_summary {stationKey?,status?,due?,includeOverdue?,limit?}; operations.get_attention_summary {filter?,dueWithinDays?,stationKey?,limit?}; analytics.resolve_customer {query}; analytics.customer_product_sales {customer:{id?,name?},dateRange:{start,end},rankingMetric?,limit?,grouping?,includeQuantities?,includeInvoiceCounts?,includeOrderCounts?,includeAverageUnitPrice?}; analytics.customer_uninvoiced_orders {customer:{id?,name?},dateRange:{start,end},limit?}.
For production.get_queue_summary, stationKey is only an untrusted human station phrase such as "Flatbed printing"; the server resolves it within the organization. Never invent a station ID or canonical key. Omit stationKey for all-station and comparison questions. Use production.get_queue_summary for a station queue, first due job, backlog, or station comparison. Use operations.get_attention_summary for what needs attention, overdue work, due-today/tomorrow work, proof/prepress/artwork/fulfillment attention, and urgent production jobs. Its filter must be one of overdue, due_today, due_tomorrow, waiting_artwork, waiting_proof, waiting_prepress, in_production, ready_for_fulfillment, urgent, or all_attention.
Production questions apply to the whole organization. Do not use passive customer, order, or page context as a filter unless the user explicitly says "this customer", "their jobs", "this order", "this station", or "this board". These are read-only reporting questions, never mutations.
Preserve the user's reporting scope. Use orders.get_due_summary for explicit order due/overdue questions; use production tools only when the user explicitly asks about production jobs, stations, or production work. Never headline an order question with a production-job count.
For historical customer product sales, use only analytics.customer_product_sales. Supply the customer name exactly as stated; the server resolves it in the active organization. Require a date range when the question does not state one. When posted revenue is empty and the user asks why or requests operational context, use analytics.customer_uninvoiced_orders with the same customer and date range. Never label operational order value as revenue. Do not infer products, financial totals, margins, dates, customer IDs, or currency values. Use analytics.resolve_customer only to resolve a customer by itself or when clarification will follow; do not fabricate an ID from it.
Never create, edit, save, change, confirm, execute, price, calculate a new price, publish, share, export, or perform GO actions. A request to save, publish, share, or export a report is a metadata workflow the application may offer after a read result, but this planner must classify it as intent "unsupported_write" with no tool calls.
Never return or request organization IDs, user IDs, roles, permissions, URLs, SQL, service names, credentials, or auth material. Tool arguments must use only the documented argument fields.
Choose a plan that supports a concise, human-readable answer. Never ask the user to interpret a tool name, planning step, schema, or internal diagnostic.
Use at most five tool calls. Ask for clarification when an identifier or search target is genuinely ambiguous.
Required JSON shape: {"intent":"lookup|operational_summary|production_reporting|analytical_reporting|navigation|unsupported_write|clarification","selectedSkill":"string or null","toolCalls":[{"toolName":"allowed tool name","arguments":{}}],"clarificationRequired":false,"clarificationQuestion":null,"responseStyle":"concise|standard"}.`;

function contextForPlanner(context: AssistantContextEnvelope) {
  // This is a reduced trusted page description, not DOM text, business rows,
  // identity, authorization state, or a navigable URL supplied by the model.
  return {
    route: context.route,
    pageTitle: context.pageTitle,
    entityType: context.entityType ?? null,
    entityId: context.entityId ?? null,
    selectedCount: context.selectedRecordIds.length,
    unsavedChanges: context.unsavedChanges,
    capturedAt: context.capturedAt,
  };
}

/** Financial aggregates must remain bounded even when a provider omits a
 * requested period. Convert that unsafe plan into a normal clarification
 * before any adapter reaches the database. */
function withBoundedAnalyticsPlan(plan: AssistantProviderPlan): AssistantProviderPlan {
  const customerSales = plan.toolCalls.find((call) => call.toolName === "analytics.customer_product_sales");
  const customerAnalytics = customerSales ?? plan.toolCalls.find((call) => call.toolName === "analytics.customer_uninvoiced_orders");
  if (!customerAnalytics) return plan;
  const range = customerAnalytics.arguments?.dateRange;
  if (!range || typeof range !== "object" || Array.isArray(range)
    || typeof (range as Record<string, unknown>).start !== "string"
    || typeof (range as Record<string, unknown>).end !== "string") {
    return assistantProviderPlanSchema.parse({
      intent: "clarification",
      selectedSkill: null,
      toolCalls: [],
      clarificationRequired: true,
      clarificationQuestion: "What date range should I use for this sales report?",
      responseStyle: "concise",
    });
  }
  // An empty posted-revenue result is otherwise indistinguishable from a
  // customer with active, uninvoiced work. Pair the bounded operational read
  // with customer sales reports server-side so the model never has to invent
  // a second customer ID, date range, or query route.
  if (customerSales && !plan.toolCalls.some((call) => call.toolName === "analytics.customer_uninvoiced_orders")) {
    return assistantProviderPlanSchema.parse({
      ...plan,
      toolCalls: [...plan.toolCalls, {
        toolName: "analytics.customer_uninvoiced_orders",
        arguments: {
          customer: customerSales.arguments.customer,
          dateRange: customerSales.arguments.dateRange,
          limit: 10,
        },
      }],
    });
  }
  return plan;
}

/** A conservative refusal gate protects the common mutation/confirmation
 * phrasing even if a provider is misconfigured or returns an invalid plan. */
export function isExplicitAssistantWriteRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (/^go[!.\s]*$/.test(normalized)) return true;
  return /\b(change|edit|update|delete|remove|create|save|approve|confirm|cancel|adjust|activate|deactivate)\b/.test(normalized)
    || /\b(change|update|set)\b.{0,48}\b(price|pricing|status|payment|invoice|inventory|product|customer|order)\b/.test(normalized);
}

export function directWriteRefusalPlan(): AssistantProviderPlan {
  return assistantProviderPlanSchema.parse({
    intent: "unsupported_write",
    selectedSkill: null,
    toolCalls: [],
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "concise",
  });
}

export class ConfiguredAssistantPlanner implements AssistantPlanner {
  constructor(
    private readonly provider: AiProviderAdapter,
    private readonly resolver: AssistantProviderResolver = aiProviderResolver,
  ) {}

  async plan(input: AssistantPlanningInput) {
    if (isExplicitAssistantWriteRequest(input.message)) {
      return {
        plan: directWriteRefusalPlan(),
        provider: "local_policy",
        model: "none",
        metadata: { refusal: "read_only" },
      };
    }

    const config = await this.resolver.resolveProvider({ orgId: input.organizationId, feature: "assistant" });
    // Existing configured adapter guarantees strict JSON-object mode only for
    // OpenAI-compatible provider mode. Do not parse prose from other providers.
    if (!config.enabled || (config.provider !== "openai" && config.provider !== "openai_compatible") || !config.endpoint || !config.model || !config.apiKey) {
      throw new AssistantPlanningError(
        "provider_unavailable",
        "Business questions are unavailable until a compatible AI provider is configured.",
        false,
      );
    }

    let response: AiProviderResponse;
    try {
      response = await this.provider.generateJson({
        orgId: input.organizationId,
        feature: "assistant",
        system: PLANNER_SYSTEM_PROMPT,
        user: JSON.stringify({
          request: input.message,
          currentContext: contextForPlanner(input.context),
        }),
        promptVersion: "assistant-stage-2-planner-v1",
        timeoutMs: resolveAssistantPlanningTimeoutMs(),
        timeoutUseCase: "assistant_planning",
        providerConfig: config,
      });
    } catch (error) {
      if (error instanceof AiProviderUnavailableError) {
        throw new AssistantPlanningError("provider_unavailable", "Business questions are unavailable until AI configuration is complete.", false);
      }
      throw new AssistantPlanningError("provider_unavailable", "The AI provider is temporarily unavailable. Please retry.", true);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.rawText);
    } catch {
      throw new AssistantPlanningError("provider_invalid_response", "I couldn't safely interpret that request. Nothing was changed. Please retry.", true);
    }
    const parsedPlan = assistantProviderPlanSchema.safeParse(parsedJson);
    if (!parsedPlan.success) {
      throw new AssistantPlanningError("provider_invalid_response", "I couldn't safely interpret that request. Nothing was changed. Please retry.", true);
    }
    return {
      plan: withBoundedAnalyticsPlan(parsedPlan.data),
      provider: response.provider,
      model: response.model,
      metadata: response.requestMetadata,
    };
  }
}
