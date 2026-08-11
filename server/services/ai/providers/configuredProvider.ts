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
import { parseAssistantOperatorDecisionText, type AssistantOperatorDecision } from "../../assistant/operatorRuntime";

const DEFAULT_AI_JSON_MAX_TOKENS = 2048;
const MIN_AI_JSON_MAX_TOKENS = 128;
const MAX_AI_JSON_MAX_TOKENS = 4096;
export const DEFAULT_AI_OPERATOR_PROVIDER_TIMEOUT_MS = 120_000;
export const DEFAULT_AI_OPERATOR_MAX_OUTPUT_TOKENS = 8_192;
export const MAX_AI_OPERATOR_MAX_OUTPUT_TOKENS = 16_384;

export function resolveAiProviderTimeoutMs(overrideMs?: number): number {
  if (Number.isFinite(overrideMs) && Number(overrideMs) > 0) return Number(overrideMs);
  const parsed = Number(process.env.AI_PROVIDER_TIMEOUT_MS || process.env.AI_BUG_REVIEW_TIMEOUT_MS || 30000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

/** Keep longer Operator decisions independent from generic AI request timeouts. */
export function resolveAiOperatorProviderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.AI_OPERATOR_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AI_OPERATOR_PROVIDER_TIMEOUT_MS;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Operator reports are not small structured-JSON tasks. Keep this separate
 * from AI_PROVIDER_JSON_MAX_TOKENS while retaining a hard resource ceiling. */
export function resolveAiOperatorMaxOutputTokens(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.AI_OPERATOR_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_AI_OPERATOR_MAX_OUTPUT_TOKENS;
  return clampInteger(configured, MIN_AI_JSON_MAX_TOKENS, MAX_AI_OPERATOR_MAX_OUTPUT_TOKENS);
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
  incompleteReason?: string | null;
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
    incompleteReason: args.incompleteReason ?? null,
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
              // validation. Semantic tools may additionally expose a compact
              // business-operation schema so capable providers need not infer
              // application internals from prose alone.
              parameters: deepSeekFunctionParameters(tool.inputSchema),
            })),
            { type: "web_search" },
          ],
          tool_choice: "auto",
          // Responses enables thinking by default. The operator requires a
          // bounded visible JSON decision; otherwise reasoning can consume
          // the response budget before the native web result is expressed.
          reasoning: { effort: "none" },
          text: { format: { type: "json_object" } },
          max_output_tokens: resolveAiOperatorMaxOutputTokens(),
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
      const responseStatus = typeof body?.status === "string" ? body.status : "unknown";
      const incompleteReason = typeof body?.incomplete_details?.reason === "string" ? body.incomplete_details.reason : null;
      const providerErrorCode = typeof body?.error?.code === "string" ? body.error.code : null;
      const outputItemTypes = output.slice(0, 32).map((item: any) => typeof item?.type === "string" ? item.type.slice(0, 80) : "unknown");
      const outputItemStatuses = output.slice(0, 32).map((item: any) => typeof item?.status === "string" ? item.status.slice(0, 80) : "unknown");
      const functionCallItems = output.filter((item: any) => item?.type === "function_call");
      const functionCalls = functionCallItems.filter((item: any) => typeof item?.name === "string" && providerFunctionNames.has(item.name));
      const decodedFunctionCalls = functionCalls.map((item: any) => ({
        toolName: providerFunctionNames.get(item.name)!,
        ...decodeDeepSeekFunctionArguments(item.arguments),
      }));
      const nativeWebSearchCalls = output.filter((item: any) => item?.type === "web_search_call");
      const webSearchActions = nativeWebSearchCalls.filter((item: any) => item.action && typeof item.action === "object").map((item: any) => item.action);
      const webSources = nativeWebSources(output);
      const outputTextFragments = deepSeekOutputTextFragments(output);
      const finalText = outputTextFragments.join("");
      // DeepSeek can put a complete reasoning block in the same visible
      // message item as its terminal answer. It is never user-facing output.
      // Remove it only when a non-empty, control-free terminal payload remains;
      // incomplete or unknown control text stays on the safe-rejection path.
      const normalizedTerminalText = normalizeDeepSeekTerminalText(finalText);
      console.info("[AI_OPERATOR_TRACE]", {
        stage: "provider_decision_received", requestSequence: request.operatorRequestSequence ?? null,
        responseStatus, outputItemTypes, structuredToolCallDetected: decodedFunctionCalls.length > 0,
        toolCallCount: decodedFunctionCalls.length,
      });
      if (decodedFunctionCalls.length) {
        console.info("[AI_OPERATOR_TRACE]", {
          stage: "tool_call_detected", requestSequence: request.operatorRequestSequence ?? null,
          toolNames: decodedFunctionCalls.map((call) => call.toolName).slice(0, 12),
          toolCallCount: decodedFunctionCalls.length,
        });
        console.info("[AI_OPERATOR_TRACE]", {
          stage: "argument_decode", requestSequence: request.operatorRequestSequence ?? null,
          succeeded: decodedFunctionCalls.every((call) => call.argumentDecodeSucceeded),
          successCount: decodedFunctionCalls.filter((call) => call.argumentDecodeSucceeded).length,
          failureCount: decodedFunctionCalls.filter((call) => !call.argumentDecodeSucceeded).length,
        });
      }
      // A valid Operator decision is a control protocol, not native terminal
      // prose. Normalize known DeepSeek transport artifacts before deciding
      // whether remaining text is unsafe control leakage.
      const parsedTerminalDecision = parseDeepSeekTerminalDecision(normalizedTerminalText, providerFunctionNames);
      const terminalDecision = parsedTerminalDecision?.decision ?? null;
      // A malformed control-shaped payload is never ordinary assistant prose.
      // If bounded recovery did not produce a schema-valid decision, keep it
      // out of the presentation path and fail at the provider boundary below.
      const malformedControlEnvelope = !terminalDecision && resemblesOperatorControlEnvelope(normalizedTerminalText);
      const terminalCompletion = terminalDecision || malformedControlEnvelope ? null : normalizeDeepSeekOperatorTerminal(normalizedTerminalText);
      const terminalClassification = parsedTerminalDecision?.classification ?? terminalCompletion?.classification ?? null;
      const hasTerminalDecision = Boolean(terminalDecision || terminalCompletion);
      const parseClassification = functionCalls.length ? "function_calls" : terminalDecision ? "operator_decision" : nativeWebSearchCalls.length && !hasTerminalDecision ? "native_web_continuation" : terminalCompletion ? "terminal_completion" : "empty_response";
      const responseMetadata = deepSeekOperatorResponseMetadata({
        output, outputItemTypes, outputItemStatuses, functionCallItems, functionCalls, decodedFunctionCalls,
        outputTextFragments, finalText, responseStatus, terminalDecision, terminalClassification, parseClassification,
      });
      if (!functionCalls.length && !terminalDecision && (hasProviderControlProtocol(normalizedTerminalText) || malformedControlEnvelope)) {
        console.warn("[AI_PROVIDER] DeepSeek Responses returned unconsumed control protocol.", {
          provider: config.provider, model: config.model, apiSurface: "deepseek_responses", providerRequestId,
          responseStatus, outputItemTypes, responseItemCount: output.length, structuredToolCallDetected: false,
          textualControlProtocolDetected: true, protocolStage: "message_output_text",
        });
        throw new AiProviderResponseError({ kind: "provider_protocol_failure", status: response.status, provider: config.provider, model: config.model, providerRequestId, message: "DeepSeek returned an unconsumed tool-control protocol.", responseMetadata });
      }
      if (responseStatus !== "unknown" && responseStatus !== "completed") {
        const failureKind = responseStatus === "incomplete" && incompleteReason === "max_output_tokens" ? "truncated_output" : "malformed_response";
        logProviderFailure({ message: "[AI_PROVIDER] DeepSeek Responses Operator did not reach a terminal completion.", provider: config.provider, model: config.model, endpoint, status: response.status, providerRequestId, providerErrorCode, incompleteReason, failureKind, timeoutMs, elapsedMs: Date.now() - started, feature: request.feature, useCase: request.timeoutUseCase ?? request.feature });
        throw new AiProviderResponseError({ kind: failureKind, status: response.status, provider: config.provider, model: config.model, providerRequestId, message: "DeepSeek Responses did not return a complete Operator result.", responseMetadata });
      }
      const rawText = functionCalls.length
        ? JSON.stringify({ kind: "call_tools", calls: decodedFunctionCalls.map((call) => ({ toolName: call.toolName, arguments: call.arguments })), workingSummary: "Continuing authorized investigation." })
        : terminalDecision ? JSON.stringify(terminalDecision) : terminalCompletion ? JSON.stringify({ kind: "complete", response: terminalCompletion.response }) : (nativeWebSearchCalls.length
          ? JSON.stringify({ kind: "continue", workingSummary: "Continuing public research." })
          : "");
      if (!rawText.trim()) throw new AiProviderResponseError({ kind: "empty_response", status: response.status, provider: config.provider, model: config.model, providerRequestId, message: "DeepSeek Responses did not include a usable function call, web-search continuation, or final answer.", responseMetadata });
      console.info("[AI_PROVIDER] DeepSeek Responses Operator result.", {
        model: config.model,
        apiSurface: "deepseek_responses",
        requestSequence: request.operatorRequestSequence ?? null,
        responseStatus,
        responseId: safeProviderDiagnosticToken(body?.id),
        httpStatus: response.status,
        outputItemCount: output.length,
        outputItemTypes,
        outputItemStatuses,
        functionCallCount: functionCalls.length,
        functionAliases: functionCalls.map((item: any) => item.name).slice(0, 12),
        nativeWebSearchCallCount: nativeWebSearchCalls.length,
        nativeWebSearchActionCount: webSearchActions.length,
        nativeWebSourceCount: webSources.length,
        configuredOperatorMaxOutputTokens: resolveAiOperatorMaxOutputTokens(),
        messageOutputTextPresent: Boolean(finalText),
        terminalClassification,
        continuationReason: functionCalls.length ? "function_calls" : nativeWebSearchCalls.length && !hasTerminalDecision ? "native_web_activity" : null,
        parseClassification,
      });
      return {
        rawText,
        provider: config.provider,
        model: config.model,
        requestMetadata: {
          latencyMs: Date.now() - started, promptVersion: request.promptVersion, mode: config.mode, source: config.source,
          providerRequestId, providerResponseId: safeProviderDiagnosticToken(body?.id), usage: body?.usage ?? null,
          apiSurface: "deepseek_responses", toolChoice: "auto", nativeWebSearch: true,
          configuredOperatorMaxOutputTokens: resolveAiOperatorMaxOutputTokens(),
          requestSequence: request.operatorRequestSequence ?? null, responseStatus, httpStatus: response.status,
          ...responseMetadata,
          functionAliases: functionCalls.map((item: any) => item.name).slice(0, 12),
          functionCallCount: functionCalls.length,
          functionArgumentDecodeSucceeded: decodedFunctionCalls.length ? decodedFunctionCalls.every((call) => call.argumentDecodeSucceeded) : null,
          continuationReason: functionCalls.length ? "function_calls" : nativeWebSearchCalls.length && !hasTerminalDecision ? "native_web_activity" : null,
          nativeWebSearchCallCount: nativeWebSearchCalls.length, nativeWebSearchActionCount: webSearchActions.length,
          nativeWebSources: webSources,
          timeoutMs, timeoutUseCase: request.timeoutUseCase ?? request.feature,
        },
        operatorContinuation: {
          items: output,
          functionCalls: functionCalls.map((item: any) => ({ callId: String(item.call_id ?? ""), toolName: providerFunctionNames.get(item.name)! })).filter((item: { callId: string }) => Boolean(item.callId)),
        },
      };
    } catch (error) {
      if (controller.signal.aborted) {
        const elapsedMs = Date.now() - started;
        logProviderFailure({
          message: "[AI_PROVIDER] DeepSeek Responses request timed out.",
          feature: request.feature,
          useCase: request.timeoutUseCase ?? request.feature,
          timeoutMs,
          elapsedMs,
          provider: config.provider,
          model: config.model,
          endpoint,
          failureKind: "timeout",
        });
        throw new AiProviderTimeoutError({ timeoutMs, elapsedMs, provider: config.provider, model: config.model, useCase: request.timeoutUseCase ?? request.feature });
      }
      throw error;
    } finally { clearTimeout(timeout); }
  }
}

