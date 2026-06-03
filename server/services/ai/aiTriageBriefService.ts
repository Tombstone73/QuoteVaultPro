import { getAiTriageBriefStaleMinutes } from "./aiBugReviewConfig";
import { parseAiJsonObject } from "./bugReviewValidator";
import { buildTriageBriefPrompt } from "./prompts/triageBriefPrompt";
import { validateTriageBriefJson } from "./triageBriefValidator";
import {
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderResponse,
} from "./providers/AiProviderAdapter";
import { createConfiguredAiProvider } from "./providers/configuredProvider";
import { aiProviderResolver } from "./aiProviderResolver";
import {
  DrizzleAiTriageBriefsRepository,
  toAiTriageBriefDto,
  type AiTriageBriefsRepository,
  type TriageBriefFilters,
} from "../../storage/aiTriageBriefs.repo";
import {
  DrizzleAiFoundationRepository,
  type AiFoundationRepository,
} from "../../storage/aiFoundation.repo";
import type { AiTriageBriefDto, AiTriageBriefResult } from "@shared/aiTriageBriefContracts";
import { activeTriageFeedbackStatusValues, getIncludedTriageFeedbackStatuses } from "@shared/aiTriageBriefContracts";

export class AiTriageBriefServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AiTriageBriefServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AiTriageBriefActor {
  userId: string | null;
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RequestTriageBriefInput {
  orgId: string;
  filters: TriageBriefFilters;
  actor: AiTriageBriefActor;
}

export interface ProcessTriageBriefInput {
  orgId: string;
  briefId: string;
}

type ProviderValidationOutcome =
  | { success: true; result: AiTriageBriefResult }
  | { success: false; errors: Array<{ path: string; message: string }> };

function compactErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return "AI triage brief failed.";
}

function errorCodeFor(error: unknown): string {
  if (error instanceof AiProviderUnavailableError) return "provider_unavailable";
  if (error instanceof DOMException && error.name === "AbortError") return "provider_timeout";
  if (error instanceof Error && /abort/i.test(error.message)) return "provider_timeout";
  return "provider_error";
}

function staleBeforeDate(): Date {
  return new Date(Date.now() - getAiTriageBriefStaleMinutes() * 60 * 1000);
}

function buildRepairPrompt(rawText: string, validationErrors: unknown): string {
  return [
    "Repair the previous response so it is exactly one strict JSON object matching the required AI Triage Brief schema.",
    "Do not add markdown. Do not add extra fields. Preserve advisory-only meaning.",
    "",
    "Validation errors:",
    JSON.stringify(validationErrors, null, 2),
    "",
    "Previous response:",
    rawText.slice(0, 12000),
  ].join("\n");
}

function normalizeFilters(filters: TriageBriefFilters): TriageBriefFilters {
  return {
    status: filters.status && filters.status !== "all" ? filters.status : undefined,
    severity: filters.severity && filters.severity !== "all" ? filters.severity : undefined,
    type: filters.type ?? "all",
    limit: Math.min(Math.max(filters.limit ?? 100, 1), 200),
  };
}

function tokenUsageFromMetadata(metadata: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const usage = metadata.usage && typeof metadata.usage === "object" ? metadata.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
    totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
  };
}

export class AiTriageBriefService {
  constructor(
    private readonly repo: AiTriageBriefsRepository = new DrizzleAiTriageBriefsRepository(),
    private readonly provider: AiProviderAdapter = createConfiguredAiProvider(),
    private readonly aiFoundationRepo: AiFoundationRepository = new DrizzleAiFoundationRepository(),
  ) {}

  async listBriefs(orgId: string): Promise<AiTriageBriefDto[]> {
    await this.recoverStaleActiveBriefs(orgId, { userId: null, email: "system" });
    const rows = await this.repo.listBriefs(orgId, 25);
    return rows.map(toAiTriageBriefDto);
  }

  async getBrief(orgId: string, briefId: string): Promise<AiTriageBriefDto | null> {
    await this.recoverStaleActiveBriefs(orgId, { userId: null, email: "system" });
    const row = await this.repo.getBriefById(orgId, briefId);
    return row ? toAiTriageBriefDto(row) : null;
  }

