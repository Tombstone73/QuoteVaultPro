import { getAiBugReviewFeatureFlags, getAiBugReviewProviderConfig, getAiBugReviewStaleMinutes } from "./aiBugReviewConfig";
import { buildBugReviewPrompt } from "./prompts/bugReviewPrompt";
import { parseAiJsonObject, validateBugReviewJson } from "./bugReviewValidator";
import {
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderResponse,
} from "./providers/AiProviderAdapter";
import { createConfiguredAiProvider } from "./providers/configuredProvider";
import {
  DrizzleAiReviewsRepository,
  toAiReviewDto,
  type AiReviewsRepository,
} from "../../storage/aiReviews.repo";
import type { AiReviewDto, BugAiReviewResult } from "@shared/aiReviewContracts";

export class AiReviewServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AiReviewServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AiReviewActor {
  userId: string | null;
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RequestBugReviewInput {
  orgId: string;
  bugReportId: string;
  actor: AiReviewActor;
}

export interface ProcessReviewInput {
  orgId: string;
  reviewId: string;
}

const ACTIVE_STATUSES = new Set(["pending", "processing"]);

type ProviderValidationOutcome =
  | { success: true; result: BugAiReviewResult }
  | { success: false; errors: Array<{ path: string; message: string }> };

function compactErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return "AI review failed.".slice(0, 500);
}

function errorCodeFor(error: unknown): string {
  if (error instanceof AiProviderUnavailableError) return "provider_unavailable";
  if (error instanceof DOMException && error.name === "AbortError") return "provider_timeout";
  if (error instanceof Error && /abort/i.test(error.message)) return "provider_timeout";
  return "provider_error";
}

function buildRepairPrompt(rawText: string, validationErrors: unknown): string {
  return [
    "Repair the previous response so it is exactly one strict JSON object matching the required schema.",
    "Do not add markdown. Do not add extra fields. Preserve the advisory-only meaning.",
    "",
    "Validation errors:",
    JSON.stringify(validationErrors, null, 2),
    "",
    "Previous response:",
    rawText.slice(0, 8000),
  ].join("\n");
}