function decodeDeepSeekFunctionArguments(value: unknown): { arguments: Record<string, unknown>; argumentDecodeSucceeded: boolean } {
  if (value && typeof value === "object" && !Array.isArray(value)) return { arguments: value as Record<string, unknown>, argumentDecodeSucceeded: true };
  if (typeof value !== "string") return { arguments: {}, argumentDecodeSucceeded: false };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { arguments: parsed as Record<string, unknown>, argumentDecodeSucceeded: true }
      : { arguments: {}, argumentDecodeSucceeded: false };
  } catch {
    return { arguments: {}, argumentDecodeSucceeded: false };
  }
}

/** DeepSeek's Responses output may represent visible text as ordinary message
 * parts or a top-level output_text item. Preserve item order and never read
 * reasoning content. */
function deepSeekOutputTextFragments(output: readonly any[]): string[] {
  return output.flatMap((item) => {
    if (item?.type === "output_text" && typeof item.text === "string") return [item.text];
    if (item?.type !== "message") return [];
    if (typeof item.content === "string") return [item.content];
    return Array.isArray(item.content)
      ? item.content.filter((part: any) => part?.type === "output_text" && typeof part.text === "string").map((part: any) => part.text)
      : [];
  });
}

function stripKnownDeepSeekTransportSuffix(value: string): { text: string; stripped: boolean } {
  const trimmed = value.trim();
  const text = trimmed.replace(/<\/parameter>\s*$/i, "").trim();
  return { text, stripped: text !== trimmed };
}

