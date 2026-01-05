/**
 * Attachment Routes Module
 * 
 * Handles all file attachment operations across quotes, line items, and orders:
 * - Object storage proxy endpoints (/objects/*)
 * - Quote-level attachments
 * - Quote line-item attachments (artwork)
 * - Order attachments
 * - Chunked uploads for large files
 * - Thumbnail generation
 * 
 * Extracted from monolithic routes.ts for better maintainability.
 */

import type { Express } from "express";
import path from "path";
import { promises as fsPromises } from "fs";
import { db } from "../db";
import {
  quotes,
  quoteAttachments,
  quoteAttachmentPages,
  quoteLineItems,
  orderAttachments,
  orders,
  orderLineItems,
} from "@shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { storage } from "../storage";
import { 
  getRequestOrganizationId, 
  tenantContext 
} from "../tenantContext";
import { 
  getEffectiveWorkflowState, 
  isQuoteLocked,
  type QuoteStatusDB,
  type QuoteWorkflowState,
} from "@shared/quoteWorkflow";
import { SupabaseStorageService, isSupabaseConfigured } from "../supabaseStorage";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { ObjectPermission } from "../objectAcl";

// Type alias for authentication
type AuthenticatedRequest = Express.Request & { user: any };

/**
 * Helper to extract user ID from authenticated user (handles both Replit and local auth formats)
 */
function getUserId(user: any): string | null {
  if (!user) return null;
  return user.id || user.claims?.sub || null;
}

// ────────────────────────────────────────────────────────────────────────────
// Quote Workflow Enforcement Helpers
// ────────────────────────────────────────────────────────────────────────────

const APPROVED_LOCK_MESSAGE =
  "Cannot modify approved quote. Unapprove or create revision to make changes.";
const CONVERTED_LOCK_MESSAGE =
  "Cannot modify quote after order conversion. Create quote revision for changes.";

/**
 * Get effective workflow state for a quote
 */
function getQuoteWorkflowState(quote: any): QuoteWorkflowState {
  const dbStatus = quote.status as QuoteStatusDB;
  const validUntil = quote.validUntil;
  const hasOrder = !!quote.convertedToOrderId;
  return getEffectiveWorkflowState(dbStatus, validUntil, hasOrder);
}

/**
 * Assert quote is editable, return false and send error response if locked
 */
