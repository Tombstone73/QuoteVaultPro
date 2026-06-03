import { getAiBugReviewProviderConfig } from "../aiBugReviewConfig";
import {
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
} from "./AiProviderAdapter";

export class OpenAiCompatibleBugReviewProvider implements AiProviderAdapter {
  async generateBugReview(request: AiProviderRequest): Promise<AiProviderResponse> {
    const config = getAiBugReviewProviderConfig();
    if (!config.endpoint || !config.apiKey || !config.model) {
      throw new AiProviderUnavailableError("AI bug review provider is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(config.endpoint, {
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
        throw new Error(`AI provider returned HTTP ${response.status}.`);
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
