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
import { Readable } from "stream";
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
  assets,
} from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, inArray, sql } from "drizzle-orm";
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
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  normalizeObjectKeyForDb,
  scheduleSupabaseObjectSelfCheck,
  tryExtractSupabaseObjectKeyFromUrl
} from "../lib/supabaseObjectHelpers";
import type { FileRole, FileSide } from "../lib/supabaseObjectHelpers";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { ObjectPermission } from "../objectAcl";
import { resolveLocalStoragePath } from "../services/localStoragePath";
import { normalizeTenantObjectKey } from "../utils/orgKeys";
import type { DownloadIntent } from "@shared/schema";

let hasLoggedPdfObjectsResponse = false;

function isNotFoundError(err: any): boolean {
  if (!err) return false;
  const code = (err as any)?.code;
  if (code === "ENOENT") return true;

  const status = (err as any)?.status;
  if (status === 404) return true;

  const msg = String((err as any)?.message ?? "").toLowerCase();
  // Supabase + our own upstream wrapper errors.
  if (msg.includes("object not found")) return true;
  if (msg.includes("upstream fetch failed") && msg.includes("404")) return true;
  return false;
}

function parseOrigins(val?: string) {
  return (val ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toOrigin(u: string | null | undefined): string | null {
  const raw = (u ?? "").toString().trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function uniq(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const s = (item ?? "").toString().trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function getFrameAncestors(req: any): string[] {
  // Prod: use env allowlist (APP_ORIGINS, APP_ORIGIN, PUBLIC_APP_URL)
  const envOrigins = uniq([
    ...parseOrigins(process.env.APP_ORIGINS).map(toOrigin),
    toOrigin(process.env.APP_ORIGIN),
    toOrigin(process.env.PUBLIC_APP_URL),
  ]);
  if (envOrigins.length > 0) {
    return uniq(["'self'", ...envOrigins]);
  }

  // Dev: derive the UI origin from request headers (no hardcoded ports).
  // Prefer Referer (includes path) and fall back to Origin.
  const referer = typeof req.get === "function" ? req.get("referer") : undefined;
  const origin = typeof req.get === "function" ? req.get("origin") : undefined;
  const inferred = toOrigin(referer) ?? toOrigin(origin);
  return inferred ? uniq(["'self'", inferred]) : ["'self'"];
}

/**
 * Resolves which file to download for an attachment based on download intent.
 * 
 * @param attachment - Attachment record with fileUrl, relativePath, etc.
 * @param intent - Download intent (original/print/proof/preferred)
 * @returns Object with displayFilename and objectPath (storage key)
 * 
 * TODO: When file variants are implemented in the database:
 * - For "print": Check attachment.printReadyKey, fall back to original
 * - For "proof": Check attachment.proofKey, fall back to original  
 * - For "preferred": Try print > proof > original in that order
 * - For "original": Always use original file
 * 
 * CURRENT BEHAVIOR: All intents resolve to original file (no variants yet).
 */
function resolveAttachmentDownloadTarget(
  attachment: {
    id: string;
    fileName: string;
    originalFilename?: string | null;
    fileUrl?: string | null;
    relativePath?: string | null;
  },
  intent: DownloadIntent
): { displayFilename: string; objectPath: string | null } {
  // TODO: Add variant resolution logic when database schema supports it
  // For now, ignore intent and always return original file
  
  const displayFilename = String(attachment.originalFilename || attachment.fileName || `attachment-${attachment.id}`);
  
  // Extract objectPath from fileUrl or use relativePath
  let objectPath: string | null = null;
  
  // Priority 1: /objects/ URLs (Supabase)
  if (attachment.fileUrl && attachment.fileUrl.startsWith('/objects/')) {
    objectPath = attachment.fileUrl.replace('/objects/', '').split('?')[0];
  } 
  // Priority 2: relativePath field (local storage)
  else if (attachment.relativePath) {
    objectPath = attachment.relativePath;
  }
  // Priority 3: fileUrl as direct path (for uploads/* paths stored directly)
  else if (attachment.fileUrl && !attachment.fileUrl.startsWith('http')) {
    objectPath = attachment.fileUrl;
  }
  
  return { displayFilename, objectPath };
}

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



// ────────────────────────────────────────────────────────────────────────────
// Type definitions for file roles and sides
// ────────────────────────────────────────────────────────────────────────────



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
   * GET /api/objects/download?key=<objectKey>&filename=<name>
   * Same-origin download endpoint that ALWAYS sets Content-Disposition: attachment.
   *
   * Security: only accepts object keys (not arbitrary external URLs) and enforces
   * that the key is tenant-scoped (first path segment must match organizationId).
   */
  app.get("/api/objects/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const rawKeyParam = (req.query.key ?? req.query.objectPath ?? "").toString();
      if (!rawKeyParam) return res.status(400).json({ error: "Missing key" });

      let decodedKey = rawKeyParam;
      try {
        decodedKey = decodeURIComponent(rawKeyParam);
      } catch {
        // keep rawKeyParam
      }

      const requestedKey = normalizeTenantObjectKey(normalizeObjectKeyForDb(decodedKey));
      if (!requestedKey) return res.status(400).json({ error: "Invalid key" });

      // Tenant safety (compatible with legacy keys):
      // - If a key is explicitly org-scoped (starts with "org_"), enforce it matches.
      // - Otherwise allow (mirrors existing /objects behavior while still avoiding arbitrary URLs).
      const firstSegment = requestedKey.split("/")[0] || "";
      if (firstSegment.startsWith("org_") && firstSegment !== organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const rawFilename = (req.query.filename ?? "").toString();
      const resolvedName = (rawFilename || path.basename(requestedKey) || "download")
        .replace(/[\r\n\t\0]/g, " ")
        .replace(/"/g, "'")
        .slice(0, 240);

      const bucketParamRaw = (req.query.bucket ?? "").toString().trim();
      const bucketParam = /^[a-z0-9._-]+$/i.test(bucketParamRaw) ? bucketParamRaw : "";

      // 1) Supabase: fetch bytes server-side and stream with attachment headers.
      if (isSupabaseConfigured()) {
        try {
          const supabaseService = new SupabaseStorageService(bucketParam || undefined);
          const signedUrl = await supabaseService.getSignedDownloadUrl(requestedKey, 3600);
          const upstream = await fetch(signedUrl);
          if (!upstream.ok) {
            throw new Error(`Upstream fetch failed: ${upstream.status} ${upstream.statusText}`);
          }

          res.setHeader("Content-Disposition", `attachment; filename="${resolvedName}"`);
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
          res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

          // Stream if possible; otherwise buffer.
          const body: any = (upstream as any).body;
          if (body && typeof Readable.fromWeb === "function") {
            const nodeStream = Readable.fromWeb(body);
            nodeStream.on("error", (err) => {
              console.error("[objects:download] Stream error:", err);
              if (!res.headersSent) res.status(500).end();
            });
            return nodeStream.pipe(res);
          }

          const buf = Buffer.from(await upstream.arrayBuffer());
          return res.send(buf);
        } catch (supabaseError: any) {
          // fall through to local/GCS attempts
          if (process.env.NODE_ENV === "development") {
            console.log(`[objects:download] supabase miss key="${requestedKey}":`, supabaseError?.message || supabaseError);
          }
        }
      }

      // 2) Local filesystem
      try {
        const localPath = resolveLocalStoragePath(requestedKey);
        await fsPromises.access(localPath, fsPromises.constants.R_OK);
        return res.download(path.resolve(localPath), resolvedName);
      } catch {
        // fall through
      }

      // 3) GCS via Replit ObjectStorage
      const userId = getUserId((req as any).user);
      const objectStorageService = new ObjectStorageService();
      const objectRoutePath = `/objects/${requestedKey}`;
      const objectFile = await objectStorageService.getObjectEntityFile(objectRoutePath);

      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId ?? undefined,
        requestedPermission: ObjectPermission.READ,
      });

      if (!canAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.setHeader("Content-Disposition", `attachment; filename="${resolvedName}"`);
      return objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      console.error("[objects:download] Error:", error);
      return res.status(500).json({ error: error?.message || "Failed to download" });
    }
  });

  /**
   * GET /objects/:objectPath
   * Proxy endpoint for serving files from Supabase/local/GCS storage
   * Handles automatic fallback: Supabase → local → GCS
   */
  app.get("/objects/:objectPath(*)", isAuthenticated, tenantContext, async (req: any, res) => {
    const userId = getUserId(req.user);
    const isDev = process.env.NODE_ENV === "development";

    let hasLoggedExpectedNotFound = false;
    const logExpectedNotFoundOnce = (provider: string, key: string, detail?: string) => {
      if (!isDev) return;
      if (hasLoggedExpectedNotFound) return;
      hasLoggedExpectedNotFound = true;
      const suffix = detail ? ` (${detail})` : "";
      console.log(`[objects] not-found provider=${provider} key="${key}"${suffix}`);
    };

    const organizationId = getRequestOrganizationId(req);

    // Extract and decode object path properly
    const rawObjectPath = req.params.objectPath || req.params[0] || "";
    const objectPath = decodeURIComponent(rawObjectPath);

    // Canonicalize obvious key mistakes early (but keep original for logging).
    const requestedKey = normalizeObjectKeyForDb(objectPath);
    const compatKey = normalizeTenantObjectKey(requestedKey);
    const candidateKeys = requestedKey === compatKey ? [requestedKey] : [requestedKey, compatKey];

    if (isDev) {
      console.log(
        `[objects] request="${objectPath}" key="${requestedKey}"` +
          (requestedKey !== compatKey ? ` compat="${compatKey}"` : "")
      );
    }

    if (!requestedKey) {
      return res.status(400).json({ error: "Invalid object path" });
    }

    // Tenant safety (compatible with legacy keys):
    // - If a key is explicitly org-scoped (starts with "org_"), enforce it matches.
    // - Otherwise allow (mirrors existing behavior while still avoiding obvious cross-tenant reads).
    const firstSegmentRequested = requestedKey.split("/")[0] || "";
    if (firstSegmentRequested.startsWith("org_") && firstSegmentRequested !== organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const wantsDownload =
      req.query.download === "1" ||
      req.query.download === "true" ||
      req.query.disposition === "attachment";

    const rawFilename = (req.query.filename ?? "").toString();

    const bucketParamRaw = (req.query.bucket ?? "").toString().trim();
    const bucketParam = /^[a-z0-9._-]+$/i.test(bucketParamRaw) ? bucketParamRaw : "";

    // Optional DB lookup: map object key -> original uploaded filename/mimeType (scoped to org).
    // This allows /objects/uploads/<uuid> to still download as the original filename.
    let assetMeta: { fileName: string | null; mimeType: string | null } | null = null;
    if (!rawFilename) {
      try {
        const [row] = await db
          .select({ fileName: assets.fileName, mimeType: assets.mimeType })
          .from(assets)
          .where(and(eq(assets.organizationId, organizationId), inArray(assets.fileKey, candidateKeys)))
          .limit(1);
        if (row) assetMeta = { fileName: row.fileName ?? null, mimeType: row.mimeType ?? null };
      } catch (error) {
        if (isDev) {
          console.warn("[objects] asset meta lookup failed (fail-soft):", (error as any)?.message || error);
        }
      }
    }

    // Per requirements: safeName = filename ?? assets.file_name ?? path.basename(objectPath)
    // objectPath should reflect what the client requested, not any normalized variant.
    let safeName = (rawFilename || assetMeta?.fileName || path.basename(objectPath) || "download")
      .replace(/[\r\n\t\0]/g, " ")
      .replace(/"/g, "'")
      .slice(0, 240);

    try {
      // Try Supabase then local filesystem for each candidate key.
      for (const keyToTry of candidateKeys) {
        // 1) Supabase
        if (isSupabaseConfigured()) {
          const supabaseService = new SupabaseStorageService(bucketParam || undefined);
          const ext = path.extname(keyToTry).toLowerCase();
          const dbMimeLower = (assetMeta?.mimeType ?? "").toLowerCase();
          const safeLower = safeName.toLowerCase();
          const isPdf = ext === ".pdf" || safeLower.endsWith(".pdf") || dbMimeLower.includes("pdf");
          const isImage =
            [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ||
            safeLower.endsWith(".jpg") ||
            safeLower.endsWith(".jpeg") ||
            safeLower.endsWith(".png") ||
            safeLower.endsWith(".gif") ||
            safeLower.endsWith(".webp") ||
            dbMimeLower.startsWith("image/");
          const contentTypes: { [key: string]: string } = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".pdf": "application/pdf",
          };

          try {
            const signedUrl = await supabaseService.getSignedDownloadUrl(keyToTry, 3600);

            if (isDev) {
              console.log(`[objects] resolved provider=supabase key="${keyToTry}"`);
            }

            // Always proxy bytes for Supabase so:
            // - Same-origin (iframe-friendly)
            // - We can control Content-Disposition (inline vs attachment)
            // - We can override missing/incorrect Content-Type metadata
            const upstream = await fetch(signedUrl);
            if (!upstream.ok) {
              const e: any = new Error(`Upstream fetch failed: ${upstream.status} ${upstream.statusText}`);
              e.status = upstream.status;
              throw e;
            }

            const upstreamType = upstream.headers.get("content-type") || "";
            const inferredType = contentTypes[ext] || "";
            const upstreamLower = upstreamType.toLowerCase();
            const contentType = isPdf
              ? (!wantsDownload
                  ? "application/pdf"
                  : (upstreamType || assetMeta?.mimeType || "application/pdf"))
              : isImage
                ? (upstreamType || assetMeta?.mimeType || inferredType || "image/*")
                : (upstreamType || assetMeta?.mimeType || inferredType || "application/octet-stream");

            // ALWAYS include extension when known.
            if (isPdf && safeName && !safeLower.endsWith(".pdf")) safeName = `${safeName}.pdf`;
            if (!path.extname(safeName)) {
              const ctLower = contentType.toLowerCase();
              if (ctLower.includes("application/pdf")) safeName = `${safeName}.pdf`;
              else if (ctLower.includes("image/png")) safeName = `${safeName}.png`;
              else if (ctLower.includes("image/jpeg")) safeName = `${safeName}.jpg`;
              else if (ctLower.includes("image/webp")) safeName = `${safeName}.webp`;
              else if (ctLower.includes("image/gif")) safeName = `${safeName}.gif`;
            }

            res.setHeader("Content-Type", contentType);
            res.setHeader(
              "Content-Disposition",
              `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`
            );
            res.setHeader("Cache-Control", wantsDownload ? "private, max-age=0, must-revalidate" : "public, max-age=86400");
            res.removeHeader("X-Frame-Options");
            const ancestors = getFrameAncestors(req);
            res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);

            if (isDev && isPdf && !hasLoggedPdfObjectsResponse) {
              hasLoggedPdfObjectsResponse = true;
              console.log(
                `[objects] ok url="${req.originalUrl}" key="${keyToTry}" content-type="${contentType}" disposition="${wantsDownload ? "attachment" : "inline"}" filename="${safeName}"`
              );
            }

            const body: any = (upstream as any).body;
            if (body && typeof Readable.fromWeb === "function") {
              const nodeStream = Readable.fromWeb(body);
              nodeStream.on("error", (err) => {
                console.error("[objects] upstream stream error:", err);
                if (!res.headersSent) res.status(500).end();
              });
              return nodeStream.pipe(res);
            }

            const buf = Buffer.from(await upstream.arrayBuffer());
            return res.send(buf);
          } catch (supabaseError: any) {
            if (isNotFoundError(supabaseError)) {
              logExpectedNotFoundOnce("supabase", keyToTry);
              // fall through to local/GCS
            } else if (isDev) {
              console.warn(`[objects] supabase error key="${keyToTry}":`, supabaseError?.message || supabaseError);
            } else {
              console.error("[objects] supabase error:", supabaseError);
            }
          }
        }

        // 2) Local filesystem (FILE_STORAGE_ROOT)
        try {
          const localPath = resolveLocalStoragePath(keyToTry);
          await fsPromises.access(localPath, fsPromises.constants.R_OK);

          const ext = path.extname(keyToTry).toLowerCase();
          const contentTypes: { [key: string]: string } = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".pdf": "application/pdf",
          };
          const dbMimeLower = (assetMeta?.mimeType ?? "").toLowerCase();
          const safeLower = safeName.toLowerCase();
          const isPdf = ext === ".pdf" || safeLower.endsWith(".pdf") || dbMimeLower.includes("pdf");
          const isImage =
            [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ||
            safeLower.endsWith(".jpg") ||
            safeLower.endsWith(".jpeg") ||
            safeLower.endsWith(".png") ||
            safeLower.endsWith(".gif") ||
            safeLower.endsWith(".webp") ||
            dbMimeLower.startsWith("image/");

          const contentType = isPdf
            ? (!wantsDownload ? contentTypes[".pdf"] : (assetMeta?.mimeType || contentTypes[".pdf"]))
            : (contentTypes[ext] || assetMeta?.mimeType || "application/octet-stream");

          // ALWAYS include extension when known.
          if (isPdf && safeName && !safeName.toLowerCase().endsWith(".pdf")) safeName = `${safeName}.pdf`;
          if (!path.extname(safeName)) {
            const ctLower = contentType.toLowerCase();
            if (ctLower.includes("application/pdf")) safeName = `${safeName}.pdf`;
            else if (ctLower.includes("image/png")) safeName = `${safeName}.png`;
            else if (ctLower.includes("image/jpeg")) safeName = `${safeName}.jpg`;
            else if (ctLower.includes("image/webp")) safeName = `${safeName}.webp`;
            else if (ctLower.includes("image/gif")) safeName = `${safeName}.gif`;
          }

          res.setHeader("Content-Type", contentType);
          res.setHeader(
            "Content-Disposition",
            `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`
          );
          res.setHeader("Cache-Control", wantsDownload ? "private, max-age=0, must-revalidate" : "public, max-age=86400"); // 1 day cache
          res.removeHeader("X-Frame-Options");
          const ancestors = getFrameAncestors(req);
          res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);

          if (isDev && isPdf && !hasLoggedPdfObjectsResponse) {
            hasLoggedPdfObjectsResponse = true;
            console.log(
              `[objects] ok url="${req.originalUrl}" key="${keyToTry}" content-type="${contentType}" disposition="${wantsDownload ? "attachment" : "inline"}" filename="${safeName}"`
            );
          }

          if (isDev) {
            console.log(`[objects] resolved provider=local key="${keyToTry}" path="${localPath}"`);
          }

          return res.sendFile(path.resolve(localPath));
        } catch (localError: any) {
          if (isNotFoundError(localError)) {
            logExpectedNotFoundOnce("local", keyToTry, "ENOENT");
            if (process.env.DEBUG_THUMBNAILS && keyToTry.includes('thumbs/')) {
              try {
                const attemptedPath = resolveLocalStoragePath(keyToTry);
                console.log(`[objects] Thumbnail not found:`, {
                  requestedKey: keyToTry,
                  attemptedPath,
                  error: localError?.code,
                });
              } catch {
                console.log(`[objects] Thumbnail not found:`, {
                  requestedKey: keyToTry,
                  error: localError?.code,
                });
              }
            }
          } else if (isDev) {
            console.warn(`[objects] local error key="${keyToTry}":`, localError?.message || localError);
          } else {
            console.error("[objects] local error:", localError);
          }
        }
      }

      // Try GCS via Replit ObjectStorage (requires sidecar)
      // Check if GCS credentials are accessible
      const hasGCSAccess = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.REPL_ID !== "local-dev-repl-id";

      if (!hasGCSAccess) {
        if (isDev) {
          console.log(`[objects] 404 - File not found in any storage. Object path: "${requestedKey}"`);
        }
        return res.status(404).json({
          error: "File not found",
          message: "File not available in Supabase or local storage, and GCS not configured",
          path: req.path,
          objectPath: requestedKey,
        });
      }

      // 3) GCS (Replit ObjectStorage) - try candidate keys as well
      const objectStorageService = new ObjectStorageService();
      for (const keyToTry of candidateKeys) {
        try {
          const objectRoutePath = `/objects/${keyToTry}`;
          const objectFile = await objectStorageService.getObjectEntityFile(objectRoutePath);

          const canAccess = await objectStorageService.canAccessObjectEntity({
            objectFile,
            userId: userId ?? undefined,
            requestedPermission: ObjectPermission.READ,
          });

          if (!canAccess) {
            if (isDev) {
              console.log(`[objects] 403 - Access denied. Object path: "${keyToTry}"`);
            }
            return res.status(403).json({ error: "Access denied", path: req.path, objectPath: keyToTry });
          }

          if (isDev) {
            console.log(`[objects] resolved provider=gcs key="${keyToTry}"`);
          }

          // Ensure /objects embed policy is consistent across providers.
          res.removeHeader("X-Frame-Options");
          const ancestors = getFrameAncestors(req);
          res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);
          res.setHeader(
            "Content-Disposition",
            `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`
          );

          return objectStorageService.downloadObject(objectFile, res);
        } catch {
          // keep trying candidates
        }
      }

      throw new ObjectNotFoundError();
    } catch (error: any) {
      if (error instanceof ObjectNotFoundError) {
        // Missing objects (e.g. thumbnails) are expected sometimes; keep 404 response but avoid scary logs.
        logExpectedNotFoundOnce("any", requestedKey);
        if (isDev) {
          console.log(`[objects] 404 - Object not found. Object path: "${objectPath}", Error:`, error.message);
        }
        return res.status(404).json({ error: "Object not found", path: req.path, objectPath });
      }

      console.error("[objects] Error serving object:", error);

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
      const { url, path } = await objectStorageService.getObjectEntityUploadURL();
      res.json({
        method: "PUT",
        url,
        path,
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
   * Supports optional ?intent=original|print|proof|preferred query param (defaults to "original").
   */
  app.get(
    "/api/quotes/:quoteId/attachments/:attachmentId/download/proxy",
    isAuthenticated,
    tenantContext,
    async (req: any, res) => {
      try {
        const { quoteId, attachmentId } = req.params;
        const intentParam = (req.query.intent || "original").toString();
        const downloadIntent: DownloadIntent = ["original", "print", "proof", "preferred"].includes(intentParam)
          ? (intentParam as DownloadIntent)
          : "original";
        
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

        // Use resolver to get target file (currently returns original regardless of intent)
        const resolved = resolveAttachmentDownloadTarget(attachment, downloadIntent);
        if (!resolved.objectPath) {
          return res.status(404).json({ error: "File path not found" });
        }

        res.setHeader("Content-Disposition", `attachment; filename="${resolved.displayFilename}"`);
        res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");

        if (
          isSupabaseConfigured() &&
          (attachment.storageProvider === "supabase" || (resolved.objectPath || "").startsWith("uploads/"))
        ) {
          const { SupabaseStorageService } = await import("../supabaseStorage");
          const supabaseService = new SupabaseStorageService();
          const signedUrl = await supabaseService.getSignedDownloadUrl(resolved.objectPath, 3600);
          const fileResponse = await fetch(signedUrl);
          if (!fileResponse.ok) throw new Error("Failed to fetch file from storage");
          const buffer = await fileResponse.arrayBuffer();
          return res.send(Buffer.from(buffer));
        }

        // Local storage fallback
        const { resolveLocalStoragePath } = await import("../services/localStoragePath");
        const fs = await import("fs");
        const absPath = resolveLocalStoragePath(resolved.objectPath);
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

  /**
   * GET /api/quotes/:quoteId/attachments.zip
   * Download all quote-level and line-item attachments as a zip file
   */
  app.get('/api/quotes/:quoteId/attachments.zip', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      // Verify quote access
      const [quoteRow] = await db
        .select({ id: quotes.id, quoteNumber: quotes.quoteNumber })
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);

      if (!quoteRow) return res.status(404).json({ error: 'Quote not found' });

      // Collect all quote-level attachments
      const attachmentRows = await db
        .select({
          id: quoteAttachments.id,
          fileName: quoteAttachments.fileName,
          originalFilename: quoteAttachments.originalFilename,
          fileUrl: quoteAttachments.fileUrl,
          relativePath: quoteAttachments.relativePath,
        })
        .from(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.quoteId, quoteId),
            isNull(quoteAttachments.quoteLineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        )
        .orderBy(quoteAttachments.createdAt);

      // Collect line-item attachment rows
      const lineItemAttachmentRows = await db
        .select({
          id: quoteAttachments.id,
          fileName: quoteAttachments.fileName,
          originalFilename: quoteAttachments.originalFilename,
          fileUrl: quoteAttachments.fileUrl,
          relativePath: quoteAttachments.relativePath,
          quoteLineItemId: quoteAttachments.quoteLineItemId,
        })
        .from(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.quoteId, quoteId),
            isNotNull(quoteAttachments.quoteLineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        )
        .orderBy(quoteAttachments.createdAt);

      // Build file list with paths
      const files: Array<{ filename: string; objectPath: string }> = [];

      for (const att of attachmentRows) {
        const filename = String(att.originalFilename || att.fileName || `attachment-${att.id}`);
        // Extract objectPath from fileUrl (if it starts with /objects/) or use relativePath
        let objectPath: string | null = null;
        if (att.fileUrl && att.fileUrl.startsWith('/objects/')) {
          objectPath = att.fileUrl.replace('/objects/', '').split('?')[0];
        } else if (att.relativePath) {
          objectPath = att.relativePath;
        }
        if (objectPath) files.push({ filename, objectPath });
      }

      for (const att of lineItemAttachmentRows) {
        const filename = String(att.originalFilename || att.fileName || `attachment-${att.id}`);
        // Use a folder structure for line item attachments
        const filenameWithLabel = `line-item-${att.quoteLineItemId}/${filename}`;
        // Extract objectPath from fileUrl (if it starts with /objects/) or use relativePath
        let objectPath: string | null = null;
        if (att.fileUrl && att.fileUrl.startsWith('/objects/')) {
          objectPath = att.fileUrl.replace('/objects/', '').split('?')[0];
        } else if (att.relativePath) {
          objectPath = att.relativePath;
        }
        if (objectPath) files.push({ filename: filenameWithLabel, objectPath });
      }

      if (files.length === 0) {
        return res.status(404).json({ error: 'No attachments found for this quote' });
      }

      // Stream zip using archiver
      const archiver = (await import('archiver')).default;
      const { Readable } = await import('stream');
      const { promises: fsPromises } = await import('fs');
      const path = await import('path');

      const archive = archiver('zip', { zlib: { level: 9 } });

      const zipFilename = `Quote-${quoteRow.quoteNumber || quoteId}-attachments.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      archive.on('error', (err: Error) => {
        console.error('[QuoteAttachmentsZip] Archiver error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create zip archive' });
        }
      });

      archive.pipe(res);

      // Helper to get file stream (mirrors /objects endpoint logic)
      const resolveLocalStoragePath = (key: string): string => {
        const root = process.env.FILE_STORAGE_ROOT || './data/uploads';
        return path.join(root, key);
      };

      for (const file of files) {
        try {
          const keyToTry = file.objectPath;
          let streamAdded = false;

          // 1) Try Supabase
          if (isSupabaseConfigured()) {
            try {
              const supabaseService = new SupabaseStorageService();
              const signedUrl = await supabaseService.getSignedDownloadUrl(keyToTry, 3600);
              const upstream = await fetch(signedUrl);
              if (upstream.ok) {
                const body: any = (upstream as any).body;
                if (body && typeof Readable.fromWeb === 'function') {
                  const nodeStream = Readable.fromWeb(body);
                  const safeFilename = file.filename.replace(/[<>:"/\\|?*]/g, '_');
                  archive.append(nodeStream, { name: safeFilename });
                  streamAdded = true;
                }
              }
            } catch (supabaseError) {
              // fall through to local
            }
          }

          // 2) Try local filesystem
          if (!streamAdded) {
            const localPath = resolveLocalStoragePath(keyToTry);
            await fsPromises.access(localPath, fsPromises.constants.R_OK);
            const fs = await import('fs');
            const nodeStream = fs.createReadStream(localPath);
            const safeFilename = file.filename.replace(/[<>:"/\\|?*]/g, '_');
            archive.append(nodeStream, { name: safeFilename });
            streamAdded = true;
          }

          if (!streamAdded) {
            console.warn(`[QuoteAttachmentsZip] Could not resolve file: ${file.filename} (${keyToTry})`);
          }
        } catch (err) {
          console.error(`[QuoteAttachmentsZip] Failed to add ${file.filename}:`, err);
          // Continue with other files
        }
      }

      await archive.finalize();
    } catch (error) {
      console.error('[QuoteAttachmentsZip:GET] Error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to generate zip archive' });
      }
    }
  });

  // Universal bulk zip download endpoint (supports both attachmentIds and modal scope)
  app.post('/api/attachments/zip', isAuthenticated, tenantContext, async (req: any, res) => {
    console.info('[zip] Route handler hit', { url: req.originalUrl, method: req.method, bodyKeys: Object.keys(req.body ?? {}) });
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const { attachmentIds, scope, parentType, parentId, intent = "original" } = req.body;
      
      // Validate intent if provided
      const downloadIntent: DownloadIntent = ["original", "print", "proof", "preferred"].includes(intent)
        ? intent
        : "original";

      let attachmentsToInclude: Array<{
        id: string;
        fileName: string;
        originalFilename?: string | null;
        fileUrl?: string | null;
        relativePath?: string | null;
        orderLineItemId?: string | null;
      }> = [];

      // Mode 1: Specific attachment IDs
      if (attachmentIds && Array.isArray(attachmentIds) && attachmentIds.length > 0) {
        // Ensure all IDs are strings (not undefined/null)
        const validIds = attachmentIds.filter((id) => id && typeof id === 'string');
        
        if (validIds.length === 0) {
          return res.status(400).json({ error: 'No valid attachment IDs provided' });
        }

        // DEBUG
        if (process.env.DEBUG_ZIP === '1') {
          console.info('[zip] Mode 1: Selected IDs', { count: validIds.length, sampleIds: validIds.slice(0, 3) });
        }

        // Try ORDER attachments first
        const orderAttachmentRows = await db
          .select({
            id: orderAttachments.id,
            fileName: orderAttachments.fileName,
            originalFilename: orderAttachments.originalFilename,
            fileUrl: orderAttachments.fileUrl,
            relativePath: orderAttachments.relativePath,
            orderLineItemId: orderAttachments.orderLineItemId,
          })
          .from(orderAttachments)
          .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
          .where(
            and(
              inArray(orderAttachments.id, validIds),
              eq(orders.organizationId, organizationId)
            )
          );

        // DEBUG
        if (process.env.DEBUG_ZIP === '1') {
          console.info('[zip] Mode 1: orderAttachmentRows', { count: orderAttachmentRows.length });
        }

        // If no order attachments found, try QUOTE attachments
        if (orderAttachmentRows.length === 0) {
          const quoteAttachmentRows = await db
            .select({
              id: quoteAttachments.id,
              fileName: quoteAttachments.fileName,
              originalFilename: quoteAttachments.originalFilename,
              fileUrl: quoteAttachments.fileUrl,
              relativePath: quoteAttachments.relativePath,
              orderLineItemId: sql<string | null>`NULL`.as('orderLineItemId'),
            })
            .from(quoteAttachments)
            .innerJoin(quotes, eq(quotes.id, quoteAttachments.quoteId))
            .where(
              and(
                inArray(quoteAttachments.id, validIds),
                eq(quotes.organizationId, organizationId)
              )
            );
          
          // DEBUG
          if (process.env.DEBUG_ZIP === '1') {
            console.info('[zip] Mode 1: quoteAttachmentRows', { count: quoteAttachmentRows.length });
          }
          
          attachmentsToInclude = quoteAttachmentRows as any;
        } else {
          attachmentsToInclude = orderAttachmentRows;
        }
      }
      // Mode 2: Modal scope (all attachments for order/quote)
      else if (scope === 'modal' && parentType && parentId) {
        if (parentType === 'order') {
          // Verify order belongs to org
          const [orderRow] = await db
            .select({ id: orders.id, orderNumber: orders.orderNumber })
            .from(orders)
            .where(and(eq(orders.id, parentId), eq(orders.organizationId, organizationId)))
            .limit(1);

          if (!orderRow) {
            return res.status(404).json({ error: 'Order not found' });
          }

          // Collect all order-level + line-item attachments
          const allOrderAttachments = await db
            .select({
              id: orderAttachments.id,
              fileName: orderAttachments.fileName,
              originalFilename: orderAttachments.originalFilename,
              fileUrl: orderAttachments.fileUrl,
              relativePath: orderAttachments.relativePath,
              orderLineItemId: orderAttachments.orderLineItemId,
            })
            .from(orderAttachments)
            .where(eq(orderAttachments.orderId, parentId))
            .orderBy(orderAttachments.createdAt);

          attachmentsToInclude = allOrderAttachments;
        } else if (parentType === 'quote') {
          // Verify quote belongs to org
          const [quoteRow] = await db
            .select({ id: quotes.id, quoteNumber: quotes.quoteNumber })
            .from(quotes)
            .where(and(eq(quotes.id, parentId), eq(quotes.organizationId, organizationId)))
            .limit(1);

          if (!quoteRow) {
            return res.status(404).json({ error: 'Quote not found' });
          }

          // For quotes, we use quoteAttachments table
          // (This endpoint is designed for orders primarily, but we support quotes too)
          const allQuoteAttachments = await db
            .select({
              id: quoteAttachments.id,
              fileName: quoteAttachments.fileName,
              originalFilename: quoteAttachments.originalFilename,
              fileUrl: quoteAttachments.fileUrl,
              relativePath: quoteAttachments.relativePath,
              orderLineItemId: sql<string | null>`NULL`.as('orderLineItemId'),
            })
            .from(quoteAttachments)
            .where(and(eq(quoteAttachments.quoteId, parentId), eq(quoteAttachments.organizationId, organizationId)))
            .orderBy(quoteAttachments.createdAt);

          attachmentsToInclude = allQuoteAttachments as any;
        } else {
          return res.status(400).json({ error: 'Invalid parentType. Must be "order" or "quote".' });
        }
      } else {
        return res.status(400).json({ error: 'Must provide either attachmentIds or scope parameters' });
      }

      if (attachmentsToInclude.length === 0) {
        return res.status(404).json({ error: 'No attachments found' });
      }

      // DEBUG
      if (process.env.DEBUG_ZIP === '1') {
        console.info('[zip] attachmentsToInclude', {
          count: attachmentsToInclude.length,
          first: attachmentsToInclude[0] ? {
            id: attachmentsToInclude[0].id,
            fileName: attachmentsToInclude[0].fileName,
            originalFilename: attachmentsToInclude[0].originalFilename,
            fileUrl: attachmentsToInclude[0].fileUrl,
            relativePath: attachmentsToInclude[0].relativePath,
          } : null
        });
      }

      // Build file list with paths using the resolver
      const files: Array<{ filename: string; objectPath: string }> = [];
      const missingFiles: string[] = [];

      for (const att of attachmentsToInclude) {
        const resolved = resolveAttachmentDownloadTarget(att, downloadIntent);
        
        // Prefix with line-item folder if this is a line item attachment
        const filename = att.orderLineItemId
          ? `line-item-${att.orderLineItemId}/${resolved.displayFilename}`
          : resolved.displayFilename;

        if (resolved.objectPath) {
          files.push({ filename, objectPath: resolved.objectPath });
        } else {
          missingFiles.push(resolved.displayFilename);
        }
      }

      // DEBUG
      if (process.env.DEBUG_ZIP === '1') {
        console.info('[zip] Files resolved for packing', {
          validCount: files.length,
          missingCount: missingFiles.length,
          files: files.slice(0, 5).map(f => ({ filename: f.filename, objectPath: f.objectPath })),
        });
      }

      // DEBUG
      if (process.env.DEBUG_ZIP === '1') {
        console.info('[zip] Files to add', {
          validCount: files.length,
          missingCount: missingFiles.length,
          files: files.map(f => ({ filename: f.filename, objectPath: f.objectPath })),
        });
      }

      if (files.length === 0) {
        const diagnostics = process.env.DEBUG_ZIP === '1' ? {
          totalAttachments: attachmentsToInclude.length,
          resolvedFiles: files.length,
          missingFiles: missingFiles.slice(0, 5),
          mode: attachmentIds ? 'selected' : 'modal-scope',
        } : undefined;
        return res.status(404).json({ 
          error: 'No valid file paths found for attachments',
          ...(diagnostics && { diagnostics })
        });
      }

      // Stream zip using archiver
      const archiver = (await import('archiver')).default;
      const archive = archiver('zip', { zlib: { level: 9 } });

      const zipFilename = scope === 'modal'
        ? `${parentType}-${parentId}-attachments.zip`
        : `selected-attachments-${Date.now()}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      archive.on('error', (err: Error) => {
        console.error('[AttachmentsZip:POST] Archiver error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create zip archive' });
        }
      });

      archive.pipe(res);

      const errorLog: string[] = [];

      // Helper to resolve local storage path
      const resolveLocalStoragePath = (key: string): string => {
        const root = process.env.FILE_STORAGE_ROOT || './data/uploads';
        return path.join(root, key);
      };

      // Process files sequentially - archiver queues streams internally
      for (const file of files) {
        if (process.env.DEBUG_ZIP === '1') {
          console.info('[zip] Processing file', { filename: file.filename, objectPath: file.objectPath });
        }
        
        try {
          const keyToTry = file.objectPath;
          let streamAdded = false;

          // 1) Try Supabase
          if (isSupabaseConfigured()) {
            try {
              const supabaseService = new SupabaseStorageService();
              const signedUrl = await supabaseService.getSignedDownloadUrl(keyToTry, 3600);
              const upstream = await fetch(signedUrl);
              if (upstream.ok) {
                const body: any = (upstream as any).body;
                if (body && typeof Readable.fromWeb === 'function') {
                  const nodeStream = Readable.fromWeb(body);
                  const safeFilename = file.filename.replace(/[<>:"/\\|?*]/g, '_');
                  // Archiver queues streams internally, no need to await
                  archive.append(nodeStream, { name: safeFilename });
                  streamAdded = true;
                  if (process.env.DEBUG_ZIP === '1') {
                    console.info('[zip] Added from Supabase:', safeFilename);
                  }
                }
              }
            } catch (supabaseError) {
              // fall through to local
            }
          }

          // 2) Try local filesystem
          if (!streamAdded) {
            const localPath = resolveLocalStoragePath(keyToTry);
            await fsPromises.access(localPath, fsPromises.constants.R_OK);
            const fs = await import('fs');
            const nodeStream = fs.createReadStream(localPath);
            const safeFilename = file.filename.replace(/[<>:"/\\|?*]/g, '_');
            // Archiver queues streams internally, no need to await
            archive.append(nodeStream, { name: safeFilename });
            streamAdded = true;
            if (process.env.DEBUG_ZIP === '1') {
              console.info('[zip] Added from local:', safeFilename);
            }
          }

          if (!streamAdded) {
            errorLog.push(`Missing: ${file.filename} (${keyToTry})`);
            console.warn(`[AttachmentsZip:POST] Could not resolve file: ${file.filename} (${keyToTry})`);
            if (process.env.DEBUG_ZIP === '1') {
              console.info('[zip] Failed to resolve file:', { filename: file.filename, objectPath: keyToTry });
            }
          }
        } catch (err) {
          errorLog.push(`Error: ${file.filename} - ${String(err)}`);
          console.error(`[AttachmentsZip:POST] Failed to add ${file.filename}:`, err);
          if (process.env.DEBUG_ZIP === '1') {
            console.info('[zip] Exception when processing:', { filename: file.filename, error: String(err) });
          }
          // Continue with other files
        }
      }

      // DEBUG
      if (process.env.DEBUG_ZIP === '1') {
        console.info('[zip] Loop complete, finalizing archive');
      }

      // Add ERRORS.txt if any files were missing
      if (errorLog.length > 0) {
        const errorsContent = `The following files could not be included in this zip:\n\n${errorLog.join('\n')}\n`;
        archive.append(errorsContent, { name: 'ERRORS.txt' });
      }

      await archive.finalize();
    } catch (error) {
      console.error('[AttachmentsZip:POST] Error:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to generate zip archive' });
      }
    }
  });

  console.log("[AttachmentRoutes] Registered attachment routes successfully");
}
