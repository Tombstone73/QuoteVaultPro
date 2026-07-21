import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiUsage,
  insertAiUsageSchema,
  organizationAiSettings,
  type AiUsage,
  type InsertAiUsage,
  type OrganizationAiSettings,
} from "@shared/schema";
import {
  defaultAiFeatureFlags,
  normalizeAiMode,
  type AiFeatureFlags,
  type SafeAiSettingsDto,
} from "@shared/aiFoundationContracts";

export interface AiSettingsUpdateData {
  mode?: OrganizationAiSettings["mode"];
  provider?: OrganizationAiSettings["provider"] | null;
  model?: string | null;
  encryptedApiKey?: string | null;
  apiKeyLast4?: string | null;
  encryptionKeyId?: string | null;
  isEnabled?: boolean;
  bugReviewEnabled?: boolean;
  triageBriefEnabled?: boolean;
  featureReviewEnabled?: boolean;
  duplicateDetectionEnabled?: boolean;
  orderParsingEnabled?: boolean;
  emailProcessingEnabled?: boolean;
  customerSupportEnabled?: boolean;
  inventoryRecommendationsEnabled?: boolean;
  productionAssistanceEnabled?: boolean;
  assistantEnabled?: boolean;
  monthlyUsageLimit?: number | null;
}

export interface AiFoundationRepository {
  getSettings(orgId: string): Promise<OrganizationAiSettings | null>;
  upsertSettings(orgId: string, data: AiSettingsUpdateData): Promise<OrganizationAiSettings>;
  recordUsage(data: InsertAiUsage): Promise<AiUsage>;
}

export function toAiFeatureFlags(row: OrganizationAiSettings | null | undefined): AiFeatureFlags {
  if (!row) return { ...defaultAiFeatureFlags };
  return {
    bugReview: row.bugReviewEnabled,
    triageBrief: row.triageBriefEnabled,
    featureReview: row.featureReviewEnabled,
    duplicateDetection: row.duplicateDetectionEnabled,
    orderParsing: row.orderParsingEnabled,
    emailProcessing: row.emailProcessingEnabled,
    customerSupport: row.customerSupportEnabled,
    inventoryRecommendations: row.inventoryRecommendationsEnabled,
    productionAssistance: row.productionAssistanceEnabled,
    assistant: row.assistantEnabled,
  };
}

export function toSafeAiSettingsDto(orgId: string, row: OrganizationAiSettings | null | undefined): SafeAiSettingsDto {
  if (!row) {
    return {
      id: null,
      orgId,
      mode: "disabled",
      provider: null,
      model: null,
      isEnabled: false,
      hasApiKey: false,
      features: { ...defaultAiFeatureFlags },
      monthlyUsageLimit: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    id: row.id,
    orgId: row.orgId,
    mode: normalizeAiMode(row.mode),
    provider: row.provider,
    model: row.model,
    isEnabled: row.isEnabled,
    hasApiKey: Boolean(row.encryptedApiKey),
    features: toAiFeatureFlags(row),
    monthlyUsageLimit: row.monthlyUsageLimit,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
  };
}

export class DrizzleAiFoundationRepository implements AiFoundationRepository {
  async getSettings(orgId: string): Promise<OrganizationAiSettings | null> {
    const [row] = await db
      .select()
      .from(organizationAiSettings)
      .where(eq(organizationAiSettings.orgId, orgId))
      .limit(1);
    return row ?? null;
  }

  async upsertSettings(orgId: string, data: AiSettingsUpdateData): Promise<OrganizationAiSettings> {
    const insertData = {
      ...data,
      orgId,
    };
    const updateData = {
      ...data,
      updatedAt: sql`now()`,
    };

    const [row] = await db
      .insert(organizationAiSettings)
      .values(insertData as typeof organizationAiSettings.$inferInsert)
      .onConflictDoUpdate({
        target: organizationAiSettings.orgId,
        set: updateData,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to save AI settings.");
    }
    return row;
  }

  async recordUsage(data: InsertAiUsage): Promise<AiUsage> {
    const parsed = insertAiUsageSchema.parse(data);
    const [row] = await db
      .insert(aiUsage)
      .values(parsed as InsertAiUsage)
      .returning();
    if (!row) {
      throw new Error("Failed to record AI usage.");
    }
    return row;
  }
}
