export type OpenAiCompatibleProviderFamily = "deepseek" | "generic";

export interface OpenAiCompatibleRequestPolicy {
  family: OpenAiCompatibleProviderFamily;
  disableThinking: boolean;
}

const DEEPSEEK_API_HOSTNAME = "api.deepseek.com";

export function resolveOpenAiCompatibleRequestPolicy(endpoint: string): OpenAiCompatibleRequestPolicy {
  try {
    const url = new URL(endpoint);
    if (url.hostname.toLowerCase() === DEEPSEEK_API_HOSTNAME) {
      return { family: "deepseek", disableThinking: true };
    }
  } catch {
    // Invalid provider endpoints should never opt into provider-specific fields.
  }
  return { family: "generic", disableThinking: false };
}
