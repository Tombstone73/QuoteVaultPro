import {
  defaultAiFeatureFlags,
  type AiCapabilitiesDto,
  type AiFeature,
  type AiFeatureFlags,
  type AiMode,
  type AiProvider,
} from "@shared/aiFoundationContracts";
import {
  DrizzleAiFoundationRepository,
  toAiFeatureFlags,
  type AiFoundationRepository,
} from "../../storage/aiFoundation.repo";
import type { OrganizationAiSettings } from "@shared/schema";
import { decryptAiSecret, isAiSecretEncryptionConfigured } from "./aiSecretsEncryption";
import { getAiBugReviewFeatureFlags, getAiBugReviewProviderConfig } from "./aiBugReviewConfig";

export interface ResolvedAiProvider {
  enabled: boolean;
  mode: AiMode | "legacy_env";
  provider: AiProvider | "openai_compatible" | null;
  model: string | null;
  endpoint: string | null;
  apiKey: string | null;
  feature: AiFeature;
  source: "settings" | "titanos_managed_env" | "legacy_env" | "disabled";
  settings: OrganizationAiSettings | null;
}

export interface ResolveProviderInput {
  orgId: string;
  feature: AiFeature;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function featureEnabled(features: AiFeatureFlags, feature: AiFeature): boolean {
  switch (feature) {
    case "bug_review":
      return features.bugReview;
    case "feature_review":
      return features.featureReview;
    case "duplicate_detection":
      return features.duplicateDetection;
    case "order_parsing":
      return features.orderParsing;
    case "email_processing":
      return features.emailProcessing;
    case "customer_support":
      return features.customerSupport;
    case "inventory_recommendations":
      return features.inventoryRecommendations;
    case "production_assistance":
      return features.productionAssistance;
    default:
      return false;
  }
}

function defaultDisabled(feature: AiFeature, settings: OrganizationAiSettings | null = null): ResolvedAiProvider {
  return {
    enabled: false,
    mode: settings?.mode ?? "disabled",
    provider: settings?.provider ?? null,
    model: settings?.model ?? null,
    endpoint: null,
    apiKey: null,
    feature,
    source: "disabled",
    settings,
  };
}

function getManagedProvider(): ResolvedAiProvider {
  const provider = (process.env.TITANOS_MANAGED_AI_PROVIDER?.trim() || process.env.AI_BUG_REVIEW_PROVIDER?.trim() || "openai") as AiProvider;
  const endpoint = process.env.TITANOS_MANAGED_AI_ENDPOINT?.trim() || process.env.AI_BUG_REVIEW_ENDPOINT?.trim() || "";
  const apiKey = process.env.TITANOS_MANAGED_AI_API_KEY?.trim() || process.env.AI_BUG_REVIEW_API_KEY?.trim() || "";
  const model = process.env.TITANOS_MANAGED_AI_MODEL?.trim() || process.env.AI_BUG_REVIEW_MODEL?.trim() || "";

  return {
    enabled: Boolean(endpoint && apiKey && model),
    mode: "titanos_managed",
    provider,
    model: model || null,
    endpoint: endpoint || null,
    apiKey: apiKey || null,
    feature: "bug_review",
    source: "titanos_managed_env",
    settings: null,
  };
}

function getLegacyBugReviewProvider(): ResolvedAiProvider {
  const flags = getAiBugReviewFeatureFlags();
  const config = getAiBugReviewProviderConfig();
  return {
    enabled: flags.enabled,
    mode: "legacy_env",
    provider: "openai_compatible",
    model: config.model || null,
    endpoint: config.endpoint || null,
    apiKey: config.apiKey || null,
    feature: "bug_review",
    source: flags.enabled ? "legacy_env" : "disabled",
    settings: null,
  };
}

export class AiProviderResolver {
  constructor(private readonly repo: AiFoundationRepository = new DrizzleAiFoundationRepository()) {}

  async resolveProvider(input: ResolveProviderInput): Promise<ResolvedAiProvider> {
    const settings = await this.repo.getSettings(input.orgId);

    if (!settings) {
      return input.feature === "bug_review" ? getLegacyBugReviewProvider() : defaultDisabled(input.feature);
    }

    const features = toAiFeatureFlags(settings);
    if (!settings.isEnabled || settings.mode === "disabled" || !featureEnabled(features, input.feature)) {
      return defaultDisabled(input.feature, settings);
    }

    if (settings.mode === "titanos_managed") {
      const managed = getManagedProvider();
      return {
        ...managed,
        feature: input.feature,
        settings,
        model: settings.model || managed.model,
        provider: settings.provider || managed.provider,
      };
    }

    if (settings.mode === "bring_your_own") {
      if (!settings.provider || !settings.model || !settings.encryptedApiKey || !isAiSecretEncryptionConfigured()) {
        return defaultDisabled(input.feature, settings);
      }

      const apiKey = decryptAiSecret(settings.encryptedApiKey);
      const endpoint = settings.provider === "openai"
        ? (process.env.OPENAI_API_ENDPOINT?.trim() || "https://api.openai.com/v1/chat/completions")
        : null;

      return {
        enabled: Boolean(endpoint),
        mode: "bring_your_own",
        provider: settings.provider,
        model: settings.model,
        endpoint,
        apiKey,
        feature: input.feature,
        source: "settings",
        settings,
      };
    }

    return defaultDisabled(input.feature, settings);
  }

  async getCapabilities(orgId: string, permissions: { canManageSettings: boolean; canRunBugReview: boolean }): Promise<AiCapabilitiesDto> {
    const settings = await this.repo.getSettings(orgId);
    if (!settings) {
      const legacy = getLegacyBugReviewProvider();
      const legacyBugEnabled = legacy.enabled || readBooleanEnv("AI_BUG_REVIEW_ENABLED", false);
      return {
        enabled: legacyBugEnabled,
        mode: legacyBugEnabled ? "titanos_managed" : "disabled",
        provider: legacyBugEnabled ? "openai" : null,
        model: legacy.model,
        hasApiKey: false,
        features: { ...defaultAiFeatureFlags, bugReview: legacyBugEnabled },
        permissions: {
          canManageSettings: permissions.canManageSettings,
          canRunBugReview: permissions.canRunBugReview && legacyBugEnabled,
        },
        usage: { monthlyUsageLimit: null },
      };
    }

    const features = toAiFeatureFlags(settings);
    const enabled = settings.isEnabled && settings.mode !== "disabled";

    return {
      enabled,
      mode: settings.mode,
      provider: settings.provider,
      model: settings.model,
      hasApiKey: Boolean(settings.encryptedApiKey),
      features,
      permissions: {
        canManageSettings: permissions.canManageSettings,
        canRunBugReview: permissions.canRunBugReview && enabled && features.bugReview,
      },
      usage: { monthlyUsageLimit: settings.monthlyUsageLimit },
    };
  }
}

export const aiProviderResolver = new AiProviderResolver();
