import type { AiProviderAdapter, AiProviderResponse } from "../ai/providers/AiProviderAdapter";
import { AiProviderResponseError, AiProviderTimeoutError, AiProviderUnavailableError } from "../ai/providers/AiProviderAdapter";
import { aiProviderResolver, type ResolvedAiProvider } from "../ai/aiProviderResolver";
import { resolveAiOperatorProviderTimeoutMs } from "../ai/providers/configuredProvider";
import { resolveAiProviderCapabilities } from "../ai/providers/providerCapabilities";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS } from "@shared/assistantContracts";
import { parseAssistantOperatorDecisionText, type AssistantOperatorDecisionProvider, type ProviderDecisionShape } from "./operatorRuntime";
import { renderOperatorSkillsForProvider, resolveOperatorSkills, selectOperatorSkills } from "./operatorSkillLoader";

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
    const contextTrace = trustedContextTrace(input);
    console.info("[AI_OPERATOR_TRACE]", { stage: "authoritative_context_available", taskId: input.taskId, ...contextTrace });
    const skillSelection = selectOperatorSkills({
      request: input.goal,
      activeDomain: input.task?.domain,
      trustedEntityTypes: input.task?.entityReferences.map((reference) => reference.type),
    });
    const loadedSkills = await resolveOperatorSkills(skillSelection);
    console.info("[AI_OPERATOR_TRACE]", {
      stage: "operator_skill_context_resolved", taskId: input.taskId,
      selectedDomains: loadedSkills.diagnostics.selectedDomains,
      selectedSkillIds: loadedSkills.diagnostics.selectedSkillIds,
      skillVersions: loadedSkills.diagnostics.skills.map((skill) => `${skill.skillId}@${skill.version}`),
      sourceVersions: loadedSkills.diagnostics.skills.flatMap((skill) => skill.sourceVersions),
      contentChars: loadedSkills.diagnostics.skills.map((skill) => skill.contentChars),
      skippedSkillCount: loadedSkills.diagnostics.skipped.length,
      fallback: loadedSkills.diagnostics.fallback,
      selectionReasons: skillSelection.reasons,
    });
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
      "When a user refers to an already-resolved trusted entity and a registered detail, pricing, or summary capability can act on it, call that capability directly with the trusted reference (or omit identity only where its documented server binding applies). Do not call search.global merely to rediscover a trusted entity. Search is for genuinely unresolved discovery; for a known product discovery, use entityType product.",
      "A standalone request naming one product and asking for its current pricing, defaults, or option dependencies is a direct persisted configuration read, not broad discovery: call products.get_pricing once with query set to that exact product name. Do not call search.global first or retry semantically equivalent searches. If that canonical pricing read returns not_found, complete accurately from that authoritative result.",
      "When the current user turn explicitly names a Product that differs from retained Product context, the current-turn name wins: call the relevant Product read with query set to that name. Never echo the retained Product id alongside that query. If the direct read reports an ambiguous match, use tenant Product search to present the candidates; ask only when canonical discovery cannot select one unambiguously.",
      "Every active task includes a server-derived businessContext. Treat its identity, state summary, unresolved decisions, recent operations, trusted selections and provenance, readiness, constraints, and capabilities as the continuity contract for this turn. Use it to continue the task after a detour or provider swap; do not infer missing business facts, regenerate a draft, or treat it as authorization.",
      "businessContext.recentCompletedTurn is the bounded result of the immediately preceding completed turn. Use it when the current request clearly refers to that result (for example: it, that, summarize it, how thick is it, or make that shorter), and transform its established facts without a new lookup. Do not carry its subject, facts, or entities into an unrelated new request; ask a targeted clarification only when the follow-up cannot be resolved from that context.",
      "When activeTask.activeSemanticProductDraft is present, it is the authoritative unfinished Product Builder business context. For a user answer, correction, or requested draft edit, call products.apply_operations with the smallest valid business operation. Resolve an outstanding decision from that context instead of regenerating a product, asking the user to restate it, or asking an edit-only confirmation. Do not ask for dimensions when the active or requested pricing basis is per square foot. Only ask one question when the requested business change is genuinely ambiguous; draft edits do not require GO, while final product creation does.",
      "If products.apply_operations returns failureCategory recoverable_validation, it is feedback for a revised plan, not a terminal error. Inspect result.validation and the refreshed draftContext, then call products.apply_operations again with changed, valid business operations in dependency order (group before values, values before rates/defaults/dependencies). Never retry an identical rejected operation. Ask the user only when a required business choice is genuinely missing or ambiguous; do not ask them to repeat facts already in the goal or draft context.",
      "For a clear NEW-product request that already gives a name plus business details, the first products.begin_draft call must include every understood detail as ordered initialOperations: identity/category and measurement/pricing before option groups, then option values, rates, dependencies, and defaults. Do not create an empty draft and reconstruct supplied facts later. If products.begin_draft reports that a draft is already active, it did not create another draft: use the returned draft context and products.apply_operations, and never retry products.begin_draft.",
      "When businessContext.existingProduct is present, it identifies a persisted product and takes precedence for a request to change that product. Use products.apply_existing_operations, never products.begin_draft, for an existing-product edit. Use products.begin_draft only when the user intends a distinct NEW product; if an existing product is in context, its tool argument target must be new_product. Do not silently turn an existing-product edit into a new-product draft.",
      "For an explicit existing-product edit, 'do not apply/change it yet' means prepare the protected products.apply_existing_operations preview now; it does not mean skip that capability. Only the separate GO confirmation executes the persisted change.",
      "For a read-only question about the active product draft, answer directly from activeSemanticProductDraft when it contains the requested current business facts; no tool is required. If a conditional request says not to change anything unless current state is wrong and the authoritative context shows it is already correct, complete with that no-op outcome and do not request a mutation.",
      "Protected mutations are represented only by semantic planning tools and must never execute a mutation directly.",
      renderOperatorSkillsForProvider(loadedSkills.skills),
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
        businessContext: input.task?.businessContext ?? null,
        activeSemanticProductDraft: input.task?.activeSemanticProductDraft ?? null,
        entityReferences: input.task?.entityReferences ?? [],
        trustedObservations: input.task?.trustedObservations ?? [],
        priorMissingInformation: input.task?.missingInformation ?? [],
      },
      step: input.step,
      remainingSteps: input.remainingSteps,
      finalSynthesis: Boolean(input.finalSynthesis),
      tools: input.toolCatalog,
      observations: input.observations.map((observation) => ({ toolName: observation.toolName, status: observation.status, result: observation.result?.data ?? null, warning: observation.warning ?? null, failureCategory: observation.failureCategory ?? null, failureCode: observation.failureCode ?? null, failingStep: observation.failingStep ?? null, validationSchema: observation.validationSchema ?? null, validationIssuePaths: observation.validationIssuePaths ?? [], validationIssueCodes: observation.validationIssueCodes ?? [], operationType: observation.operationType ?? null })),
    });
    if (capabilities.responsesApi && this.provider.generateOperatorDecision) {
      this.appendFunctionOutputs(input.observations);
      let response: AiProviderResponse;
      const generateDecision = () => this.provider.generateOperatorDecision!({
        orgId: this.organizationId, feature: "assistant", promptVersion: "ai-operator-runtime-v1", timeoutUseCase: "assistant_operator_decision", timeoutMs: operatorTimeoutMs,
        providerConfig: config, system, user, toolCatalog: input.toolCatalog, responseContinuation: this.responseContinuation,
        operatorRequestSequence: ++this.responseRequestSequence,
      });
      try {
        response = await generateDecision();
      } catch (error) {
        // DeepSeek can intermittently emit a DSML transport fragment as a
        // terminal message after otherwise successful tool observations. The
        // adapter rejects it before any text can reach the user. Retry this
        // one recoverable provider boundary once with the same server-owned
        // observations and continuation; all other provider failures retain
        // their existing safe failure behavior.
        if (!(error instanceof AiProviderResponseError) || error.kind !== "provider_protocol_failure") {
          return providerFailureDecision(error, { taskId: input.taskId, ...contextTrace });
        }
        console.warn("[AI_OPERATOR_TRACE]", {
          stage: "provider_protocol_recovery_started",
          taskId: input.taskId,
          requestSequence: this.responseRequestSequence,
        });
        try {
          response = await generateDecision();
        } catch (retryError) {
          return providerFailureDecision(retryError, { taskId: input.taskId, ...contextTrace });
        }
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
        console.warn("[AI_OPERATOR_TRACE]", {
          stage: "final_result_validation", taskId: input.taskId,
          requestSequence: response.requestMetadata.requestSequence ?? null,
          succeeded: false, reason: "provider_operator_decision_json",
        });
        return { kind: "fail", response: "The AI provider returned an unusable investigation result.", providerDecisionShape: safeProviderDecisionShape(response.requestMetadata) };
      }
      if (hasProviderControlProtocol(decision)) {
        console.warn("[AI_PROVIDER] Blocking provider control protocol from Operator terminal output.", { requestSequence: response.requestMetadata.requestSequence ?? null, apiSurface: response.requestMetadata.apiSurface ?? null, outputItemTypes: response.requestMetadata.outputItemTypes ?? [] });
        console.warn("[AI_OPERATOR_TRACE]", {
          stage: "final_result_validation", taskId: input.taskId,
          requestSequence: response.requestMetadata.requestSequence ?? null,
          succeeded: false, reason: "provider_control_protocol",
        });
        return { kind: "fail", response: "The AI provider returned an unusable investigation result.", providerDecisionShape: safeProviderDecisionShape(response.requestMetadata) };
      }
      if (decision.kind === "complete") {
        console.info("[AI_OPERATOR_TRACE]", { stage: "direct_answer_decision", taskId: input.taskId, requestSequence: response.requestMetadata.requestSequence ?? null, directAnswer: true, toolCallRequested: false, mutationRequested: false, revisionCreated: false, ...contextTrace });
        console.info("[AI_OPERATOR_TRACE]", { stage: "final_result_validation", taskId: input.taskId, requestSequence: response.requestMetadata.requestSequence ?? null, succeeded: true });
      } else if (decision.kind === "call_tools") {
        const toolNames = decision.calls.map((call) => call.toolName);
        console.info("[AI_OPERATOR_TRACE]", { stage: "tool_call_requested", taskId: input.taskId, requestSequence: response.requestMetadata.requestSequence ?? null, directAnswer: false, toolCallRequested: true, toolNames, mutationRequested: toolNames.some((name) => name === "products.begin_draft" || name === "products.apply_operations" || name === "products.apply_existing_operations"), ...contextTrace });
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
    return hasProviderControlProtocol(decision) ? { kind: "fail", response: "The AI provider returned an unusable investigation result." } : decision;
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

function hasProviderControlProtocol(decision: unknown): boolean {
  if (!decision || typeof decision !== "object" || (decision as { kind?: unknown }).kind !== "complete") return false;
  const response = (decision as { response?: unknown }).response;
  return typeof response === "string" && /DSML|<think\b|<\/?[|｜][^>]*(?:thinking|tool_calls|invoke|parameter)|<\/?[|｜]/i.test(response);
}

function trustedContextTrace(input: Parameters<AssistantOperatorDecisionProvider["decide"]>[0]): { authoritativeBusinessContextAvailable: boolean; activeProductDraftAvailable: boolean; relevantTrustedFactsFound: boolean } {
  const active = input.task?.activeSemanticProductDraft;
  const labels = active ? [
    active.name,
    active.category.label,
    active.pricing.optionGroup ?? "",
    ...active.pricing.rates.map((rate) => rate.option),
    ...active.optionGroups.flatMap((group) => [group.label, group.defaultValue ?? "", group.availableWhen?.optionGroup ?? "", group.availableWhen?.value ?? "", ...group.values.map((value) => value.label)]),
  ] : [];
  const requestTerms = input.goal.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
  const labelTerms = labels.flatMap((label) => label.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []);
  return {
    authoritativeBusinessContextAvailable: Boolean(input.task?.businessContext),
    activeProductDraftAvailable: Boolean(active),
    relevantTrustedFactsFound: requestTerms.some((term) => term.length >= 4 && labelTerms.some((label) => label === term || label.startsWith(term) || term.startsWith(label))),
  };
}

function providerFailureDecision(error: unknown, context: { taskId: string; authoritativeBusinessContextAvailable: boolean; activeProductDraftAvailable: boolean; relevantTrustedFactsFound: boolean }): { kind: "fail"; response: string; providerDecisionShape?: ProviderDecisionShape } {
  if (error instanceof AiProviderTimeoutError) return { kind: "fail", response: "The AI provider did not finish the investigation before the request timed out." };
  if (error instanceof AiProviderResponseError) {
    console.warn("[AI_OPERATOR_TRACE]", { stage: "provider_response_failure", ...context, providerFailureKind: error.kind, providerStatus: error.status, toolCallRequested: false, directAnswerDecision: false, finalAnswerAccepted: false });
    const providerDecisionShape = error.responseMetadata ? safeProviderDecisionShape(error.responseMetadata) : undefined;
    if (error.kind === "truncated_output") return { kind: "fail", response: "The AI provider did not return a complete investigation result before its output limit.", ...(providerDecisionShape ? { providerDecisionShape } : {}) };
    if (error.kind === "rate_limit") return { kind: "fail", response: "The AI provider is temporarily busy and could not complete the investigation.", ...(providerDecisionShape ? { providerDecisionShape } : {}) };
    return { kind: "fail", response: "The AI provider did not return a usable investigation result.", ...(providerDecisionShape ? { providerDecisionShape } : {}) };
  }
  throw error;
}

/** Convert adapter-owned metadata into a small persisted diagnostic shape.
 * Never retain provider text, tool arguments, reasoning, or sources. */
function safeProviderDecisionShape(metadata: Record<string, unknown>): ProviderDecisionShape {
  const strings = (value: unknown, maximum: number, length = 80) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, length)).slice(0, maximum)
    : [];
  const number = (value: unknown, maximum: number) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;
  const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 80) : null;
  const responseItemTypes = strings(metadata.outputItemTypes, 32);
  const knownItemTypes = new Set(["message", "output_text", "function_call", "web_search_call", "reasoning"]);
  return {
    responseItemCount: number(metadata.outputItemCount, 64), responseItemTypes,
    unknownItemTypes: responseItemTypes.filter((item) => !knownItemTypes.has(item)).slice(0, 16),
    outputTextPresent: metadata.messageOutputTextPresent === true,
    outputTextItemCount: number(metadata.outputTextItemCount, 64),
    outputTextLengths: (Array.isArray(metadata.outputTextLengths) ? metadata.outputTextLengths : []).filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000).slice(0, 32),
    textBeginsKnownTransportMarker: metadata.textBeginsKnownTransportMarker === true,
    textEndsKnownTransportMarker: metadata.textEndsKnownTransportMarker === true,
    finalTextRemainingAfterTransportStripping: metadata.finalTextRemainingAfterTransportStripping === true,
    finalTextLength: number(metadata.finalTextLength, 1_000_000),
    functionCallItemCount: number(metadata.functionCallItemCount, 24),
    functionCallCount: number(metadata.functionCallCount, 24),
    functionArgumentDecodeSucceeded: typeof metadata.functionArgumentDecodeSucceeded === "boolean" ? metadata.functionArgumentDecodeSucceeded : null,
    responseStatus: text(metadata.responseStatus), terminalClassification: text(metadata.terminalClassification), decisionDiscriminator: text(metadata.decisionDiscriminator), structuredDecisionPresent: metadata.structuredDecisionPresent === true, parseClassification: text(metadata.parseClassification),
    controlProtocolDetected: metadata.controlProtocolDetected === true, decisionParseStage: "operator_decision_parse",
  };
}
