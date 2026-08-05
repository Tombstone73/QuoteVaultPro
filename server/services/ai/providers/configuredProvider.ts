import {
  AiProviderResponseError,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
} from "./AiProviderAdapter";
import { resolveOpenAiCompatibleRequestPolicy } from "./providerRequestPolicy";

const DEFAULT_AI_JSON_MAX_TOKENS = 2048;
const MIN_AI_JSON_MAX_TOKENS = 128;
const MAX_AI_JSON_MAX_TOKENS = 4096;

export function resolveAiProviderTimeoutMs(overrideMs?: number): number {
  if (Number.isFinite(overrideMs) && Number(overrideMs) > 0) return Number(overrideMs);
  const parsed = Number(process.env.AI_PROVIDER_TIMEOUT_MS || process.env.AI_BUG_REVIEW_TIMEOUT_MS || 30000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function resolveAiJsonMaxTokens(overrideTokens?: number, env: NodeJS.ProcessEnv = process.env): number {
  if (Number.isFinite(overrideTokens) && Number(overrideTokens) > 0) {
    return clampInteger(Number(overrideTokens), MIN_AI_JSON_MAX_TOKENS, MAX_AI_JSON_MAX_TOKENS);
  }
  const raw = env.AI_PROVIDER_JSON_MAX_TOKENS;
  if (raw == null || raw.trim() === "") return DEFAULT_AI_JSON_MAX_TOKENS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AI_JSON_MAX_TOKENS;
  return clampInteger(parsed, MIN_AI_JSON_MAX_TOKENS, MAX_AI_JSON_MAX_TOKENS);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function composeOpenAiChatCompletionsEndpoint(endpoint: string, provider: string | null): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    const path = trimTrailingSlashes(url.pathname || "");
    const isOpenAi = provider === "openai";
    const isOpenAiCompatible = provider === "openai_compatible";

    if (isOpenAi && (path === "" || path === "/")) {
      url.pathname = "/v1/chat/completions";
      return url.toString();
    }

    if ((isOpenAi || isOpenAiCompatible) && path === "/v1") {
      url.pathname = "/v1/chat/completions";
      return url.toString();
    }

    if (isOpenAi && path === "/chat/completions") {
      url.pathname = "/v1/chat/completions";
      return url.toString();
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

function safeEndpointParts(endpoint: string): { host: string; path: string; label: string } {
  try {
    const url = new URL(endpoint);
    const path = url.pathname || "/";
    return { host: url.host, path, label: `${url.host}${path}` };
  } catch {
    return { host: "invalid-endpoint-url", path: "", label: "invalid-endpoint-url" };
  }
}

function safeEndpointDiagnostic(endpoint: string): string {
  return safeEndpointParts(endpoint).label;
}

function safeProviderDiagnosticToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function providerRequestIdFromHeaders(headers: unknown): string | null {
  if (!headers || typeof (headers as { get?: unknown }).get !== "function") return null;
  const get = (headers as { get(name: string): string | null }).get.bind(headers);
  return safeProviderDiagnosticToken(get("x-request-id"))
    ?? safeProviderDiagnosticToken(get("request-id"))
    ?? safeProviderDiagnosticToken(get("x-ds-request-id"));
}

function providerRequestIdFromBody(body: any): string | null {
  return safeProviderDiagnosticToken(body?.request_id)
    ?? safeProviderDiagnosticToken(body?.id);
}

function providerErrorCodeFromBody(body: any): { providerErrorType: string | null; providerErrorCode: string | null } {
  const error = body?.error && typeof body.error === "object" ? body.error : null;
  return {
    providerErrorType: safeProviderDiagnosticToken(error?.type),
    providerErrorCode: safeProviderDiagnosticToken(error?.code),
  };
}

async function readSafeProviderErrorDiagnostics(response: Response): Promise<{
  providerRequestId: string | null;
  providerErrorType: string | null;
  providerErrorCode: string | null;
}> {
  const headerRequestId = providerRequestIdFromHeaders(response.headers);
  try {
    const body = typeof (response as any).clone === "function"
      ? await (response as any).clone().json()
      : typeof (response as any).json === "function"
        ? await (response as any).json()
        : null;
    const errorDiagnostics = providerErrorCodeFromBody(body);
    return {
      providerRequestId: headerRequestId ?? providerRequestIdFromBody(body),
      ...errorDiagnostics,
    };
  } catch {
    return { providerRequestId: headerRequestId, providerErrorType: null, providerErrorCode: null };
  }
}

function classifyHttpFailure(status: number) {
  if (status === 401 || status === 403) return "authentication_failure" as const;
  if (status === 429) return "rate_limit" as const;
  return "http_failure" as const;
}

function logProviderFailure(args: {
  message: string;
  provider: string | null;
  model: string | null;
  endpoint: string;
  status?: number | null;
  providerRequestId?: string | null;
  providerErrorType?: string | null;
  providerErrorCode?: string | null;
  failureKind: string;
  timeoutMs: number;
  elapsedMs: number;
  feature?: string;
  useCase?: string;
}) {
  const endpoint = safeEndpointParts(args.endpoint);
  console.warn(args.message, {
    provider: args.provider,
    model: args.model,
    endpointHost: endpoint.host,
    endpointPath: endpoint.path,
    status: args.status ?? null,
    providerRequestId: args.providerRequestId ?? null,
    providerErrorType: args.providerErrorType ?? null,
    providerErrorCode: args.providerErrorCode ?? null,
    failureKind: args.failureKind,
    timeoutMs: args.timeoutMs,
    elapsedMs: args.elapsedMs,
    feature: args.feature,
    useCase: args.useCase,
  });
}

export class OpenAiCompatibleBugReviewProvider implements AiProviderAdapter {
  async generateBugReview(request: AiProviderRequest): Promise<AiProviderResponse> {
    return this.generateJson(request);
  }

  async generateTriageBrief(request: AiProviderRequest): Promise<AiProviderResponse> {
    return this.generateJson(request);
  }

  async generateJson(request: AiProviderRequest): Promise<AiProviderResponse> {
    const config = request.providerConfig ?? await (async () => {
      // Direct adapter tests and explicitly supplied provider configs must not
      // initialize the database-backed resolver.
      const { aiProviderResolver } = await import("../aiProviderResolver");
      return aiProviderResolver.resolveProvider({ orgId: request.orgId, feature: request.feature });
    })();

    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model || !config.provider) {
      throw new AiProviderUnavailableError("AI provider is not configured.");
    }
    if (config.provider !== "openai" && config.provider !== "openai_compatible") {
      throw new AiProviderUnavailableError(`AI provider ${config.provider} is not supported by the current adapter.`);
    }

    const endpoint = composeOpenAiChatCompletionsEndpoint(config.endpoint, config.provider);
    const requestPolicy = resolveOpenAiCompatibleRequestPolicy(endpoint);
    const controller = new AbortController();
    const timeoutMs = resolveAiProviderTimeoutMs(request.timeoutMs);
    const maxTokens = resolveAiJsonMaxTokens(request.maxTokens);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const requestBody: Record<string, unknown> = {
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
      };
      if (requestPolicy.disableThinking) {
        requestBody.thinking = { type: "disabled" };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const elapsedMs = Date.now() - started;
        const diagnostics = await readSafeProviderErrorDiagnostics(response);
        const failureKind = classifyHttpFailure(response.status);
        logProviderFailure({
          message: "[AI_PROVIDER] Provider request failed.",
          provider: config.provider,
          model: config.model,
          endpoint,
          status: response.status,
          ...diagnostics,
          failureKind,
          timeoutMs,
          elapsedMs,
          feature: request.feature,
          useCase: request.timeoutUseCase ?? request.feature,
        });
        throw new AiProviderResponseError({
          kind: failureKind,
          status: response.status,
          provider: config.provider,
          model: config.model,
          providerRequestId: diagnostics.providerRequestId,
          message:
          `AI provider endpoint/model is not configured correctly. Provider ${config.provider} returned HTTP ${response.status} for ${safeEndpointDiagnostic(endpoint)} using model ${config.model}.`,
        });
      }

      let body: any;
      try {
        body = await response.json() as any;
      } catch {
        const elapsedMs = Date.now() - started;
        const providerRequestId = providerRequestIdFromHeaders(response.headers);
        logProviderFailure({
          message: "[AI_PROVIDER] Provider response was not valid JSON.",
          provider: config.provider,
          model: config.model,
          endpoint,
          status: response.status,
          providerRequestId,
          failureKind: "malformed_response",
          timeoutMs,
          elapsedMs,
          feature: request.feature,
          useCase: request.timeoutUseCase ?? request.feature,
        });
        throw new AiProviderResponseError({
          kind: "malformed_response",
          status: response.status,
          provider: config.provider,
          model: config.model,
          providerRequestId,
          message: "AI provider response could not be parsed safely.",
        });
      }
      const providerRequestId = providerRequestIdFromHeaders(response.headers) ?? providerRequestIdFromBody(body);
      const finishReason = body?.choices?.[0]?.finish_reason ?? null;
      if (finishReason === "length") {
        const elapsedMs = Date.now() - started;
        logProviderFailure({
          message: "[AI_PROVIDER] Provider response was truncated.",
          provider: config.provider,
          model: config.model,
          endpoint,
          status: response.status,
          providerRequestId,
          failureKind: "truncated_output",
          timeoutMs,
          elapsedMs,
          feature: request.feature,
          useCase: request.timeoutUseCase ?? request.feature,
        });
        throw new AiProviderResponseError({
          kind: "truncated_output",
          status: response.status,
          provider: config.provider,
          model: config.model,
          providerRequestId,
          message: "AI provider response exceeded the configured output limit.",
        });
      }
      const rawText = body?.choices?.[0]?.message?.content;
      if (typeof rawText !== "string" || rawText.trim() === "") {
        const elapsedMs = Date.now() - started;
        logProviderFailure({
          message: "[AI_PROVIDER] Provider response did not include usable content.",
          provider: config.provider,
          model: config.model,
          endpoint,
          status: response.status,
          providerRequestId,
          failureKind: "empty_response",
          timeoutMs,
          elapsedMs,
          feature: request.feature,
          useCase: request.timeoutUseCase ?? request.feature,
        });
        throw new AiProviderResponseError({
          kind: "empty_response",
          status: response.status,
          provider: config.provider,
          model: config.model,
          providerRequestId,
          message: "AI provider response did not include usable message content.",
        });
      }

      return {
        rawText,
        provider: config.provider,
        model: config.model,
        requestMetadata: {
          latencyMs: Date.now() - started,
          promptVersion: request.promptVersion,
          repairAttempt: Boolean(request.repairAttempt),
          mode: config.mode,
          source: config.source,
          providerRequestId,
          providerResponseId: safeProviderDiagnosticToken(body?.id),
          usage: body?.usage ?? null,
          finishReason,
          maxTokens,
          timeoutMs,
          timeoutUseCase: request.timeoutUseCase ?? request.feature,
          providerFamily: requestPolicy.family,
        },
      };
    } catch (error) {
      if (controller.signal.aborted) {
        const elapsedMs = Date.now() - started;
        logProviderFailure({
          message: "[AI_PROVIDER] Provider request timed out.",
          feature: request.feature,
          useCase: request.timeoutUseCase ?? request.feature,
          timeoutMs,
          elapsedMs,
          provider: config.provider,
          model: config.model,
          endpoint,
          failureKind: "timeout",
        });
        throw new AiProviderTimeoutError({
          timeoutMs,
          elapsedMs,
          provider: config.provider,
          model: config.model,
          useCase: request.timeoutUseCase ?? request.feature,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createConfiguredAiProvider(): AiProviderAdapter {
  return new OpenAiCompatibleBugReviewProvider();
}
