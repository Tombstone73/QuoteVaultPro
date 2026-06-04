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
import { bugReports, bugReportNotes, auditLogs, organizations, type BugReportScreenshotAttachment } from "@shared/schema";
import { eq, and, desc, asc, or, sql } from "drizzle-orm";
import { getRequestOrganizationId } from "../tenantContext";
import { isSupabaseConfigured } from "../supabaseStorage";

// ─── Bug report screenshot storage configuration ─────────────────────────────

// Use "titan-private" bucket for bug screenshots (stored in org-scoped bug-screenshots/ folder)
const BUG_REPORT_SCREENSHOT_BUCKET = process.env.SUPABASE_BUG_REPORT_BUCKET ?? "titan-private";

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
const BUG_REPORT_TYPE_VALUES = ["bug", "feature"] as const;

const createBugReportSchema = z.object({
  type:             z.enum(BUG_REPORT_TYPE_VALUES).optional().default("bug"),
  title:            z.string().min(3, "Title must be at least 3 characters").max(200),
  description:      z.string().min(3, "Description must be at least 3 characters").max(5000),
  severity:         z.enum(SEVERITY_VALUES),
  url:              z.string().min(1).max(2000),
  screenWidth:      z.number().int().positive().optional(),
  screenHeight:     z.number().int().positive().optional(),
  screenshotUrl:    z.string().max(4000).optional().nullable(), // DEPRECATED: backward compatibility (URL or path)
  screenshotUrls:   z.array(z.string().max(4000)).max(5).optional(), // Storage paths or URLs
  screenshotAttachments: z.array(z.object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().nonnegative(),
    storagePath: z.string().min(1).max(4000),
    displayOrder: z.number().int().min(0),
  })).max(5).optional(),
  userAgent:        z.string().max(1024).optional(),
  metadata:         z.record(z.unknown()).optional(),
});

const listBugReportsQuerySchema = z.object({
  status:   z.string().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  type:     z.enum(["bug", "feature", "all"]).default("all"),
  search:   z.string().trim().max(120).optional(),
  sort:     z.enum(["newest", "oldest", "reference_asc", "reference_desc"]).default("newest"),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  cursor:   z.string().optional(), // createdAt-based ISO string cursor
});

const STATUS_VALUES = ["open", "in_review", "resolved", "closed"] as const;

const updateBugReportStatusSchema = z.object({
  status: z.enum(STATUS_VALUES),
});

const createNoteSchema = z.object({
  note: z.string().min(1, "Note cannot be empty").max(2000),
});

// ─── Screenshot upload constants ──────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/bmp"]);
const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TOTAL_SCREENSHOT_BYTES = 25 * 1024 * 1024; // 25 MB

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    case "image/png":
    default:
      return ".png";
  }
}

function sanitizeFilename(filename: string | undefined, fallback: string): string {
  const clean = (filename || fallback).replace(/[^\w.\- ]+/g, "_").trim();
  return clean.slice(0, 255) || fallback;
}

function isLikelyImagePath(pathOrUrl: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(pathOrUrl);
}

