/**
 * prepressFiles.routes.ts
 *
 * Prepress file transport routes: multipart upload, file download/streaming,
 * thumbnail URL resolution, originals ZIP export, file listing, and file replacement.
 *
 * These routes are the file-handling counterpart to prepress.routes.ts (queue/session/
 * material/spec routes). They delegate all persistence and storage operations to
 * prepressFileService and resolveDerivativeFileAccess — nothing here manages storage
 * paths directly.
 *
 * Placement: server/routes/prepressFiles.routes.ts
 * Registered by: server/routes.ts via registerPrepressFileRoutes
 */

import busboy from "busboy";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { lineItemFiles, orderLineItems, orders } from "@shared/schema";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { getStorageAuthMode } from "../objectStorage";
import * as prepressFileService from "../prepressFileService";
import { resolveDerivativeFileAccess } from "../lib/supabaseObjectHelpers";

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

// Handles both Replit auth (claims.sub) and local auth (id) formats
const getUserId = (user: any): string | undefined => user?.claims?.sub || user?.id;

type PreviewUiStatus = "missing" | "processing" | "ready" | "failed";
const toPreviewUiStatus = (status: string): PreviewUiStatus => {
  if (status === "available" || status === "ready") return "ready";
  if (status === "pending" || status === "processing") return "processing";
  if (status === "failed") return "failed";
  return "missing";
};

