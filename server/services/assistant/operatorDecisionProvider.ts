import type { AiProviderAdapter } from "../ai/providers/AiProviderAdapter";
import { AiProviderUnavailableError } from "../ai/providers/AiProviderAdapter";
import { aiProviderResolver, type ResolvedAiProvider } from "../ai/aiProviderResolver";
import { resolveAiProviderCapabilities } from "../ai/providers/providerCapabilities";
import type { AssistantOperatorDecisionProvider } from "./operatorRuntime";

export interface AssistantOperatorProviderResolver {
  resolveProvider(input: { orgId: string; feature: "assistant" }): Promise<ResolvedAiProvider>;
}

/** Provider adapter for one Operator decision. It exposes only the current
 * goal, reduced observations, and safe tool descriptions; authorization and
 * execution remain entirely in the server tool boundary. */
export class ConfiguredAssistantOperatorDecisionProvider implements AssistantOperatorDecisionProvider {
  /** DeepSeek Responses is stateless. This in-memory continuation exists only
   * for one runtime instance and is deliberately never persisted or returned
   * to the browser, because it can contain provider reasoning items. */
  private responseContinuation: unknown[] = [];
  private pendingFunctionCalls: Array<{ callId: string; toolName: string }> = [];
  private pendingObservationStart = 0;
  constructor(
    private readonly organizationId: string,
    private readonly provider: AiProviderAdapter,
    private readonly resolver: AssistantOperatorProviderResolver = aiProviderResolver,
  ) {}

