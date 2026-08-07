import {
  AiProviderResponseError,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderOperatorRequest,
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

/** The managed DeepSeek setting historically stores a Chat Completions URL.
 * Responses is a sibling endpoint, so translate only the known official
 * DeepSeek paths; arbitrary compatible-provider endpoints remain untouched. */
export function composeDeepSeekResponsesEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint.trim());
    if (url.hostname.toLowerCase() !== "api.deepseek.com") return endpoint;
    const path = trimTrailingSlashes(url.pathname || "");
    if (path === "" || path === "/" || path === "/v1" || path === "/chat/completions" || path === "/v1/chat/completions") {
      url.pathname = "/responses";
      url.search = "";
      return url.toString();
    }
    return endpoint;
  } catch {
    return endpoint;
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

  /** DeepSeek V4-Flash Responses transport for the existing Operator loop.
   * Function calls are returned as the runtime's ordinary call_tools decision;
   * web_search remains server-side at DeepSeek and never becomes an app tool. */
  async generateOperatorDecision(request: AiProviderOperatorRequest): Promise<AiProviderResponse> {
    const config = request.providerConfig ?? await (async () => {
      const { aiProviderResolver } = await import("../aiProviderResolver");
      return aiProviderResolver.resolveProvider({ orgId: request.orgId, feature: request.feature });
    })();
    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model || config.provider !== "openai_compatible" || config.model.trim().toLowerCase() !== "deepseek-v4-flash") {
      throw new AiProviderUnavailableError("DeepSeek Responses API is not configured for this Operator.");
    }
    const endpoint = composeDeepSeekResponsesEndpoint(config.endpoint);
    if (safeEndpointParts(endpoint).host.toLowerCase() !== "api.deepseek.com") {
      throw new AiProviderUnavailableError("DeepSeek Responses API requires the official DeepSeek endpoint.");
    }
    const timeoutMs = resolveAiProviderTimeoutMs(request.timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const providerFunctions = request.toolCatalog.map((tool, index) => ({ providerName: deepSeekFunctionName(index, tool.name), tool }));
      const providerFunctionNames = new Map(providerFunctions.map(({ providerName, tool }) => [providerName, tool.name]));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          input: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
            ...(request.responseContinuation ?? []),
          ],
          tools: [
            ...providerFunctions.map(({ providerName, tool }) => ({
              type: "function",
              name: providerName,
              description: tool.description,
              // The registered server tool boundary remains the authority for
              // precise validation; this permissive schema avoids claiming an
              // incomplete schema for the legacy catalog.
              parameters: { type: "object", additionalProperties: true },
            })),
            { type: "web_search" },
          ],
          tool_choice: "auto",
          text: { format: { type: "json_object" } },
          max_output_tokens: resolveAiJsonMaxTokens(request.maxTokens),
        }),
      });
      if (!response.ok) {
        const diagnostics = await readSafeProviderErrorDiagnostics(response);
        const failureKind = classifyHttpFailure(response.status);
        logProviderFailure({ message: "[AI_PROVIDER] DeepSeek Responses request failed.", provider: config.provider, model: config.model, endpoint, status: response.status, ...diagnostics, failureKind, timeoutMs, elapsedMs: Date.now() - started, feature: request.feature, useCase: request.timeoutUseCase ?? request.feature });
        throw new AiProviderResponseError({ kind: failureKind, status: response.status, provider: config.provider, model: config.model, providerRequestId: diagnostics.providerRequestId, message: `DeepSeek Responses returned HTTP ${response.status}.` });
      }
      let body: any;
      try { body = await response.json(); }
      catch {
        throw new AiProviderResponseError({ kind: "malformed_response", status: response.status, provider: config.provider, model: config.model, providerRequestId: providerRequestIdFromHeaders(response.headers), message: "DeepSeek Responses response could not be parsed safely." });
      }
      const providerRequestId = providerRequestIdFromHeaders(response.headers) ?? providerRequestIdFromBody(body);
      const output = Array.isArray(body?.output) ? body.output : [];
      const functionCalls = output.filter((item: any) => item?.type === "function_call" && typeof item.name === "string" && typeof item.arguments === "string" && providerFunctionNames.has(item.name));
      const webSearchActions = output.filter((item: any) => item?.type === "web_search_call" && item.action && typeof item.action === "object").map((item: any) => item.action);
      const webSources = nativeWebSources(output);
      const finalText = output.filter((item: any) => item?.type === "message").flatMap((item: any) => Array.isArray(item.content) ? item.content : []).filter((part: any) => part?.type === "output_text" && typeof part.text === "string").map((part: any) => part.text).join("\n");
      const rawText = functionCalls.length
        ? JSON.stringify({ kind: "call_tools", calls: functionCalls.map((item: any) => ({ toolName: providerFunctionNames.get(item.name), arguments: (() => { try { const parsed = JSON.parse(item.arguments); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } })() })), workingSummary: "Continuing authorized investigation." })
        : finalText || (webSearchActions.length
          ? JSON.stringify({ kind: "continue", workingSummary: "Continuing public research." })
          : "");
      if (!rawText.trim()) throw new AiProviderResponseError({ kind: "empty_response", status: response.status, provider: config.provider, model: config.model, providerRequestId, message: "DeepSeek Responses did not include a usable function call, web-search continuation, or final answer." });
      console.info("[AI_PROVIDER] DeepSeek Responses Operator result.", {
        model: config.model,
        apiSurface: "deepseek_responses",
        functionCallCount: functionCalls.length,
        nativeWebSearchActionCount: webSearchActions.length,
        nativeWebSourceCount: webSources.length,
        disposition: functionCalls.length ? "function_calls" : webSearchActions.length && !finalText ? "native_web_continuation" : "direct_completion",
      });
      return {
        rawText,
        provider: config.provider,
        model: config.model,
        requestMetadata: {
          latencyMs: Date.now() - started, promptVersion: request.promptVersion, mode: config.mode, source: config.source,
          providerRequestId, providerResponseId: safeProviderDiagnosticToken(body?.id), usage: body?.usage ?? null,
          apiSurface: "deepseek_responses", toolChoice: "auto", nativeWebSearch: true,
          nativeWebSearchActionCount: webSearchActions.length,
          nativeWebSources: webSources,
          timeoutMs, timeoutUseCase: request.timeoutUseCase ?? request.feature,
        },
        operatorContinuation: {
          items: output,
          functionCalls: functionCalls.map((item: any) => ({ callId: String(item.call_id ?? ""), toolName: providerFunctionNames.get(item.name)! })).filter((item: { callId: string }) => Boolean(item.callId)),
        },
      };
    } catch (error) {
      if (controller.signal.aborted) throw new AiProviderTimeoutError({ timeoutMs, elapsedMs: Date.now() - started, provider: config.provider, model: config.model, useCase: request.timeoutUseCase ?? request.feature });
      throw error;
    } finally { clearTimeout(timeout); }
  }
}

