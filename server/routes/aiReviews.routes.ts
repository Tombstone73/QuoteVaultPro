import { Router, type Request, type Response, type RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { getRequestOrganizationId } from "../tenantContext";
import { getAiBugReviewFeatureFlags } from "../services/ai/aiBugReviewConfig";
import { AiReviewServiceError, aiReviewService } from "../services/ai/aiReviewService";
import { aiReviewQueue } from "../services/ai/aiReviewQueue";

function getUserId(user: any): string | null {
  return user?.claims?.sub ?? user?.id ?? null;
}

function getUserEmail(user: any): string {
  return user?.email ?? user?.claims?.email ?? "";
}

function isOrgAdminOrOwner(req: Request): boolean {
  const orgRole = String((req as any).orgRole ?? "").toLowerCase();
  return orgRole === "owner" || orgRole === "admin";
}

function buildActor(req: Request) {
  return {
    userId: getUserId((req as any).user),
    email: getUserEmail((req as any).user),
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function handleAiReviewError(res: Response, error: unknown): void {
  if (error instanceof AiReviewServiceError) {
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }

  console.error("[AiReviews] Unexpected route error:", error);
  res.status(500).json({
    success: false,
    code: "AI_REVIEW_INTERNAL_ERROR",
    message: "Failed to process AI review request.",
  });
}

const aiReviewMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const orgId = (req as any).organizationId ?? "unknown_org";
    const userId = getUserId((req as any).user) ?? ipKeyGenerator(req.ip ?? "unknown_user");
    return `${orgId}:${userId}`;
  },
  message: {
    success: false,
    code: "AI_REVIEW_RATE_LIMITED",
    message: "Too many AI review requests. Please wait before trying again.",
  },
});

export function registerAiReviewRoutes(
  app: import("express").Express,
  middleware: {
    isAuthenticated: RequestHandler;
    tenantContext: RequestHandler;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;
  const router = Router();

  router.get("/bug-reports/:id/ai-review", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    const orgId = getRequestOrganizationId(req);
    const flags = getAiBugReviewFeatureFlags();
    const canRun = flags.enabled && isOrgAdminOrOwner(req);

    try {
      const review = await aiReviewService.getCurrentBugReview(orgId, req.params.id);
      return res.json({
        success: true,
        data: {
          review,
          featureFlags: flags,
          canRun,
        },
      });
    } catch (error) {
      return handleAiReviewError(res, error);
    }
  });

  router.post("/bug-reports/:id/ai-review", isAuthenticated, tenantContext, aiReviewMutationLimiter, async (req: Request, res: Response) => {
    const flags = getAiBugReviewFeatureFlags();
    if (!flags.enabled) {
      return res.status(503).json({
        success: false,
        code: "AI_BUG_REVIEW_DISABLED",
        message: "AI bug review is disabled.",
      });
    }
    if (!isOrgAdminOrOwner(req)) {
      return res.status(403).json({
        success: false,
        code: "AI_REVIEW_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    const orgId = getRequestOrganizationId(req);
    try {
      const review = await aiReviewService.requestBugReview({
        orgId,
        bugReportId: req.params.id,
        actor: buildActor(req),
      });

      aiReviewQueue.enqueue({ orgId, reviewId: review.id });

      return res.status(202).json({
        success: true,
        data: {
          reviewId: review.id,
          status: review.status,
        },
        message: "AI bug review queued.",
      });
    } catch (error) {
      return handleAiReviewError(res, error);
    }
  });

  router.post("/ai-reviews/:id/rerun", isAuthenticated, tenantContext, aiReviewMutationLimiter, async (req: Request, res: Response) => {
    const flags = getAiBugReviewFeatureFlags();
    if (!flags.enabled) {
      return res.status(503).json({
        success: false,
        code: "AI_BUG_REVIEW_DISABLED",
        message: "AI bug review is disabled.",
      });
    }
    if (!isOrgAdminOrOwner(req)) {
      return res.status(403).json({
        success: false,
        code: "AI_REVIEW_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    const orgId = getRequestOrganizationId(req);
    try {
      const review = await aiReviewService.rerunReview(orgId, req.params.id, buildActor(req));
      aiReviewQueue.enqueue({ orgId, reviewId: review.id });

      return res.status(202).json({
        success: true,
        data: {
          reviewId: review.id,
          status: review.status,
        },
        message: "AI bug review rerun queued.",
      });
    } catch (error) {
      return handleAiReviewError(res, error);
    }
  });

  app.use("/api", router);
}
