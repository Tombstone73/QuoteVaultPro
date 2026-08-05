import type { z } from "zod";
import {
  productIntentCompilerResultSchema,
  type ProductDraftIntent,
  type ProductIntentCompilerResult,
} from "@shared/productDraftIntent";

/** The compiler is deliberately an interpretation boundary. It has no database,
 * routing, persistence, or command-execution dependency. */
export const PRODUCT_INTENT_COMPILER_PROMPT_VERSION = "product-intent-compiler-v1";
export const PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS = 1;

const DEFAULT_COMPILER_TIMEOUT_MS = 45_000;
const MIN_COMPILER_TIMEOUT_MS = 5_000;
const MAX_COMPILER_TIMEOUT_MS = 90_000;

export type ProductIntentCandidateLabels = {
  categories?: string[];
  materials?: string[];
  productionRoutes?: string[];
  optionTemplates?: string[];
  existingProducts?: string[];
};

export type ProductIntentCompilerInput = {
  orgId: string;
  request: string;
  /** Present for a continuation, answer, or correction. This is server-loaded
   * state; the provider receives no tenant IDs beyond the opaque labels below. */
  currentIntent?: ProductDraftIntent | null;
  currentRevision?: number | null;
  operationContext: Record<string, unknown>;
  schemaDescription: string;
  allowedEnums: Record<string, readonly string[]>;
  supportedArchetypes: readonly string[];
  candidateLabels?: ProductIntentCandidateLabels;
  serverConstraints?: readonly string[];
  timeoutMs?: number;
};

export type ProductIntentCompilerDiagnostics = {
  provider: string;
  model: string;
  requestMetadata: Record<string, unknown>;
  attempts: number;
};

export type ProductIntentCompilerSuccess = {
  ok: true;
  result: ProductIntentCompilerResult;
  diagnostics: ProductIntentCompilerDiagnostics;
};

export type ProductIntentCompilerFailureCode =
  | "provider_unavailable"
  | "provider_failure"
  | "invalid_json"
  | "invalid_contract";

export type ProductIntentCompilerFailure = {
  ok: false;
  error: {
    code: ProductIntentCompilerFailureCode;
    message: string;
    retryable: boolean;
  };
  diagnostics?: ProductIntentCompilerDiagnostics;
};

export type ProductIntentCompilerOutcome = ProductIntentCompilerSuccess | ProductIntentCompilerFailure;

export interface ProductIntentCompilerProvider {
  generateJson(request: {
    orgId: string;
    feature: "feature_review";
    system: string;
    user: string;
    promptVersion: string;
    repairAttempt: boolean;
    timeoutMs: number;
    timeoutUseCase: string;
  }): Promise<{ rawText: string; provider: string; model: string; requestMetadata: Record<string, unknown> }>;
}

function isProviderUnavailable(error: unknown): boolean {
  return error instanceof Error && error.name === "AiProviderUnavailableError";
}

function clampTimeout(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs) || Number(timeoutMs) <= 0) return DEFAULT_COMPILER_TIMEOUT_MS;
  return Math.min(MAX_COMPILER_TIMEOUT_MS, Math.max(MIN_COMPILER_TIMEOUT_MS, Math.floor(Number(timeoutMs))));
}

function uniqueLabels(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, 100);
}

function candidateLabelsForPrompt(candidates: ProductIntentCandidateLabels | undefined): ProductIntentCandidateLabels {
  return {
    categories: uniqueLabels(candidates?.categories),
    materials: uniqueLabels(candidates?.materials),
    productionRoutes: uniqueLabels(candidates?.productionRoutes),
    optionTemplates: uniqueLabels(candidates?.optionTemplates),
    existingProducts: uniqueLabels(candidates?.existingProducts),
  };
}

function safeRequestMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["providerRequestId", "finishReason", "latencyMs", "timeoutMs", "providerFamily"];
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = metadata?.[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [[key, value]]
      : [];
  }));
}

function promptForCompilation(input: ProductIntentCompilerInput): { system: string; user: string } {
  return {
    system: [
      "You are the PrintersHero Product Intent Compiler.",
      "Return exactly one strict JSON object and no markdown, commentary, or code fences.",
      "Your JSON must validate against the supplied canonical compiler-result contract.",
      "Interpret natural language only; do not execute commands, create products, invent tenant IDs, or claim that a database lookup succeeded.",
      "Use only candidate labels supplied by the server for tenant-scoped entities. If no supplied label is an unambiguous match, return an unresolved-question result.",
      "For continuations and corrections, preserve every existing authoritative intent field unless the request explicitly changes it.",
      "A correction must return a typed patch, not a rewritten product intent, unless the request explicitly replaces the complete product.",
      "Do not turn preservation instructions into product options, materials, or entity references.",
      "Never set an active or published lifecycle. Confidence never makes a value execution-authorizing.",
    ].join(" "),
    user: JSON.stringify({
      request: input.request,
      currentIntent: input.currentIntent ?? null,
      currentRevision: input.currentRevision ?? null,
      operationContext: input.operationContext,
      canonicalSchema: input.schemaDescription,
      allowedEnums: input.allowedEnums,
      supportedArchetypes: input.supportedArchetypes,
      candidateLabels: candidateLabelsForPrompt(input.candidateLabels),
      serverConstraints: input.serverConstraints ?? [],
    }),
  };
}

