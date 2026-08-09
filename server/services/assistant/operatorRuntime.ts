import { z } from "zod";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS, type AssistantContextEnvelope, type AssistantStructuredCard, type AssistantToolResultEnvelope } from "@shared/assistantContracts";

/**
 * The operator loop is intentionally separate from provider transport and
 * persistence.  The model owns the next safe business step; server-owned
 * tools own authorization, validation, tenancy, and observations.
 */
export const DEFAULT_ASSISTANT_OPERATOR_MAX_STEPS = 16;
export const ASSISTANT_OPERATOR_MAX_STEPS = 24;

/** Optional per-deployment investigation budget. It stays finite even when
 * configured incorrectly, while the default permits real multi-source work. */
export function resolveAiOperatorMaxSteps(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.AI_OPERATOR_MAX_STEPS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_ASSISTANT_OPERATOR_MAX_STEPS;
  return Math.max(1, Math.min(ASSISTANT_OPERATOR_MAX_STEPS, Math.floor(configured)));
}

const operatorToolCallSchema = z.object({
  toolName: z.string().trim().min(1).max(120),
  arguments: z.record(z.unknown()),
}).strict();

export const assistantOperatorDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("call_tools"), calls: z.array(operatorToolCallSchema).min(1).max(3), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  /** A provider-native capability made progress but needs another Responses
   * request before it can produce a user-visible decision. */
  z.object({ kind: z.literal("continue"), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("ask_user"), question: z.string().trim().min(1).max(1_000), missingInformation: z.array(z.string().trim().min(1).max(160)).min(1).max(12), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("complete"), response: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("fail"), response: z.string().trim().min(1).max(1_000), recoverySummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
]);
export type AssistantOperatorDecision = z.infer<typeof assistantOperatorDecisionSchema>;

/**
 * Parse only a complete, schema-valid Operator control message.  This is
 * intentionally narrow: ordinary JSON remains an ordinary user-facing
 * response, while a known control shape can stay inside the Operator loop.
 */
export function parseAssistantOperatorDecisionText(value: string): AssistantOperatorDecision | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const first = JSON.parse(trimmed) as unknown;
    // Some Responses payloads have returned the protocol JSON as one JSON
    // string value. Accept exactly one additional layer, never an unbounded
    // recursive decoder, and only consume a schema-valid control message.
    const normalized = typeof first === "string" ? JSON.parse(first) : first;
    const parsed = assistantOperatorDecisionSchema.safeParse(normalized);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type AssistantOperatorObservation = {
  step: number;
  toolName: string;
  status: "succeeded" | "not_found" | "permission_denied" | "partial" | "failed" | "rejected" | "timed_out";
  result?: AssistantToolResultEnvelope;
  warning?: string;
  /** Server-to-browser presentation only. It is intentionally excluded from
   * subsequent provider decisions so the model never receives GO tokens,
   * plan identifiers, fingerprints, or command payloads. */
  presentation?: { cards: AssistantStructuredCard[] };
};

/** A bounded, already-authorized read result retained for presentation-only
 * follow-ups. It is never authorization, freshness, or mutation authority. */
export type AssistantOperatorTrustedObservation = {
  toolName: string;
  data: unknown;
  capturedAt: string;
};

export interface AssistantOperatorToolExecutor {
  catalog(): ReadonlyArray<{ name: string; description: string }>;
  execute(input: { toolName: string; arguments: Record<string, unknown>; context: AssistantOperatorTrustedContext }): Promise<Omit<AssistantOperatorObservation, "step">>;
}

export interface AssistantOperatorTrustedContext {
  scope: { organizationId: string; userId: string };
  conversationId: string;
  actor: { userId: string; email: string | null };
  permissions: readonly string[];
  context: AssistantContextEnvelope;
  correlationId: string;
  /** Original user goal is trusted conversational input, never a model tool
   * argument. Semantic adapters can use it without asking the model to repeat
   * it in a persistence-shaped payload. */
  goal: string;
  task?: {
    id: string;
    domain: string | null;
    canonicalProductIntentProposalId: string | null;
    /** Reduced, server-derived references from prior observations in this
     * conversation. They support unambiguous follow-ups, never authorization. */
    entityReferences: Array<{ type: string; id: string; label?: string }>;
    /** Validated read data from recent turns. It lets the provider answer a
     * harmless transformation directly without refetching changing state. */
    trustedObservations?: AssistantOperatorTrustedObservation[];
    /** A repeated identical clarification is a recovery signal, not a reason
     * to keep asking the same question after a user replies. */
    missingInformation?: string[];
  };
  /** Prior tool observations in this runtime only. Semantic tools may inspect
   * these released facts, never ambient services or untrusted model state. */
  analysisObservations?: readonly AssistantOperatorObservation[];
}

export interface AssistantOperatorDecisionProvider {
  decide(input: {
    goal: string;
    taskId: string;
    step: number;
    remainingSteps: number;
    toolCatalog: ReadonlyArray<{ name: string; description: string }>;
    observations: readonly AssistantOperatorObservation[];
    safeWorkingSummary: string | null;
    task?: AssistantOperatorTrustedContext["task"];
    /** Final evidence-only response opportunity after the investigation
     * budget is exhausted. It always has an empty tool catalog. */
    finalSynthesis?: boolean;
  }): Promise<unknown>;
}

export type AssistantOperatorRunResult = {
  status: "completed" | "awaiting_input" | "failed" | "step_limit";
  response: string;
  observations: AssistantOperatorObservation[];
  safeWorkingSummary: string | null;
  missingInformation: string[];
  diagnostics: {
    configuredMaxSteps: number;
    stepsConsumed: number;
    providerDecisionCount: number;
    printersHeroToolDecisionCount: number;
    continuationCount: number;
    finalSynthesisUsed: boolean;
  };
};