  async decide(input: Parameters<AssistantOperatorDecisionProvider["decide"]>[0]): Promise<unknown> {
    const config = await this.resolver.resolveProvider({ orgId: this.organizationId, feature: "assistant" });
    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model || (config.provider !== "openai" && config.provider !== "openai_compatible")) {
      throw new AiProviderUnavailableError("AI Operator is unavailable.");
    }
    const capabilities = resolveAiProviderCapabilities(config);
    const system = [
      "You are the PrintersHero AI Operator. Decide the next safe business step, not an implementation route.",
      "Return exactly one JSON object and no markdown. Valid shapes:",
      '{"kind":"call_tools","calls":[{"toolName":"registered name","arguments":{}}],"workingSummary":"safe short summary"}',
      '{"kind":"continue","workingSummary":"safe short summary"}',
      '{"kind":"ask_user","question":"business question","missingInformation":["item"],"workingSummary":"safe short summary"}',
      '{"kind":"complete","response":"concise answer grounded in observations","workingSummary":"safe short summary"}',
      '{"kind":"fail","response":"safe explanation","recoverySummary":"safe short summary"}.',
      capabilities.responsesApi
        ? "When a PrintersHero function is useful, call its provided native function instead of returning call_tools text. Public web search is a read-only provider capability: use it only when useful, without asking for GO. Never put private customer, contact, invoice, token, or internal-note data in a public search. Identify provider-returned sources in your final answer when available."
        : "Use only registered tool names and documented arguments. You may use multiple sequential decisions after observations arrive.",
      "Never request or emit IDs not returned by a tool or included in trusted active-task references, organization/user information, permissions, SQL, persistence paths, fingerprints, confirmation tokens, or GO execution. The sole URL exception is web.open, which may use a public URL returned by web.search or supplied by the user; never use URLs to access PrintersHero or private infrastructure.",
      "A direct complete response is a first-class outcome: use trusted observations from this turn or active task to format, reorganize, compare, summarize, explain, shorten, expand, sort, or select already-established results without a tool call. Read only when the user asks for new or freshness-sensitive facts.",
      "Treat a user's requested presentation as part of the goal: honor practical requests such as one per line, separate records, readable layout, bullets, or a table. For small structured multi-record results, normally choose bullets, numbered rows, a compact table, or visually separated record blocks rather than dense prose.",
      "When reformatting information already established in trusted observations, preserve the requested field set and do not normally add unrelated retained fields. Include additional fields only when materially useful to the user's stated goal.",
      "For comparisons over retained observations, compare the full relevant set before naming a unique highest or lowest record. If multiple records share the extreme value, state the tie and name the tied records rather than arbitrarily choosing one.",
      "Reads are authorized when a tool is available. If evidence is partial, choose another legitimate tool before asking the user when possible.",
      "Never ask the user about PrintersHero tools, APIs, database access, or whether a capability exists. Inspect the registered catalog and use the relevant authorized read. If no registered capability can establish a requested fact, complete with an accurate system limitation instead of presenting that gap as missing user information.",
      "The registered catalog is permission-aware. Questions about what the assistant can do are informational: answer directly from that catalog without invoking an underlying planning or action capability. Invoke a planning capability only when the user is actually requesting the work.",
      "Use an unambiguous trusted active-task entity reference for a follow-up instead of asking the user to repeat it.",
      "Protected mutations are represented only by semantic planning tools and must never execute a mutation directly.",
    ].join(" ");
    const user = JSON.stringify({
      goal: input.goal,
      activeTask: {
        taskId: input.taskId,
        safeWorkingSummary: input.safeWorkingSummary,
        domain: input.task?.domain ?? null,
        entityReferences: input.task?.entityReferences ?? [],
        trustedObservations: input.task?.trustedObservations ?? [],
        priorMissingInformation: input.task?.missingInformation ?? [],
      },
      step: input.step,
      remainingSteps: input.remainingSteps,
      tools: input.toolCatalog,
      observations: input.observations.map((observation) => ({ toolName: observation.toolName, status: observation.status, result: observation.result?.data ?? null, warning: observation.warning ?? null })),
    });
    if (capabilities.responsesApi && this.provider.generateOperatorDecision) {
      this.appendFunctionOutputs(input.observations);
      const response = await this.provider.generateOperatorDecision({
        orgId: this.organizationId, feature: "assistant", promptVersion: "ai-operator-runtime-v1", timeoutUseCase: "assistant_operator_decision", timeoutMs: 30_000,
        providerConfig: config, system, user, toolCatalog: input.toolCatalog, responseContinuation: this.responseContinuation,
      });
      const continuation = response.operatorContinuation;
      this.responseContinuation = Array.isArray(continuation?.items) ? [...this.responseContinuation, ...continuation.items] : this.responseContinuation;
      this.pendingFunctionCalls = Array.isArray(continuation?.functionCalls) ? continuation.functionCalls : [];
      this.pendingObservationStart = input.observations.length;
      try { return this.withNativeSources(JSON.parse(response.rawText), response.requestMetadata.nativeWebSources); } catch { throw new Error("ASSISTANT_OPERATOR_INVALID_JSON"); }
    }
    const response = await this.provider.generateJson({
      orgId: this.organizationId,
      feature: "assistant",
      promptVersion: "ai-operator-runtime-v1",
      timeoutUseCase: "assistant_operator_decision",
      timeoutMs: 30_000,
      providerConfig: config,
      system, user,
    });
    try {
      return JSON.parse(response.rawText);
    } catch {
      throw new Error("ASSISTANT_OPERATOR_INVALID_JSON");
    }
  }

  private appendFunctionOutputs(observations: Parameters<AssistantOperatorDecisionProvider["decide"]>[0]["observations"]): void {
    if (!this.pendingFunctionCalls.length) return;
    const available = [...observations.slice(this.pendingObservationStart)];
    for (const call of this.pendingFunctionCalls) {
      const index = available.findIndex((observation) => observation.toolName === call.toolName);
      const observation = index >= 0 ? available.splice(index, 1)[0] : null;
      this.responseContinuation.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(observation ? { status: observation.status, data: observation.result?.data ?? null, warning: observation.warning ?? null } : { status: "failed", warning: "The requested function did not produce an observation." }) });
    }
    this.pendingFunctionCalls = [];
    this.pendingObservationStart = observations.length;
  }

  private withNativeSources(decision: unknown, sources: unknown): unknown {
    if (!decision || typeof decision !== "object" || (decision as { kind?: unknown }).kind !== "complete" || !Array.isArray(sources)) return decision;
    const safeSources = sources.flatMap((source): Array<{ title: string; url: string }> => {
      if (!source || typeof source !== "object") return [];
      const { title, url } = source as { title?: unknown; url?: unknown };
      if (typeof title !== "string" || typeof url !== "string") return [];
      try { const parsed = new URL(url); return parsed.protocol === "https:" || parsed.protocol === "http:" ? [{ title: title.slice(0, 300), url: parsed.toString() }] : []; } catch { return []; }
    }).slice(0, 12);
    if (!safeSources.length) return decision;
    const complete = decision as { response?: unknown };
    if (typeof complete.response !== "string") return decision;
    const appendix = safeSources.map((source) => `- ${source.title}: ${source.url}`).join("\n");
    const response = `${complete.response}\n\nSources:\n${appendix}`;
    return response.length <= 8_000 ? { ...complete, response } : decision;
  }
}