function assertQuoteEditable(res: any, quote: any): boolean {
  const state = getQuoteWorkflowState(quote);
  if (isQuoteLocked(state)) {
    const message = state === "approved" ? APPROVED_LOCK_MESSAGE : CONVERTED_LOCK_MESSAGE;
    res.status(409).json({ error: message });
    return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Attachment Enrichment Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Helper: Create a logging function that logs each unique key only once per request
 */
function createRequestLogOnce() {
  const logged = new Set<string>();
  return (key: string, ...args: any[]) => {
    if (logged.has(key)) return;
    logged.add(key);
    console.warn(...args);
  };
}

/**
 * Helper: Enrich attachment records with signed URLs for display
 *
 * IMPORTANT: fileUrl, thumbKey, previewKey are STORAGE KEYS (not URLs).
 * The client must NEVER use these fields directly in <img src> or <a href>.
 * This function generates time-limited signed URLs from storage keys.
 *
 * Returns originalUrl, thumbUrl (if thumbKey exists), previewUrl (if previewKey exists)
 * For PDFs, also fetches and enriches page data with signed URLs
 */
async function enrichAttachmentWithUrls(
  attachment: any,
  options?: { logOnce?: (key: string, ...args: any[]) => void }
): Promise<any> {
  let originalUrl: string | null = null;
  let thumbUrl: string | null = null;
  let previewUrl: string | null = null;

  const logOnce = options?.logOnce;

  const rawFileUrl = (attachment.fileUrl ?? "").toString();
  const isHttpUrl = rawFileUrl.startsWith("http://") || rawFileUrl.startsWith("https://");
  const storageProvider = (attachment.storageProvider ?? null) as string | null;
  const bucket = (attachment.bucket ?? undefined) as string | undefined;

  const objectsProxyUrl = (key: string) => `/objects/${key}`;

  // External URL: use as-is.
  // BUT: Supabase signed upload URLs are http(s) and must never be used for rendering.
  // If we can recognize a Supabase object URL, convert it to a stable key and sign a download URL.
  if (rawFileUrl && isHttpUrl) {
    const maybeSupabaseKey = isSupabaseConfigured()
      ? tryExtractSupabaseObjectKeyFromUrl(rawFileUrl, bucket || "titan-private")
      : null;
    if (maybeSupabaseKey && isSupabaseConfigured()) {
      const supabaseService = new SupabaseStorageService(bucket);
      try {
        originalUrl = await supabaseService.getSignedDownloadUrl(maybeSupabaseKey, 3600);
      } catch (error: any) {
        if (logOnce) {
          logOnce(
            `orig:${attachment.id}`,
            "[enrichAttachmentWithUrls] Supabase originalUrl missing (fail-soft):",
            {
              attachmentId: attachment.id,
              bucket: bucket || "default",
              path: maybeSupabaseKey,
              message: error?.message || String(error),
            }
          );
        }
        originalUrl = null;
      }
    } else {
      originalUrl = rawFileUrl;
    }
  } else if (rawFileUrl && storageProvider === "local") {
    // Local storage: use /objects proxy which serves local files directly.
    originalUrl = objectsProxyUrl(rawFileUrl);
  } else if (rawFileUrl && storageProvider === "supabase" && isSupabaseConfigured()) {
    // Supabase storage: sign using the attachment's bucket if present.
    const supabaseService = new SupabaseStorageService(bucket);
    try {
      originalUrl = await supabaseService.getSignedDownloadUrl(rawFileUrl, 3600);
    } catch (error: any) {
      if (logOnce) {
        logOnce(
          `orig:${attachment.id}`,
          "[enrichAttachmentWithUrls] Supabase originalUrl missing (fail-soft):",
          {
            attachmentId: attachment.id,
            bucket: bucket || "default",
            path: rawFileUrl,
            message: error?.message || String(error),
          }
        );
      } else {
        console.warn(
          `[enrichAttachmentWithUrls] Failed to generate originalUrl for ${attachment.id} (fail-soft):`,
          error
        );
      }
      originalUrl = null;
    }
  } else if (rawFileUrl) {
    // Unknown provider or Supabase not configured: fall back to /objects.
    // This avoids crashing pages when storageProvider is null/mis-set.
    originalUrl = objectsProxyUrl(rawFileUrl);
  }

  // Derivative URLs
  const thumbKey = (attachment.thumbKey ?? null) as string | null;
  if (thumbKey) {
    if (storageProvider === "local") {
      thumbUrl = objectsProxyUrl(thumbKey);
    } else if (storageProvider === "supabase" && isSupabaseConfigured()) {
      // Use same-origin proxy so images can render inline reliably.
      thumbUrl = objectsProxyUrl(thumbKey);
    } else {
      thumbUrl = objectsProxyUrl(thumbKey);
    }
  }

  const previewKey = (attachment.previewKey ?? null) as string | null;
  if (previewKey) {
    if (storageProvider === "local") {
      previewUrl = objectsProxyUrl(previewKey);
    } else if (storageProvider === "supabase" && isSupabaseConfigured()) {
      // Use same-origin proxy so images can render inline reliably.
      previewUrl = objectsProxyUrl(previewKey);
    } else {
      previewUrl = objectsProxyUrl(previewKey);
    }
  }

  // For PDFs, fetch page data (only if table exists)
  let pages: any[] = [];
  const isPdf =
    attachment.mimeType === "application/pdf" ||
    (attachment.fileName || "").toLowerCase().endsWith(".pdf");

  if (isPdf && attachment.pageCount) {
    // Check if quote_attachment_pages table exists before querying
    const { hasQuoteAttachmentPagesTable } = await import("../db");
    const tableExists = hasQuoteAttachmentPagesTable();

    if (tableExists === true) {
      try {
        const pageRecords = await db
          .select()
          .from(quoteAttachmentPages)
          .where(eq(quoteAttachmentPages.attachmentId, attachment.id))
          .orderBy(quoteAttachmentPages.pageIndex);

        // Enrich each page with signed URLs
        if (isSupabaseConfigured()) {
          const supabaseService = new SupabaseStorageService(bucket);
          pages = await Promise.all(
            pageRecords.map(async (page) => {
              let pageThumbUrl: string | null = null;
              let pagePreviewUrl: string | null = null;

              if (page.thumbKey) {
                try {
                  pageThumbUrl = await supabaseService.getSignedDownloadUrl(page.thumbKey, 3600);
                } catch (error) {
                  // Fail-soft: if page thumb object missing, just omit URL
                  if (logOnce) {
                    logOnce(
                      `pageThumb:${attachment.id}`,
                      "[enrichAttachmentWithUrls] Failed to generate page thumbUrl (fail-soft)",
                      error
                    );
                  }
                }
              }

              if (page.previewKey) {
                try {
                  pagePreviewUrl = await supabaseService.getSignedDownloadUrl(page.previewKey, 3600);
                } catch (error) {
                  if (logOnce) {
                    logOnce(
                      `pagePreview:${attachment.id}`,
                      "[enrichAttachmentWithUrls] Failed to generate page previewUrl (fail-soft)",
                      error
                    );
                  }
                }
              }

              return {
                ...page,
                thumbUrl: pageThumbUrl,
                previewUrl: pagePreviewUrl,
              };
            })
          );
        } else {
          // Not Supabase: use same-origin proxy for page thumbnails (local/GCS storage)
          pages = pageRecords.map((page) => ({
            ...page,
            thumbUrl: page.thumbKey ? objectsProxyUrl(page.thumbKey) : null,
            previewUrl: page.previewKey ? objectsProxyUrl(page.previewKey) : null,
          }));
        }
      } catch (error) {
        console.error(`[enrichAttachmentWithUrls] Failed to fetch pages for ${attachment.id}:`, error);
      }
    }
    // If table doesn't exist (tableExists === false) or probe hasn't run (tableExists === null),
    // skip query and return empty pages array (already initialized above)
  }

  return {
    ...attachment,
    originalUrl,
    thumbUrl,
    previewUrl,
    pages, // Include pages array (empty for non-PDFs or PDFs without page data)
  };
}

/**
 * Helper: Normalize object key for database storage
 */
function normalizeObjectKeyForDb(input: string): string {
  let key = (input || "").toString().trim();
  key = key.replace(/^\/+/, "");
  // Strip common accidental bucket prefix when client sends "<bucket>/<path>"
  if (key.startsWith("titan-private/")) {
    key = key.slice("titan-private/".length);
  }
  return key;
}

/**
 * Helper: Extract Supabase object key from URL
 */
function tryExtractSupabaseObjectKeyFromUrl(inputUrl: string, bucket: string): string | null {
  const raw = (inputUrl || "").toString().trim();
  if (!raw) return null;

  // Already a key
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    return normalizeObjectKeyForDb(raw);
  }

  try {
    const url = new URL(raw);
    const path = url.pathname;

    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/upload/sign/${bucket}/`,
      `/storage/v1/object/download/${bucket}/`,
      `/storage/v1/object/${bucket}/`,
    ];

    for (const marker of markers) {
      const idx = path.indexOf(marker);
      if (idx >= 0) {
        const remainder = path.slice(idx + marker.length);
        const decoded = decodeURIComponent(remainder);
        const normalized = normalizeObjectKeyForDb(decoded);
        return normalized || null;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Helper: Schedule background check for Supabase object existence
 */
function scheduleSupabaseObjectSelfCheck(args: {
  bucket?: string | null;
  path: string;
  context: Record<string, any>;
}) {
  if (!isSupabaseConfigured()) return;
  const { bucket, path, context } = args;
  if (!path || path.startsWith("http://") || path.startsWith("https://")) return;

  setImmediate(() => {
    void (async () => {
      try {
        const svc = new SupabaseStorageService(bucket ?? undefined);
        const exists = await svc.fileExists(path);
        if (!exists) {
          console.warn("[SupabaseStorage] Object self-check failed (missing):", {
            bucket: bucket ?? "default",
            path,
            ...context,
          });
        }
      } catch (error) {
        console.warn("[SupabaseStorage] Object self-check errored (fail-soft):", {
          path,
          ...context,
          message: (error as any)?.message || String(error),
        });
      }
    })();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Type definitions for file roles and sides
// ────────────────────────────────────────────────────────────────────────────

type FileRole = "artwork" | "proof" | "reference" | "customer_po" | "setup" | "output" | "other";
type FileSide = "front" | "back" | "na";

// ────────────────────────────────────────────────────────────────────────────
// Route Registration Function
// ────────────────────────────────────────────────────────────────────────────

export async function registerAttachmentRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  }
) {
  const { isAuthenticated, isAdmin } = middleware;

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECT STORAGE PROXY ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /objects/:objectPath
   * Proxy endpoint for serving files from Supabase/local/GCS storage
   * Handles automatic fallback: Supabase → local → GCS
   */
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req.user);
    const isDev = process.env.NODE_ENV === "development";

    try {
      // Try Supabase first if configured
      if (isSupabaseConfigured()) {
        const objectPath = req.path.replace("/objects/", "");
        const supabaseService = new SupabaseStorageService();
        const ext = path.extname(objectPath).toLowerCase();
        const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
        const contentTypes: { [key: string]: string } = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
        };

        try {
          const signedUrl = await supabaseService.getSignedDownloadUrl(objectPath, 3600);

          // For images, proxy bytes so we can ensure an inline-capable Content-Type.
          // This avoids issues where upstream object metadata is set to application/octet-stream + nosniff.
          if (isImage) {
            const upstream = await fetch(signedUrl);
            if (!upstream.ok) {
              throw new Error(`Upstream fetch failed: ${upstream.status} ${upstream.statusText}`);
            }

            res.setHeader("Content-Type", contentTypes[ext] || "image/*");
            res.setHeader("Content-Disposition", "inline");
            res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day cache

            const buf = Buffer.from(await upstream.arrayBuffer());
            return res.send(buf);
          }

          // Non-images: keep redirect behavior.
          return res.redirect(signedUrl);
        } catch (supabaseError: any) {
          // If file not found in Supabase, fall through to local/GCS
          if (isDev) {
            console.log("[objects] File not in Supabase, trying local storage:", supabaseError.message);
          }
        }
      }

      // Try local filesystem (STORAGE_ROOT) - common in local dev
      const storageRoot = process.env.STORAGE_ROOT || "./storage";
      const objectPath = req.path.replace("/objects/", "");
      const localPath = path.join(storageRoot, objectPath);

      try {
        // Check if file exists locally
        await fsPromises.access(localPath, fsPromises.constants.R_OK);

        // Determine content type
        const ext = path.extname(objectPath).toLowerCase();
        const contentTypes: { [key: string]: string } = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".pdf": "application/pdf",
        };
        const contentType = contentTypes[ext] || "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day cache

        // Serve file directly
        return res.sendFile(path.resolve(localPath));
      } catch (localError: any) {
        // File not found locally, try GCS
        if (isDev) {
          console.log("[objects] File not in local storage, trying GCS:", localError.message);
        }
      }

      // Try GCS via Replit ObjectStorage (requires sidecar)
      // Check if GCS credentials are accessible
      const hasGCSAccess = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.REPL_ID !== "local-dev-repl-id";

      if (!hasGCSAccess) {
        return res.status(404).json({
          error: "File not found",
          message: "File not available in Supabase or local storage, and GCS not configured",
          path: req.path,
        });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId ?? undefined,
        requestedPermission: ObjectPermission.READ,
      });

      if (!canAccess) {
        return res.status(403).json({ error: "Access denied", path: req.path });
      }

      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("[objects] Error serving object:", error);

      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found", path: req.path });
      }

      // Check if this is a credential/connection error (don't return 500 for config issues)
      if (error.message?.includes("ECONNREFUSED") || error.message?.includes("credential")) {
        return res.status(501).json({
          error: "Storage unavailable",
          message: isDev ? "GCS sidecar not running (local dev)" : "Storage service unavailable",
          ...(isDev && { details: error.message }),
        });
      }

      // True internal errors
      return res.status(500).json({
        error: "Internal server error",
        ...(isDev && { details: error.message || String(error) }),
      });
    }
  });

  /**
   * POST /api/objects/upload
   * Get signed upload URL for direct file upload to storage
   * Admin-only endpoint
   */
  app.post("/api/objects/upload", isAuthenticated, isAdmin, async (req, res) => {
    try {
      // Use Supabase storage if configured, otherwise fall back to Replit ObjectStorage
      if (isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService();
        const result = await supabaseService.getSignedUploadUrl({
          folder: "uploads",
        });
        return res.json({
          method: "PUT",
          url: result.url,
          path: result.path,
          token: result.token,
        });
      }

      // Fall back to Replit ObjectStorage (only works on Replit platform)
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({
        method: "PUT",
        url: uploadURL,
      });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  /**
   * POST /api/objects/acl
   * Set ACL policy for an object (GCS only)
   * Admin-only endpoint
   */
  app.post("/api/objects/acl", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { objectPath } = req.body;
      if (typeof objectPath !== "string" || !objectPath) {
        return res.status(400).json({ message: "objectPath is required" });
      }

      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const objectStorageService = new ObjectStorageService();

      const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: userId,
        visibility: "public",
      });

      res.json({ path: normalizedPath });
    } catch (error) {
      console.error("Error setting object ACL:", error);
      res.status(500).json({ message: "Failed to set object ACL" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // QUOTE FILE ATTACHMENTS (LEGACY ROUTES - quote-level, not line-item)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/quotes/:id/files
   * List all attachments for a quote (quote-level only, not line items)
   */
  app.get("/api/quotes/:id/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const files = await db
        .select()
        .from(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.quoteId, req.params.id),
            isNull(quoteAttachments.quoteLineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        )
        .orderBy(desc(quoteAttachments.createdAt));

      const logOnce = createRequestLogOnce();
      // Enrich each attachment with signed URLs
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

      res.json({ success: true, data: enrichedFiles });
    } catch (error) {
      console.error("Error fetching quote files:", error);
      res.status(500).json({ error: "Failed to fetch quote files" });
    }
  });

  /**
   * POST /api/quotes/:id/files
   * Attach file to quote (quote-level, not line-item)
   */
  app.post("/api/quotes/:id/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);

      // Validate quote belongs to org (prevents cross-tenant access)
      const [quote] = await db
        .select({ id: quotes.id, status: quotes.status })
        .from(quotes)
        .where(and(eq(quotes.id, req.params.id), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      if (!assertQuoteEditable(res, quote)) return;

      const { fileName, fileUrl, fileSize, mimeType, description, fileBuffer, originalFilename } = req.body;

      // Detect if this is a PDF (by mimeType or filename)
      const resolvedUploadName = (originalFilename || fileName || "") as string;
      const lowerMime = (mimeType || "").toString().toLowerCase();
      const isPdfEarly = lowerMime.includes("pdf") || resolvedUploadName.toLowerCase().endsWith(".pdf");

      // Check if PDF processing columns exist (from startup probe)
      const { hasPageCountStatusColumn } = await import("../db");
      const pdfColumnsExist = hasPageCountStatusColumn() === true;

      if (isPdfEarly && !pdfColumnsExist) {
        console.warn(
          `[QuoteFiles:POST] PDF detected but page_count_status column missing; PDF processing disabled for ${resolvedUploadName}`
        );
      }

      // Support both legacy and new upload methods
      if (!fileName && !originalFilename) {
        return res.status(400).json({ error: "fileName or originalFilename is required" });
      }

      let attachmentData: any = {
        quoteId: req.params.id,
        organizationId,
        uploadedByUserId: userId,
        uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
        description: description || null,
      };

      // New storage model with local file system
      if (fileBuffer && originalFilename) {
        const { processUploadedFile } = await import("../utils/fileStorage.js");
        const buffer = Buffer.from(fileBuffer, "base64");

        const fileMetadata = await processUploadedFile({
          originalFilename,
          buffer,
          mimeType: mimeType || "application/octet-stream",
          organizationId,
          resourceType: "quote",
          resourceId: req.params.id,
        });

        attachmentData = {
          ...attachmentData,
          // Legacy fields (for backward compatibility)
          fileName: originalFilename,
          fileUrl: fileMetadata.relativePath, // Store relative path in fileUrl for now
          fileSize: fileMetadata.sizeBytes,
          mimeType: mimeType || "application/octet-stream",
          // New storage fields
          originalFilename: fileMetadata.originalFilename,
          storedFilename: fileMetadata.storedFilename,
          relativePath: fileMetadata.relativePath,
          storageProvider: "local",
          extension: fileMetadata.extension,
          sizeBytes: fileMetadata.sizeBytes,
          checksum: fileMetadata.checksum,
          thumbStatus: isPdfEarly && pdfColumnsExist ? ("thumb_pending" as const) : ("uploaded" as const),
        };

        if (pdfColumnsExist) {
          attachmentData.pageCountStatus = isPdfEarly ? ("detecting" as const) : ("unknown" as const);
        }
      }
      // Legacy method (GCS or direct URL)
      else {
        if (!fileUrl) {
          return res.status(400).json({ error: "fileUrl is required for legacy uploads" });
        }

        // Determine storage provider for legacy uploads
        // - http(s): external legacy URL
        // - Supabase object key: typically starts with "uploads/" (or bucket-prefixed)
        // - Otherwise: local storage key
        let storageProvider: string | undefined;
        if (fileUrl && (fileUrl.startsWith("http://") || fileUrl.startsWith("https://"))) {
          storageProvider = undefined;
        } else if (
          isSupabaseConfigured() &&
          fileUrl &&
          (fileUrl.startsWith("uploads/") || fileUrl.startsWith("titan-private/uploads/"))
        ) {
          storageProvider = "supabase";
        } else {
          storageProvider = "local";
        }

        attachmentData = {
          ...attachmentData,
          fileName,
          fileUrl:
            storageProvider === "supabase" &&
            fileUrl &&
            !fileUrl.startsWith("http://") &&
            !fileUrl.startsWith("https://")
              ? normalizeObjectKeyForDb(fileUrl)
              : fileUrl,
          fileSize: fileSize || null,
          mimeType: mimeType || null,
          originalFilename: originalFilename || fileName || null,
          storageProvider,
          bucket: "titan-private",
          thumbStatus: isPdfEarly && pdfColumnsExist ? ("thumb_pending" as const) : ("uploaded" as const),
        };

        if (pdfColumnsExist) {
          attachmentData.pageCountStatus = isPdfEarly ? ("detecting" as const) : ("unknown" as const);
        }
      }

      const [attachment] = await db.insert(quoteAttachments).values(attachmentData).returning();

      // Best-effort self-check for Supabase-backed keys (non-blocking)
      if (attachment.storageProvider === "supabase" && attachment.fileUrl) {
        res.on("finish", () => {
          scheduleSupabaseObjectSelfCheck({
            bucket: "titan-private",
            path: attachment.fileUrl,
            context: { attachmentType: "quote", quoteId: req.params.id, attachmentId: attachment.id },
          });
        });
      }

      // Fire-and-forget thumbnail generation for images (non-blocking)
      // Use isSupportedImageType helper which supports both mimeType and fileName-based detection
      const { isSupportedImageType } = await import("../services/thumbnailGenerator");
      const attachmentFileNameForThumb = attachment.originalFilename || attachment.fileName || null;
      const isSupportedImage = isSupportedImageType(attachment.mimeType, attachmentFileNameForThumb);
      const hasStorageProviderForThumb = !!attachment.storageProvider;
      const isNotHttpUrlForThumb =
        attachment.fileUrl &&
        !attachment.fileUrl.startsWith("http://") &&
        !attachment.fileUrl.startsWith("https://");

      if (isSupportedImage && hasStorageProviderForThumb && isNotHttpUrlForThumb && attachment.fileUrl) {
        const { generateImageDerivatives, isThumbnailGenerationEnabled } = await import(
          "../services/thumbnailGenerator"
        );
        if (isThumbnailGenerationEnabled()) {
          void generateImageDerivatives(
            attachment.id,
            "quote",
            attachment.fileUrl,
            attachment.mimeType || null,
            attachment.storageProvider!,
            organizationId,
            attachmentFileNameForThumb
          ).catch((error) => {
            // Errors are already logged inside generateImageDerivatives
            console.error(`[QuoteFiles:POST] Thumbnail generation failed for ${attachment.id}:`, error);
          });
        } else {
          console.log(`[QuoteFiles:POST] Thumbnail generation disabled, skipping for ${attachment.id}`);
        }
      } else if (isSupportedImage && (!hasStorageProviderForThumb || !isNotHttpUrlForThumb)) {
        console.log(
          `[QuoteFiles:POST] Skipping thumbnail generation for ${attachment.id}: storageProvider=${attachment.storageProvider}, fileUrl starts with http=${attachment.fileUrl?.startsWith("http")}`
        );
      }

      // Fire-and-forget PDF thumbnail generation for PDFs (non-blocking)
      const attachmentFileNameForPdf = (
        (attachment.originalFilename ?? attachment.fileName ?? "") as string
      ).toLowerCase();
      const isPdf =
        (attachment.mimeType ?? "").toLowerCase().includes("pdf") || attachmentFileNameForPdf.endsWith(".pdf");
      const normalizedStorageProvider =
        (attachment.storageProvider as any) ??
        (isSupabaseConfigured() && attachment.fileUrl?.startsWith("uploads/") ? "supabase" : null);

      if (isPdf && pdfColumnsExist && normalizedStorageProvider && isNotHttpUrlForThumb && attachment.fileUrl) {
        res.on("finish", () => {
          setImmediate(() => {
            void (async () => {
              try {
                const { processPdfAttachmentDerivedData } = await import("../services/pdfProcessing");
                await processPdfAttachmentDerivedData({
                  orgId: organizationId,
                  attachmentId: attachment.id,
                  storageKey: attachment.fileUrl,
                  storageProvider: normalizedStorageProvider,
                  mimeType: attachment.mimeType || null,
                  attachmentType: "quote",
                });
              } catch (error: any) {
                console.error(`[QuoteFiles:POST] PDF kickoff failed for ${attachment.id}:`, error);
              }
            })();
          });
        });
      }

      res.json({ success: true, data: attachment });
    } catch (error) {
      console.error("Error attaching file to quote:", error);
      res.status(500).json({ error: "Failed to attach file to quote" });
    }
  });

  /**
   * DELETE /api/quotes/:id/files/:fileId
   * Delete quote attachment (quote-level only)
   */
  app.delete("/api/quotes/:id/files/:fileId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate quote belongs to org (prevents cross-tenant access)
      const [quote] = await db
        .select({ id: quotes.id, status: quotes.status })
        .from(quotes)
        .where(and(eq(quotes.id, req.params.id), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      if (!assertQuoteEditable(res, quote)) return;

      await db
        .delete(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.id, req.params.fileId),
            eq(quoteAttachments.quoteId, req.params.id),
            isNull(quoteAttachments.quoteLineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        );

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quote file:", error);
      res.status(500).json({ error: "Failed to delete quote file" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CHUNKED UPLOADS (for large files)
  // ══════════════════════════════════════════════════════════════════════════

  // Start background cleanup for temp chunked uploads (fail-soft)
  try {
    const { startUploadCleanupTimerOnce } = await import("../services/chunkedUploads");
    startUploadCleanupTimerOnce();
  } catch {
    // fail-soft
  }

  /**
   * POST /api/uploads/init
   * Initialize a chunked upload session
   */
  app.post("/api/uploads/init", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { filename, mimeType, size, purpose, quoteId, orderId } = req.body || {};
      if (!filename || typeof filename !== "string") return res.status(400).json({ error: "filename is required" });
      if (!mimeType || typeof mimeType !== "string") return res.status(400).json({ error: "mimeType is required" });
      if (size == null || Number.isNaN(Number(size))) return res.status(400).json({ error: "size is required" });
      if (purpose !== "quote-attachment" && purpose !== "order-attachment")
        return res.status(400).json({ error: "Unsupported purpose" });

      if (purpose === "quote-attachment") {
        if (!quoteId || typeof quoteId !== "string")
          return res.status(400).json({ error: "quoteId is required for quote-attachment" });

        // Validate quote belongs to org
        const [quote] = await db
          .select({ id: quotes.id, status: quotes.status })
          .from(quotes)
          .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
          .limit(1);
        if (!quote) return res.status(404).json({ error: "Quote not found" });
        if (!assertQuoteEditable(res, quote)) return;
      } else if (purpose === "order-attachment") {
        if (!orderId || typeof orderId !== "string")
          return res.status(400).json({ error: "orderId is required for order-attachment" });

        // Validate order belongs to org
        const order = await storage.getOrderById(organizationId, orderId);
        if (!order) return res.status(404).json({ error: "Order not found" });
      }

      const { createUploadSession } = await import("../services/chunkedUploads");
      const session = await createUploadSession({
        organizationId,
        createdByUserId: userId,
        purpose,
        quoteId: purpose === "quote-attachment" ? quoteId : null,
        orderId: purpose === "order-attachment" ? orderId : null,
        filename,
        mimeType,
        sizeBytes: Number(size),
      });

      return res.json({
        success: true,
        data: {
          uploadId: session.uploadId,
          chunkSizeBytes: session.chunkSizeBytes,
          totalChunks: session.totalChunks,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error) {
      console.error("[Uploads:Init] Error:", error);
      return res.status(500).json({ error: "Failed to initialize upload" });
    }
  });

  /**
   * PUT /api/uploads/:uploadId/chunks/:chunkIndex
   * Upload a single chunk
   */
  app.put("/api/uploads/:uploadId/chunks/:chunkIndex", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { uploadId, chunkIndex } = req.params;
      const idx = Number(chunkIndex);
      if (!uploadId) return res.status(400).json({ error: "uploadId is required" });
      if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: "Invalid chunkIndex" });

      const { loadUploadSessionMeta, writeUploadChunkFromStream, saveUploadSessionMeta } = await import(
        "../services/chunkedUploads"
      );
      const meta = await loadUploadSessionMeta(uploadId);
      if (meta.organizationId !== organizationId) return res.status(404).json({ error: "Upload session not found" });
      if (idx >= meta.totalChunks) return res.status(400).json({ error: "chunkIndex out of bounds" });

      // Stream chunk directly to disk (no base64, no buffering the whole file in memory).
      await writeUploadChunkFromStream({ uploadId, chunkIndex: idx, stream: req });

      if (meta.status === "initiated") {
        meta.status = "uploading";
        await saveUploadSessionMeta(uploadId, meta);
      }

      return res.json({ success: true, data: { received: true } });
    } catch (error) {
      console.error("[Uploads:Chunk] Error:", error);
      return res.status(500).json({ error: "Failed to upload chunk" });
    }
  });

  /**
   * POST /api/uploads/:uploadId/finalize
   * Finalize chunked upload (assemble chunks and create attachment)
   */
  app.post("/api/uploads/:uploadId/finalize", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { uploadId } = req.params;
      const { quoteId, orderId } = req.body || {};
      if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

      // Require either quoteId or orderId
      if (!quoteId && !orderId) return res.status(400).json({ error: "quoteId or orderId is required" });
      if (quoteId && orderId) return res.status(400).json({ error: "Cannot specify both quoteId and orderId" });

      if (quoteId) {
        // Validate quote belongs to org
        const [quote] = await db
          .select({ id: quotes.id, status: quotes.status })
          .from(quotes)
          .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
          .limit(1);
        if (!quote) return res.status(404).json({ error: "Quote not found" });
        if (!assertQuoteEditable(res, quote)) return;
      } else if (orderId) {
        // Validate order belongs to org
        const order = await storage.getOrderById(organizationId, orderId);
        if (!order) return res.status(404).json({ error: "Order not found" });
      }

      const { finalizeUploadSession } = await import("../services/chunkedUploads");
      const finalized = await finalizeUploadSession({
        uploadId,
        organizationId,
        quoteId: quoteId || undefined,
        orderId: orderId || undefined,
      });

      return res.json({
        success: true,
        data: {
          fileId: finalized.fileId,
          filename: finalized.filename,
          mimeType: finalized.mimeType,
          size: finalized.sizeBytes,
          checksum: finalized.checksum,
        },
      });
    } catch (error: any) {
      console.error("[Uploads:Finalize] Error:", error);
      return res.status(500).json({ error: error?.message || "Failed to finalize upload" });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // QUOTE ATTACHMENTS (Modern API - quote-level attachments with atomic uploads)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/quotes/:quoteId/attachments
   * List all quote attachments (optionally include line-item attachments)
   */
  app.get("/api/quotes/:quoteId/attachments", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId } = req.params;
      const { includeLineItems } = req.query;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate quote belongs to org (prevents cross-tenant access)
      const [quote] = await db
        .select({ id: quotes.id })
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      // Build where clause - optionally include line item attachments
      const whereConditions = [eq(quoteAttachments.quoteId, quoteId), eq(quoteAttachments.organizationId, organizationId)];

      // If includeLineItems is not explicitly true, filter to quote-level only (backward compatible)
      if (includeLineItems !== "true") {
        whereConditions.push(isNull(quoteAttachments.quoteLineItemId));
      }

      const files = await db
        .select()
        .from(quoteAttachments)
        .where(and(...whereConditions))
        .orderBy(desc(quoteAttachments.createdAt));

      const logOnce = createRequestLogOnce();
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));
      return res.json({ success: true, data: enrichedFiles });
    } catch (error) {
      console.error("[QuoteAttachments:GET] Error:", error);
      return res.status(500).json({ error: "Failed to fetch quote attachments" });
    }
  });

  /**
   * POST /api/quotes/:quoteId/attachments
   * Upload/link a quote-level attachment (expects storage key from /api/objects/upload or atomic upload)
   */
  app.post("/api/quotes/:quoteId/attachments", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);

      const {
        // Chunked upload (preferred for large files)
        uploadId,
        // Atomic upload contract (preferred)
        files,
        description,
        // Legacy link-only contract (fallback)
        fileName,
        fileUrl,
        fileSize,
        mimeType,
      } = req.body;

      // Validate quote belongs to org
      const [quote] = await db
        .select({ id: quotes.id, status: quotes.status })
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      if (!assertQuoteEditable(res, quote)) return;

      // Chunked upload link: finalize happens via /api/uploads/:uploadId/finalize.
      // This endpoint links a finalized upload into quote_attachments.
      if (uploadId && typeof uploadId === "string") {
        const { loadUploadSessionMeta, saveUploadSessionMeta, deleteUploadSession } = await import(
          "../services/chunkedUploads"
        );
        const meta = await loadUploadSessionMeta(uploadId);
        if (meta.organizationId !== organizationId) return res.status(404).json({ error: "Upload not found" });
        if (meta.purpose !== "quote-attachment") return res.status(400).json({ error: "Invalid upload purpose" });
        if (meta.status !== "finalized" || !meta.relativePath)
          return res.status(400).json({ error: "Upload not finalized" });
        if (meta.quoteId && meta.quoteId !== quoteId) return res.status(400).json({ error: "Upload quoteId mismatch" });

        const attachmentInsert: any = {
          quoteId,
          quoteLineItemId: null,
          organizationId,
          uploadedByUserId: userId,
          uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
          description: description || null,
          bucket: "titan-private",
          fileName: meta.originalFilename,
          fileUrl: meta.relativePath,
          fileSize: meta.sizeBytes,
          mimeType: meta.mimeType,
          originalFilename: meta.originalFilename,
          storedFilename: meta.storedFilename || null,
          relativePath: meta.relativePath,
          storageProvider: "local",
          extension: meta.extension || null,
          sizeBytes: meta.sizeBytes,
          checksum: meta.checksum || null,
        };

        const [created] = await db.insert(quoteAttachments).values(attachmentInsert).returning();

        // Mark linked and remove temp session metadata (permanent file remains in uploads root).
        meta.linkedAt = new Date().toISOString();
        await saveUploadSessionMeta(uploadId, meta);
        await deleteUploadSession(uploadId);

        const enriched = await enrichAttachmentWithUrls(created);
        return res.json({ success: true, data: [enriched] });
      }

      // Preferred: atomic upload+link in a single request.
      // Body format:
      // { files: [{ originalFilename, mimeType, sizeBytes, fileBufferBase64 }], description? }
      if (Array.isArray(files) && files.length > 0) {
        const { SupabaseStorageService, isSupabaseConfigured: _isSupabaseConfigured } = await import(
          "../supabaseStorage"
        );
        const {
          processUploadedFile,
          generateStoredFilename,
          generateRelativePath,
          computeChecksum,
          getFileExtension,
          deleteFile: deleteLocalFile,
        } = await import("../utils/fileStorage.js");

        const uploadedKeys: Array<{ provider: "supabase" | "local"; key: string }> = [];

        try {
          const inserted = await db.transaction(async (tx) => {
            const results: any[] = [];

            for (const f of files) {
              const originalFilename = (f?.originalFilename ?? f?.fileName ?? "").toString();
              const fileBufferBase64 = (f?.fileBufferBase64 ?? f?.fileBuffer ?? "").toString();
              const fileMimeType = (f?.mimeType ?? "application/octet-stream").toString();

              if (!originalFilename) {
                throw new Error("originalFilename is required");
              }
              if (!fileBufferBase64) {
                throw new Error(`fileBufferBase64 is required for ${originalFilename}`);
              }

              const buffer = Buffer.from(fileBufferBase64, "base64");

              let attachmentInsert: any = {
                quoteId,
                quoteLineItemId: null,
                organizationId,
                uploadedByUserId: userId,
                uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
                description: description || null,
                bucket: "titan-private",
              };

              if (_isSupabaseConfigured()) {
                const storedFilename = generateStoredFilename(originalFilename);
                const relativePath = generateRelativePath({
                  organizationId,
                  resourceType: "quote",
                  resourceId: quoteId,
                  storedFilename,
                });
                const checksum = computeChecksum(buffer);
                const extension = getFileExtension(originalFilename);
                const sizeBytes = buffer.length;

                const supabase = new SupabaseStorageService();
                const uploaded = await supabase.uploadFile(relativePath, buffer, fileMimeType);
                uploadedKeys.push({ provider: "supabase", key: uploaded.path });

                attachmentInsert = {
                  ...attachmentInsert,
                  fileName: originalFilename,
                  fileUrl: uploaded.path,
                  fileSize: sizeBytes,
                  mimeType: fileMimeType,
                  originalFilename,
                  storedFilename,
                  relativePath,
                  storageProvider: "supabase",
                  extension,
                  sizeBytes,
                  checksum,
                };
              } else {
                const fileMetadata = await processUploadedFile({
                  originalFilename,
                  buffer,
                  mimeType: fileMimeType,
                  organizationId,
                  resourceType: "quote",
                  resourceId: quoteId,
                });
                uploadedKeys.push({ provider: "local", key: fileMetadata.relativePath });

                attachmentInsert = {
                  ...attachmentInsert,
                  fileName: originalFilename,
                  fileUrl: fileMetadata.relativePath,
                  fileSize: fileMetadata.sizeBytes,
                  mimeType: fileMimeType,
                  originalFilename: fileMetadata.originalFilename,
                  storedFilename: fileMetadata.storedFilename,
                  relativePath: fileMetadata.relativePath,
                  storageProvider: "local",
                  extension: fileMetadata.extension,
                  sizeBytes: fileMetadata.sizeBytes,
                  checksum: fileMetadata.checksum,
                };
              }

              const [created] = await tx.insert(quoteAttachments).values(attachmentInsert).returning();
              results.push(created);
            }

            return results;
          });

          return res.json({ success: true, data: inserted });
        } catch (error: any) {
          // Best-effort cleanup of uploaded blobs on failure
          try {
            if (_isSupabaseConfigured()) {
              const supabase = new SupabaseStorageService();
              await Promise.all(
                uploadedKeys.filter((k) => k.provider === "supabase").map((k) => supabase.deleteFile(k.key))
              );
            }
            await Promise.all(
              uploadedKeys.filter((k) => k.provider === "local").map((k) => deleteLocalFile(k.key).catch(() => false))
            );
          } catch {
            // fail-soft cleanup
          }

          console.error("[QuoteAttachments:POST] Atomic upload failed:", error);
          return res.status(500).json({ error: error?.message || "Failed to upload attachments" });
        }
      }

      // Fallback: link-only (legacy) contract
      if (!fileName) return res.status(400).json({ error: "fileName is required" });
      if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" });

      let storageProvider: string | undefined;
      if (isSupabaseConfigured() && fileUrl && !fileUrl.startsWith("http://") && !fileUrl.startsWith("https://")) {
        storageProvider = "supabase";
      } else if (fileUrl && (fileUrl.startsWith("http://") || fileUrl.startsWith("https://"))) {
        storageProvider = undefined;
      } else {
        storageProvider = "local";
      }

      const attachmentData: any = {
        quoteId,
        quoteLineItemId: null,
        organizationId,
        uploadedByUserId: userId,
        uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
        fileName,
        originalFilename: fileName,
        fileUrl,
        fileSize: fileSize || null,
        mimeType: mimeType || null,
        description: description || null,
        bucket: "titan-private",
        storageProvider,
      };

      const [attachment] = await db.insert(quoteAttachments).values(attachmentData).returning();
      return res.json({ success: true, data: attachment });
    } catch (error) {
      console.error("[QuoteAttachments:POST] Error:", error);
      return res.status(500).json({ error: "Failed to attach file to quote" });
    }
  });

  /**
   * GET /api/quotes/:quoteId/attachments/:attachmentId/download/proxy
   * Download proxy for quote-level attachment - streams file with correct filename and content-type.
   */
  app.get(
    "/api/quotes/:quoteId/attachments/:attachmentId/download/proxy",
    isAuthenticated,
    tenantContext,
    async (req: any, res) => {
      try {
        const { quoteId, attachmentId } = req.params;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

        // Validate quote belongs to org
        const [quote] = await db
          .select({ id: quotes.id })
          .from(quotes)
          .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
          .limit(1);
        if (!quote) return res.status(404).json({ error: "Quote not found" });

        const [attachment] = await db
          .select()
          .from(quoteAttachments)
          .where(
            and(
              eq(quoteAttachments.id, attachmentId),
              eq(quoteAttachments.quoteId, quoteId),
              isNull(quoteAttachments.quoteLineItemId),
              eq(quoteAttachments.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!attachment) return res.status(404).json({ error: "Attachment not found" });

        const resolvedName = attachment.originalFilename || attachment.fileName;
        res.setHeader("Content-Disposition", `attachment; filename="${resolvedName}"`);
        res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");

        if (
          isSupabaseConfigured() &&
          (attachment.storageProvider === "supabase" || (attachment.fileUrl || "").startsWith("uploads/"))
        ) {
          const { SupabaseStorageService } = await import("../supabaseStorage");
          const supabaseService = new SupabaseStorageService();
          const signedUrl = await supabaseService.getSignedDownloadUrl(attachment.fileUrl, 3600);
          const fileResponse = await fetch(signedUrl);
          if (!fileResponse.ok) throw new Error("Failed to fetch file from storage");
          const buffer = await fileResponse.arrayBuffer();
          return res.send(Buffer.from(buffer));
        }

        // Local storage fallback
        const { resolveLocalStoragePath } = await import("../services/localStoragePath");
        const fs = await import("fs");
        const absPath = resolveLocalStoragePath(attachment.fileUrl);
        const stream = fs.createReadStream(absPath);
        stream.on("error", (err) => {
          console.error("[QuoteAttachments:DOWNLOAD:PROXY] Local stream error:", err);
          if (!res.headersSent) res.status(404).json({ error: "File not found" });
        });
        return stream.pipe(res);
      } catch (error: any) {
        console.error("[QuoteAttachments:DOWNLOAD:PROXY] Error:", error);
        return res.status(500).json({ error: error.message || "Failed to download file" });
      }
    }
  );

  /**
   * DELETE /api/quotes/:quoteId/attachments/:attachmentId
   * Remove/unlink a quote-level attachment
   */
  app.delete("/api/quotes/:quoteId/attachments/:attachmentId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, attachmentId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate quote belongs to org (prevents cross-tenant access)
      const [quote] = await db
        .select({ id: quotes.id, status: quotes.status })
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      if (!assertQuoteEditable(res, quote)) return;

      await db
        .delete(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.id, attachmentId),
            eq(quoteAttachments.quoteId, quoteId),
            isNull(quoteAttachments.quoteLineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        );

      return res.json({ success: true });
    } catch (error) {
      console.error("[QuoteAttachments:DELETE] Error:", error);
      return res.status(500).json({ error: "Failed to delete quote attachment" });
    }
  });

  console.log("[AttachmentRoutes] Registered attachment routes successfully");
}