function runtimeDiagnostics(input: AssistantOperatorRunResult["diagnostics"]) { return input; }

function safeFailureResponse(observations: readonly AssistantOperatorObservation[]): string {
  const last = observations.at(-1);
  if (last?.status === "permission_denied") return "I don't have permission to inspect the information needed to complete that request.";
  if (last?.status === "rejected") return "I couldn't complete that request because the needed business lookup is unavailable or invalid.";
  const retainedEvidence = observations.some((observation) => observation.status === "succeeded" || observation.status === "partial" || observation.status === "not_found");
  if (last?.status === "failed" || last?.status === "timed_out") {
    return retainedEvidence
      ? "I completed part of the investigation, but a later lookup was unavailable. The completed results remain available above."
      : "I couldn't complete the requested business lookup because it was unavailable.";
  }
  return retainedEvidence
    ? "I completed part of the investigation, but the Operator could not finish a later step. The completed results remain available above."
    : "I couldn't complete the request because the AI Operator could not complete its investigation.";
}

function repeatsPriorClarification(previous: readonly string[], next: readonly string[]): boolean {
  if (!previous.length || previous.length !== next.length) return false;
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const prior = [...previous].map(normalize).sort();
  const requested = [...next].map(normalize).sort();
  return prior.every((value, index) => value === requested[index]);
}

/** A bounded sequential tool loop. It deliberately has no mutation executor:
 * protected work remains a proposal/confirmation/GO responsibility of the
 * existing deterministic command layer. */
export class AssistantOperatorRuntime {
  constructor(
    private readonly provider: AssistantOperatorDecisionProvider,
    private readonly tools: AssistantOperatorToolExecutor,
    private readonly maxSteps = resolveAiOperatorMaxSteps(),
  ) {}

  async run(input: { goal: string; taskId: string; trustedContext: AssistantOperatorTrustedContext; initialWorkingSummary?: string | null }): Promise<AssistantOperatorRunResult> {
    const observations: AssistantOperatorObservation[] = [];
    let safeWorkingSummary = input.initialWorkingSummary ?? null;
    const boundedSteps = Math.max(1, Math.min(ASSISTANT_OPERATOR_MAX_STEPS, this.maxSteps));
    let providerDecisionCount = 0;
    let printersHeroToolDecisionCount = 0;
    let continuationCount = 0;

    for (let step = 1; step <= boundedSteps; step += 1) {
      let decision: AssistantOperatorDecision;
      try {
        providerDecisionCount += 1;
        decision = assistantOperatorDecisionSchema.parse(await this.provider.decide({
          goal: input.goal, taskId: input.taskId, step, remainingSteps: boundedSteps - step,
          toolCatalog: this.tools.catalog(), observations, safeWorkingSummary, task: input.trustedContext.task,
        }));
      } catch {
        return { status: "failed", response: safeFailureResponse(observations), observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
      }
      safeWorkingSummary = decision.kind === "fail" ? decision.recoverySummary ?? safeWorkingSummary : decision.workingSummary ?? safeWorkingSummary;
      if (decision.kind === "continue") { continuationCount += 1; continue; }
      if (decision.kind === "complete") return { status: "completed", response: decision.response, observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
      if (decision.kind === "ask_user") {
        if (repeatsPriorClarification(input.trustedContext.task?.missingInformation ?? [], decision.missingInformation)) {
          return {
            status: "failed",
            response: "I couldn't reconcile the information already provided with the outstanding request. I won't repeat the same clarification; please start a new request if you still need help.",
            observations,
            safeWorkingSummary,
            missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }),
          };
        }
        return { status: "awaiting_input", response: decision.question, observations, safeWorkingSummary, missingInformation: decision.missingInformation, diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
      }
      if (decision.kind === "fail") return { status: "failed", response: decision.response, observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };

      printersHeroToolDecisionCount += 1;
      for (const call of decision.calls) {
        try {
          const execution = await this.tools.execute({ toolName: call.toolName, arguments: call.arguments, context: { ...input.trustedContext, analysisObservations: observations } });
          observations.push({ step, ...execution });
        } catch {
          // Provider/model execution faults are still bounded observations.
          // Returning them to the model lets it choose a safe alternative or
          // a truthful partial answer without exposing implementation detail.
          observations.push({ step, toolName: call.toolName, status: "failed", warning: "The requested capability was temporarily unavailable." });
        }
      }
    }
    // This is intentionally not another investigation step: it has existing
    // evidence only and an empty catalog, so it cannot create more work.
    try {
      providerDecisionCount += 1;
      const synthesis = assistantOperatorDecisionSchema.parse(await this.provider.decide({
        goal: input.goal, taskId: input.taskId, step: boundedSteps + 1, remainingSteps: 0,
        toolCatalog: [], observations, safeWorkingSummary, task: input.trustedContext.task, finalSynthesis: true,
      }));
      safeWorkingSummary = synthesis.kind === "fail" ? synthesis.recoverySummary ?? safeWorkingSummary : synthesis.workingSummary ?? safeWorkingSummary;
      if (synthesis.kind === "complete") return { status: "completed", response: synthesis.response, observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: boundedSteps, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: true }) };
      if (synthesis.kind === "fail") return { status: "failed", response: synthesis.response, observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: boundedSteps, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: true }) };
    } catch {
      // The completed observations remain persisted and available in cards.
    }
    return { status: "step_limit", response: observations.length
      ? "I completed the available investigation steps, but could not safely produce a final synthesis from the evidence gathered. The completed results remain available above."
      : "I could not complete the investigation within the configured safety limit.", observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: boundedSteps, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: true }) };
  }
}