function attachmentFromLegacyPath(pathOrUrl: string, displayOrder: number): BugReportScreenshotAttachment {
  const withoutQuery = pathOrUrl.split(/[?#]/)[0];
  const filename = sanitizeFilename(path.basename(withoutQuery) || `screenshot-${displayOrder + 1}.png`, `screenshot-${displayOrder + 1}.png`);
  return {
    filename,
    mimeType: "image/*",
    size: 0,
    storagePath: pathOrUrl,
    displayOrder,
  };
}

function normalizeScreenshotAttachments(input: {
  screenshotUrl?: string | null;
  screenshotUrls?: string[];
  screenshotAttachments?: BugReportScreenshotAttachment[];
}): { attachments: BugReportScreenshotAttachment[]; paths: string[]; legacyUrl: string | null; errors: string[] } {
  const rawAttachments = input.screenshotAttachments?.length
    ? input.screenshotAttachments
    : input.screenshotUrls?.length
      ? input.screenshotUrls.map(attachmentFromLegacyPath)
      : input.screenshotUrl
        ? [attachmentFromLegacyPath(input.screenshotUrl, 0)]
        : [];

  const errors: string[] = [];
  if (rawAttachments.length > MAX_SCREENSHOTS) {
    errors.push(`You can attach up to ${MAX_SCREENSHOTS} screenshots per bug report.`);
  }

  const sorted = rawAttachments
    .slice(0, MAX_SCREENSHOTS)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((attachment, index) => ({
      filename: sanitizeFilename(attachment.filename, `screenshot-${index + 1}${extensionForMime(attachment.mimeType)}`),
      mimeType: attachment.mimeType,
      size: attachment.size,
      storagePath: attachment.storagePath,
      displayOrder: index,
    }));

  for (const attachment of sorted) {
    const hasKnownImageMime = ALLOWED_MIME_TYPES.has(attachment.mimeType);
    const hasLegacyImagePath = attachment.mimeType === "image/*" && isLikelyImagePath(attachment.storagePath);
    const hasImageType = hasKnownImageMime || hasLegacyImagePath;
    if (!hasImageType) {
      errors.push(`${attachment.filename}: Only image attachments are allowed.`);
    }
    if (attachment.size > MAX_SCREENSHOT_BYTES) {
      errors.push(`${attachment.filename}: Each screenshot must be 10 MB or smaller.`);
    }
  }

  const totalBytes = sorted.reduce((sum, attachment) => sum + attachment.size, 0);
  if (totalBytes > MAX_TOTAL_SCREENSHOT_BYTES) {
    errors.push(`Screenshot attachments total ${formatMb(totalBytes)}. The total limit is 25 MB.`);
  }

  const paths = sorted.map((attachment) => attachment.storagePath);
  return {
    attachments: sorted,
    paths,
    legacyUrl: input.screenshotUrl ?? paths[0] ?? null,
    errors,
  };
}

// ─── Screenshot storage ───────────────────────────────────────────────────────

/**
 * Store screenshot and return STORAGE PATH (not URL).
 * Paths will be converted to signed URLs at view time.
 * 
 * @returns Storage path like "bug-reports/{bugReportId}/{timestamp}-{random}.png"
 */
async function storeScreenshot(
  bugReportId: string,
  fileBuffer: Buffer,
  mimeType: string,
  originalExt: string,
  req: Request
): Promise<string> {
  const orgId = getRequestOrganizationId(req);
  const timestamp = Date.now();
  const random = randomUUID().split('-')[0]; // First segment for brevity
  const filename = `${timestamp}-${random}${originalExt}`;
  const storagePath = `org_${orgId}/bug-screenshots/${bugReportId}/${filename}`;

  if (isSupabaseConfigured()) {
    const { SupabaseStorageService } = await import("../supabaseStorage");
    const svc = new SupabaseStorageService(BUG_REPORT_SCREENSHOT_BUCKET);
    
    console.log('[BugReports] Uploading screenshot:', {
      bucket: BUG_REPORT_SCREENSHOT_BUCKET,
      path: storagePath,
      size: fileBuffer.length,
      mimeType
    });
    
    try {
      await svc.uploadFile(storagePath, fileBuffer, mimeType);
      console.log('[BugReports] Upload successful:', storagePath);
      return storagePath; // Return PATH, not URL
    } catch (err) {
      console.error('[BugReports] Supabase upload failed:', err);
      throw err;
    }
  }

  // Local-dev fallback: write to disk, return local path
  const uploadDir = path.resolve(process.cwd(), "uploads", "bug-screenshots", bugReportId);
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), fileBuffer);
  
  // Return path format (will be converted to URL at view time)
  return `local:bug-screenshots/${bugReportId}/${filename}`;
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
  router.get("/screenshot/file/:bugReportId/:filename", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
    const { bugReportId, filename } = req.params;

    // Basic path sanitisation
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename) || !/^[a-zA-Z0-9_.-]+$/.test(bugReportId)) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }

    const filePath = path.resolve(process.cwd(), "uploads", "bug-screenshots", bugReportId, filename);
    try {
      await fs.access(filePath);
      res.sendFile(filePath);
    } catch {
      res.status(404).json({ success: false, message: "Not found" });
    }
  });

  // ── POST /screenshot ─────────────────────────────────────────────────────────
  /**
   * Upload screenshot images (up to 5). Returns screenshot metadata and legacy paths.
   * Accepts multipart/form-data with "screenshots" file field(s).
   */
  router.post("/screenshot", isAuthenticated, tenantContext, async (req: Request, res: Response) => {
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
      const bb = BusBoy({ headers: req.headers, limits: { files: MAX_SCREENSHOTS + 1, fileSize: MAX_SCREENSHOT_BYTES + 1 } });

      const uploadedAttachments: BugReportScreenshotAttachment[] = [];
      const uploadErrors: string[] = [];
      let filesProcessed = 0;
      let totalFiles = 0;
      let totalUploadBytes = 0;
      let totalSizeExceeded = false;

      bb.on("file", async (fieldname, file, info) => {
        const { filename, mimeType } = info;
        totalFiles++;
        const displayOrder = totalFiles - 1;

        if (fieldname !== "screenshots") {
          file.resume();
          uploadErrors.push(`File ${filename}: Use the 'screenshots' field.`);
          filesProcessed++;
          return;
        }

        if (totalFiles > MAX_SCREENSHOTS) {
          file.resume();
          uploadErrors.push(`You can attach up to ${MAX_SCREENSHOTS} screenshots per bug report.`);
          filesProcessed++;
          return;
        }

        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
          file.resume(); // drain
          uploadErrors.push(`File ${filename}: Only image files are allowed.`);
          filesProcessed++;
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let tooLarge = false;

        file.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          totalUploadBytes += chunk.length;
          if (totalBytes > MAX_SCREENSHOT_BYTES) {
            tooLarge = true;
            file.destroy();
          } else if (totalUploadBytes > MAX_TOTAL_SCREENSHOT_BYTES) {
            totalSizeExceeded = true;
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
            uploadErrors.push(`File ${filename}: Each screenshot must be 10 MB or smaller.`);
            filesProcessed++;
            return;
          }

          if (totalSizeExceeded) {
            uploadErrors.push(`Screenshot attachments exceed the 25 MB total limit.`);
            filesProcessed++;
            return;
          }

          try {
            const buffer = Buffer.concat(chunks);
            const ext = path.extname(filename || "") || extensionForMime(mimeType);
            // Use temp ID for pre-create uploads (will be organized by bug report ID later)
            const tempId = `temp-${randomUUID()}`;
            const storagePath = await storeScreenshot(tempId, buffer, mimeType, ext, req);
            uploadedAttachments.push({
              filename: sanitizeFilename(filename, `screenshot-${displayOrder + 1}${ext}`),
              mimeType,
              size: buffer.length,
              storagePath,
              displayOrder,
            });
          } catch (err) {
            console.error("[BugReports] Screenshot upload failed:", err);
            uploadErrors.push(`File ${filename}: Upload failed.`);
          }
          filesProcessed++;
        });

        file.on("error", (err: Error) => {
          console.error("[BugReports] File stream error:", err);
          uploadErrors.push(`File ${filename}: Read error.`);
          filesProcessed++;
        });
      });

      bb.on("filesLimit", () => {
        uploadErrors.push(`You can attach up to ${MAX_SCREENSHOTS} screenshots per bug report.`);
      });

      bb.on("finish", () => {
        // Wait for all file processing to complete
        const checkComplete = setInterval(() => {
          if (filesProcessed >= totalFiles && !resolved) {
            clearInterval(checkComplete);
            const orderedAttachments = uploadedAttachments
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((attachment, index) => ({ ...attachment, displayOrder: index }));
            const screenshotUrls = orderedAttachments.map((attachment) => attachment.storagePath);

            if (orderedAttachments.length === 0 && uploadErrors.length === 0) {
              respond(400, { success: false, message: "No files provided. Include 'screenshots' field(s)." });
            } else if (orderedAttachments.length > 0 && uploadErrors.length === 0) {
              respond(200, { success: true, screenshotUrls, screenshotAttachments: orderedAttachments });
            } else if (orderedAttachments.length > 0) {
              respond(400, {
                success: false,
                message: "Some screenshots could not be uploaded. Please fix the attachment errors and try again.",
                screenshotUrls,
                screenshotAttachments: orderedAttachments,
                errors: uploadErrors,
              });
            } else {
              respond(400, { success: false, message: "All uploads failed.", errors: uploadErrors });
            }
          }
        }, 50);
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

    const { type, title, description, severity, url, screenWidth, screenHeight, screenshotUrl, screenshotUrls, screenshotAttachments, metadata } = parse.data;

    const orgId = getRequestOrganizationId(req);
    const userId = getUserId(req.user) ?? null;
    const email = getUserEmail(req.user);
    const userAgent = (req.get("user-agent") ?? "").slice(0, 1024);

    const normalizedScreenshots = normalizeScreenshotAttachments({ screenshotUrl, screenshotUrls, screenshotAttachments });
    if (normalizedScreenshots.errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Screenshot attachment validation failed.",
        errors: { screenshots: normalizedScreenshots.errors },
      });
    }

    try {
      const [org] = await db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      const authUser = req.user as any;
      const userName = [authUser?.firstName, authUser?.lastName].filter(Boolean).join(" ").trim();
      const finalMetadata = {
        ...((metadata as Record<string, unknown>) ?? {}),
        autoContextServer: {
          capturedAt: new Date().toISOString(),
          currentPageUrl: url,
          browserUserAgent: userAgent,
          user: {
            id: userId,
            name: userName || email || null,
            email: email || null,
          },
          organization: {
            id: org?.id ?? orgId,
            name: org?.name ?? null,
            slug: org?.slug ?? null,
          },
        },
      };

      const [created] = await db
        .insert(bugReports)
        .values({
          orgId,
          createdByUserId: userId,
          createdByEmail: email,
          type,
          title,
          description,
          severity,
          url,
          userAgent,
          screenWidth: screenWidth ?? null,
          screenHeight: screenHeight ?? null,
          screenshotUrl: normalizedScreenshots.legacyUrl,
          screenshotUrls: normalizedScreenshots.paths,
          screenshotAttachments: normalizedScreenshots.attachments,
          status: "open",
          metadata: finalMetadata,
        })
        .returning({ id: bugReports.id, referenceNumber: bugReports.referenceNumber });

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
          description: `Feedback submitted: ${created.referenceNumber} [${type}] [${severity}] ${title}`,
          ipAddress: req.ip ?? null,
          userAgent,
          newValues: { type, referenceNumber: created.referenceNumber },
        });
      } catch (auditErr) {
        console.error("[BugReports] Audit log failed:", auditErr);
      }

      return res.status(201).json({ success: true, data: { id: created.id, referenceNumber: created.referenceNumber }, message: "Bug report created." });
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

    const { status, severity, type, search, sort, limit, cursor } = parseQ.data;
    const orgId = getRequestOrganizationId(req);

    try {
      const conditions = [eq(bugReports.orgId, orgId)];
      if (status)   conditions.push(eq(bugReports.status, status));
      if (severity) conditions.push(eq(bugReports.severity, severity));
      if (type !== "all") conditions.push(eq(bugReports.type, type));
      if (search) {
        const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
        conditions.push(or(
          sql`${bugReports.referenceNumber} ILIKE ${pattern} ESCAPE '\'`,
          sql`${bugReports.title} ILIKE ${pattern} ESCAPE '\'`,
        )!);
      }
      if (cursor) {
        conditions.push(sql`${bugReports.createdAt} < ${cursor}::timestamptz`);
      }

      const orderByColumns = sort === "oldest"
        ? [asc(bugReports.createdAt)]
        : sort === "reference_asc"
          ? [asc(bugReports.referenceNumber), asc(bugReports.createdAt)]
          : sort === "reference_desc"
            ? [desc(bugReports.referenceNumber), desc(bugReports.createdAt)]
            : [desc(bugReports.createdAt)];

      const rows = await db
        .select({
          id:               bugReports.id,
          referenceNumber:  bugReports.referenceNumber,
          type:             bugReports.type,
          title:            bugReports.title,
          severity:         bugReports.severity,
          status:           bugReports.status,
          createdAt:        bugReports.createdAt,
          createdByEmail:   bugReports.createdByEmail,
          url:              bugReports.url,
        })
        .from(bugReports)
        .where(and(...conditions))
        .orderBy(...orderByColumns)
        .limit(limit);

      const nextCursor = rows.length === limit
        ? rows[rows.length - 1].createdAt?.toISOString() ?? null
        : null;

      return res.json({ success: true, data: rows, message: "Bug reports fetched.", nextCursor });
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
          description: `Bug report viewed: ${row.referenceNumber} [${row.severity}] ${row.title}`,
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

  // ── GET /:id/screenshot-urls (get signed URLs for screenshots) ───────────────
  /**
   * Generate signed URLs for bug report screenshots.
   * Converts stored paths to temporary signed URLs (1 hour expiry).
   */
  router.get("/:id/screenshot-urls", isAuthenticated, tenantContext, requireOrgAdmin, async (req: Request, res: Response) => {
    const orgId = getRequestOrganizationId(req);
    const { id } = req.params;

    try {
      const [row] = await db
        .select({
          screenshotUrls: bugReports.screenshotUrls,
          screenshotUrl: bugReports.screenshotUrl,
          screenshotAttachments: bugReports.screenshotAttachments,
        })
        .from(bugReports)
        .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, id)))
        .limit(1);

      if (!row) {
        return res.status(404).json({ success: false, message: "Bug report not found." });
      }

      const urls: Array<BugReportScreenshotAttachment & { path: string; url: string }> = [];

      const attachments = row.screenshotAttachments && row.screenshotAttachments.length > 0
        ? row.screenshotAttachments
        : row.screenshotUrls && row.screenshotUrls.length > 0
          ? row.screenshotUrls.map(attachmentFromLegacyPath)
          : row.screenshotUrl
            ? [attachmentFromLegacyPath(row.screenshotUrl, 0)]
            : [];

      // Process metadata attachments first, with path-only legacy fallback above.
      if (attachments.length > 0) {
        for (const attachment of attachments.sort((a, b) => a.displayOrder - b.displayOrder)) {
          const path = attachment.storagePath;
          // If path is already a full URL (legacy data), pass through
          if (path.startsWith('http://') || path.startsWith('https://')) {
            urls.push({ ...attachment, path, url: path });
            continue;
          }

          // Handle local dev paths
          if (path.startsWith('local:')) {
            const localPath = path.replace('local:', '');
            const baseUrl = (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
            const parts = localPath.split('/');
            const bugReportId = parts[1];
            const filename = parts[2];
            urls.push({ 
              ...attachment,
              path, 
              url: `${baseUrl}/api/bug-reports/screenshot/file/${bugReportId}/${filename}` 
            });
            continue;
          }

          // Generate signed URL for Supabase path
          if (isSupabaseConfigured()) {
            try {
              const { SupabaseStorageService } = await import("../supabaseStorage");
              const svc = new SupabaseStorageService(BUG_REPORT_SCREENSHOT_BUCKET);
              const signedUrl = await svc.getSignedDownloadUrl(path, 3600); // 1 hour
              urls.push({ ...attachment, path, url: signedUrl });
            } catch (err) {
              console.error(`[BugReports] Failed to generate signed URL:`, {
                bucket: BUG_REPORT_SCREENSHOT_BUCKET,
                path,
                error: err
              });
              // Skip failed URLs rather than breaking entire request
            }
          }
        }
      }

      return res.json({ success: true, data: urls });
    } catch (err) {
      console.error("[BugReports] Screenshot URL generation failed:", err);
      return res.status(500).json({ success: false, message: "Failed to generate screenshot URLs." });
    }
  });

  // ── PATCH /:id (update status — admin only) ──────────────────────────────────
  router.patch("/:id", isAuthenticated, tenantContext, requireOrgAdmin, async (req: Request, res: Response) => {
    const parse = updateBugReportStatusSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parse.error.flatten().fieldErrors,
      });
    }

    const { status } = parse.data;
    const orgId = getRequestOrganizationId(req);
    const { id } = req.params;
    const userId = getUserId(req.user) ?? null;
    const email = getUserEmail(req.user);

    try {
      // Verify report belongs to this org
      const [existing] = await db
        .select({ id: bugReports.id, referenceNumber: bugReports.referenceNumber, title: bugReports.title })
        .from(bugReports)
        .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, id)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, message: "Bug report not found." });
      }

      const [updated] = await db
        .update(bugReports)
        .set({ status })
        .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, id)))
        .returning({ id: bugReports.id, status: bugReports.status });

      // Audit log
      try {
        await db.insert(auditLogs).values({
          organizationId: orgId,
          userId: userId ?? undefined,
          userName: email,
          actionType: "UPDATE",
          entityType: "bug_report",
          entityId: id,
          entityName: existing.title,
          description: `Bug report status updated to '${status}': ${existing.referenceNumber} ${existing.title}`,
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? "",
          newValues: { status, referenceNumber: existing.referenceNumber },
        });
      } catch (auditErr) {
        console.error("[BugReports] Status update audit log failed:", auditErr);
      }

      return res.json({ success: true, data: { id: updated.id, status: updated.status }, message: "Bug report status updated." });
    } catch (err) {
      console.error("[BugReports] Status update failed:", err);
      return res.status(500).json({ success: false, message: "Failed to update status." });
    }
  });

  // ── POST /:id/notes (add note — admin only) ───────────────────────────────────
  router.post("/:id/notes", isAuthenticated, tenantContext, requireOrgAdmin, async (req: Request, res: Response) => {
    const parse = createNoteSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parse.error.flatten().fieldErrors,
      });
    }

    const { note } = parse.data;
    const orgId = getRequestOrganizationId(req);
    const { id } = req.params;
    const userId = getUserId(req.user) ?? null;
    const email = getUserEmail(req.user);

    try {
      // Verify report belongs to this org
      const [existing] = await db
        .select({ id: bugReports.id, referenceNumber: bugReports.referenceNumber })
        .from(bugReports)
        .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, id)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, message: "Bug report not found." });
      }

      const [created] = await db
        .insert(bugReportNotes)
        .values({
          bugReportId:     id,
          orgId,
          createdByUserId: userId,
          createdByEmail:  email,
          note,
        })
        .returning();

      // Audit log
      try {
        await db.insert(auditLogs).values({
          organizationId: orgId,
          userId: userId ?? undefined,
          userName: email,
          actionType: "CREATE",
          entityType: "bug_report_note",
          entityId: created.id,
          entityName: `Note on bug report ${existing.referenceNumber}`,
          description: `Internal note added to bug report ${existing.referenceNumber}`,
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? "",
        });
      } catch (auditErr) {
        console.error("[BugReports] Note audit log failed:", auditErr);
      }

      return res.status(201).json({ success: true, data: created });
    } catch (err) {
      console.error("[BugReports] Add note failed:", err);
      return res.status(500).json({ success: false, message: "Failed to add note." });
    }
  });

  // ── GET /:id/notes (list notes — admin only) ──────────────────────────────────
  router.get("/:id/notes", isAuthenticated, tenantContext, requireOrgAdmin, async (req: Request, res: Response) => {
    const orgId = getRequestOrganizationId(req);
    const { id } = req.params;

    try {
      // Verify report belongs to this org before exposing notes
      const [existing] = await db
        .select({ id: bugReports.id })
        .from(bugReports)
        .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, id)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ success: false, message: "Bug report not found." });
      }

      const notes = await db
        .select()
        .from(bugReportNotes)
        .where(and(eq(bugReportNotes.orgId, orgId), eq(bugReportNotes.bugReportId, id)))
        .orderBy(asc(bugReportNotes.createdAt));

      return res.json({ success: true, data: notes });
    } catch (err) {
      console.error("[BugReports] List notes failed:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch notes." });
    }
  });

  // Mount under /api/bug-reports
  app.use("/api/bug-reports", router);
}