  async requestTriageBrief(input: RequestTriageBriefInput): Promise<AiTriageBriefDto> {
    const resolvedProvider = await aiProviderResolver.resolveProvider({ orgId: input.orgId, feature: "triage_brief" });
    if (!resolvedProvider.enabled) {
      throw new AiTriageBriefServiceError("AI_TRIAGE_BRIEF_DISABLED", "AI Triage Brief is disabled.", 503);
    }

    await this.recoverStaleActiveBriefs(input.orgId, input.actor);

    const filters = normalizeFilters(input.filters);
    const reports = await this.repo.listReportsForBrief(input.orgId, filters);
    if (reports.length === 0) {
      throw new AiTriageBriefServiceError("AI_TRIAGE_BRIEF_NO_REPORTS", "No open or in-review feedback items match the selected filters.", 400);
    }

    const builtPrompt = buildTriageBriefPrompt({
      filtersSnapshot: {
        ...filters,
        activeOnly: true,
        allowedStatuses: [...activeTriageFeedbackStatusValues],
        includedStatuses: getIncludedTriageFeedbackStatuses(filters.status),
        excludedStatuses: ["resolved", "closed"],
        reportCount: reports.length,
      },
      reports,
    });

    const created = await this.repo.createPendingBrief({
      orgId: input.orgId,
      requestedByUserId: input.actor.userId,
      requestedByEmail: input.actor.email,
      promptVersion: builtPrompt.promptVersion,
      filtersSnapshot: {
        ...filters,
        activeOnly: true,
        allowedStatuses: [...activeTriageFeedbackStatusValues],
        includedStatuses: getIncludedTriageFeedbackStatuses(filters.status),
        excludedStatuses: ["resolved", "closed"],
        reportCount: reports.length,
      },
      reportSnapshot: builtPrompt.reportSnapshot,
    });

    await this.safeAudit({
      orgId: input.orgId,
      userId: input.actor.userId,
      userEmail: input.actor.email,
      actionType: "CREATE",
      entityId: created.id,
      entityName: "AI Triage Brief",
      description: `AI triage brief requested for ${reports.length} feedback item(s).`,
      ipAddress: input.actor.ipAddress,
      userAgent: input.actor.userAgent,
      newValues: {
        status: created.status,
        promptVersion: created.promptVersion,
        reportCount: reports.length,
        filters,
      },
    });

    return toAiTriageBriefDto(created);
  }

  async processBrief(input: ProcessTriageBriefInput): Promise<void> {
    const brief = await this.repo.getBriefById(input.orgId, input.briefId);
    if (!brief || brief.status !== "pending") return;

    const resolvedProvider = await aiProviderResolver.resolveProvider({ orgId: input.orgId, feature: "triage_brief" });
    const claimed = await this.repo.markProcessing(
      input.orgId,
      input.briefId,
      resolvedProvider.provider || "unconfigured",
      resolvedProvider.model || "unconfigured",
      resolvedProvider.mode,
    );
    if (!claimed) {
      console.warn("[AiTriageBriefService] Skipping provider call because processing claim failed.", {
        orgId: input.orgId,
        briefId: input.briefId,
      });
      await this.safeAudit({
        orgId: input.orgId,
        userId: null,
        userEmail: "system",
        actionType: "UPDATE",
        entityId: input.briefId,
        entityName: `AI triage brief ${input.briefId}`,
        description: `AI triage brief processing skipped because the queue claim failed for brief ${input.briefId}`,
        newValues: { status: "claim_failed" },
      });
      return;
    }

    const builtPrompt = buildTriageBriefPrompt({
      filtersSnapshot: claimed.filtersSnapshot,
      reports: claimed.reportSnapshot as any[],
    });

    let providerResponse: AiProviderResponse | null = null;

    try {
      providerResponse = await this.provider.generateTriageBrief({
        orgId: input.orgId,
        feature: "triage_brief",
        system: builtPrompt.system,
        user: builtPrompt.user,
        promptVersion: builtPrompt.promptVersion,
        providerConfig: resolvedProvider,
      });

      const firstResult = this.validateProviderResponse(providerResponse.rawText);
      if (firstResult.success) {
        await this.complete(input.orgId, input.briefId, resolvedProvider.mode, providerResponse, firstResult.result);
        return;
      }

      const repairResponse = await this.provider.generateTriageBrief({
        orgId: input.orgId,
        feature: "triage_brief",
        system: builtPrompt.system,
        user: buildRepairPrompt(providerResponse.rawText, firstResult.errors),
        promptVersion: builtPrompt.promptVersion,
        repairAttempt: true,
        providerConfig: resolvedProvider,
      });

      const repaired = this.validateProviderResponse(repairResponse.rawText);
      if (!repaired.success) {
        await this.fail(input.orgId, input.briefId, resolvedProvider.mode, repairResponse, "invalid_json", "AI triage brief response did not match the required schema.", repaired.errors);
        return;
      }

      await this.complete(input.orgId, input.briefId, resolvedProvider.mode, repairResponse, repaired.result);
    } catch (error) {
      await this.fail(
        input.orgId,
        input.briefId,
        resolvedProvider.mode,
        providerResponse,
        errorCodeFor(error),
        compactErrorMessage(error),
      );
    }
  }