function staleBeforeDate(): Date {
  return new Date(Date.now() - getAiBugReviewStaleMinutes() * 60 * 1000);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

export class AiReviewService {
  constructor(
    private readonly repo: AiReviewsRepository = new DrizzleAiReviewsRepository(),
    private readonly provider: AiProviderAdapter = createConfiguredAiProvider(),
  ) {}

  async getCurrentBugReview(orgId: string, bugReportId: string): Promise<AiReviewDto | null> {
    await this.recoverStaleActiveReviewsForBugReport(orgId, bugReportId, {
      userId: null,
      email: "system",
    });
    const review = await this.repo.getCurrentReviewForBugReport(orgId, bugReportId);
    return review ? toAiReviewDto(review) : null;
  }

  async requestBugReview(input: RequestBugReviewInput): Promise<AiReviewDto> {
    const flags = getAiBugReviewFeatureFlags();
    if (!flags.enabled) {
      throw new AiReviewServiceError("AI_BUG_REVIEW_DISABLED", "AI bug review is disabled.", 503);
    }

    const bug = await this.repo.getBugReportForReview(input.orgId, input.bugReportId);
    if (!bug) {
      throw new AiReviewServiceError("BUG_REPORT_NOT_FOUND", "Bug report not found.", 404);
    }
    if (bug.type !== "bug") {
      throw new AiReviewServiceError("AI_REVIEW_BUGS_ONLY", "Phase 1 AI review only supports bug reports.", 400);
    }

    await this.recoverStaleActiveReviewsForBugReport(input.orgId, input.bugReportId, input.actor);

    const current = await this.repo.getCurrentReviewForBugReport(input.orgId, input.bugReportId);
    if (current && ACTIVE_STATUSES.has(current.status)) {
      throw new AiReviewServiceError("AI_REVIEW_ALREADY_ACTIVE", "An AI review is already pending or processing.", 409);
    }

    const builtPrompt = buildBugReviewPrompt({
      id: bug.id,
      title: bug.title,
      description: bug.description,
      severity: bug.severity,
      url: bug.url,
      screenWidth: bug.screenWidth,
      screenHeight: bug.screenHeight,
      metadata: bug.metadata ?? {},
      createdAt: bug.createdAt,
    });

    let created;
    try {
      created = await this.repo.createPendingReview({
        orgId: input.orgId,
        bugReportId: input.bugReportId,
        requestedByUserId: input.actor.userId,
        requestedByEmail: input.actor.email,
        promptVersion: builtPrompt.promptVersion,
        inputSnapshot: builtPrompt.inputSnapshot,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AiReviewServiceError("AI_REVIEW_ALREADY_ACTIVE", "An AI review is already pending or processing.", 409);
      }
      throw error;
    }

    await this.safeAudit({
      orgId: input.orgId,
      userId: input.actor.userId,
      userEmail: input.actor.email,
      actionType: "CREATE",
      entityId: created.id,
      entityName: `AI review for ${bug.title}`,
      description: `AI bug review requested for bug report ${bug.id}`,
      ipAddress: input.actor.ipAddress,
      userAgent: input.actor.userAgent,
      newValues: {
        bugReportId: bug.id,
        status: created.status,
        promptVersion: created.promptVersion,
      },
    });

    return toAiReviewDto(created);
  }

  async rerunReview(orgId: string, reviewId: string, actor: AiReviewActor): Promise<AiReviewDto> {
    const source = await this.repo.getReviewById(orgId, reviewId);
    if (!source) {
      throw new AiReviewServiceError("AI_REVIEW_NOT_FOUND", "AI review not found.", 404);
    }
    if (ACTIVE_STATUSES.has(source.status)) {
      throw new AiReviewServiceError("AI_REVIEW_ALREADY_ACTIVE", "Cannot rerun a pending or processing review.", 409);
    }

    const rerun = await this.requestBugReview({ orgId, bugReportId: source.bugReportId, actor });

    await this.safeAudit({
      orgId,
      userId: actor.userId,
      userEmail: actor.email,
      actionType: "CREATE",
      entityId: rerun.id,
      entityName: `Rerun AI review ${source.id}`,
      description: `AI bug review rerun requested from review ${source.id}`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      newValues: {
        sourceReviewId: source.id,
        newReviewId: rerun.id,
      },
    });

    return rerun;
  }

  async processReview(input: ProcessReviewInput): Promise<void> {
    const review = await this.repo.getReviewById(input.orgId, input.reviewId);
    if (!review || review.status !== "pending") return;

    const bug = await this.repo.getBugReportForReview(input.orgId, review.bugReportId);
    if (!bug || bug.type !== "bug") {
      await this.repo.failReview({
        orgId: input.orgId,
        reviewId: input.reviewId,
        errorCode: "bug_report_unavailable",
        errorMessage: "Bug report was not available for AI review.",
      });
      return;
    }

    const providerConfig = getAiBugReviewProviderConfig();
    const claimed = await this.repo.markProcessing(input.orgId, input.reviewId, providerConfig.provider, providerConfig.model || "unconfigured");
    if (!claimed) {
      console.warn("[AiReviewService] Skipping AI review provider call because processing claim failed.", {
        orgId: input.orgId,
        reviewId: input.reviewId,
      });
      await this.safeAudit({
        orgId: input.orgId,
        userId: null,
        userEmail: "system",
        actionType: "UPDATE",
        entityId: input.reviewId,
        entityName: `AI review ${input.reviewId}`,
        description: `AI bug review processing skipped because the queue claim failed for review ${input.reviewId}`,
        newValues: {
          status: "claim_failed",
        },
      });
      return;
    }

    const builtPrompt = buildBugReviewPrompt({
      id: bug.id,
      title: bug.title,
      description: bug.description,
      severity: bug.severity,
      url: bug.url,
      screenWidth: bug.screenWidth,
      screenHeight: bug.screenHeight,
      metadata: bug.metadata ?? {},
      createdAt: bug.createdAt,
    });

    let providerResponse: AiProviderResponse | null = null;

    try {
      providerResponse = await this.provider.generateBugReview({
        system: builtPrompt.system,
        user: builtPrompt.user,
        promptVersion: builtPrompt.promptVersion,
      });

      const firstResult = this.validateProviderResponse(providerResponse.rawText);
      if (firstResult.success) {
        await this.complete(input.orgId, input.reviewId, providerResponse, firstResult.result);
        return;
      }

      const repairResponse = await this.provider.generateBugReview({
        system: builtPrompt.system,
        user: buildRepairPrompt(providerResponse.rawText, firstResult.errors),
        promptVersion: builtPrompt.promptVersion,
        repairAttempt: true,
      });

      const repaired = this.validateProviderResponse(repairResponse.rawText);
      if (!repaired.success) {
        await this.fail(input.orgId, input.reviewId, repairResponse, "invalid_json", "AI review response did not match the required schema.", repaired.errors);
        return;
      }

      await this.complete(input.orgId, input.reviewId, repairResponse, repaired.result);
    } catch (error) {
      await this.fail(
        input.orgId,
        input.reviewId,
        providerResponse,
        errorCodeFor(error),
        compactErrorMessage(error),
      );
    }
  }

  private validateProviderResponse(rawText: string): ProviderValidationOutcome {
    try {
      const parsed = parseAiJsonObject(rawText);
      const validation = validateBugReviewJson(parsed);
      if (validation.success && validation.result) {
        return { success: true, result: validation.result };
      }
      return { success: false, errors: validation.errors ?? [{ path: "$", message: "AI response did not match schema." }] };
    } catch (error) {
      return {
        success: false as const,
        errors: [{ path: "$", message: compactErrorMessage(error) }],
      };
    }
  }

  private async complete(orgId: string, reviewId: string, response: AiProviderResponse, result: BugAiReviewResult): Promise<void> {
    const completed = await this.repo.completeReview({
      orgId,
      reviewId,
      provider: response.provider,
      model: response.model,
      result,
      requestMetadata: response.requestMetadata,
    });

    if (completed) {
      await this.safeAudit({
        orgId,
        userId: null,
        userEmail: "system",
        actionType: "UPDATE",
        entityId: reviewId,
        entityName: `AI review ${reviewId}`,
        description: `AI bug review completed for bug report ${completed.bugReportId}`,
        newValues: {
          status: "completed",
          provider: response.provider,
          model: response.model,
          promptVersion: completed.promptVersion,
          confidence: result.confidence,
          workflowImpact: result.workflowImpact,
          revenueRisk: result.revenueRisk,
          suggestedOwner: result.suggestedOwner,
        },
      });
    }
  }

  private async fail(
    orgId: string,
    reviewId: string,
    response: AiProviderResponse | null,
    errorCode: string,
    errorMessage: string,
    validationErrors?: unknown,
  ): Promise<void> {
    const failed = await this.repo.failReview({
      orgId,
      reviewId,
      provider: response?.provider ?? null,
      model: response?.model ?? null,
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
        entityId: reviewId,
        entityName: `AI review ${reviewId}`,
        description: `AI bug review failed for bug report ${failed.bugReportId}`,
        newValues: {
          status: "failed",
          errorCode,
        },
      });
    }
  }

  private async recoverStaleActiveReviewsForBugReport(orgId: string, bugReportId: string, actor: AiReviewActor): Promise<void> {
    const staleMinutes = getAiBugReviewStaleMinutes();
    const reason = `AI bug review recovered as failed after being active for more than ${staleMinutes} minutes.`;
    const recovered = await this.repo.recoverStaleActiveReviewsForBugReport(
      orgId,
      bugReportId,
      staleBeforeDate(),
      reason,
    );

    for (const row of recovered) {
      await this.safeAudit({
        orgId,
        userId: actor.userId,
        userEmail: actor.email || "system",
        actionType: "UPDATE",
        entityId: row.id,
        entityName: `AI review ${row.id}`,
        description: `Stale AI bug review recovered for bug report ${row.bugReportId}`,
        newValues: {
          status: "failed",
          previousActiveStateRecovered: true,
          errorCode: "stale_review_recovered",
          staleMinutes,
        },
      });
    }
  }

  private async safeAudit(input: Parameters<AiReviewsRepository["createAuditLog"]>[0]): Promise<void> {
    try {
      await this.repo.createAuditLog(input);
    } catch (error) {
      console.error("[AiReviewService] Audit log failed:", error);
    }
  }
}

export const aiReviewService = new AiReviewService();
