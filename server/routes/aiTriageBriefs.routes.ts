import { Router, type Request, type Response, type RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { aiProviderResolver } from "../services/ai/aiProviderResolver";
import {
  AiTriageBriefServiceError,
  aiTriageBriefService,
} from "../services/ai/aiTriageBriefService";
import { aiTriageBriefQueue } from "../services/ai/aiTriageBriefQueue";
import { buildAiTriageBriefPdfFilename, generateAiTriageBriefPdfBytes } from "../lib/aiTriageBriefPdf";

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

function handleTriageBriefError(res: Response, error: unknown): void {
  if (error instanceof AiTriageBriefServiceError) {
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }

  console.error("[AiTriageBriefs] Unexpected route error:", error);
  res.status(500).json({
    success: false,
    code: "AI_TRIAGE_BRIEF_INTERNAL_ERROR",
    message: "Failed to process AI triage brief request.",
  });
}

const triageBriefFilterSchema = z.object({
  status: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical", "all"]).optional(),
  type: z.enum(["bug", "feature", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

const aiTriageBriefMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const orgId = (req as any).organizationId ?? "unknown_org";
    const userId = getUserId((req as any).user) ?? ipKeyGenerator(req.ip ?? "unknown_user");
    return `${orgId}:${userId}`;
  },
  message: {
    success: false,
    code: "AI_TRIAGE_BRIEF_RATE_LIMITED",
    message: "Too many AI triage brief requests. Please wait before trying again.",
  },
});

export function registerAiTriageBriefRoutes(
  app: import("express").Express,
  middleware: {
    isAuthenticated: RequestHandler;
    tenantContext: RequestHandler;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;
  const router = Router();

  router.get("/bug-reports/ai-triage-briefs", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    if (!isOrgAdminOrOwner(req)) {
      return res.status(403).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    const orgId = getRequestOrganizationId(req);
    const capabilities = await aiProviderResolver.getCapabilities(orgId, {
      canManageSettings: isOrgAdminOrOwner(req),
      canRunBugReview: isOrgAdminOrOwner(req),
    });
    const featureEnabled = capabilities.enabled && capabilities.features.triageBrief;

    try {
      const briefs = await aiTriageBriefService.listBriefs(orgId);
      return res.json({
        success: true,
        data: {
          briefs,
          canGenerate: capabilities.permissions.canGenerateTriageBrief,
          featureEnabled,
        },
      });
    } catch (error) {
      return handleTriageBriefError(res, error);
    }
  });

  router.get("/bug-reports/ai-triage-briefs/:id", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    if (!isOrgAdminOrOwner(req)) {
      return res.status(403).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    const orgId = getRequestOrganizationId(req);
    try {
      const brief = await aiTriageBriefService.getBrief(orgId, req.params.id);
      if (!brief) {
        return res.status(404).json({
          success: false,
          code: "AI_TRIAGE_BRIEF_NOT_FOUND",
          message: "AI triage brief not found.",
        });
      }
      return res.json({ success: true, data: brief });
    } catch (error) {
      return handleTriageBriefError(res, error);
    }
  });

  router.get("/bug-reports/ai-triage-briefs/:id/pdf", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    if (!isOrgAdminOrOwner(req)) {
      return res.status(403).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    const orgId = getRequestOrganizationId(req);
    try {
      const brief = await aiTriageBriefService.getBrief(orgId, req.params.id);
      if (!brief) {
        return res.status(404).json({
          success: false,
          code: "AI_TRIAGE_BRIEF_NOT_FOUND",
          message: "AI triage brief not found.",
        });
      }
      if (brief.status !== "completed" || !brief.result) {
        return res.status(409).json({
          success: false,
          code: "AI_TRIAGE_BRIEF_NOT_COMPLETED",
          message: "Only completed AI triage briefs can be exported as PDF.",
        });
      }

      const pdfBytes = await generateAiTriageBriefPdfBytes(brief);
      const filename = buildAiTriageBriefPdfFilename(brief.completedAt ?? brief.createdAt);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(Buffer.from(pdfBytes));
    } catch (error) {
      return handleTriageBriefError(res, error);
    }
  });

  router.post("/bug-reports/ai-triage-brief", isAuthenticated, tenantContext, aiTriageBriefMutationLimiter, async (req: Request, res: Response) => {
    if (!isOrgAdminOrOwner(req)) {
      return res.status(403).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    const parse = triageBriefFilterSchema.safeParse(req.body?.filters ?? {});
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_INVALID_FILTERS",
        message: "Invalid AI triage brief filters.",
        errors: parse.error.flatten().fieldErrors,
      });
    }

    const orgId = getRequestOrganizationId(req);
    const capabilities = await aiProviderResolver.getCapabilities(orgId, {
      canManageSettings: isOrgAdminOrOwner(req),
      canRunBugReview: isOrgAdminOrOwner(req),
    });
    if (!capabilities.enabled || !capabilities.features.triageBrief) {
      return res.status(503).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_DISABLED",
        message: "AI Triage Brief is disabled.",
      });
    }
    if (!capabilities.permissions.canGenerateTriageBrief) {
      return res.status(403).json({
        success: false,
        code: "AI_TRIAGE_BRIEF_PERMISSION_REQUIRED",
        message: "Access denied. Organization Owner or Admin role required.",
      });
    }

    try {
      const brief = await aiTriageBriefService.requestTriageBrief({
        orgId,
        filters: parse.data,
        actor: buildActor(req),
      });

      aiTriageBriefQueue.enqueue({ orgId, briefId: brief.id });

      return res.status(202).json({
        success: true,
        data: {
          briefId: brief.id,
          status: brief.status,
        },
        message: "AI triage brief queued.",
      });
    } catch (error) {
      return handleTriageBriefError(res, error);
    }
  });

  app.use("/api", router);
}