function nativeWebSources(output: readonly any[]): Array<{ title: string; url: string }> {
  const sources = new Map<string, { title: string; url: string }>();
  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!Array.isArray(part?.annotations)) continue;
      for (const annotation of part.annotations) {
        const candidate = annotation?.url ?? annotation?.url_citation?.url ?? annotation?.source?.url;
        if (typeof candidate !== "string" || candidate.length > 2_000) continue;
        try {
          const url = new URL(candidate);
          if (url.protocol !== "https:" && url.protocol !== "http:") continue;
          const title = typeof annotation?.title === "string" ? annotation.title : typeof annotation?.url_citation?.title === "string" ? annotation.url_citation.title : url.hostname;
          sources.set(url.toString(), { title: title.slice(0, 300), url: url.toString() });
        } catch { /* provider annotations are untrusted input */ }
      }
    }
  }
  return Array.from(sources.values()).slice(0, 12);
}

/** Dotted PrintersHero namespaces are invalid DeepSeek function identifiers.
 * The index makes the transport alias unambiguous without changing registry names. */
function deepSeekFunctionName(index: number, toolName: string): string {
  return `ph_${index}_${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 128);
}

export function createConfiguredAiProvider(): AiProviderAdapter {
  return new OpenAiCompatibleBugReviewProvider();
}
