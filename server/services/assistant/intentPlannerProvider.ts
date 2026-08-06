import { randomUUID } from "crypto";
import {
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderResponse,
} from "../ai/providers/AiProviderAdapter";
import type { ResolvedAiProvider } from "../ai/aiProviderResolver";
import {
  assistantIntentPlanSchema,
  type AssistantIntentPlan,
} from "./aiFirstIntentPlannerContract";
import { sanitizeAiDiagnosticEnvelope } from "@shared/aiDiagnostics";

/**
 * Provider-neutral boundary for the AI-first planner.  It intentionally owns
 * only transport, strict JSON extraction, contract validation, and bounded
 * repair.  It cannot select a legacy route or execute a business command.
 */
export interface AssistantIntentPlannerProvider {
  plan(input: AssistantIntentPlannerProviderInput): Promise<AssistantIntentPlannerProviderOutcome>;
}

export interface AssistantIntentPlannerProviderInput {
  organizationId: string;
  system: string;
  user: string;
  promptVersion: string;
  timeoutMs?: number;
  timeoutUseCase?: string;
  maxTokens?: number;
}

export interface AssistantIntentPlannerProviderResolver {
  resolveProvider(input: { orgId: string; feature: "assistant" }): Promise<ResolvedAiProvider>;
}

export interface AssistantIntentPlannerDiagnostics {
  correlationId: string;
  provider: string | null;
  model: string | null;
  attempts: number;
  stage: "success" | "provider_unavailable" | "provider_failure" | "invalid_json" | "invalid_contract";
  repairAttempted: boolean;
  providerMetadata: Record<string, unknown>;
  validationIssuePaths?: string[];
}

export type AssistantIntentPlannerProviderOutcome =
  | { ok: true; plan: AssistantIntentPlan; diagnostics: AssistantIntentPlannerDiagnostics }
  | {
    ok: false;
    error: {
      code: "provider_unavailable" | "provider_failure" | "invalid_json" | "invalid_contract";
      message: string;
      retryable: boolean;
      correlationId: string;
    };
    diagnostics: AssistantIntentPlannerDiagnostics;
  };

const MAX_REPAIR_ATTEMPTS = 1;
const MAX_REPAIR_OUTPUT_CHARS = 24_000;

function safeRequestMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const result: Record<string, unknown> = {};
  for (const key of ["latencyMs", "providerRequestId", "providerResponseId", "finishReason", "maxTokens", "timeoutMs", "timeoutUseCase", "providerFamily", "repairAttempt", "mode", "source"]) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean" || candidate === null) result[key] = candidate;
  }
  const usage = value.usage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const safeUsage: Record<string, number> = {};
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
      const candidate = (usage as Record<string, unknown>)[key];
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) safeUsage[key] = candidate;
    }
    if (Object.keys(safeUsage).length > 0) result.usage = safeUsage;
  }
  return result;
}

/**
 * Providers occasionally wrap an otherwise valid JSON object in a markdown
 * fence or a short sentence despite JSON-mode. Extract one balanced object,
 * then keep the contract parser strict. This never accepts a second object,
 * arbitrary prose as a plan, or an array.
 */
export function extractPlannerJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const source = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(source);
  } catch {
    // Continue only when a single balanced object is embedded in prose.
  }
  const start = source.indexOf("{");
  if (start < 0) throw new Error("Planner response must include a JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        if (source.slice(index + 1).includes("{")) throw new Error("Planner response contains more than one JSON object.");
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }
  throw new Error("Planner response did not contain a complete JSON object.");
}

function strictJsonObject(rawText: string): unknown {
  const parsed = extractPlannerJsonObject(rawText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Planner response must be a JSON object.");
  }
  return parsed;
}

function validationIssuePaths(error: { issues: Array<{ path: PropertyKey[]; code: string; keys?: string[] }> }): string[] {
  return error.issues.slice(0, 20).flatMap((issue) => {
    const base = issue.path.map(String).join(".") || "result";
    return issue.code === "unrecognized_keys" && Array.isArray(issue.keys)
      ? issue.keys.map((key) => `${base}.${key}`)
      : [base];
  });
}

function safeFailureKind(error: unknown): string | null {
  const value = error && typeof error === "object" ? (error as { kind?: unknown }).kind : null;
  return typeof value === "string" && /^[a-z_]+$/.test(value) ? value : null;
}

function repairPrompt(input: AssistantIntentPlannerProviderInput, invalidOutput: string, issues: readonly string[]): { system: string; user: string } {
  return {
    system: `${input.system}\nYour previous response was invalid. Return exactly one repaired JSON object that conforms to the planner contract. Do not add markdown, prose, unknown fields, new facts, or executable payloads.`,
    user: JSON.stringify({
      plannerInput: input.user,
      invalidPlannerOutput: invalidOutput.slice(0, MAX_REPAIR_OUTPUT_CHARS),
      validationIssuePaths: issues.slice(0, 20),
      instruction: "Repair only the planner response. Return strict JSON only.",
    }),
  };
}

