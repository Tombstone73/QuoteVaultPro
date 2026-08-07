import { z } from "zod";
import type { AssistantContextEnvelope, AssistantStructuredCard, AssistantToolResultEnvelope } from "@shared/assistantContracts";

/**
 * The operator loop is intentionally separate from provider transport and
 * persistence.  The model owns the next safe business step; server-owned
 * tools own authorization, validation, tenancy, and observations.
 */
export const ASSISTANT_OPERATOR_MAX_STEPS = 8;

const operatorToolCallSchema = z.object({
  toolName: z.string().trim().min(1).max(120),
  arguments: z.record(z.unknown()),
}).strict();

export const assistantOperatorDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("call_tools"), calls: z.array(operatorToolCallSchema).min(1).max(3), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("ask_user"), question: z.string().trim().min(1).max(1_000), missingInformation: z.array(z.string().trim().min(1).max(160)).min(1).max(12), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("complete"), response: z.string().trim().min(1).max(8_000), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("fail"), response: z.string().trim().min(1).max(1_000), recoverySummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
]);
export type AssistantOperatorDecision = z.infer<typeof assistantOperatorDecisionSchema>;

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
  }): Promise<unknown>;
}

export type AssistantOperatorRunResult = {
  status: "completed" | "awaiting_input" | "failed" | "step_limit";
  response: string;
  observations: AssistantOperatorObservation[];
  safeWorkingSummary: string | null;
  missingInformation: string[];
};

function safeFailureResponse(observations: readonly AssistantOperatorObservation[]): string {
  const last = observations.at(-1);
  if (last?.status === "permission_denied") return "I don't have permission to inspect the information needed to complete that request.";
  if (last?.status === "rejected") return "I couldn't complete that request because the needed business lookup is unavailable or invalid.";
  if (last?.status === "failed" || last?.status === "timed_out") return "I couldn't complete the requested business lookup because it was unavailable. Nothing was changed.";
  return "I couldn't complete the request because the AI Operator could not complete its investigation. Nothing was changed.";
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
    private readonly maxSteps = ASSISTANT_OPERATOR_MAX_STEPS,
  ) {}

  async run(input: { goal: string; taskId: string; trustedContext: AssistantOperatorTrustedContext; initialWorkingSummary?: string | null }): Promise<AssistantOperatorRunResult> {
    const observations: AssistantOperatorObservation[] = [];
    let safeWorkingSummary = input.initialWorkingSummary ?? null;
    const boundedSteps = Math.max(1, Math.min(ASSISTANT_OPERATOR_MAX_STEPS, this.maxSteps));

    for (let step = 1; step <= boundedSteps; step += 1) {
      let decision: AssistantOperatorDecision;
      try {
        decision = assistantOperatorDecisionSchema.parse(await this.provider.decide({
          goal: input.goal, taskId: input.taskId, step, remainingSteps: boundedSteps - step,
          toolCatalog: this.tools.catalog(), observations, safeWorkingSummary, task: input.trustedContext.task,
        }));
      } catch {
        return { status: "failed", response: safeFailureResponse(observations), observations, safeWorkingSummary, missingInformation: [] };
      }
      safeWorkingSummary = decision.kind === "fail" ? decision.recoverySummary ?? safeWorkingSummary : decision.workingSummary ?? safeWorkingSummary;
      if (decision.kind === "complete") return { status: "completed", response: decision.response, observations, safeWorkingSummary, missingInformation: [] };
      if (decision.kind === "ask_user") {
        if (repeatsPriorClarification(input.trustedContext.task?.missingInformation ?? [], decision.missingInformation)) {
          return {
            status: "failed",
            response: "I couldn't reconcile the information already provided with the outstanding request. I won't repeat the same clarification; please start a new request if you still need help.",
            observations,
            safeWorkingSummary,
            missingInformation: [],
          };
        }
        return { status: "awaiting_input", response: decision.question, observations, safeWorkingSummary, missingInformation: decision.missingInformation };
      }
      if (decision.kind === "fail") return { status: "failed", response: decision.response, observations, safeWorkingSummary, missingInformation: [] };

      for (const call of decision.calls) {
        const execution = await this.tools.execute({ toolName: call.toolName, arguments: call.arguments, context: input.trustedContext });
        observations.push({ step, ...execution });
      }
    }
    return {
      status: "step_limit",
      response: "I need one more safe investigation step to finish that request. Please try again.",
      observations,
      safeWorkingSummary,
      missingInformation: [],
    };
  }
}