  private validateProviderResponse(rawText: string): ProviderValidationOutcome {
    try {
      const parsed = parseAiJsonObject(rawText);
      const validation = validateTriageBriefJson(parsed);
      if (validation.success && validation.result) {
        return { success: true, result: validation.result };
      }
      return { success: false, errors: validation.errors ?? [{ path: "$", message: "AI response did not match schema." }] };
    } catch (error) {
      return {
        success: false,
        errors: [{ path: "$", message: compactErrorMessage(error) }],
      };
    }
  }

  private async complete(orgId: string, briefId: string, mode: string, response: AiProviderResponse, result: AiTriageBriefResult): Promise<void> {
    const tokenUsage = tokenUsageFromMetadata(response.requestMetadata);
    const usageMetadata = {
      feature: "triage_brief",
      ...tokenUsage,
      costCurrency: "USD",
      estimatedCostCents: 0,
      pricingSnapshot: {
        basis: mode === "bring_your_own" ? "customer_paid_byok" : "estimate_not_configured",
        currency: "USD",
        provider: response.provider,
        model: response.model,
        mode,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        billableToPrintersHero: mode === "printershero_managed",
      },
    };

    await this.aiFoundationRepo.recordUsage({
      orgId,
      feature: "triage_brief",
      provider: response.provider,
      model: response.model,
      mode,
      requestCount: 1,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      estimatedCostCents: 0,
      costCurrency: "USD",
      pricingSnapshot: usageMetadata.pricingSnapshot,
      source: "ai_triage_brief",
      metadata: {
        briefId,
        providerRequestId: response.requestMetadata.providerRequestId ?? null,
      },
    });

    const completed = await this.repo.completeBrief({
      orgId,
      briefId,
      provider: response.provider,
      model: response.model,
      mode,
      result,
      providerMetadata: response.requestMetadata,
      usageMetadata,
    });

    if (completed) {
      await this.safeAudit({
        orgId,
        userId: null,
        userEmail: "system",
        actionType: "UPDATE",
        entityId: briefId,
        entityName: `AI triage brief ${briefId}`,
        description: "AI triage brief completed.",
        newValues: {
          status: "completed",
          provider: response.provider,
          model: response.model,
          confidence: result.confidence,
        },
      });
    }
  }

  private async fail(
    orgId: string,
    briefId: string,
    mode: string,
    response: AiProviderResponse | null,
    errorCode: string,
    errorMessage: string,
    validationErrors?: unknown,
  ): Promise<void> {
    const failed = await this.repo.failBrief({
      orgId,
      briefId,
      provider: response?.provider ?? null,
      model: response?.model ?? null,
      mode,
      validationErrors,
      errorCode,
      errorMessage,
    });

    if (failed) {
      await this.safeAudit({
        orgId,
        userId: null,
        userEmail: "system",
        actionType: "UPDATE",
        entityId: briefId,
        entityName: `AI triage brief ${briefId}`,
        description: "AI triage brief failed.",
        newValues: {
          status: "failed",
          errorCode,
        },
      });
    }
  }

  private async recoverStaleActiveBriefs(orgId: string, actor: AiTriageBriefActor): Promise<void> {
    const staleMinutes = getAiTriageBriefStaleMinutes();
    const reason = `AI triage brief recovered as failed after being active for more than ${staleMinutes} minutes.`;
    const recovered = await this.repo.recoverStaleActiveBriefs(orgId, staleBeforeDate(), reason);
    for (const row of recovered) {
      await this.safeAudit({
        orgId,
        userId: actor.userId,
        userEmail: actor.email || "system",
        actionType: "UPDATE",
        entityId: row.id,
        entityName: `AI triage brief ${row.id}`,
        description: "Stale AI triage brief recovered.",
        newValues: {
          status: "failed",
          errorCode: "stale_triage_brief_recovered",
          staleMinutes,
        },
      });
    }
  }

  private async safeAudit(input: Parameters<AiTriageBriefsRepository["createAuditLog"]>[0]): Promise<void> {
    try {
      await this.repo.createAuditLog(input);
    } catch (error) {
      console.error("[AiTriageBriefService] Audit log failed:", error);
    }
  }
}

export const aiTriageBriefService = new AiTriageBriefService();
