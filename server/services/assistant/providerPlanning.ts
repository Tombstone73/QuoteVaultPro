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

const PLANNER_SYSTEM_PROMPT = `You are the PrintersHero read-only assistant planner. Return one strict JSON object only, with no markdown or prose.
You may choose only these read-only tools: search.global, customers.get_summary, orders.get_summary, products.get_summary, reports.operational_summary, navigation.get_current_context.
Allowed arguments only: search.global {query,limit?}; customers.get_summary {customerId?,query?}; orders.get_summary {orderId?,orderNumber?}; products.get_summary {productId?,query?}; reports.operational_summary {timezone?,date?}; navigation.get_current_context {}.
Never create, edit, save, change, confirm, execute, price, calculate a new price, or perform GO actions. Classify any such request as intent "unsupported_write" with no tool calls.
Never return or request organization IDs, user IDs, roles, permissions, URLs, SQL, service names, credentials, or auth material. Tool arguments must use only the documented argument fields.
Choose a plan that supports a concise, human-readable answer. Never ask the user to interpret a tool name, planning step, schema, or internal diagnostic.
Use at most five tool calls. Ask for clarification when an identifier or search target is genuinely ambiguous.
Required JSON shape: {"intent":"lookup|operational_summary|navigation|unsupported_write|clarification","selectedSkill":"string or null","toolCalls":[{"toolName":"allowed tool name","arguments":{}}],"clarificationRequired":false,"clarificationQuestion":null,"responseStyle":"concise|standard"}.`;

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
        timeoutMs: 12_000,
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
      plan: parsedPlan.data,
      provider: response.provider,
      model: response.model,
      metadata: response.requestMetadata,
    };
  }
}
