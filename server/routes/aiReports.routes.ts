import { Router, type Express, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { reportDefinitionSchema } from "@shared/aiReportingContracts";
import { getRequestOrganizationId } from "../tenantContext";
import { AssistantReportsRepository, type AssistantReportRecord } from "../storage/assistantReports.repo";
import { ReportSharingService } from "../services/assistant/reportSharingService";

function userId(req: Request): string | null {
  const user = req.user as { id?: unknown; claims?: { sub?: unknown } } | undefined;
  const value = user?.claims?.sub ?? user?.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isOrganizationReportManager(req: Request): boolean {
  const role = String(req.orgRole ?? "").toLowerCase();
  return role === "owner" || role === "admin";
}

function publicHeaders(res: Response): void {
  res.set({
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
}

function reportDto(report: AssistantReportRecord) {
  return {
    id: report.id,
    title: report.title,
    description: report.description,
    status: report.status,
    audience: report.audience,
    definition: report.definition,
    dataSnapshotAt: report.dataSnapshotAt.toISOString(),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    archivedAt: report.archivedAt?.toISOString() ?? null,
  };
}

const createReportSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).optional(),
  definition: reportDefinitionSchema,
  dataSnapshot: z.record(z.unknown()).default({}),
  snapshotMetadata: z.record(z.unknown()).default({}),
  conversationId: z.string().trim().min(1).max(128).optional(),
  sourceTurnId: z.string().trim().min(1).max(128).optional(),
}).strict();
const updateMetadataSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  audience: z.enum(["private", "organization", "shared_link", "customer_safe"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one metadata field is required.");
const versionSchema = z.object({
  definition: reportDefinitionSchema,
  dataSnapshot: z.record(z.unknown()).default({}),
  changeSummary: z.string().trim().max(500).optional(),
}).strict();
const shareSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).optional(),
  downloadAllowed: z.boolean().optional(),
}).strict();

/** Saved reports are internal artifacts. Public rendering intentionally lives
 * in a separate unauthenticated route with a token-hash lookup only. */