/**
 * Remove only complete reasoning blocks when an ordinary terminal response
 * remains. An unclosed marker, a reasoning-only output, or any other control
 * protocol remains untouched so the established safe-rejection boundary owns
 * it. This never exposes the removed provider reasoning to the Operator.
 */
function normalizeDeepSeekTerminalText(value: string): string {
  const trimmed = value.trim();
  const withoutCompleteReasoning = trimmed.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think>/gi, "").trim();
  if (withoutCompleteReasoning === trimmed || !withoutCompleteReasoning || hasProviderControlProtocol(withoutCompleteReasoning)) return trimmed;
  return withoutCompleteReasoning;
}

function deepSeekOperatorResponseMetadata(input: {
  output: readonly any[];
  outputItemTypes: string[];
  outputItemStatuses: string[];
  functionCallItems: readonly any[];
  functionCalls: readonly any[];
  decodedFunctionCalls: ReadonlyArray<{ argumentDecodeSucceeded: boolean }>;
  outputTextFragments: readonly string[];
  finalText: string;
  responseStatus: string;
  terminalDecision: AssistantOperatorDecision | null;
  terminalClassification: string | null;
  parseClassification: string;
}): Record<string, unknown> {
  const trimmed = input.finalText.trim();
  const suffix = stripKnownDeepSeekTransportSuffix(input.finalText);
  return {
    outputItemCount: Math.min(input.output.length, 64), outputItemTypes: input.outputItemTypes, outputItemStatuses: input.outputItemStatuses,
    functionCallItemCount: Math.min(input.functionCallItems.length, 24), functionCallCount: Math.min(input.functionCalls.length, 24),
    functionArgumentDecodeSucceeded: input.decodedFunctionCalls.length ? input.decodedFunctionCalls.every((call) => call.argumentDecodeSucceeded) : null,
    messageOutputTextPresent: input.outputTextFragments.length > 0, outputTextItemCount: Math.min(input.outputTextFragments.length, 64), outputTextLengths: input.outputTextFragments.slice(0, 32).map((fragment) => Math.min(fragment.length, 1_000_000)),
    textBeginsKnownTransportMarker: /^<\/?parameter>/i.test(trimmed), textEndsKnownTransportMarker: /<\/parameter>\s*$/i.test(trimmed),
    finalTextRemainingAfterTransportStripping: Boolean(suffix.text), finalTextLength: Math.min(input.finalText.length, 1_000_000),
    responseStatus: input.responseStatus, terminalClassification: input.terminalClassification,
    decisionDiscriminator: input.terminalDecision?.kind ?? null, structuredDecisionPresent: Boolean(input.terminalDecision),
    parseClassification: input.parseClassification, controlProtocolDetected: !input.functionCalls.length && !input.terminalDecision && hasProviderControlProtocol(input.finalText),
  };
}

