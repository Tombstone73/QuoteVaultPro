import type { ResolvedAiProvider } from "../aiProviderResolver";

/** Provider mechanics, kept separate from Operator behavior.  New model
 * support is an explicit compatibility entry, never a conversational rule. */
export type AiProviderCapabilities = {
  functionTools: boolean;
  nativeWebSearch: boolean;
  responsesApi: boolean;
};

const NO_SPECIAL_CAPABILITIES: AiProviderCapabilities = {
  functionTools: false,
  nativeWebSearch: false,
  responsesApi: false,
};

function isOfficialDeepSeekEndpoint(endpoint: string | null): boolean {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

/** DeepSeek documents Responses + server-side web_search only for V4-Flash.
 * Keep the model check here so V4-Pro can be enabled by configuration when
 * DeepSeek officially adds support, without changing the Operator runtime. */
export function resolveAiProviderCapabilities(config: Pick<ResolvedAiProvider, "provider" | "model" | "endpoint">): AiProviderCapabilities {
  const isV4FlashResponses = config.provider === "openai_compatible"
    && config.model?.trim().toLowerCase() === "deepseek-v4-flash"
    && isOfficialDeepSeekEndpoint(config.endpoint);
  return isV4FlashResponses
    ? { functionTools: true, nativeWebSearch: true, responsesApi: true }
    : NO_SPECIAL_CAPABILITIES;
}
