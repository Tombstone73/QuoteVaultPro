export type AiProviderCapabilities = {
  descriptor: string;
  functionTools: boolean;
  /** Provider support, not permission to send unscreened public queries. */
  nativeWebSearch: boolean;
  responsesApi: boolean;
  vision: boolean;
  reasoning: "none" | "deepseek_toggle";
};

type ProviderIdentity = { provider: string | null; model: string | null; endpoint: string | null };
const unknown: AiProviderCapabilities = { descriptor: "unverified", functionTools: false, nativeWebSearch: false, responsesApi: false, vision: false, reasoning: "none" };
// Validated compatibility descriptors. Aliases share mechanics; unknown names
// never inherit vision or tools from a substring. No tenant config changes.
const deepseekDescriptors: ReadonlyArray<{ aliases: readonly string[]; capabilities: AiProviderCapabilities }> = [
  { aliases: ["deepseek-flash", "deepseek-v4-flash-vision-exp"], capabilities: { descriptor: "deepseek.flash.vision", functionTools: true, nativeWebSearch: false, responsesApi: true, vision: true, reasoning: "deepseek_toggle" } },
  { aliases: ["deepseek-v4-pro"], capabilities: { descriptor: "deepseek.v4.pro", functionTools: true, nativeWebSearch: true, responsesApi: true, vision: false, reasoning: "deepseek_toggle" } },
  { aliases: ["deepseek-v4-flash"], capabilities: { descriptor: "deepseek.v4.flash.legacy", functionTools: true, nativeWebSearch: false, responsesApi: true, vision: false, reasoning: "deepseek_toggle" } },
  { aliases: ["deepseek-chat", "deepseek-reasoner"], capabilities: { descriptor: "deepseek.v3.legacy", functionTools: true, nativeWebSearch: false, responsesApi: false, vision: false, reasoning: "none" } },
];

export function isOfficialDeepSeekEndpoint(endpoint: string | null): boolean {
  try { const url = new URL(endpoint ?? ""); return url.protocol === "https:" && url.hostname.toLowerCase() === "api.deepseek.com" && !url.username && !url.password && (!url.port || url.port === "443"); }
  catch { return false; }
}

export function resolveAiProviderCapabilities(config: ProviderIdentity): AiProviderCapabilities {
  const model = config.model?.trim().toLowerCase() ?? "";
  if (config.provider === "openai_compatible" && isOfficialDeepSeekEndpoint(config.endpoint)) {
    return { ...(deepseekDescriptors.find(entry => entry.aliases.includes(model))?.capabilities ?? unknown) };
  }
  if (config.provider === "openai" && /^(gpt-4o|gpt-4\.1|gpt-5)(?:$|[-.])/.test(model)) {
    return { ...unknown, descriptor: "openai.multimodal.chat", functionTools: true, vision: true };
  }
  return { ...unknown };
}
