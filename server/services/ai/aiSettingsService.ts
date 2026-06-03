import { aiSettingsUpdateSchema, type AiSettingsUpdate, type SafeAiSettingsDto } from "@shared/aiFoundationContracts";
import type { OrganizationAiSettings } from "@shared/schema";
import {
  DrizzleAiFoundationRepository,
  toSafeAiSettingsDto,
  type AiFoundationRepository,
  type AiSettingsUpdateData,
} from "../../storage/aiFoundation.repo";
import {
  encryptAiSecret,
  getSecretLast4,
} from "./aiSecretsEncryption";

export class AiSettingsServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AiSettingsServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeModel(model: string | null | undefined): string | null | undefined {
  if (model === undefined) return undefined;
  const trimmed = model?.trim() ?? "";
  return trimmed || null;
}

function asModeEnabled(mode: OrganizationAiSettings["mode"] | undefined, explicit?: boolean): boolean | undefined {
  if (explicit !== undefined) return explicit;
  if (mode === "disabled") return false;
  if (mode === "printershero_managed" || mode === "bring_your_own") return true;
  return undefined;
}

export class AiSettingsService {
  constructor(private readonly repo: AiFoundationRepository = new DrizzleAiFoundationRepository()) {}

  async getSettings(orgId: string): Promise<SafeAiSettingsDto> {
    const row = await this.repo.getSettings(orgId);
    return toSafeAiSettingsDto(orgId, row);
  }

  async updateSettings(orgId: string, rawPatch: unknown): Promise<SafeAiSettingsDto> {
    const patch = aiSettingsUpdateSchema.parse(rawPatch ?? {});
    const update = this.buildUpdate(patch);
    const row = await this.repo.upsertSettings(orgId, update);
    return toSafeAiSettingsDto(orgId, row);
  }

  private buildUpdate(patch: AiSettingsUpdate): AiSettingsUpdateData {
    const update: AiSettingsUpdateData = {};

    if (patch.mode !== undefined) update.mode = patch.mode;
    if (patch.provider !== undefined) update.provider = patch.provider;
    if (patch.model !== undefined) update.model = normalizeModel(patch.model);
    if (patch.isEnabled !== undefined || patch.mode !== undefined) {
      update.isEnabled = asModeEnabled(patch.mode, patch.isEnabled);
    }
    if (patch.bugReviewEnabled !== undefined) update.bugReviewEnabled = patch.bugReviewEnabled;
    if (patch.featureReviewEnabled !== undefined) update.featureReviewEnabled = patch.featureReviewEnabled;
    if (patch.duplicateDetectionEnabled !== undefined) update.duplicateDetectionEnabled = patch.duplicateDetectionEnabled;
    if (patch.orderParsingEnabled !== undefined) update.orderParsingEnabled = patch.orderParsingEnabled;
    if (patch.emailProcessingEnabled !== undefined) update.emailProcessingEnabled = patch.emailProcessingEnabled;
    if (patch.customerSupportEnabled !== undefined) update.customerSupportEnabled = patch.customerSupportEnabled;
    if (patch.inventoryRecommendationsEnabled !== undefined) update.inventoryRecommendationsEnabled = patch.inventoryRecommendationsEnabled;
    if (patch.productionAssistanceEnabled !== undefined) update.productionAssistanceEnabled = patch.productionAssistanceEnabled;
    if (patch.monthlyUsageLimit !== undefined) update.monthlyUsageLimit = patch.monthlyUsageLimit;

    if (patch.clearApiKey || patch.mode === "disabled" || patch.mode === "printershero_managed") {
      update.encryptedApiKey = null;
      update.apiKeyLast4 = null;
      update.encryptionKeyId = null;
    }

    if (patch.apiKey) {
      try {
        const encrypted = encryptAiSecret(patch.apiKey);
        update.encryptedApiKey = encrypted.encrypted;
        update.encryptionKeyId = encrypted.keyId;
        update.apiKeyLast4 = getSecretLast4(patch.apiKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to encrypt AI API key.";
        throw new AiSettingsServiceError("AI_SECRET_ENCRYPTION_FAILED", message, 500);
      }
    }

    if (patch.mode === "disabled") {
      update.provider = null;
      update.model = null;
      update.bugReviewEnabled = false;
      update.featureReviewEnabled = false;
      update.duplicateDetectionEnabled = false;
      update.orderParsingEnabled = false;
      update.emailProcessingEnabled = false;
      update.customerSupportEnabled = false;
      update.inventoryRecommendationsEnabled = false;
      update.productionAssistanceEnabled = false;
    }

    return update;
  }
}

export const aiSettingsService = new AiSettingsService();
