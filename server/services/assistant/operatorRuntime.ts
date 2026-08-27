import { z } from "zod";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS, type AssistantContextEnvelope, type AssistantStructuredCard, type AssistantToolResultEnvelope } from "@shared/assistantContracts";
import type { ActiveSemanticProductDraftContext } from "./productManagementSkill";
import { currentTurnProductResolution, isProductResolutionObservation, taskForCurrentProductEvidence } from "./trustedProductState";
import { existingProductEditOperationsSchema } from "./existingProductEditContract";

/**
 * The operator loop is intentionally separate from provider transport and
 * persistence.  The model owns the next safe business step; server-owned
 * tools own authorization, validation, tenancy, and observations.
 */
export const DEFAULT_ASSISTANT_OPERATOR_MAX_STEPS = 16;
export const ASSISTANT_OPERATOR_MAX_STEPS = 24;
/** Native providers may return one bounded call per requested comparison.
 * Keep this aligned with the largest supported pricing scenario batch. */
export const ASSISTANT_OPERATOR_MAX_TOOL_CALLS_PER_DECISION = 12;

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

/** Safe structural facts about a provider result. This deliberately excludes
 * provider text, arguments, reasoning, and any business payload. */
const providerDecisionShapeSchema = z.object({
  responseItemCount: z.number().int().nonnegative().max(64).nullable(),
  responseItemTypes: z.array(z.string().trim().min(1).max(80)).max(32),
  unknownItemTypes: z.array(z.string().trim().min(1).max(80)).max(16),
  outputTextPresent: z.boolean(),
  outputTextItemCount: z.number().int().nonnegative().max(64).nullable().optional().default(null),
  outputTextLengths: z.array(z.number().int().nonnegative().max(1_000_000)).max(32).optional().default([]),
  textBeginsKnownTransportMarker: z.boolean().optional().default(false), textEndsKnownTransportMarker: z.boolean().optional().default(false),
  finalTextRemainingAfterTransportStripping: z.boolean().optional().default(false),
  finalTextLength: z.number().int().nonnegative().max(1_000_000).nullable(),
  functionCallItemCount: z.number().int().nonnegative().max(24).nullable().optional().default(null),
  functionCallCount: z.number().int().nonnegative().max(24).nullable(),
  functionArgumentDecodeSucceeded: z.boolean().nullable(),
  responseStatus: z.string().trim().min(1).max(80).nullable(),
  terminalClassification: z.string().trim().min(1).max(80).nullable(), decisionDiscriminator: z.string().trim().min(1).max(80).nullable().optional().default(null),
  structuredDecisionPresent: z.boolean().optional().default(false),
  parseClassification: z.string().trim().min(1).max(80).nullable(),
  controlProtocolDetected: z.boolean(),
  decisionParseStage: z.literal("operator_decision_parse"),
}).strict();
export type ProviderDecisionShape = z.infer<typeof providerDecisionShapeSchema>;

export const assistantOperatorDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("call_tools"), calls: z.array(operatorToolCallSchema).min(1).max(ASSISTANT_OPERATOR_MAX_TOOL_CALLS_PER_DECISION), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  /** A provider-native capability made progress but needs another Responses
   * request before it can produce a user-visible decision. */
  z.object({ kind: z.literal("continue"), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("ask_user"), question: z.string().trim().min(1).max(1_000), missingInformation: z.array(z.string().trim().min(1).max(160)).min(1).max(12), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("complete"), response: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX_CONTENT_CHARS), workingSummary: z.string().trim().min(1).max(2_000).optional() }).strict(),
  z.object({ kind: z.literal("fail"), response: z.string().trim().min(1).max(1_000), recoverySummary: z.string().trim().min(1).max(2_000).optional(), providerDecisionShape: providerDecisionShapeSchema.optional() }).strict(),
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
  /** Safe execution classifications only; argument values and provider text
   * never enter observations or persisted diagnostics. */
  failureCategory?: string;
  failureCode?: string;
  failingStep?: string;
  validationSchema?: string;
  validationIssuePaths?: string[];
  validationIssueCodes?: string[];
  operationType?: string;
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