function repairPrompt(input: ProductIntentCompilerInput, invalidOutput: string): { system: string; user: string } {
  const original = promptForCompilation(input);
  return {
    system: `${original.system} Repair the previous response into valid JSON only. Do not add facts not supported by the original request or current intent.`,
    user: JSON.stringify({
      originalInput: JSON.parse(original.user),
      invalidOutput: invalidOutput.slice(0, 24_000),
      instruction: "Return a single compiler-result object that conforms exactly to canonicalSchema. Unknown keys are forbidden.",
    }),
  };
}

function strictJsonObject(rawText: string): unknown {
  const parsed: unknown = JSON.parse(rawText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider response must be one JSON object.");
  }
  return parsed;
}

function invalidResultMessage(result: z.SafeParseError<unknown>): string {
  const firstIssue = result.error.issues[0];
  return firstIssue ? `${firstIssue.path.join(".") || "result"}: ${firstIssue.message}` : "unknown schema error";
}

/**
 * Calls the configured provider and turns its JSON into the provider-neutral
 * canonical result. All provider-specific API behaviour remains inside the
 * existing configured provider adapter (including DeepSeek's request policy).
 */
export class ProductIntentCompiler {
  constructor(private readonly provider: ProductIntentCompilerProvider) {}

  async compile(input: ProductIntentCompilerInput): Promise<ProductIntentCompilerOutcome> {
    const timeoutMs = clampTimeout(input.timeoutMs);
    let lastDiagnostics: ProductIntentCompilerDiagnostics | undefined;
    let invalidOutput = "";

    for (let attempt = 0; attempt <= PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 0 ? promptForCompilation(input) : repairPrompt(input, invalidOutput);
      let response: Awaited<ReturnType<ProductIntentCompilerProvider["generateJson"]>>;
      try {
        response = await this.provider.generateJson({
          orgId: input.orgId,
          feature: "feature_review",
          system: prompt.system,
          user: prompt.user,
          promptVersion: PRODUCT_INTENT_COMPILER_PROMPT_VERSION,
          repairAttempt: attempt > 0,
          timeoutMs,
          timeoutUseCase: "product_intent_compiler",
        });
      } catch (error) {
        const unavailable = isProviderUnavailable(error);
        return {
          ok: false,
          error: {
            code: unavailable ? "provider_unavailable" : "provider_failure",
            message: unavailable
              ? "Product interpretation is unavailable until a compatible AI provider is configured."
              : "Product interpretation is temporarily unavailable. Nothing was changed.",
            retryable: !unavailable,
          },
          diagnostics: lastDiagnostics,
        };
      }

      lastDiagnostics = {
        provider: response.provider,
        model: response.model,
        requestMetadata: safeRequestMetadata(response.requestMetadata),
        attempts: attempt + 1,
      };
      invalidOutput = response.rawText;

      let parsedJson: unknown;
      try {
        parsedJson = strictJsonObject(response.rawText);
      } catch {
        console.warn("[PRODUCT_INTENT_COMPILER] Provider returned invalid JSON.", {
          provider: response.provider,
          model: response.model,
          attempt: attempt + 1,
        });
        continue;
      }

      const result = productIntentCompilerResultSchema.safeParse(parsedJson);
      if (result.success) {
        return { ok: true, result: result.data, diagnostics: lastDiagnostics };
      }

      console.warn("[PRODUCT_INTENT_COMPILER] Provider result failed canonical schema validation.", {
        provider: response.provider,
        model: response.model,
        attempt: attempt + 1,
        issueCount: result.error.issues.length,
        firstIssue: invalidResultMessage(result),
      });
    }

    return {
      ok: false,
      error: {
        code: invalidOutput.trim().startsWith("{") ? "invalid_contract" : "invalid_json",
        message: "I couldn't safely interpret that product request. Nothing was changed. Please try again.",
        retryable: true,
      },
      diagnostics: lastDiagnostics,
    };
  }
}

/** Uses the single existing OpenAI-compatible adapter. That adapter owns
 * provider request formatting for both OpenAI and DeepSeek, while this class
 * owns the provider-neutral compiler result boundary. */
export async function createConfiguredProductIntentCompiler(): Promise<ProductIntentCompiler | null> {
  // Keep the compiler module pure-testable: the configured provider imports
  // tenant AI persistence, which must not be loaded by contract tests.
  const { createConfiguredAiProvider } = await import("../ai/providers/configuredProvider");
  const provider = createConfiguredAiProvider();
  return provider ? new ProductIntentCompiler(provider) : null;
}