function logPlannerFailure(organizationId: string, diagnostics: AssistantIntentPlannerDiagnostics, extra: Record<string, unknown> = {}) {
  // Do not include messages, prompts, raw model output, endpoints, or secrets.
  console.warn("[ASSISTANT_INTENT_PLANNER] Planning failed.", {
    organizationId,
    correlationId: diagnostics.correlationId,
    provider: diagnostics.provider,
    model: diagnostics.model,
    attempts: diagnostics.attempts,
    stage: diagnostics.stage,
    repairAttempted: diagnostics.repairAttempted,
    providerRequestId: diagnostics.providerMetadata.providerRequestId ?? null,
    ...extra,
  });
}

async function persistPlannerDiagnostic(organizationId: string, diagnostics: AssistantIntentPlannerDiagnostics, errorCode: string) {
  try {
    const envelope = sanitizeAiDiagnosticEnvelope({ version: 1, referenceId: diagnostics.correlationId, correlationId: diagnostics.correlationId, diagnosticType: "ai_planner", tenantId: organizationId, actorId: null, conversationId: null, provider: diagnostics.provider, model: diagnostics.model, providerRequestId: diagnostics.providerMetadata.providerRequestId as string ?? null, stage: diagnostics.stage, errorCode, providerResponseState: diagnostics.stage === "invalid_json" ? "parse_failed" : diagnostics.stage === "invalid_contract" ? "contract_failed" : "not_received", parseMethod: "none", repairAttempted: diagnostics.repairAttempted, repairResult: diagnostics.repairAttempted ? "failed" : "not_attempted", validationSchema: diagnostics.stage === "invalid_contract" ? "AssistantIntentPlan" : null, validationIssuePaths: diagnostics.validationIssuePaths ?? [], validationIssueCodes: [], returnedTopLevelKeys: [], missingRequiredKeys: [], unknownKeys: [], plannerOperation: null, selectedCapability: null, specialistName: null, optionNormalizationStage: null, resolverStage: null, persistenceAttempted: false, persistenceResult: "not_attempted", createdAt: new Date().toISOString() });
    const { db } = await import("../../db"); const { aiAuditEvents } = await import("@shared/schema");
    await db.insert(aiAuditEvents).values({ orgId: organizationId, eventType: "ai_diagnostic", status: "failed", correlationId: envelope.correlationId, metadata: envelope });
  } catch { /* preserve the planner's original safe failure */ }
}

/**
 * Works with the existing OpenAI-compatible adapter (including DeepSeek's
 * JSON-mode policy) and with future adapters that implement AiProviderAdapter.
 * The contract is intentionally the same regardless of provider transport.
 */
export class ConfiguredAssistantIntentPlannerProvider implements AssistantIntentPlannerProvider {
  constructor(
    private readonly provider: AiProviderAdapter,
    private readonly resolver?: AssistantIntentPlannerProviderResolver,
  ) {}

