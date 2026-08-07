import type { AiProviderAdapter } from "../ai/providers/AiProviderAdapter";
import { AiProviderUnavailableError } from "../ai/providers/AiProviderAdapter";
import { aiProviderResolver, type ResolvedAiProvider } from "../ai/aiProviderResolver";
import type { AssistantOperatorDecisionProvider } from "./operatorRuntime";

export interface AssistantOperatorProviderResolver {
  resolveProvider(input: { orgId: string; feature: "assistant" }): Promise<ResolvedAiProvider>;
}

/** Provider adapter for one Operator decision. It exposes only the current
 * goal, reduced observations, and safe tool descriptions; authorization and
 * execution remain entirely in the server tool boundary. */
export class ConfiguredAssistantOperatorDecisionProvider implements AssistantOperatorDecisionProvider {
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
    const response = await this.provider.generateJson({
      orgId: this.organizationId,
      feature: "assistant",
      promptVersion: "ai-operator-runtime-v1",
      timeoutUseCase: "assistant_operator_decision",
      timeoutMs: 30_000,
      providerConfig: config,
      system: [
        "You are the PrintersHero AI Operator. Decide the next safe business step, not an implementation route.",
        "Return exactly one JSON object and no markdown. Valid shapes:",
        '{"kind":"call_tools","calls":[{"toolName":"registered name","arguments":{}}],"workingSummary":"safe short summary"}',
        '{"kind":"ask_user","question":"business question","missingInformation":["item"],"workingSummary":"safe short summary"}',
        '{"kind":"complete","response":"concise answer grounded in observations","workingSummary":"safe short summary"}',
        '{"kind":"fail","response":"safe explanation","recoverySummary":"safe short summary"}.',
        "Use only registered tool names and documented arguments. You may use multiple sequential decisions after observations arrive.",
        "Never request or emit IDs not returned by a tool or included in trusted active-task references, organization/user information, permissions, SQL, URLs, persistence paths, fingerprints, confirmation tokens, or GO execution.",
        "A direct complete response is a first-class outcome: use trusted observations from this turn or active task to format, reorganize, compare, summarize, explain, shorten, expand, sort, or select already-established results without a tool call. Read only when the user asks for new or freshness-sensitive facts.",
        "For a multi-record result, choose readable lines, bullets, or a table rather than one dense sentence when that improves comprehension.",
        "Reads are authorized when a tool is available. If evidence is partial, choose another legitimate tool before asking the user when possible.",
        "Never ask the user about PrintersHero tools, APIs, database access, or whether a capability exists. Inspect the registered catalog and use the relevant authorized read. If no registered capability can establish a requested fact, complete with an accurate system limitation instead of presenting that gap as missing user information.",
        "Use an unambiguous trusted active-task entity reference for a follow-up instead of asking the user to repeat it.",
        "Protected mutations are represented only by semantic planning tools and must never execute a mutation directly.",
      ].join(" "),
      user: JSON.stringify({
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
      }),
    });
    try {
      return JSON.parse(response.rawText);
    } catch {
      throw new Error("ASSISTANT_OPERATOR_INVALID_JSON");
    }
  }
}
