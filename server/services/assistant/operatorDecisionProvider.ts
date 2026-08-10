import type { AiProviderAdapter, AiProviderResponse } from "../ai/providers/AiProviderAdapter";
import { AiProviderResponseError, AiProviderTimeoutError, AiProviderUnavailableError } from "../ai/providers/AiProviderAdapter";
import { aiProviderResolver, type ResolvedAiProvider } from "../ai/aiProviderResolver";
import { resolveAiOperatorProviderTimeoutMs } from "../ai/providers/configuredProvider";
import { resolveAiProviderCapabilities } from "../ai/providers/providerCapabilities";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS } from "@shared/assistantContracts";
import { parseAssistantOperatorDecisionText, type AssistantOperatorDecisionProvider } from "./operatorRuntime";

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
  private responseRequestSequence = 0;
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
    const operatorTimeoutMs = resolveAiOperatorProviderTimeoutMs();
    const system = [
      "You are the PrintersHero AI Operator. Decide the next safe business step, not an implementation route.",
      "Return exactly one JSON object and no markdown. Valid shapes:",
      '{"kind":"call_tools","calls":[{"toolName":"registered name","arguments":{}}],"workingSummary":"safe short summary"}',
      '{"kind":"continue","workingSummary":"safe short summary"}',
      '{"kind":"ask_user","question":"business question","missingInformation":["item"],"workingSummary":"safe short summary"}',
      '{"kind":"complete","response":"concise answer grounded in observations","workingSummary":"safe short summary"}',
      '{"kind":"fail","response":"safe explanation","recoverySummary":"safe short summary"}.',
      capabilities.responsesApi
        ? "When a PrintersHero function is useful, call its provided native function instead of returning call_tools text. Public web search is a read-only provider capability: use it only when useful, without asking for GO. Never put private customer, contact, invoice, token, or internal-note data in a public search. Do not invent or present model-generated domains as verified sources: provider-returned source links are appended separately when available. If the user requests sources but research has no provider source metadata, say that verified links were unavailable."
        : "Use only registered tool names and documented arguments. You may use multiple sequential decisions after observations arrive.",
      "Never request or emit IDs not returned by a tool or included in trusted active-task references, organization/user information, permissions, SQL, persistence paths, fingerprints, confirmation tokens, or GO execution. The sole URL exception is web.open, which may use a public URL returned by web.search or supplied by the user; never use URLs to access PrintersHero or private infrastructure.",
      "A direct complete response is a first-class outcome: use trusted observations from this turn or active task to format, reorganize, compare, summarize, explain, shorten, expand, sort, or select already-established results without a tool call. Read only when the user asks for new or freshness-sensitive facts.",
      "Treat a user's requested presentation as part of the goal: honor practical requests such as one per line, separate records, readable layout, bullets, or a table. For small structured multi-record results, normally choose bullets, numbered rows, a compact table, or visually separated record blocks rather than dense prose.",
      "When reformatting information already established in trusted observations, preserve the requested field set and do not normally add unrelated retained fields. Include additional fields only when materially useful to the user's stated goal.",
      "For comparisons over retained observations, compare the full relevant set before naming a unique highest or lowest record. If multiple records share the extreme value, state the tie and name the tied records rather than arbitrarily choosing one.",
      "Reads are authorized when a tool is available. If evidence is partial, choose another legitimate tool before asking the user when possible.",
      "PrintersHero is not read-only: the permission-aware catalog may support authorized investigation, public research, analysis, protected change planning, and GO-gated execution. Describe those capabilities accurately without implying that a protected change runs before its required confirmation.",
      "Never ask the user about PrintersHero tools, APIs, database access, or whether a capability exists. Inspect the registered catalog and use the relevant authorized read. If no registered capability can establish a requested fact, complete with an accurate system limitation instead of presenting that gap as missing user information.",
      "The registered catalog is permission-aware. Questions about what the assistant can do are informational: answer directly from that catalog without invoking an underlying planning or action capability. Invoke a planning capability only when the user is actually requesting the work.",
      "Use an unambiguous trusted active-task entity reference for a follow-up instead of asking the user to repeat it.",
      "When activeTask.activeSemanticProductDraft is present, it is the authoritative unfinished Product Builder business context. For a user answer, correction, or requested draft edit, call products.apply_operations with the smallest valid business operation. Resolve an outstanding decision from that context instead of regenerating a product, asking the user to restate it, or asking an edit-only confirmation. Do not ask for dimensions when the active or requested pricing basis is per square foot. Only ask one question when the requested business change is genuinely ambiguous; draft edits do not require GO, while final product creation does.",
      "Protected mutations are represented only by semantic planning tools and must never execute a mutation directly.",
      input.finalSynthesis
        ? "Investigation capacity is exhausted. Produce one truthful final synthesis using only supplied observations and active-task context. You have no tools in this response: do not return call_tools or continue, do not claim unobserved research, and clearly state evidence gaps."
        : "",
    ].join(" ");
    const user = JSON.stringify({
      goal: input.goal,
      activeTask: {
        taskId: input.taskId,
        safeWorkingSummary: input.safeWorkingSummary,
        domain: input.task?.domain ?? null,
        activeSemanticProductDraft: input.task?.activeSemanticProductDraft ?? null,
        entityReferences: input.task?.entityReferences ?? [],
        trustedObservations: input.task?.trustedObservations ?? [],
        priorMissingInformation: input.task?.missingInformation ?? [],
      },
      step: input.step,
      remainingSteps: input.remainingSteps,
      finalSynthesis: Boolean(input.finalSynthesis),
      tools: input.toolCatalog,
      observations: input.observations.map((observation) => ({ toolName: observation.toolName, status: observation.status, result: observation.result?.data ?? null, warning: observation.warning ?? null })),
    });
    if (capabilities.responsesApi && this.provider.generateOperatorDecision) {
      this.appendFunctionOutputs(input.observations);
      let response: AiProviderResponse;
      try {
        response = await this.provider.generateOperatorDecision({
          orgId: this.organizationId, feature: "assistant", promptVersion: "ai-operator-runtime-v1", timeoutUseCase: "assistant_operator_decision", timeoutMs: operatorTimeoutMs,
          providerConfig: config, system, user, toolCatalog: input.toolCatalog, responseContinuation: this.responseContinuation,
          operatorRequestSequence: ++this.responseRequestSequence,
        });
      } catch (error) {
        return providerFailureDecision(error);
      }
      const continuation = response.operatorContinuation;
      this.responseContinuation = Array.isArray(continuation?.items) ? [...this.responseContinuation, ...continuation.items] : this.responseContinuation;
      this.pendingFunctionCalls = Array.isArray(continuation?.functionCalls) ? continuation.functionCalls : [];
      this.pendingObservationStart = input.observations.length;
      const decision = parseAssistantOperatorDecisionText(response.rawText);
      if (!decision) {
        console.warn("[AI_PROVIDER] DeepSeek Responses Operator decision could not be parsed.", {
          requestSequence: response.requestMetadata.requestSequence ?? null,
          apiSurface: response.requestMetadata.apiSurface ?? null,
          responseStatus: response.requestMetadata.responseStatus ?? null,
          outputItemTypes: response.requestMetadata.outputItemTypes ?? [],
          parseClassification: "invalid_operator_json",
        });
        return { kind: "fail", response: "The AI provider returned an unusable investigation result." };
      }
      return this.withNativeSources(decision, response.requestMetadata.nativeWebSources);
    }
    const response = await this.provider.generateJson({
      orgId: this.organizationId,
      feature: "assistant",
      promptVersion: "ai-operator-runtime-v1",
      timeoutUseCase: "assistant_operator_decision",
      timeoutMs: operatorTimeoutMs,
      providerConfig: config,
      system, user,
    });
    const decision = parseAssistantOperatorDecisionText(response.rawText);
    if (!decision) throw new Error("ASSISTANT_OPERATOR_INVALID_JSON");
    return decision;
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
    const safeSources = sources.flatMap((source): Array<{ title: string; url: string; domain: string; providerSourceReference?: string }> => {
      if (!source || typeof source !== "object") return [];
      const { title, url, domain, providerSourceReference } = source as { title?: unknown; url?: unknown; domain?: unknown; providerSourceReference?: unknown };
      if (typeof title !== "string" || typeof url !== "string") return [];
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];
        const safeDomain = typeof domain === "string" && domain.trim() ? domain.slice(0, 255) : parsed.hostname.toLowerCase();
        const safeReference = typeof providerSourceReference === "string" && providerSourceReference.trim() ? providerSourceReference.slice(0, 160) : undefined;
        return [{ title: title.slice(0, 300), url: parsed.toString(), domain: safeDomain, ...(safeReference ? { providerSourceReference: safeReference } : {}) }];
      } catch { return []; }
    }).slice(0, 12);
    if (!safeSources.length) return decision;
    const complete = decision as { response?: unknown };
    if (typeof complete.response !== "string") return decision;
    const lines = safeSources.map((source) => `- [${source.title}](${source.url}) (${source.domain})`);
    const heading = "\n\nProvider-verified sources:\n";
    const available = ASSISTANT_MESSAGE_MAX_CONTENT_CHARS - complete.response.length - heading.length;
    if (available <= 0) return decision;
    const included: string[] = [];
    for (const line of lines) {
      if (included.join("\n").length + line.length + (included.length ? 1 : 0) > available) break;
      included.push(line);
    }
    return included.length ? { ...complete, response: `${complete.response}${heading}${included.join("\n")}` } : decision;
  }
}

function providerFailureDecision(error: unknown): { kind: "fail"; response: string } {
  if (error instanceof AiProviderTimeoutError) return { kind: "fail", response: "The AI provider did not finish the investigation before the request timed out." };
  if (error instanceof AiProviderResponseError) {
    if (error.kind === "truncated_output") return { kind: "fail", response: "The AI provider did not return a complete investigation result before its output limit." };
    if (error.kind === "rate_limit") return { kind: "fail", response: "The AI provider is temporarily busy and could not complete the investigation." };
    return { kind: "fail", response: "The AI provider did not return a usable investigation result." };
  }
  throw error;
}
