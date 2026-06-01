import type { Express, Request, Response } from "express";
import { z } from "zod";

import {
  canStartStaffPortalPreview,
  endStaffPortalPreview,
  isStaffPortalPreviewExpired,
  startStaffPortalPreview,
} from "../services/staffPortalPreviewService";

const startPreviewSchema = z.object({
  customerId: z.string().min(1),
  returnTo: z.string().optional().nullable(),
});

function getStatusCode(error: unknown): number {
  const status = (error as any)?.status;
  return typeof status === "number" ? status : 500;
}

function getErrorCode(error: unknown): string | undefined {
  const code = (error as any)?.code;
  return typeof code === "string" ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Staff portal preview request failed";
}

function sendError(res: Response, error: unknown) {
  const status = getStatusCode(error);
  return res.status(status).json({
    success: false,
    code: getErrorCode(error),
    message: status >= 500 ? "Staff portal preview request failed" : getErrorMessage(error),
  });
}

function requireInternalPreviewActor(req: Request, res: Response): boolean {
  if (!canStartStaffPortalPreview(req.user)) {
    res.status(403).json({
      success: false,
      code: "STAFF_PORTAL_PREVIEW_INTERNAL_ONLY",
      message: "Only internal users can preview a customer portal.",
    });
    return false;
  }
  return true;
}

export function registerStaffPortalPreviewRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  app.post("/api/portal/preview/start", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    try {
      if (!requireInternalPreviewActor(req, res)) return;

      const payload = startPreviewSchema.parse(req.body ?? {});
      const user = req.user as any;
      const organizationId = req.organizationId;
      if (!user?.id || !organizationId) {
        return res.status(403).json({
          success: false,
          code: "STAFF_PORTAL_PREVIEW_CONTEXT_REQUIRED",
          message: "Organization context is required to start portal preview.",
        });
      }

      const preview = await startStaffPortalPreview({
        req,
        actorUserId: user.id,
        organizationId,
        customerId: payload.customerId,
        returnTo: payload.returnTo,
      });

      return res.json({
        success: true,
        data: {
          preview,
          redirectTo: "/portal?preview=1",
        },
      });
    } catch (error) {
      console.error("[StaffPortalPreview] start failed", error);
      return sendError(res, error);
    }
  });

  app.get("/api/portal/preview/session", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!requireInternalPreviewActor(req, res)) return;

      const preview = req.session.staffPortalPreview ?? null;
      if (!preview) {
        return res.json({ success: true, data: null });
      }

      if (isStaffPortalPreviewExpired(preview)) {
        await endStaffPortalPreview(req, "STAFF_PORTAL_PREVIEW_EXPIRED");
        return res.status(403).json({
          success: false,
          code: "STAFF_PORTAL_PREVIEW_EXPIRED",
          message: "Staff portal preview has expired.",
        });
      }

      return res.json({ success: true, data: preview });
    } catch (error) {
      console.error("[StaffPortalPreview] session failed", error);
      return sendError(res, error);
    }
  });

  app.post("/api/portal/preview/end", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!requireInternalPreviewActor(req, res)) return;

      const preview = await endStaffPortalPreview(req, "STAFF_PORTAL_PREVIEW_ENDED");
      return res.json({
        success: true,
        data: {
          returnTo: preview?.returnTo ?? "/customers",
        },
      });
    } catch (error) {
      console.error("[StaffPortalPreview] end failed", error);
      return sendError(res, error);
    }
  });
}
