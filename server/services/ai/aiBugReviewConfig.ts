export const BUG_REVIEW_PROMPT_VERSION = "bug-review-v1";
export const TRIAGE_BRIEF_PROMPT_VERSION = "triage-brief-v1";

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getAiBugReviewFeatureFlags() {
  return {
    enabled: readBooleanEnv("AI_BUG_REVIEW_ENABLED", false),
    adminsOnly: readBooleanEnv("AI_BUG_REVIEW_ADMINS_ONLY", true),
  };
}

export function getAiBugReviewProviderConfig() {
  return {
    provider: process.env.AI_BUG_REVIEW_PROVIDER?.trim() || "openai_compatible",
    endpoint: process.env.AI_BUG_REVIEW_ENDPOINT?.trim() || "",
    apiKey: process.env.AI_BUG_REVIEW_API_KEY?.trim() || "",
    model: process.env.AI_BUG_REVIEW_MODEL?.trim() || "",
    timeoutMs: Number(process.env.AI_BUG_REVIEW_TIMEOUT_MS || 30000),
  };
}

export function getAiBugReviewStaleMinutes(): number {
  const parsed = Number(process.env.AI_BUG_REVIEW_STALE_MINUTES || 15);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

export function getAiTriageBriefStaleMinutes(): number {
  const parsed = Number(process.env.AI_TRIAGE_BRIEF_STALE_MINUTES || process.env.AI_BUG_REVIEW_STALE_MINUTES || 15);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}
