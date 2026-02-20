/**
 * bugReports.ts — /api/bug-reports router
 *
 * Routes:
 *   POST /api/bug-reports/screenshot  — upload screenshot (authenticated)
 *   POST /api/bug-reports             — create bug report (authenticated, org-scoped)
 *   GET  /api/bug-reports             — list bug reports (org admin/owner only)
 *   GET  /api/bug-reports/:id         — get single bug report (org admin/owner only)
 *
 * Authorization:
 *   - All endpoints require isAuthenticated + tenantContext.
 *   - List/detail endpoints require org admin or owner role (checked via req.orgRole).
 *   - Severity validated at app layer: 'low' | 'medium' | 'high' | 'critical'.
 *   - Every DB query filters by org_id = req.organizationId.
 */

import { Router, type Request, type Response, type RequestHandler } from "express";
import BusBoy from "busboy";
import path from "path";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../db";
import { bugReports, auditLogs } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getRequestOrganizationId } from "../tenantContext";
import { isSupabaseConfigured } from "../supabaseStorage";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Handles both Replit (claims.sub) and local (id) auth user objects. */
function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

function getUserEmail(user: any): string {
  return user?.email ?? user?.claims?.email ?? "";
}

/** Returns true if the current user has admin or owner role in the active org. */
function isOrgAdminOrOwner(req: Request): boolean {
  const orgRole = (req as any).orgRole as string | undefined;
  return orgRole === "owner" || orgRole === "admin";
}

const requireOrgAdmin: RequestHandler = (req, res, next) => {
  if (!isOrgAdminOrOwner(req)) {
    return res.status(403).json({ success: false, message: "Access denied. Admin or Owner role required." });
  }
  next();
};

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;

const createBugReportSchema = z.object({
  title:            z.string().min(3, "Title must be at least 3 characters").max(200),
  description:      z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity:         z.enum(SEVERITY_VALUES),
  url:              z.string().min(1).max(2000),
  screenWidth:      z.number().int().positive().optional(),
  screenHeight:     z.number().int().positive().optional(),
  screenshotUrl:    z.string().url().max(4000).optional().nullable(),
  metadata:         z.record(z.unknown()).optional(),
});

const listBugReportsQuerySchema = z.object({
  status:   z.string().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  cursor:   z.string().optional(), // createdAt-based ISO string cursor
});

// ─── Screenshot upload constants ──────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Screenshot storage ───────────────────────────────────────────────────────

