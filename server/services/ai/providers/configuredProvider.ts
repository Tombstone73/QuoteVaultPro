import {
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
} from "./AiProviderAdapter";
import { aiProviderResolver } from "../aiProviderResolver";

function getTimeoutMs(): number {
  const parsed = Number(process.env.AI_PROVIDER_TIMEOUT_MS || process.env.AI_BUG_REVIEW_TIMEOUT_MS || 30000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
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

function safeEndpointDiagnostic(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.host}${url.pathname}`;
  } catch {
    return "invalid-endpoint-url";
  }
}

export class OpenAiCompatibleBugReviewProvider implements AiProviderAdapter {
  async generateBugReview(request: AiProviderRequest): Promise<AiProviderResponse> {
    return this.generateJson(request);
  }

  async generateTriageBrief(request: AiProviderRequest): Promise<AiProviderResponse> {
    return this.generateJson(request);
  }

  private async generateJson(request: AiProviderRequest): Promise<AiProviderResponse> {
    const config = request.providerConfig ?? await aiProviderResolver.resolveProvider({
      orgId: request.orgId,
      feature: request.feature,
    });

    if (!config.enabled || !config.endpoint || !config.apiKey || !config.model || !config.provider) {
      throw new AiProviderUnavailableError("AI bug review provider is not configured.");
    }
    if (config.provider !== "openai" && config.provider !== "openai_compatible") {
      throw new AiProviderUnavailableError(`AI provider ${config.provider} is not supported by the current adapter.`);
    }

    const endpoint = composeOpenAiChatCompletionsEndpoint(config.endpoint, config.provider);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
    const started = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          temperature: 0.1,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        console.warn("[AI_PROVIDER] Provider request failed.", {
          provider: config.provider,
          model: config.model,
          endpoint: safeEndpointDiagnostic(endpoint),
          status: response.status,
        });
        throw new Error(
          `AI provider endpoint/model is not configured correctly. Provider ${config.provider} returned HTTP ${response.status} for ${safeEndpointDiagnostic(endpoint)} using model ${config.model}.`,
        );
      }

      const body = await response.json() as any;
      const rawText = body?.choices?.[0]?.message?.content;
      if (typeof rawText !== "string") {
        throw new Error("AI provider response did not include message content.");
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
          providerRequestId: body?.id ?? null,
          usage: body?.usage ?? null,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createConfiguredAiProvider(): AiProviderAdapter {
  return new OpenAiCompatibleBugReviewProvider();
}