  async plan(input: AssistantIntentPlannerProviderInput): Promise<AssistantIntentPlannerProviderOutcome> {
    const correlationId = `aip-${randomUUID()}`;
    let response: AiProviderResponse | null = null;
    let stage: AssistantIntentPlannerDiagnostics["stage"] = "provider_failure";
    let issues: string[] = [];

    let config: ResolvedAiProvider;
    try {
      // Do not initialize the database-backed provider resolver for unit tests
      // or injected future adapters. Production callers that omit the resolver
      // still use the existing configured provider infrastructure.
      const resolver = this.resolver ?? (await import("../ai/aiProviderResolver")).aiProviderResolver;
      config = await resolver.resolveProvider({ orgId: input.organizationId, feature: "assistant" });
    } catch {
      const diagnostics: AssistantIntentPlannerDiagnostics = { correlationId, provider: null, model: null, attempts: 0, stage: "provider_unavailable", repairAttempted: false, providerMetadata: {} };
      logPlannerFailure(input.organizationId, diagnostics);
      await persistPlannerDiagnostic(input.organizationId, diagnostics, "provider_unavailable");
      return { ok: false, error: { code: "provider_unavailable", message: `AI planning is unavailable. Please retry. Reference: ${correlationId}.`, retryable: true, correlationId }, diagnostics };
    }

    if (!config.enabled || !config.provider || !config.endpoint || !config.apiKey || !config.model) {
      const diagnostics: AssistantIntentPlannerDiagnostics = { correlationId, provider: config.provider, model: config.model, attempts: 0, stage: "provider_unavailable", repairAttempted: false, providerMetadata: {} };
      logPlannerFailure(input.organizationId, diagnostics);
      await persistPlannerDiagnostic(input.organizationId, diagnostics, "provider_unavailable");
      return { ok: false, error: { code: "provider_unavailable", message: `AI planning is unavailable. Please retry. Reference: ${correlationId}.`, retryable: false, correlationId }, diagnostics };
    }

    let invalidOutput = "";
    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 0
        ? { system: input.system, user: input.user }
        : repairPrompt(input, invalidOutput, issues);
      try {
        response = await this.provider.generateJson({
          orgId: input.organizationId,
          feature: "assistant",
          system: prompt.system,
          user: prompt.user,
          promptVersion: input.promptVersion,
          repairAttempt: attempt > 0,
          timeoutMs: input.timeoutMs,
          timeoutUseCase: input.timeoutUseCase ?? "ai_first_intent_planner",
          maxTokens: input.maxTokens,
          providerConfig: config,
        });
      } catch (error) {
        stage = error instanceof AiProviderUnavailableError ? "provider_unavailable" : "provider_failure";
        const diagnostics: AssistantIntentPlannerDiagnostics = {
          correlationId,
          provider: config.provider,
          model: config.model,
          attempts: attempt + 1,
          stage,
          repairAttempted: attempt > 0,
          providerMetadata: {},
        };
        logPlannerFailure(input.organizationId, diagnostics, { providerFailureKind: safeFailureKind(error) });
        await persistPlannerDiagnostic(input.organizationId, diagnostics, stage === "provider_unavailable" ? "provider_unavailable" : "provider_failure");
        return {
          ok: false,
          error: {
            code: stage === "provider_unavailable" ? "provider_unavailable" : "provider_failure",
            message: `AI planning is temporarily unavailable. Nothing was changed. Please retry. Reference: ${correlationId}.`,
            retryable: true,
            correlationId,
          },
          diagnostics,
        };
      }

      invalidOutput = response.rawText;
      const metadata = safeRequestMetadata(response.requestMetadata);
      let candidate: unknown;
      try {
        candidate = strictJsonObject(response.rawText);
      } catch {
        stage = "invalid_json";
        issues = ["result"];
        if (attempt < MAX_REPAIR_ATTEMPTS) continue;
        const diagnostics: AssistantIntentPlannerDiagnostics = { correlationId, provider: response.provider, model: response.model, attempts: attempt + 1, stage, repairAttempted: attempt > 0, providerMetadata: metadata, validationIssuePaths: issues };
        logPlannerFailure(input.organizationId, diagnostics, { validationIssuePaths: issues });
        await persistPlannerDiagnostic(input.organizationId, diagnostics, "invalid_json");
        return { ok: false, error: { code: "invalid_json", message: `I couldn't safely interpret that request. Nothing was changed. Please retry. Reference: ${correlationId}.`, retryable: true, correlationId }, diagnostics };
      }

      const parsed = assistantIntentPlanSchema.safeParse(candidate);
      if (parsed.success) {
        return {
          ok: true,
          plan: parsed.data,
          diagnostics: { correlationId, provider: response.provider, model: response.model, attempts: attempt + 1, stage: "success", repairAttempted: attempt > 0, providerMetadata: metadata },
        };
      }

      stage = "invalid_contract";
      issues = validationIssuePaths(parsed.error);
      if (attempt < MAX_REPAIR_ATTEMPTS) continue;
      const diagnostics: AssistantIntentPlannerDiagnostics = { correlationId, provider: response.provider, model: response.model, attempts: attempt + 1, stage, repairAttempted: attempt > 0, providerMetadata: metadata, validationIssuePaths: issues };
      logPlannerFailure(input.organizationId, diagnostics, { validationIssuePaths: issues });
      await persistPlannerDiagnostic(input.organizationId, diagnostics, "invalid_contract");
      return { ok: false, error: { code: "invalid_contract", message: `I couldn't safely interpret that request. Nothing was changed. Please retry. Reference: ${correlationId}.`, retryable: true, correlationId }, diagnostics };
    }

    // The loop always returns; this protects future changes from exposing a
    // provider response without a validated contract.
    const diagnostics: AssistantIntentPlannerDiagnostics = { correlationId, provider: response?.provider ?? config.provider, model: response?.model ?? config.model, attempts: MAX_REPAIR_ATTEMPTS + 1, stage, repairAttempted: true, providerMetadata: safeRequestMetadata(response?.requestMetadata), validationIssuePaths: issues };
    logPlannerFailure(input.organizationId, diagnostics);
    return { ok: false, error: { code: "invalid_contract", message: `I couldn't safely interpret that request. Nothing was changed. Please retry. Reference: ${correlationId}.`, retryable: true, correlationId }, diagnostics };
  }
}
