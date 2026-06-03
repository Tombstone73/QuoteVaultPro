import { z } from "zod";

export const aiModeValues = ["disabled", "titanos_managed", "bring_your_own"] as const;
export const aiProviderValues = ["openai", "anthropic", "future"] as const;
export const aiFeatureValues = [
  "bug_review",
  "feature_review",
  "duplicate_detection",
  "order_parsing",
  "email_processing",
  "customer_support",
  "inventory_recommendations",
  "production_assistance",
] as const;

export type AiMode = (typeof aiModeValues)[number];
export type AiProvider = (typeof aiProviderValues)[number];
export type AiFeature = (typeof aiFeatureValues)[number];

export const aiFeatureFlagsSchema = z.object({
  bugReview: z.boolean(),
  featureReview: z.boolean(),
  duplicateDetection: z.boolean(),
  orderParsing: z.boolean(),
  emailProcessing: z.boolean(),
  customerSupport: z.boolean(),
  inventoryRecommendations: z.boolean(),
  productionAssistance: z.boolean(),
});

export type AiFeatureFlags = z.infer<typeof aiFeatureFlagsSchema>;

export const aiSettingsUpdateSchema = z.object({
  mode: z.enum(aiModeValues).optional(),
  provider: z.enum(aiProviderValues).nullable().optional(),
  model: z.string().trim().min(1).max(160).nullable().optional(),
  apiKey: z.string().trim().min(1).max(4000).nullable().optional(),
  clearApiKey: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  bugReviewEnabled: z.boolean().optional(),
  featureReviewEnabled: z.boolean().optional(),
  duplicateDetectionEnabled: z.boolean().optional(),
  orderParsingEnabled: z.boolean().optional(),
  emailProcessingEnabled: z.boolean().optional(),
  customerSupportEnabled: z.boolean().optional(),
  inventoryRecommendationsEnabled: z.boolean().optional(),
  productionAssistanceEnabled: z.boolean().optional(),
  monthlyUsageLimit: z.number().int().positive().nullable().optional(),
}).strict();

export type AiSettingsUpdate = z.infer<typeof aiSettingsUpdateSchema>;

export interface SafeAiSettingsDto {
  id: string | null;
  orgId: string;
  mode: AiMode;
  provider: AiProvider | null;
  model: string | null;
  isEnabled: boolean;
  hasApiKey: boolean;
  features: AiFeatureFlags;
  monthlyUsageLimit: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AiCapabilitiesDto {
  enabled: boolean;
  mode: AiMode;
  provider: AiProvider | null;
  model: string | null;
  hasApiKey: boolean;
  features: AiFeatureFlags;
  permissions: {
    canManageSettings: boolean;
    canRunBugReview: boolean;
  };
  usage: {
    monthlyUsageLimit: number | null;
  };
}

export const defaultAiFeatureFlags: AiFeatureFlags = {
  bugReview: false,
  featureReview: false,
  duplicateDetection: false,
  orderParsing: false,
  emailProcessing: false,
  customerSupport: false,
  inventoryRecommendations: false,
  productionAssistance: false,
};