/** The durable, reduced task contract supplied on every Operator turn. It is
 * descriptive rather than executable: canonical product state, command
 * plans, and authorization remain behind server-owned tool boundaries. */
export type AssistantOperatorBusinessContext = {
  taskType: string;
  businessStateSummary: string | null;
  recentCompletedTurn?: { goal: string; response: string; workingSummary: string | null; capturedAt: string } | null;
  unresolvedDecisions: Array<{ item: string; question?: string; choices?: string[] }>;
  recentOperations: string[];
  trustedSelections: Array<{ field: string; label: string; provenance: string }>;
  readiness: "ready" | "needs_input" | "in_progress" | "unknown";
  constraints: string[];
  capabilities: string[];
  /** A server-refreshed existing product, intentionally label-only. Product
   * identity stays in the trusted execution context, never a model argument. */
  existingProduct?: { name: string; lifecycle: "active" | "inactive"; pricingLifecycle: "DRAFT" | "ACTIVE" | "UNAVAILABLE"; optionGroups: Array<{ label: string; defaultValue: string | null; values: string[] }> } | null;
};

export interface AssistantOperatorToolExecutor {
  catalog(): ReadonlyArray<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
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
    /** Server-derived business state for an active direct Product Builder
     * draft. It is enough for a capable provider to answer outstanding
     * decisions without regenerating or re-reading the product. */
    activeSemanticProductDraft?: ActiveSemanticProductDraftContext | null;
    /** Safe task context common to every domain. It is regenerated from
     * durable state at the start of each turn, never model-written state. */
    businessContext?: AssistantOperatorBusinessContext;
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
    toolCatalog: ReadonlyArray<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
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
    providerDecisionShape?: ProviderDecisionShape;
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

/** Runtime-only equivalence for loop prevention. It is never logged or
 * persisted, and normalizes object key order so semantically identical model
 * calls cannot consume the full investigation budget after one deterministic
 * failure. */
function equivalentToolCallKey(toolName: string, argumentsValue: Record<string, unknown>, productResolutionEpoch = 0): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, normalize(child)]));
  };
  const canonicalArguments = toolName === "products.apply_existing_operations"
    ? (() => {
      const parsed = existingProductEditOperationsSchema.safeParse({ operations: argumentsValue.operations });
      return parsed.success ? parsed.data : argumentsValue;
    })()
    : argumentsValue;
  return `${productResolutionEpoch}:${toolName}:${JSON.stringify(normalize(canonicalArguments))}`;
}

function isDeterministicToolFailure(observation: Pick<AssistantOperatorObservation, "status" | "failureCode">): boolean {
  return observation.status === "rejected"
    || observation.failureCode === "draft_already_active"
    || observation.failureCode === "initial_operations_required"
    || observation.failureCode === "invalid_arguments"
    || observation.failureCode === "core_query_failed"
    || observation.failureCode === "adapter_failed"
    || observation.failureCode === "result_validation_failed";
}

function latestRecoverableProductValidation(observations: readonly AssistantOperatorObservation[]): AssistantOperatorObservation | null {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index]!;
    if (observation.toolName === "products.apply_operations" && observation.status === "rejected" && observation.failureCategory === "recoverable_validation") return observation;
    if (observation.toolName === "products.apply_operations" && observation.status === "succeeded") return null;
  }
  return null;
}

/** Keep diagnostics useful without recording provider text, arguments, or
 * business data. These facts identify the boundary that rejected a decision. */