async function storeScreenshot(
  orgId: string,
  fileBuffer: Buffer,
  mimeType: string,
  originalExt: string,
  req: Request
): Promise<string> {
  const filename = `${randomUUID()}${originalExt}`;
  const storageKey = `bug-screenshots/${orgId}/${filename}`;

  if (isSupabaseConfigured()) {
    const { SupabaseStorageService } = await import("../supabaseStorage");
    const svc = new SupabaseStorageService();
    const result = await svc.uploadFile(storageKey, fileBuffer, mimeType);
    return result.publicUrl ?? `/api/bug-reports/screenshot/file/${orgId}/${filename}`;
  }

  // Local-dev fallback: write to disk, serve via static handler registered in route
  const uploadDir = path.resolve(process.cwd(), "uploads", "bug-screenshots", orgId);
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), fileBuffer);

  const baseUrl = (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${baseUrl}/api/bug-reports/screenshot/file/${orgId}/${filename}`;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerBugReportRoutes(
  app: import("express").Express,
  middleware: {
    isAuthenticated: RequestHandler;
    tenantContext: RequestHandler;
  }
): void {
  const { isAuthenticated, tenantContext } = middleware;
  const router = Router();

  // ── Serve locally stored screenshots (dev only) ─────────────────────────────
  router.get("/screenshot/file/:orgId/:filename", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    const { orgId, filename } = req.params;
    // Validate org matches session
    try {
      const sessionOrgId = getRequestOrganizationId(req);
      if (sessionOrgId !== orgId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    } catch {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Basic path sanitisation
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      return res.status(400).json({ success: false, message: "Invalid filename" });
    }

    const filePath = path.resolve(process.cwd(), "uploads", "bug-screenshots", orgId, filename);
    try {
      await fs.access(filePath);
      res.sendFile(filePath);
    } catch {
      res.status(404).json({ success: false, message: "Not found" });
    }
  });

  // ── POST /screenshot ─────────────────────────────────────────────────────────
  /**
   * Upload a screenshot image. Returns { screenshotUrl }.
   * Accepts multipart/form-data with a single "screenshot" file field.
   */
  router.post("/screenshot", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    const orgId = getRequestOrganizationId(req);

    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ success: false, message: "Expected multipart/form-data" });
    }

    let resolved = false;
    const respond = (status: number, body: object) => {
      if (!resolved) {
        resolved = true;
        res.status(status).json(body);
      }
    };

    try {
      const bb = BusBoy({ headers: req.headers, limits: { files: 1, fileSize: MAX_SCREENSHOT_BYTES + 1 } });

      let fileReceived = false;

      bb.on("file", async (fieldname, file, info) => {
        const { filename, mimeType } = info;

        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
          file.resume(); // drain
          return respond(400, { success: false, message: "Only PNG, JPEG, and WebP images are allowed." });
        }

        fileReceived = true;
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let tooLarge = false;

        file.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_SCREENSHOT_BYTES) {
            tooLarge = true;
            file.destroy();
          } else {
            chunks.push(chunk);
          }
        });

        file.on("limit", () => {
          tooLarge = true;
        });

        file.on("close", async () => {
          if (tooLarge) {
            return respond(413, { success: false, message: "Screenshot must be under 5 MB." });
          }

          try {
            const buffer = Buffer.concat(chunks);
            const ext = path.extname(filename || "screenshot.png") || ".png";
            const screenshotUrl = await storeScreenshot(orgId, buffer, mimeType, ext, req);
            respond(200, { success: true, screenshotUrl });
          } catch (err) {
            console.error("[BugReports] Screenshot upload failed:", err);
            respond(500, { success: false, message: "Screenshot upload failed." });
          }
        });

        file.on("error", (err: Error) => {
          console.error("[BugReports] File stream error:", err);
          respond(500, { success: false, message: "File read error." });
        });
      });

      bb.on("finish", () => {
        if (!fileReceived && !resolved) {
          respond(400, { success: false, message: "No file provided. Include a 'screenshot' field." });
        }
      });

      bb.on("error", (err: Error) => {
        console.error("[BugReports] Busboy error:", err);
        respond(400, { success: false, message: "Failed to parse multipart form." });
      });

      req.pipe(bb);
    } catch (err) {
      console.error("[BugReports] Screenshot endpoint error:", err);
      respond(500, { success: false, message: "Internal error." });
    }
  });

  // ── POST / (create bug report) ────────────────────────────────────────────────
  router.post("/", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    const parse = createBugReportSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parse.error.flatten().fieldErrors,
      });
    }

    const { title, description, severity, url, screenWidth, screenHeight, screenshotUrl, metadata } = parse.data;

    const orgId = getRequestOrganizationId(req);
    const userId = getUserId(req.user) ?? null;
    const email = getUserEmail(req.user);
    const userAgent = (req.get("user-agent") ?? "").slice(0, 1024);

    try {
      const [created] = await db
        .insert(bugReports)
        .values({
          orgId,
          createdByUserId: userId,
          createdByEmail: email,
          title,
          description,
          severity,
          url,
          userAgent,
          screenWidth: screenWidth ?? null,
          screenHeight: screenHeight ?? null,
          screenshotUrl: screenshotUrl ?? null,
          status: "open",
          metadata: (metadata as Record<string, unknown>) ?? {},
        })
        .returning({ id: bugReports.id });

      // Org-scoped audit log
      try {
        await db.insert(auditLogs).values({
          organizationId: orgId,
          userId: userId ?? undefined,
          userName: email,
          actionType: "CREATE",
          entityType: "bug_report",
          entityId: created.id,
          entityName: title,
          description: `Bug report submitted: [${severity}] ${title}`,
          ipAddress: req.ip ?? null,
          userAgent,
        });
      } catch (auditErr) {
        console.error("[BugReports] Audit log failed:", auditErr);
      }

      return res.status(201).json({ success: true, id: created.id });
    } catch (err) {
      console.error("[BugReports] Create failed:", err);
      return res.status(500).json({ success: false, message: "Failed to create bug report." });
    }
  });

  // ── GET / (list — admin only) ─────────────────────────────────────────────────
  router.get("/", isAuthenticated, tenantContext, requireOrgAdmin, async (req: Request, res: Response) => {
    const parseQ = listBugReportsQuerySchema.safeParse(req.query);
    if (!parseQ.success) {
      return res.status(400).json({ success: false, message: "Invalid query parameters." });
    }

    const { status, severity, limit, cursor } = parseQ.data;
    const orgId = getRequestOrganizationId(req);

    try {
      const conditions = [eq(bugReports.orgId, orgId)];
      if (status)   conditions.push(eq(bugReports.status, status));
      if (severity) conditions.push(eq(bugReports.severity, severity));
      if (cursor) {
        conditions.push(sql`${bugReports.createdAt} < ${cursor}::timestamptz`);
      }

      const rows = await db
        .select({
          id:               bugReports.id,
          title:            bugReports.title,
          severity:         bugReports.severity,
          status:           bugReports.status,
          createdAt:        bugReports.createdAt,
          createdByEmail:   bugReports.createdByEmail,
          url:              bugReports.url,
        })
        .from(bugReports)
        .where(and(...conditions))
        .orderBy(desc(bugReports.createdAt))
        .limit(limit);

      const nextCursor = rows.length === limit
        ? rows[rows.length - 1].createdAt?.toISOString() ?? null
        : null;

      return res.json({ success: true, data: rows, nextCursor });
    } catch (err) {
      console.error("[BugReports] List failed:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch bug reports." });
    }
  });

  // ── GET /:id (detail — admin only) ───────────────────────────────────────────
  router.get("/:id", isAuthenticated, tenantContext, requireOrgAdmin, async (req: Request, res: Response) => {
    const orgId = getRequestOrganizationId(req);
    const { id } = req.params;

    try {
      const [row] = await db
        .select()
        .from(bugReports)
        .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, id)))
        .limit(1);

      if (!row) {
        return res.status(404).json({ success: false, message: "Bug report not found." });
      }

      // Audit log the view
      const userId = getUserId(req.user) ?? null;
      const email = getUserEmail(req.user);
      try {
        await db.insert(auditLogs).values({
          organizationId: orgId,
          userId: userId ?? undefined,
          userName: email,
          actionType: "READ",
          entityType: "bug_report",
          entityId: id,
          entityName: row.title,
          description: `Bug report viewed: [${row.severity}] ${row.title}`,
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? "",
        });
      } catch (auditErr) {
        console.error("[BugReports] View audit log failed:", auditErr);
      }

      return res.json({ success: true, data: row });
    } catch (err) {
      console.error("[BugReports] Get by ID failed:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch bug report." });
    }
  });

  // Mount under /api/bug-reports
  app.use("/api/bug-reports", router);
}