// One-time dev-mode GCS auth mode log — avoids spamming on every upload
let hasLoggedPrepressStorageAuthMode = false;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPrepressFileRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    assertInternalUser: (req: any, res: any) => boolean;
    downloadLineItemFile?: typeof prepressFileService.downloadLineItemFile;
    downloadProductionFileForJob?: typeof prepressFileService.downloadProductionFileForJob;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;
  const downloadLineItemFile = middleware.downloadLineItemFile ?? prepressFileService.downloadLineItemFile;
  const downloadProductionFileForJob = middleware.downloadProductionFileForJob ?? prepressFileService.downloadProductionFileForJob;

  app.get("/api/prepress/file-naming-policy", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const policy = await prepressFileService.getFileUploadNamingPolicy(organizationId);
      res.json({ success: true, data: policy });
    } catch (error: any) {
      console.error("[Prepress] File naming policy error:", error);
      res.status(500).json({ error: error?.message || "Failed to resolve file naming policy" });
    }
  });

  // POST /api/prepress/files/upload - Upload file (multipart)
  app.post("/api/prepress/files/upload", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      // Parse multipart upload
      const bb = busboy({ headers: req.headers });

      let fileBuffer: Buffer | null = null;
      let fileName = '';
      let fileMimeType = '';
      const fields: Record<string, string> = {};
      let fileSize = 0;
      const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;

      bb.on('file', (name, file, info) => {
        const { filename, mimeType } = info;
        fileName = filename;
        fileMimeType = mimeType;

        const chunks: Buffer[] = [];

        file.on('data', (chunk: Buffer) => {
          fileSize += chunk.length;
          if (fileSize > MAX_FILE_SIZE_BYTES) {
            file.resume();
            return;
          }
          chunks.push(chunk);
        });

        file.on('end', () => {
          if (fileSize <= MAX_FILE_SIZE_BYTES) {
            fileBuffer = Buffer.concat(chunks);
          }
        });
      });

      bb.on('field', (name, value) => {
        fields[name] = value;
      });

      bb.on('finish', async () => {
        try {
          if (fileSize > MAX_FILE_SIZE_BYTES) {
            return res.status(400).json({ error: "File size exceeds maximum allowed size of 250MB" });
          }

          if (!fileBuffer) {
            return res.status(400).json({ error: 'No file uploaded' });
          }

          // Validate required fields
          if (!fields.lineItemId || !fields.role) {
            return res.status(400).json({ error: "Missing required fields: lineItemId, role" });
          }

          // Get line item to validate org and get order ID
          const lineItems = await db
            .select({
              lineItem: orderLineItems,
              order: orders,
            })
            .from(orderLineItems)
            .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
            .where(
              and(
                eq(orderLineItems.id, fields.lineItemId),
                eq(orders.organizationId, organizationId)
              )
            )
            .limit(1);

          if (!lineItems[0]) {
            return res.status(404).json({ error: "Line item not found" });
          }

          if (!hasLoggedPrepressStorageAuthMode && process.env.NODE_ENV !== "production") {
            hasLoggedPrepressStorageAuthMode = true;
            console.log(`[Prepress] GCS auth mode: ${getStorageAuthMode()}`);
          }

          const lineItem = lineItems[0].lineItem;
          const order = lineItems[0].order;
          const namingPolicy = await prepressFileService.getFileUploadNamingPolicy(organizationId);
          const normalizedRole = fields.role as "original" | "final" | "reference";
          const normalizedTag = fields.tag === "none" ? "" : fields.tag;

          if (normalizedRole === "final" && namingPolicy.prepressFileLabelMode === "required" && !normalizedTag) {
            return res.status(400).json({ error: "File type is required for final prepress uploads" });
          }

          // Upload file
          const uploadedFile = await prepressFileService.uploadLineItemFile({
            organizationId,
            orderId: order.id,
            lineItemId: fields.lineItemId,
            prepressSessionId: fields.sessionId || undefined,
            role: normalizedRole,
            tag: normalizedTag || undefined,
            buffer: fileBuffer,
            originalFilename: fileName,
            mimeType: fileMimeType,
            createdByUserId: userId,
          });

          res.json({ success: true, data: uploadedFile });
        } catch (uploadError: any) {
          console.error("[Prepress] File upload error:", uploadError);
          const upstreamMessage = String(uploadError?.message || uploadError || "upload_failed");
          const isStorageAuthFailure =
            upstreamMessage.includes("127.0.0.1:1106") ||
            upstreamMessage.includes("ECONNREFUSED") ||
            upstreamMessage.toLowerCase().includes("credential");

          res.status(500).json({
            error: "Failed to upload file",
            code: isStorageAuthFailure ? "storage_auth_unavailable" : "prepress_upload_failed",
            message: upstreamMessage.slice(0, 280),
          });
        }
      });

      bb.on('error', (error) => {
        console.error("[Prepress] Busboy error:", error);
        res.status(500).json({ error: "Upload parsing failed" });
      });

      req.pipe(bb);
    } catch (error: any) {
      console.error("[Prepress] Upload error:", error);
      res.status(500).json({ error: error?.message || "Failed to upload file" });
    }
  });

  // GET /api/prepress/files/:fileId/download - Download file with job number prefix
  app.get("/api/prepress/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const inline = String(req.query.inline || "").toLowerCase() === "1" || String(req.query.inline || "").toLowerCase() === "true";
      await downloadLineItemFile(req.params.fileId, organizationId, res, { inline });
    } catch (error: any) {
      console.error("[Prepress] Download error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to download file" });
      }
    }
  });

  // GET /api/prepress/files/:fileId/thumbnail - Preview URL (thumbnail/inline fallback)
  app.get("/api/prepress/files/:fileId/thumbnail", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const [fileRow] = await db
        .select({
          id: lineItemFiles.id,
          orderId: lineItemFiles.orderId,
          lineItemId: lineItemFiles.lineItemId,
          fileRecordId: lineItemFiles.fileRecordId,
          storageBucket: lineItemFiles.storageBucket,
          storagePath: lineItemFiles.storagePath,
          storageKey: lineItemFiles.storageKey,
          mimeType: lineItemFiles.mimeType,
          role: lineItemFiles.role,
          originalFilename: lineItemFiles.originalFilename,
        })
        .from(lineItemFiles)
        .where(
          and(
            eq(lineItemFiles.id, req.params.fileId),
            eq(lineItemFiles.organizationId, organizationId),
            eq(lineItemFiles.status, "active")
          )
        )
        .limit(1);

      if (!fileRow) {
        return res.status(404).json({ error: "File not found" });
      }

      res.set("X-Served-As", "thumbnail");
      res.set("Cache-Control", "no-store");

      const normalizedMimeType = String(fileRow.mimeType || "").toLowerCase();
      const supportsPreview = normalizedMimeType === "application/pdf"
        || fileRow.originalFilename.toLowerCase().endsWith(".pdf")
        || (normalizedMimeType.startsWith("image/") && !normalizedMimeType.includes("svg"));
      const canRepair = fileRow.role === "final" && supportsPreview;

      if (!fileRow.fileRecordId) {
        if (canRepair) {
          prepressFileService.queueLineItemFilePreviewRepair({
            fileId: fileRow.id,
            organizationId,
            actorUserId: getUserId(req.user) || "system",
          });
          return res.json({
            success: true,
            data: {
              thumbnailUrl: null,
              thumbnailAvailabilityStatus: "pending",
              thumbnailStatus: "processing",
            },
            message: "Thumbnail processing",
          });
        }
        return res.json({
          success: true,
          data: {
            thumbnailUrl: null,
            thumbnailAvailabilityStatus: "missing",
            thumbnailStatus: "missing",
          },
          message: "Thumbnail derivative unavailable",
        });
      }

      const resolved = await resolveDerivativeFileAccess(
        { id: fileRow.id, fileRecordId: fileRow.fileRecordId },
        "thumbnail"
      );

      if (resolved.url) {
        return res.json({
          success: true,
          data: {
            thumbnailUrl: resolved.url,
            thumbnailAvailabilityStatus: resolved.availabilityStatus,
            thumbnailStatus: "ready",
          },
        });
      }

      if (resolved.availabilityStatus === "missing" && canRepair) {
        prepressFileService.queueLineItemFilePreviewRepair({
          fileId: fileRow.id,
          organizationId,
          actorUserId: getUserId(req.user) || "system",
        });
        return res.json({
          success: true,
          data: {
            thumbnailUrl: null,
            thumbnailAvailabilityStatus: "pending",
            thumbnailStatus: "processing",
          },
          message: "Thumbnail processing",
        });
      }

      return res.json({
        success: true,
        data: {
          thumbnailUrl: null,
          thumbnailAvailabilityStatus: resolved.availabilityStatus,
          thumbnailStatus: toPreviewUiStatus(resolved.availabilityStatus),
        },
        message: resolved.availabilityStatus === "pending"
          ? "Thumbnail processing"
          : resolved.availabilityStatus === "failed"
            ? "Preview unavailable"
            : "Thumbnail derivative unavailable",
      });
    } catch (error: any) {
      console.error("[Prepress] Thumbnail URL error:", error);
      res.status(500).json({ error: error?.message || "Failed to resolve thumbnail URL" });
    }
  });

  // Production-specific final-file access. The service validates job, line item, file, and org ownership.
  app.get("/api/production/jobs/:jobId/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const inline = ["1", "true"].includes(String(req.query.inline || "").toLowerCase());
      await downloadProductionFileForJob({
        jobId: req.params.jobId,
        fileId: req.params.fileId,
        organizationId,
        inline,
        res,
      });
    } catch (error: any) {
      if (
        error instanceof prepressFileService.ProductionFileAccessError
        || (error?.name === "ProductionFileAccessError" && Number.isInteger(error?.statusCode))
      ) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("[Production] Final file download error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Could not access production file" });
      }
    }
  });

  // POST /api/prepress/files/:fileId/ensure-preview - Generate/repair private preview derivatives.
  app.post("/api/prepress/files/:fileId/ensure-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const result = await prepressFileService.ensureLineItemFilePreview({
        fileId: req.params.fileId,
        organizationId,
        actorUserId: req.user.id,
      });
      const [thumbnail, preview] = await Promise.all([
        resolveDerivativeFileAccess({ id: req.params.fileId, fileRecordId: result.fileRecordId }, "thumbnail"),
        resolveDerivativeFileAccess({ id: req.params.fileId, fileRecordId: result.fileRecordId }, "preview"),
      ]);

      return res.json({
        success: true,
        data: {
          previewStatus: result.previewStatus,
          thumbnailStatus: toPreviewUiStatus(thumbnail.availabilityStatus),
          thumbnailUrl: thumbnail.url ?? null,
          previewUrl: preview.url ?? null,
        },
      });
    } catch (error: any) {
      const message = error?.message || "Failed to prepare file preview";
      if (message === "File not found") return res.status(404).json({ error: message });
      console.error("[Prepress] Ensure preview error:", error);
      return res.status(500).json({ error: message });
    }
  });

  // GET /api/prepress/line-item/:lineItemId/download-originals-zip - Download all originals as ZIP
  app.get("/api/prepress/line-item/:lineItemId/download-originals-zip", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      await prepressFileService.downloadOriginalsAsZip(req.params.lineItemId, organizationId, res);
    } catch (error: any) {
      console.error("[Prepress] ZIP download error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to download originals" });
      }
    }
  });

  // GET /api/prepress/line-item/:lineItemId/files - Get all files for a line item
  app.get("/api/prepress/line-item/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const files = await prepressFileService.getLineItemFiles(req.params.lineItemId, organizationId);
      const [lineItemRow] = await db
        .select({ orderNumber: orders.orderNumber })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(
          and(
            eq(orderLineItems.id, req.params.lineItemId),
            eq(orders.organizationId, organizationId)
          )
        )
        .limit(1);
      const fullJobNumber = lineItemRow?.orderNumber || "";
      const namingPolicy = await prepressFileService.getFileUploadNamingPolicy(organizationId);
      const enhance = async (f: any) => {
        const [thumbnailAccess, previewAccess] = f.fileRecordId
          ? await Promise.all([
              resolveDerivativeFileAccess({ id: f.id, fileRecordId: f.fileRecordId }, "thumbnail"),
              resolveDerivativeFileAccess({ id: f.id, fileRecordId: f.fileRecordId }, "preview"),
            ])
          : [{ url: null }, { url: null }];

        return {
          ...f,
          computedDisplayFilename: prepressFileService.buildComputedDisplayFilename({
            role: f.role,
            originalFilename: f.originalFilename,
            tag: f.tag,
            fullJobNumber,
            namingPolicy,
          }),
          originalUrl: `/api/prepress/files/${f.id}/download`,
          downloadUrl: `/api/prepress/files/${f.id}/download`,
          previewUrl: previewAccess.url ?? null,
          thumbnailUrl: thumbnailAccess.url ?? null,
          previewAvailabilityStatus: previewAccess.availabilityStatus ?? "missing",
          thumbnailAvailabilityStatus: thumbnailAccess.availabilityStatus ?? "missing",
          thumbnailStatus: toPreviewUiStatus(thumbnailAccess.availabilityStatus ?? "missing"),
        };
      };

      const [originals, finals, references] = await Promise.all([
        Promise.all(files.originals.map(enhance)),
        Promise.all(files.finals.map(enhance)),
        Promise.all(files.references.map(enhance)),
      ]);

      const data = {
        originals,
        finals,
        references,
        bridgedOriginals: files.bridgedOriginals,
        proofs: files.proofs,
      };

      res.json({ success: true, data, files: [...data.originals, ...data.finals, ...data.references] });
    } catch (error: any) {
      console.error("[Prepress] Error fetching files:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch files" });
    }
  });

  // POST /api/prepress/files/:fileId/replace - Replace existing file
  app.post("/api/prepress/files/:fileId/replace", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      // Parse multipart upload (same pattern as upload)
      const bb = busboy({ headers: req.headers });

      let fileBuffer: Buffer | null = null;
      let fileName = '';
      let fileMimeType = '';
      let fileSize = 0;
      const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;

      bb.on('file', (name, file, info) => {
        const { filename, mimeType } = info;
        fileName = filename;
        fileMimeType = mimeType;

        const chunks: Buffer[] = [];

        file.on('data', (chunk: Buffer) => {
          fileSize += chunk.length;
          if (fileSize > MAX_FILE_SIZE_BYTES) {
            file.resume();
            return;
          }
          chunks.push(chunk);
        });

        file.on('end', () => {
          if (fileSize <= MAX_FILE_SIZE_BYTES) {
            fileBuffer = Buffer.concat(chunks);
          }
        });
      });

      bb.on('finish', async () => {
        try {
          if (fileSize > MAX_FILE_SIZE_BYTES) {
            return res.status(400).json({ error: "File size exceeds maximum allowed size of 250MB" });
          }

          if (!fileBuffer) {
            return res.status(400).json({ error: 'No file uploaded' });
          }

          const replacedFile = await prepressFileService.replaceLineItemFile({
            fileId: req.params.fileId,
            organizationId,
            buffer: fileBuffer,
            originalFilename: fileName,
            mimeType: fileMimeType,
            createdByUserId: userId,
          });

          res.json({ success: true, data: replacedFile });
        } catch (replaceError: any) {
          console.error("[Prepress] File replace error:", replaceError);
          res.status(500).json({ error: replaceError?.message || "Failed to replace file" });
        }
      });

      bb.on('error', (error) => {
        console.error("[Prepress] Busboy error:", error);
        res.status(500).json({ error: "Upload parsing failed" });
      });

      req.pipe(bb);
    } catch (error: any) {
      console.error("[Prepress] Replace error:", error);
      res.status(500).json({ error: error?.message || "Failed to replace file" });
    }
  });
}