function decisionDiagnosticShape(value: unknown): { decisionKind: string | null; toolCallCount: number | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { decisionKind: null, toolCallCount: null };
  const record = value as Record<string, unknown>;
  return {
    decisionKind: typeof record.kind === "string" ? record.kind : null,
    toolCallCount: Array.isArray(record.calls) ? record.calls.length : null,
  };
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
    const deterministicFailureKeys = new Set<string>();
    let productResolutionEpoch = 0;
    // A rejected semantic product operation is often a correct canonical
    // safety result, not a terminal workflow failure.  Require one explicit
    // reconsideration per rejected observation before accepting a terminal
    // provider decision; the finite step budget still bounds bad providers.
    let forcedProductReplanForObservationStep = -1;

    for (let step = 1; step <= boundedSteps; step += 1) {
      let decision: AssistantOperatorDecision;
      try {
        providerDecisionCount += 1;
        if (observations.length) console.info("[AI_OPERATOR_TRACE]", { stage: "provider_continuation_started", taskId: input.taskId, step, observationCount: observations.length });
        const productEvidence = currentTurnProductResolution(observations);
        const received = await this.provider.decide({
          goal: input.goal, taskId: input.taskId, step, remainingSteps: boundedSteps - step,
          toolCatalog: this.tools.catalog(), observations, safeWorkingSummary: productEvidence.attempted ? null : safeWorkingSummary, task: taskForCurrentProductEvidence(input.trustedContext.task, observations),
        });
        const parsed = assistantOperatorDecisionSchema.safeParse(received);
        const shape = decisionDiagnosticShape(received);
        console.info("[AI_OPERATOR_TRACE]", { stage: "runtime_schema_validation", taskId: input.taskId, step, succeeded: parsed.success, ...shape });
        if (!parsed.success) {
          console.warn("[AI_OPERATOR_TRACE]", { stage: "final_result_validation", taskId: input.taskId, step, succeeded: false, reason: "operator_decision_schema" });
          return { status: "failed", response: safeFailureResponse(observations), observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
        }
        decision = parsed.data;
      } catch {
        console.warn("[AI_OPERATOR_TRACE]", { stage: "runtime_schema_validation", taskId: input.taskId, step, succeeded: false, reason: "provider_decision_unavailable" });
        return { status: "failed", response: safeFailureResponse(observations), observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
      }
      safeWorkingSummary = decision.kind === "fail" ? decision.recoverySummary ?? safeWorkingSummary : decision.workingSummary ?? safeWorkingSummary;
      if (decision.kind === "continue") { continuationCount += 1; continue; }
      const recoverableProductValidation = latestRecoverableProductValidation(observations);
      if ((decision.kind === "complete" || decision.kind === "fail")
        && recoverableProductValidation
        && recoverableProductValidation.step !== forcedProductReplanForObservationStep
        && step < boundedSteps) {
        forcedProductReplanForObservationStep = recoverableProductValidation.step;
        observations.push({
          step,
          toolName: "operator.replan_required",
          status: "partial",
          warning: "A product operation was rejected by recoverable canonical validation. Inspect its safe validation feedback and refreshed draft context, then use a changed products.apply_operations plan or ask only for a genuinely missing business choice.",
          failureCategory: "recoverable_validation",
          failureCode: "product_plan_revision_required",
          failingStep: recoverableProductValidation.failingStep,
        });
        console.info("[AI_OPERATOR_TRACE]", { stage: "recoverable_product_replan_required", taskId: input.taskId, step, failedStep: recoverableProductValidation.failingStep ?? null });
        continue;
      }
      if (decision.kind === "complete") {
        console.info("[AI_OPERATOR_TRACE]", { stage: "final_result_validation", taskId: input.taskId, step, succeeded: true });
        return { status: "completed", response: decision.response, observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
      }
      if (decision.kind === "ask_user") {
        if (repeatsPriorClarification(input.trustedContext.task?.missingInformation ?? [], decision.missingInformation)) {
          if (input.trustedContext.task?.activeSemanticProductDraft) {
            return {
              status: "awaiting_input",
              response: decision.question,
              observations,
              safeWorkingSummary,
              missingInformation: decision.missingInformation,
              diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }),
            };
          }
          return {
            status: "failed",
            response: "I couldn't reconcile the information already provided with the outstanding request. I won't repeat the same clarification.",
            observations,
            safeWorkingSummary,
            missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }),
          };
        }
        return { status: "awaiting_input", response: decision.question, observations, safeWorkingSummary, missingInformation: decision.missingInformation, diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }) };
      }
      if (decision.kind === "fail") return { status: "failed", response: decision.response, observations, safeWorkingSummary, missingInformation: [], diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false, ...(decision.providerDecisionShape ? { providerDecisionShape: decision.providerDecisionShape } : {}) }) };

      printersHeroToolDecisionCount += 1;
      for (const call of decision.calls) {
        const callKey = equivalentToolCallKey(call.toolName, call.arguments, productResolutionEpoch);
        if (deterministicFailureKeys.has(callKey)) {
          const prior = [...observations].reverse().find((observation) => observation.toolName === call.toolName && isDeterministicToolFailure(observation));
          observations.push({ step, toolName: call.toolName, status: "rejected", warning: "This equivalent operation already failed deterministically; it was not attempted again.", failureCategory: prior?.failureCategory ?? "deterministic_rejection", failureCode: prior?.failureCode ?? "equivalent_operation_rejected", failingStep: prior?.failingStep });
          console.warn("[AI_OPERATOR_TRACE]", { stage: "duplicate_deterministic_tool_failure_blocked", taskId: input.taskId, step, toolName: call.toolName });
          if (call.toolName !== "products.apply_existing_operations") continue;
          return {
            status: "failed",
            response: prior?.warning ?? "The requested business operation was rejected and was not retried without new evidence or a changed proposal.",
            observations,
            safeWorkingSummary,
            missingInformation: [],
            diagnostics: runtimeDiagnostics({ configuredMaxSteps: boundedSteps, stepsConsumed: step, providerDecisionCount, printersHeroToolDecisionCount, continuationCount, finalSynthesisUsed: false }),
          };
        }
        try {
          console.info("[AI_OPERATOR_TRACE]", { stage: "handler_entered", taskId: input.taskId, step, toolName: call.toolName });
          const execution = await this.tools.execute({ toolName: call.toolName, arguments: call.arguments, context: { ...input.trustedContext, analysisObservations: observations } });
          observations.push({ step, ...execution });
          if (isProductResolutionObservation(execution as AssistantOperatorObservation) && execution.status === "succeeded") productResolutionEpoch += 1;
          if (isDeterministicToolFailure(execution)) deterministicFailureKeys.add(callKey);
          console.info("[AI_OPERATOR_TRACE]", { stage: "observation_returned", taskId: input.taskId, step, toolName: call.toolName, status: execution.status });
        } catch {
          // Provider/model execution faults are still bounded observations.
          // Returning them to the model lets it choose a safe alternative or
          // a truthful partial answer without exposing implementation detail.
          observations.push({ step, toolName: call.toolName, status: "failed", warning: "The requested capability was temporarily unavailable." });
          console.warn("[AI_OPERATOR_TRACE]", { stage: "observation_returned", taskId: input.taskId, step, toolName: call.toolName, status: "failed" });
        }
      }
    }
    // This is intentionally not another investigation step: it has existing
    // evidence only and an empty catalog, so it cannot create more work.
    try {
      providerDecisionCount += 1;
      const productEvidence = currentTurnProductResolution(observations);
      const synthesis = assistantOperatorDecisionSchema.parse(await this.provider.decide({
        goal: input.goal, taskId: input.taskId, step: boundedSteps + 1, remainingSteps: 0,
        toolCatalog: [], observations, safeWorkingSummary: productEvidence.attempted ? null : safeWorkingSummary, task: taskForCurrentProductEvidence(input.trustedContext.task, observations), finalSynthesis: true,
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