function normalizeDeepSeekOperatorTerminal(finalText: string): { response: string; classification: "provider_message" | "provider_message_parameter_suffix" } | null {
  const { text: trimmed, stripped } = stripKnownDeepSeekTransportSuffix(finalText);
  if (!trimmed) return null;
  return { response: trimmed, classification: stripped ? "provider_message_parameter_suffix" : "provider_message" };
}

/**
 * DeepSeek Responses has occasionally appended a lone `</parameter>` marker
 * after an otherwise schema-valid terminal Operator decision.  Accept only
 * that exact, bounded transport artifact; arbitrary markup or prose remains
 * a normal provider message and cannot become an Operator control decision.
 */
function parseDeepSeekTerminalDecision(finalText: string, providerFunctionNames: ReadonlyMap<string, string>): {
  decision: AssistantOperatorDecision;
  classification: "operator_decision" | "operator_decision_parameter_suffix" | "operator_decision_sanitized_string_controls" | "operator_decision_parameter_suffix_sanitized_string_controls";
} | null {
  const direct = parseAssistantOperatorDecisionText(finalText);
  if (direct) return { decision: normalizeDeepSeekTerminalDecisionAliases(direct, providerFunctionNames), classification: "operator_decision" };

  const recoveredDirect = recoverMalformedOperatorControlEnvelope(finalText);
  if (recoveredDirect) return { decision: normalizeDeepSeekTerminalDecisionAliases(recoveredDirect, providerFunctionNames), classification: "operator_decision_sanitized_string_controls" };

  const { text: withoutParameterSuffix, stripped } = stripKnownDeepSeekTransportSuffix(finalText);
  if (!stripped) return null;
  const normalized = parseAssistantOperatorDecisionText(withoutParameterSuffix);
  if (normalized) return { decision: normalizeDeepSeekTerminalDecisionAliases(normalized, providerFunctionNames), classification: "operator_decision_parameter_suffix" };
  const recoveredSuffix = recoverMalformedOperatorControlEnvelope(withoutParameterSuffix);
  return recoveredSuffix ? { decision: normalizeDeepSeekTerminalDecisionAliases(recoveredSuffix, providerFunctionNames), classification: "operator_decision_parameter_suffix_sanitized_string_controls" } : null;
}