export function registerAiReportsRoutes(
  app: Express,
  middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler },
  dependencies: { repository?: AssistantReportsRepository; sharingService?: ReportSharingService } = {},
): void {
  const repository = dependencies.repository ?? new AssistantReportsRepository();
  const sharingService = dependencies.sharingService ?? new ReportSharingService({ repository });
  const internal = Router();
  const guarded: RequestHandler[] = [middleware.isAuthenticated, middleware.tenantContext];
  const requireManager: RequestHandler = (req, res, next) => isOrganizationReportManager(req)
    ? next()
    : res.status(403).json({ success: false, code: "REPORT_PERMISSION_REQUIRED", message: "Organization Owner or Admin access is required for reports." });
  const scope = (req: Request) => {
    const actorUserId = userId(req);
    if (!actorUserId) throw new Error("REPORT_AUTH_REQUIRED");
    return { organizationId: getRequestOrganizationId(req), actorUserId };
  };
  const accessibleReport = async (req: Request, res: Response) => {
    const { organizationId, actorUserId } = scope(req);
    const report = await repository.get(organizationId, req.params.reportId);
    if (!report) { res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Report not found." }); return null; }
    if (report.ownerUserId !== actorUserId && !isOrganizationReportManager(req)) {
      res.status(403).json({ success: false, code: "REPORT_ACCESS_DENIED", message: "You do not have access to this report." }); return null;
    }
    return { report, organizationId, actorUserId };
  };

  internal.get("/ai-reports", ...guarded, requireManager, async (req, res) => {
    try {
      const { organizationId, actorUserId } = scope(req);
      const rows = await repository.listForOwner(organizationId, actorUserId, req.query.archived === "true");
      return res.json({ success: true, data: rows.map(reportDto) });
    } catch (error) { console.error("[AiReports] list failed", error); return res.status(500).json({ success: false, code: "REPORT_LIST_FAILED", message: "Unable to list reports." }); }
  });

  internal.post("/ai-reports", ...guarded, requireManager, async (req, res) => {
    try {
      const body = createReportSchema.parse(req.body ?? {});
      const { organizationId, actorUserId } = scope(req);
      const report = await repository.create({
        organizationId, ownerUserId: actorUserId, title: body.title, description: body.description,
        conversationId: body.conversationId, sourceTurnId: body.sourceTurnId,
        audience: body.definition.audience, definition: body.definition,
        dataSnapshot: body.dataSnapshot, snapshotMetadata: body.snapshotMetadata,
        dataSnapshotAt: new Date(body.definition.dataSnapshotAt),
      });
      return res.status(201).json({ success: true, data: reportDto(report) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: "REPORT_INVALID", message: error.errors.map((issue) => issue.message).join("; ") });
      console.error("[AiReports] create failed", error); return res.status(500).json({ success: false, code: "REPORT_CREATE_FAILED", message: "Unable to save report." });
    }
  });

  internal.get("/ai-reports/:reportId", ...guarded, async (req, res) => {
    try { const access = await accessibleReport(req, res); return access ? res.json({ success: true, data: reportDto(access.report) }) : undefined; }
    catch { return res.status(401).json({ success: false, code: "REPORT_AUTH_REQUIRED", message: "Authentication is required." }); }
  });

  internal.patch("/ai-reports/:reportId", ...guarded, async (req, res) => {
    try {
      const access = await accessibleReport(req, res); if (!access) return;
      const body = updateMetadataSchema.parse(req.body ?? {});
      const report = await repository.updateMetadata({ organizationId: access.organizationId, reportId: access.report.id, ...body });
      return report ? res.json({ success: true, data: reportDto(report) }) : res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Report not found." });
    } catch (error) { return error instanceof z.ZodError ? res.status(400).json({ success: false, code: "REPORT_INVALID", message: error.errors.map((issue) => issue.message).join("; ") }) : res.status(500).json({ success: false, code: "REPORT_UPDATE_FAILED", message: "Unable to update report." }); }
  });

  internal.post("/ai-reports/:reportId/versions", ...guarded, async (req, res) => {
    try {
      const access = await accessibleReport(req, res); if (!access) return;
      const body = versionSchema.parse(req.body ?? {});
      const version = await repository.createVersion({ organizationId: access.organizationId, reportId: access.report.id, createdByUserId: access.actorUserId, definition: body.definition, dataSnapshot: body.dataSnapshot, changeSummary: body.changeSummary, dataSnapshotAt: new Date(body.definition.dataSnapshotAt) });
      return version ? res.status(201).json({ success: true, data: { id: version.id, versionNumber: version.versionNumber, createdAt: version.createdAt.toISOString() } }) : res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Report not found." });
    } catch (error) { return error instanceof z.ZodError ? res.status(400).json({ success: false, code: "REPORT_INVALID", message: error.errors.map((issue) => issue.message).join("; ") }) : res.status(500).json({ success: false, code: "REPORT_VERSION_FAILED", message: "Unable to create report version." }); }
  });

  internal.post("/ai-reports/:reportId/archive", ...guarded, async (req, res) => {
    try { const access = await accessibleReport(req, res); if (!access) return; const report = await repository.archive(access.organizationId, access.report.id); return report ? res.json({ success: true, data: reportDto(report) }) : res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Report not found." }); }
    catch { return res.status(500).json({ success: false, code: "REPORT_ARCHIVE_FAILED", message: "Unable to archive report." }); }
  });

  internal.post("/ai-reports/:reportId/shares", ...guarded, async (req, res) => {
    try {
      const access = await accessibleReport(req, res); if (!access) return;
      const body = shareSchema.parse(req.body ?? {});
      const result = await sharingService.issue({ organizationId: access.organizationId, reportId: access.report.id, actorUserId: access.actorUserId, canManageOrganizationReports: isOrganizationReportManager(req), expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined, downloadAllowed: body.downloadAllowed });
      if (result.kind !== "issued") return res.status(result.kind === "forbidden" ? 403 : 400).json({ success: false, code: `REPORT_SHARE_${result.kind.toUpperCase()}`, message: "This report cannot be shared with a public link." });
      return res.status(201).json({ success: true, data: { shareId: result.shareId, url: `/shared/reports/${result.token}`, expiresAt: result.expiresAt, downloadAllowed: result.downloadAllowed } });
    } catch (error) { return error instanceof z.ZodError ? res.status(400).json({ success: false, code: "REPORT_SHARE_INVALID", message: error.errors.map((issue) => issue.message).join("; ") }) : res.status(500).json({ success: false, code: "REPORT_SHARE_FAILED", message: "Unable to create report share link." }); }
  });

  internal.delete("/ai-reports/:reportId/shares/:shareId", ...guarded, async (req, res) => {
    try { const access = await accessibleReport(req, res); if (!access) return; const result = await sharingService.revoke({ organizationId: access.organizationId, reportId: access.report.id, shareId: req.params.shareId, actorUserId: access.actorUserId, canManageOrganizationReports: isOrganizationReportManager(req) }); return result === "revoked" ? res.status(204).end() : res.status(result === "forbidden" ? 403 : 404).json({ success: false, code: "REPORT_SHARE_NOT_FOUND", message: "Report share link not found." }); }
    catch { return res.status(500).json({ success: false, code: "REPORT_SHARE_REVOKE_FAILED", message: "Unable to revoke report share link." }); }
  });

  const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, code: "REPORT_UNAVAILABLE", message: "This report is unavailable." } });
  app.get("/api/shared/reports/:token", publicLimiter, async (req, res) => {
    publicHeaders(res);
    try {
      const result = await sharingService.resolvePublic(req.params.token);
      if (result.kind !== "available") return res.status(404).json({ success: false, code: "REPORT_UNAVAILABLE", message: "This report is unavailable." });
      return res.json({ success: true, data: result.report });
    } catch { return res.status(404).json({ success: false, code: "REPORT_UNAVAILABLE", message: "This report is unavailable." }); }
  });
  app.use("/api", internal);
}
