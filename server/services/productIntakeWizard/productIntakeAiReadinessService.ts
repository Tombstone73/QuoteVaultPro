import { normalizeAiMode } from "@shared/aiFoundationContracts";
import type { ProductIntakeAiReadiness } from "@shared/productIntakeWizardSchemas";
import { DrizzleAiFoundationRepository, toAiFeatureFlags, type AiFoundationRepository } from "../../storage/aiFoundation.repo";
import { isAiSecretEncryptionConfigured } from "../ai/aiSecretsEncryption";

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function managedEndpoint(): string {
  return process.env.PRINTERSHERO_MANAGED_AI_ENDPOINT?.trim()
    || process.env.AI_BUG_REVIEW_ENDPOINT?.trim()
    || "";
}

function managedApiKey(): string {
  return process.env.PRINTERSHERO_MANAGED_AI_API_KEY?.trim()
    || process.env.AI_BUG_REVIEW_API_KEY?.trim()
    || "";
}

function managedModel(): string {
  return process.env.PRINTERSHERO_MANAGED_AI_MODEL?.trim()
    || process.env.AI_BUG_REVIEW_MODEL?.trim()
    || "";
}

function managedProvider(): string {
  return process.env.PRINTERSHERO_MANAGED_AI_PROVIDER?.trim()
    || process.env.AI_BUG_REVIEW_PROVIDER?.trim()
    || "openai";
}

export async function resolveProductIntakeAiReadiness(args: {
  organizationId: string;
  userId?: string | null;
  databaseIdentifier?: string | null;
  repo?: AiFoundationRepository;
}): Promise<ProductIntakeAiReadiness> {
  const repo = args.repo ?? new DrizzleAiFoundationRepository();
  const settings = await repo.getSettings(args.organizationId);
  const managedEnv = {
    endpointPresent: present(process.env.PRINTERSHERO_MANAGED_AI_ENDPOINT),
    apiKeyPresent: present(process.env.PRINTERSHERO_MANAGED_AI_API_KEY),
    modelPresent: present(process.env.PRINTERSHERO_MANAGED_AI_MODEL),
  };
  const encryptionKeyPresent = isAiSecretEncryptionConfigured();

  if (!settings) {
    return {
      organizationId: args.organizationId,
      userId: args.userId ?? null,
      databaseIdentifier: args.databaseIdentifier ?? null,
      enabled: false,
      mode: "disabled",
      featureReviewEnabled: false,
      provider: null,
      model: null,
      reason: "missing_org_ai_settings",
      managedEnv,
      encryptionKeyPresent,
      canAttemptLiveAi: false,
    };
  }

  const mode = normalizeAiMode(settings.mode);
  const features = toAiFeatureFlags(settings);
  const base = {
    organizationId: args.organizationId,
    userId: args.userId ?? null,
    databaseIdentifier: args.databaseIdentifier ?? null,
    enabled: settings.isEnabled && mode !== "disabled",
    mode,
    featureReviewEnabled: features.featureReview,
    provider: settings.provider,
    model: settings.model,
    managedEnv,
    encryptionKeyPresent,
  };

  if (!settings.isEnabled || mode === "disabled") {
    return { ...base, reason: "ai_disabled", canAttemptLiveAi: false };
  }

  if (!features.featureReview) {
    return { ...base, reason: "feature_review_disabled", canAttemptLiveAi: false };
  }

  if (mode === "printershero_managed") {
    const endpoint = managedEndpoint();
    const apiKey = managedApiKey();
    const model = settings.model?.trim() || managedModel();
    const provider = settings.provider || managedProvider();
    const hasProviderConfig = Boolean(endpoint && apiKey && model && provider);
    return {
      ...base,
      provider,
      model: model || null,
      reason: hasProviderConfig ? "live_ai_ready" : "managed_env_missing",
      canAttemptLiveAi: hasProviderConfig,
    };
  }

  if (mode === "bring_your_own") {
    if (!settings.provider || !settings.model || !settings.encryptedApiKey) {
      return { ...base, reason: "missing_provider_config", canAttemptLiveAi: false };
    }
    if (!encryptionKeyPresent) {
      return { ...base, reason: "missing_encryption_key", canAttemptLiveAi: false };
    }
    if (settings.provider !== "openai") {
      return { ...base, reason: "provider_unavailable", canAttemptLiveAi: false };
    }
    return { ...base, reason: "live_ai_ready", canAttemptLiveAi: true };
  }

  return { ...base, reason: "provider_unavailable", canAttemptLiveAi: false };
}