/** A recovery attempt is permitted only for a top-level object whose early
 * discriminator is one of the five Operator control kinds. This deliberately
 * excludes ordinary JSON content from the provider-message path. */
function resemblesOperatorControlEnvelope(value: string): boolean {
  return /^\s*\{[\s\S]{0,320}?"kind"\s*:\s*"(?:continue|call_tools|ask_user|complete|fail)"/.test(value);
}

/** Escape only illegal U+0000–U+001F characters that occur inside a JSON
 * string. It understands backslash escapes and quotes, performs one pass,
 * and never changes control characters outside a string. The normal strict
 * parser and Operator decision schema remain the authority after this repair. */
function escapeLiteralJsonStringControls(value: string): string | null {
  let inString = false;
  let escaped = false;
  let changed = false;
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (!inString) {
      output += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      output += character;
      inString = false;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code > 0x1f) {
      output += character;
      continue;
    }
    changed = true;
    output += character === "\n" ? "\\n"
      : character === "\r" ? "\\r"
        : character === "\t" ? "\\t"
          : `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return changed ? output : null;
}

function recoverMalformedOperatorControlEnvelope(value: string): AssistantOperatorDecision | null {
  if (!resemblesOperatorControlEnvelope(value)) return null;
  const sanitized = escapeLiteralJsonStringControls(value);
  return sanitized ? parseAssistantOperatorDecisionText(sanitized) : null;
}

/** Textual DeepSeek decisions can use the same short aliases as its native
 * function-call items. Translate only aliases generated for this request;
 * unknown names remain untouched for the Operator runtime to reject safely. */
function normalizeDeepSeekTerminalDecisionAliases(
  decision: AssistantOperatorDecision,
  providerFunctionNames: ReadonlyMap<string, string>,
): AssistantOperatorDecision {
  if (decision.kind !== "call_tools") return decision;
  return {
    ...decision,
    calls: decision.calls.map((call) => ({
      ...call,
      toolName: providerFunctionNames.get(call.toolName) ?? call.toolName,
    })),
  };
}

/** DeepSeek V4's tool transport is less reliable with discriminated oneOf
 * arrays. This adapter-only projection preserves all business fields while
 * using one permissive object envelope; runtime schemas remain authoritative. */
function deepSeekFunctionParameters(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const transform = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.oneOf)) {
      const variants = record.oneOf.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
      const properties = Object.assign({}, ...variants.map((variant) => transform(variant.properties) as Record<string, unknown>));
      // Do not copy a branch-specific discriminator const: the final branch
      // would otherwise make all earlier operations impossible to emit.
      properties.op = { type: "string" };
      return { type: "object", additionalProperties: false, required: ["op"], properties };
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, transform(item)]));
  };
  return (transform(schema ?? { type: "object", additionalProperties: true }) ?? { type: "object", additionalProperties: true }) as Record<string, unknown>;
}

function hasProviderControlProtocol(text: string): boolean {
  return /DSML|<think\b|<\/?[|｜][^>]*(?:thinking|tool_calls|invoke|parameter)|<\/?[|｜]/i.test(text);
}

function nativeWebSources(output: readonly any[]): Array<{ title: string; url: string; domain: string; providerSourceReference?: string }> {
  const sources = new Map<string, { title: string; url: string; domain: string; providerSourceReference?: string }>();
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
          const providerSourceReference = safeProviderDiagnosticToken(annotation?.id ?? annotation?.ref_id ?? annotation?.url_citation?.id);
          sources.set(url.toString(), { title: title.slice(0, 300), url: url.toString(), domain: url.hostname.toLowerCase(), ...(providerSourceReference ? { providerSourceReference } : {}) });
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
