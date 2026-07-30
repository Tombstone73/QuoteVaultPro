/**
 * quoteLineItemFiles.routes.ts
 *
 * Quote Line Item File routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/quotes/:quoteId/line-items/:lineItemId/files
 *   GET    /api/line-items/:lineItemId/files
 *   POST   /api/quotes/:quoteId/line-items/:lineItemId/files
 *   GET    /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download
 *   GET    /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download/proxy
 *   GET    /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/assets
 *   POST   /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/generate-thumbnails
 *   POST   /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/generate-pdf-thumbnails
 *   GET    /api/line-items/:lineItemId/files/:fileId/download
 *   DELETE /api/quotes/:quoteId/line-items/:lineItemId/files/:fileId
 *
 * Placement: server/routes/quoteLineItemFiles.routes.ts
 * Registered by: server/routes.ts via registerQuoteLineItemFileRoutes
 */

import type { Express } from "express";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { db, hasQuoteAttachmentPagesTable } from "../db";
import {
  quotes,
  quoteAttachments,
  quoteAttachmentPages,
  quoteLineItems,
  assets,
  assetLinks,
  assetVariants,
  orderAttachments,
} from "@shared/schema";
import { getRequestOrganizationId } from "../tenantContext";
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  normalizeObjectKeyForDb,
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
  scheduleSupabaseObjectSelfCheck,
} from "../lib/supabaseObjectHelpers";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { deleteStoredObjectKeysIfUnreferenced } from "../services/storage/storageReferenceGuard";
import { fileDerivativeRepository } from "../storage/fileDerivative.repo";
import { fileRecordRepository } from "../storage/fileRecord.repo";
import { assertQuoteEditable } from "./helpers/quoteWorkflow.helpers";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function toLegacyStorageProvider(provider: string | null | undefined): "local" | "s3" | "gcs" | "supabase" | null {
  if (provider === "local" || provider === "s3" || provider === "gcs" || provider === "supabase") {
    return provider;
  }
  return null;
}

export function registerQuoteLineItemFileRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  // ────────────────────────────────────────────────────────────────────────────
  // Quote Line Item Attachments (per-line-item artwork)
  // ────────────────────────────────────────────────────────────────────────────

  // Get attachments for a specific quote line item
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:GET] quoteId=${quoteId}, lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Validate the line item exists and belongs to this quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:GET] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Query attachments by lineItemId only (not by quoteId) to ensure files uploaded
      // before quote persistence remain visible. Access control is via the line item validation above.
      const files = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .orderBy(desc(quoteAttachments.createdAt));

      // Enrich each attachment with signed URLs
      const logOnce = createRequestLogOnce();
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

      // PHASE 2: Include linked assets with enriched URLs
      const { assetRepository } = await import('../services/assets/AssetRepository');
      const { enrichAssetsWithRoles } = await import('../services/assets/enrichAssetWithUrls');
      const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'quote_line_item', lineItemId);
      const enrichedAssets = await enrichAssetsWithRoles(linkedAssets);

      console.log(`[LineItemFiles:GET] Found ${files.length} files + ${linkedAssets.length} assets for line item ${lineItemId}`);
      res.json({ success: true, data: enrichedFiles, assets: enrichedAssets });
    } catch (error) {
      console.error("[LineItemFiles:GET] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Get attachments for a TEMPORARY line item (no quote yet)
  app.get("/api/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:GET:Temp] lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Fetch files safely; empty result is acceptable
      const files = await db
        .select()
        .from(quoteAttachments)
        .where(
          and(
            eq(quoteAttachments.quoteLineItemId, lineItemId),
            eq(quoteAttachments.organizationId, organizationId)
          )
        )
        .orderBy(desc(quoteAttachments.createdAt));

      // Enrich each attachment with signed URLs
      const logOnce = createRequestLogOnce();
      const enrichedFiles = await Promise.all(files.map((f) => enrichAttachmentWithUrls(f, { logOnce })));

      console.log(`[LineItemFiles:GET:Temp] Found ${files.length} files for temp line item ${lineItemId}`);
      res.json({ success: true, data: enrichedFiles });
    } catch (error) {
      console.error("[LineItemFiles:GET:Temp] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Attach file to a quote line item
  app.post("/api/quotes/:quoteId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);

      // Validate quote belongs to org and enforce lock before any attachment writes
      const [quote] = await db.select({ id: quotes.id, status: quotes.status }).from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;

      const { uploadId, fileName, fileUrl, fileSize, mimeType, description, fileBuffer, originalFilename, storageTarget, requestedStorageTarget } = req.body;

      console.log(`[LineItemFiles:POST] quoteId=${quoteId}, lineItemId=${lineItemId}, fileName=${fileName}`);

      const requestedTarget =
        (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
        (typeof storageTarget === 'string' ? storageTarget : null);

      if (!uploadId && !fileName && !originalFilename) {
        return res.status(400).json({ error: "fileName or originalFilename is required" });
      }

      // Legacy flow requires fileUrl.
      if (!uploadId && !fileBuffer && !fileUrl) {
        return res.status(400).json({ error: "fileUrl is required for legacy uploads" });
      }

      // Validate the line item exists and belongs to this quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:POST] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Detect if this is a PDF (by mimeType or filename) - will be recalculated after attachment creation
      const resolvedUploadName = (originalFilename || fileName || "") as string;
      const isPdfEarly = (mimeType && mimeType.toLowerCase().includes('pdf')) ||
        (resolvedUploadName && resolvedUploadName.toLowerCase().endsWith('.pdf'));

      // Check if PDF processing columns exist (from startup probe)
      const { hasPageCountStatusColumn } = await import('../db');
      const pdfColumnsExist = hasPageCountStatusColumn() === true;

      if (isPdfEarly && !pdfColumnsExist) {
        console.warn(`[LineItemFiles:POST] PDF detected but page_count_status column missing; PDF processing disabled for ${fileName}`);
      }

      const baseAttachmentData = {
        quoteId,
        quoteLineItemId: lineItemId,
        organizationId,
        uploadedByUserId: userId,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        description: description || null,
        bucket: 'titan-private',
      } as const;

      const defaultThumbStatus = isPdfEarly ? ('thumb_pending' as const) : ('uploaded' as const);
      const defaultPageCountStatus = pdfColumnsExist ? (isPdfEarly ? ('detecting' as const) : ('unknown' as const)) : null;
      const isExternalUrl = typeof fileUrl === 'string' && (fileUrl.startsWith('http://') || fileUrl.startsWith('https://'));

      let canonicalUpload: Awaited<ReturnType<typeof storageApplicationService.finalizeUpload<any>>> | null = null;

      if (uploadId && typeof uploadId === 'string') {
        canonicalUpload = await storageApplicationService.finalizeUpload({
          organizationId,
          createdByUserId: userId ?? null,
          requestedTarget,
          resource: {
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            lineItemId,
          },
          source: {
            kind: 'upload-session',
            uploadId,
            expectedPurpose: 'quote-attachment',
            expectedParentId: quoteId,
          },
          persistLink: async (tx, stored) => {
            const [created] = await tx.insert(quoteAttachments).values({
              ...baseAttachmentData,
              fileRecordId: stored.fileRecord.id,
              fileName: stored.storedObject.originalFilename,
              fileUrl: null,
              fileSize: stored.storedObject.sizeBytes,
              mimeType: stored.storedObject.mimeType,
              originalFilename: stored.storedObject.originalFilename,
              storedFilename: stored.storedObject.storedFilename,
              relativePath: null,
              storageProvider: null,
              extension: stored.storedObject.extension,
              sizeBytes: stored.storedObject.sizeBytes,
              checksum: stored.storedObject.checksum,
              thumbStatus: defaultThumbStatus,
              pageCountStatus: defaultPageCountStatus,
            }).returning();

            if (!created) throw new Error('Failed to create quote line item attachment link');
            return created;
          },
        });
      } else if (fileBuffer && resolvedUploadName) {
        canonicalUpload = await storageApplicationService.finalizeUpload({
          organizationId,
          createdByUserId: userId ?? null,
          requestedTarget,
          resource: {
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            lineItemId,
          },
          source: {
            kind: 'buffer',
            buffer: Buffer.from(fileBuffer, 'base64'),
            originalFilename: resolvedUploadName,
            mimeType: (mimeType || 'application/octet-stream') as string,
          },
          persistLink: async (tx, stored) => {
            const [created] = await tx.insert(quoteAttachments).values({
              ...baseAttachmentData,
              fileRecordId: stored.fileRecord.id,
              fileName: stored.storedObject.originalFilename,
              fileUrl: null,
              fileSize: stored.storedObject.sizeBytes,
              mimeType: stored.storedObject.mimeType,
              originalFilename: stored.storedObject.originalFilename,
              storedFilename: stored.storedObject.storedFilename,
              relativePath: null,
              storageProvider: null,
              extension: stored.storedObject.extension,
              sizeBytes: stored.storedObject.sizeBytes,
              checksum: stored.storedObject.checksum,
              thumbStatus: defaultThumbStatus,
              pageCountStatus: defaultPageCountStatus,
            }).returning();

            if (!created) throw new Error('Failed to create quote line item attachment link');
            return created;
          },
        });
      } else if (fileUrl && !isExternalUrl) {
        canonicalUpload = await storageApplicationService.finalizeUpload({
          organizationId,
          createdByUserId: userId ?? null,
          requestedTarget,
          resource: {
            organizationId,
            resourceType: 'quote',
            resourceId: quoteId,
            lineItemId,
          },
          source: {
            kind: 'existing-key',
            fileUrl: normalizeObjectKeyForDb(fileUrl),
            originalFilename: resolvedUploadName,
            mimeType: mimeType || null,
            fileSize: fileSize || null,
          },
          persistLink: async (tx, stored) => {
            const [created] = await tx.insert(quoteAttachments).values({
              ...baseAttachmentData,
              fileRecordId: stored.fileRecord.id,
              fileName: stored.storedObject.originalFilename,
              fileUrl: null,
              fileSize: stored.storedObject.sizeBytes,
              mimeType: stored.storedObject.mimeType,
              originalFilename: stored.storedObject.originalFilename,
              storedFilename: stored.storedObject.storedFilename,
              relativePath: null,
              storageProvider: null,
              extension: stored.storedObject.extension,
              sizeBytes: stored.storedObject.sizeBytes,
              checksum: stored.storedObject.checksum,
              thumbStatus: defaultThumbStatus,
              pageCountStatus: defaultPageCountStatus,
            }).returning();

            if (!created) throw new Error('Failed to create quote line item attachment link');
            return created;
          },
        });
      }

      console.log(`[LineItemFiles:POST] Inserting attachment with quoteLineItemId=${lineItemId}`);
      const attachment = canonicalUpload
        ? canonicalUpload.linkedRecord
        : (await db.insert(quoteAttachments).values({
            ...baseAttachmentData,
            fileRecordId: null,
            fileName: resolvedUploadName,
            originalFilename: resolvedUploadName,
            fileUrl,
            relativePath: null,
            fileSize: fileSize || null,
            mimeType: mimeType || null,
            storageProvider: undefined,
            thumbStatus: defaultThumbStatus,
            pageCountStatus: defaultPageCountStatus,
          }).returning())[0];

      const canonicalOriginal = attachment.fileRecordId
        ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
        : null;
      const canonicalStorageKey = canonicalOriginal?.objectKey ?? canonicalOriginal?.localPathRef ?? null;
      const canonicalStorageProvider = canonicalOriginal?.providerType
        ?? (canonicalOriginal?.localPathRef ? 'local_filesystem' : canonicalOriginal?.objectKey ? 'supabase' : null);

      // Best-effort self-check for Supabase-backed keys (non-blocking)
      if (canonicalStorageProvider === 'supabase' && canonicalStorageKey) {
        res.on('finish', () => {
          scheduleSupabaseObjectSelfCheck({
            bucket: 'titan-private',
            path: canonicalStorageKey,
            context: { attachmentType: 'quote', quoteId, lineItemId, attachmentId: attachment.id },
          });
        });
      }

      if (attachment.fileRecordId) {
        void import('../workers/thumbnailWorker')
          .then(({ triggerThumbnailGenerationForAttachment }) => {
            triggerThumbnailGenerationForAttachment({
              attachmentType: 'quote',
              attachmentId: String(attachment.id),
              reason: 'quote-line-item-file-upload',
            });
          })
          .catch((error) => {
            console.error('[LineItemFiles:POST] Failed to trigger thumbnail generation:', error);
          });
      }

      console.log(`[LineItemFiles:POST] Saved attachment storageProvider=${attachment.storageProvider || 'none'} storageKey=${attachment.fileUrl || 'null'}`);
      console.log(`[LineItemFiles:POST] Created attachment id=${attachment.id}, quoteLineItemId=${attachment.quoteLineItemId}`);

      // PHASE 2: Create asset + link (fail-soft: errors logged but don't block response)
      try {
        const { assetRepository } = await import('../services/assets/AssetRepository');
        const asset = await assetRepository.createAsset(organizationId, {
          fileRecordId: attachment.fileRecordId ?? null,
          fileKey: attachment.fileRecordId ? null : attachment.fileUrl,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType || undefined,
          sizeBytes: attachment.fileSize || undefined,
        });
        await assetRepository.linkAsset(organizationId, asset.id, 'quote_line_item', lineItemId, 'primary');
        console.log(`[LineItemFiles:POST] Created asset ${asset.id} + linked to quote_line_item ${lineItemId}`);
      } catch (assetError) {
        console.error(`[LineItemFiles:POST] Asset creation failed (non-blocking):`, assetError);
      }

      // Robust PDF detection using both mimeType and filename
      const attachmentFileName =
        (attachment.originalFilename ?? attachment.fileName ?? '').toString();

      const isPdfByMime = (attachment.mimeType ?? '').toLowerCase().includes('pdf');
      const isPdfByName = attachmentFileName.toLowerCase().endsWith('.pdf');
      const isPdf = isPdfByMime || isPdfByName;

      // Best-effort AI detection for PDF-compatible .ai files.
      // IMPORTANT: Do not treat all postscript as AI (avoid .eps); require .ai extension unless mime is explicitly illustrator.
      const lowerMimeType = (attachment.mimeType ?? '').toLowerCase();
      const isAiByName = attachmentFileName.toLowerCase().endsWith('.ai');
      const isAiByMime = /illustrator/i.test(lowerMimeType) || (/postscript/i.test(lowerMimeType) && isAiByName);
      const isAi = isAiByName || isAiByMime;

      const hasStorageProvider = !!canonicalStorageProvider;
      const isNotHttpUrl = !!canonicalStorageKey;

      console.log('[LineItemFiles:POST][Detect]', {
        attachmentId: attachment.id,
        fileName: attachmentFileName,
        mimeType: attachment.mimeType ?? null,
        storageProvider: canonicalStorageProvider ?? attachment.storageProvider ?? null,
        fileUrl: canonicalStorageKey ?? attachment.fileUrl ?? null,
        isPdfByMime,
        isPdfByName,
        isPdf,
        isAiByName,
        isAiByMime,
        isAi,
        hasStorageProvider,
        isNotHttpUrl,
        pdfColumnsExist,
      });

      // Fire-and-forget thumbnail generation for images (non-blocking)
      // Use isSupportedImageType helper which supports both mimeType and fileName-based detection
      const { isSupportedImageType } = await import('../services/thumbnailGenerator');
      const attachmentFileNameForThumb = attachment.originalFilename || attachment.fileName || null;
      const isSupportedImage = isSupportedImageType(attachment.mimeType, attachmentFileNameForThumb);

      if (isSupportedImage && hasStorageProvider && isNotHttpUrl && canonicalStorageKey && canonicalStorageProvider) {
        const { generateImageDerivatives, isThumbnailGenerationEnabled } = await import('../services/thumbnailGenerator');
        if (isThumbnailGenerationEnabled()) {
          void generateImageDerivatives(
            attachment.id,
            'quote',
            canonicalStorageKey,
            attachment.mimeType || null,
            canonicalStorageProvider,
            organizationId,
            attachmentFileNameForThumb
          ).catch((error) => {
            // Errors are already logged inside generateImageDerivatives
            // This catch prevents unhandled promise rejection
            console.error(`[LineItemFiles:POST] Thumbnail generation failed for ${attachment.id}:`, error);
          });
        } else {
          console.log(`[LineItemFiles:POST] Thumbnail generation disabled, skipping for ${attachment.id}`);
        }
      } else if (isSupportedImage && (!hasStorageProvider || !isNotHttpUrl)) {
        console.log(`[LineItemFiles:POST] Skipping thumbnail generation for ${attachment.id}: canonicalStorageProvider=${canonicalStorageProvider}, canonicalStorageKey=${canonicalStorageKey}`);
      }

      // Fire-and-forget PDF processing for PDFs (non-blocking)
      // Trigger AFTER response finishes to ensure upload completes successfully first
      // Normalize storageProvider: if missing but Supabase is configured and fileUrl starts with "uploads/", treat as supabase
      const normalizedStorageProvider = canonicalStorageProvider;

      if (isPdf || isAi) {
        if (!pdfColumnsExist) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but pdf columns missing; skipping processing for attachmentId=${attachment.id}`);
        } else if (!normalizedStorageProvider) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but storageProvider missing; skipping processing for attachmentId=${attachment.id}`);
        } else if (!isNotHttpUrl) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but fileUrl is http(s); skipping processing for attachmentId=${attachment.id}`);
        } else if (!canonicalStorageKey) {
          console.warn(`[LineItemFiles:POST] PDF/AI detected but fileUrl missing; skipping processing for attachmentId=${attachment.id}`);
        } else {
          console.log(`[LineItemFiles:POST] PDF/AI detected; queued processing for attachmentId=${attachment.id}, fileName=${attachmentFileName}`);
          const attachmentStorageKey = canonicalStorageKey;

          res.on("finish", () => {
            setImmediate(() => {
              void (async () => {
                try {
                  console.log(`[LineItemFiles:POST] Starting PDF processing for attachmentId=${attachment.id}`);
                  const { processPdfAttachmentDerivedData } = await import('../services/pdfProcessing');
                  await processPdfAttachmentDerivedData({
                    orgId: organizationId,
                    attachmentId: attachment.id,
                    storageKey: attachmentStorageKey,
                    storageProvider: normalizedStorageProvider,
                    mimeType: attachment.mimeType || null,
                  });
                } catch (error: any) {
                  // Errors are already logged inside processPdfAttachmentDerivedData
                  // This catch prevents unhandled promise rejection and server crashes
                  console.error(`[LineItemFiles:POST] PDF kickoff failed for ${attachment.id}:`, error);
                }
              })();
            });
          });
        }
      }

      const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
      res.json({ success: true, data: enrichedAttachment });
    } catch (error: any) {
      console.error("[LineItemFiles:POST] Error:", error);
      // Provide useful error message without leaking sensitive details
      const errorDetail = error.message?.substring(0, 200) || 'Unknown error';
      res.status(500).json({
        success: false,
        message: "Failed to attach file to line item",
        detail: errorDetail
      });
    }
  });

  // Delete attachment from a quote line item
  // Download a line item attachment (quote-scoped) - returns signed URL
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:DOWNLOAD] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate the line item belongs to this quote (access control)
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:DOWNLOAD] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get the attachment by fileId and lineItemId only (not quoteId) to support files
      // uploaded before quote persistence. Access control is via line item validation above.
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:DOWNLOAD] Attachment not found or access denied`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const resolved = await resolveOriginalFileAccess(attachment, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        return res.status(404).json({ success: false, error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      const signedUrl = resolved.downloadUrl;
      const fileName = resolved.displayFilename;

      console.log(`[LineItemFiles:DOWNLOAD] Generated signed URL for file ${fileId}, fileName: ${fileName}`);

      return res.json({ success: true, data: { signedUrl, fileName } });
    } catch (error: any) {
      console.error("[LineItemFiles:DOWNLOAD] Error:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to generate download URL" });
    }
  });

  // Proxy download endpoint - streams file with correct filename in Content-Disposition header
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/download/proxy", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate line item belongs to quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get attachment
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const resolved = await resolveOriginalFileAccess(attachment, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        return res.status(404).json({ error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      return res.redirect(resolved.downloadUrl);
    } catch (error: any) {
      console.error("[LineItemFiles:DOWNLOAD:PROXY] Error:", error);
      return res.status(500).json({ error: error.message || "Failed to download file" });
    }
  });

  // Get derived assets (thumbnails/previews) for an attachment - returns signed URLs
  app.get("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/assets", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:ASSETS] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate line item belongs to quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:ASSETS] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get attachment
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:ASSETS] Attachment not found or access denied`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const derivativeLogOnce = createRequestLogOnce();
      const [thumbAccess, previewAccess] = await Promise.all([
        resolveDerivativeFileAccess(attachment, "thumbnail", { logOnce: derivativeLogOnce }),
        resolveDerivativeFileAccess(attachment, "preview", { logOnce: derivativeLogOnce }),
      ]);

      console.log(`[LineItemFiles:ASSETS] Returning assets for file ${fileId}, thumbStatus=${attachment.thumbStatus}`);

      return res.json({
        success: true,
        data: {
          thumbUrl: thumbAccess.url,
          previewUrl: previewAccess.url,
          thumbStatus: attachment.thumbStatus || 'uploaded',
        },
      });
    } catch (error: any) {
      console.error("[LineItemFiles:ASSETS] Error:", error);
      return res.status(500).json({ error: error.message || "Failed to get attachment assets" });
    }
  });

  // Generate thumbnails for an attachment (explicit user action, images only)
  app.post("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/generate-thumbnails", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:GENERATE_THUMBS] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate line item belongs to quote
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ success: false, message: "Line item not found" });
      }

      // Get attachment
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Attachment not found or access denied`);
        return res.status(404).json({ success: false, message: "Attachment not found" });
      }

      // Import thumbnail generator utilities
      const thumbnailModule = await import('../services/thumbnailGenerator');
      const { generateImageDerivatives, isThumbnailGenerationEnabled, isSupportedImageType } = thumbnailModule;

      // Check feature flag
      if (!isThumbnailGenerationEnabled()) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Thumbnail generation disabled via THUMBNAILS_ENABLED env var`);
        return res.status(503).json({
          success: false,
          code: 'THUMBNAILS_UNAVAILABLE',
          error: "Thumbnail generation is currently disabled",
          message: "Thumbnail generation is disabled. Please enable it via THUMBNAILS_ENABLED environment variable."
        });
      }

      // Check sharp availability at runtime (same as thumbnailGenerator uses)
      const sharpAvailable = await thumbnailModule.ensureSharp();
      if (!sharpAvailable) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] sharp not available - returning 503`);
        return res.status(503).json({
          success: false,
          code: 'THUMBNAILS_UNAVAILABLE',
          error: "Thumbnail generation temporarily unavailable",
          message: "Thumbnail generation requires sharp package to be installed"
        });
      }

      // Handle PDFs - disabled (no pdfjs/canvas deps)
      if (attachment.mimeType === 'application/pdf') {
        console.log(`[LineItemFiles:GENERATE_THUMBS] PDF thumbnail generation disabled (no pdf deps)`);
        return res.status(501).json({
          success: false,
          message: "PDF thumbnails are disabled (no pdf deps installed yet)"
        });
      }

      // Check if it's a supported image type (uses mimeType and fileName fallback)
      const fileName = attachment.originalFilename || attachment.fileName || null;
      const isSupportedImage = isSupportedImageType(attachment.mimeType, fileName);

      if (!isSupportedImage) {
        console.log(`[LineItemFiles:GENERATE_THUMBS] Unsupported file type: mimeType=${attachment.mimeType}, fileName=${fileName}`);
        return res.status(400).json({
          success: false,
          message: "Unsupported file type for thumbnail generation"
        });
      }

      console.log(`[LineItemFiles:GENERATE_THUMBS] Supported image type detected: mimeType=${attachment.mimeType}, fileName=${fileName}`);

      const resolvedOriginal = attachment.fileRecordId
        ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
        : null;
      const attachmentStorageKey = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? attachment.fileUrl ?? null;
      const attachmentStorageProvider = resolvedOriginal?.providerType === 'local_filesystem'
        ? 'local'
        : resolvedOriginal?.providerType === 's3'
          ? 's3'
          : resolvedOriginal?.providerType === 'gcs'
            ? 'gcs'
            : resolvedOriginal?.providerType === 'azure_blob'
              ? 'azure_blob'
              : resolvedOriginal?.providerType === 'titan_managed'
                ? 'titan_managed'
                : resolvedOriginal?.providerType === 'supabase'
                  ? 'supabase'
                  : attachment.storageProvider ?? null;

      // Validate required fields for image generation
      if (!attachmentStorageKey || !attachmentStorageProvider) {
        return res.status(400).json({
          success: false,
          message: "Attachment missing required storage information"
        });
      }

      // Set status to pending
      await db.update(quoteAttachments)
        .set({
          thumbStatus: 'thumb_pending',
          thumbError: null,
          updatedAt: new Date(),
        })
        .where(eq(quoteAttachments.id, fileId));

      const attachmentFileName = attachment.originalFilename || attachment.fileName || null;
      console.log(`[LineItemFiles:GENERATE_THUMBS] Queuing thumbnail generation for ${fileId} (sharp available: ${sharpAvailable})`);

      // Trigger async thumbnail generation (fire-and-forget)
      void generateImageDerivatives(
        fileId,
        'quote',
        attachmentStorageKey,
        attachment.mimeType,
        attachmentStorageProvider,
        organizationId,
        attachmentFileName
      ).catch((error) => {
        // Errors are already logged inside generateImageDerivatives
        console.error(`[LineItemFiles:GENERATE_THUMBS] Thumbnail generation failed for ${fileId}:`, error);
      });

      // Return 202 immediately (processing queued)
      return res.status(202).json({
        success: true,
        message: "Thumbnail generation queued"
      });
    } catch (error: any) {
      console.error("[LineItemFiles:GENERATE_THUMBS] Error:", error);

      // Only update DB with failure if this was a real processing error (not unavailable/disabled)
      // For 503/unavailable errors, don't mark as failed since the feature is not available
      const isUnavailableError = error.code === 'THUMBNAILS_UNAVAILABLE' ||
        error.message?.includes('disabled') ||
        error.message?.includes('unavailable') ||
        error.statusCode === 503;

      if (!isUnavailableError) {
        try {
          const { fileId } = req.params;
          await db.update(quoteAttachments)
            .set({
              thumbStatus: 'thumb_failed',
              thumbError: error.message?.substring(0, 500) || 'Thumbnail generation failed',
              updatedAt: new Date(),
            })
            .where(eq(quoteAttachments.id, fileId));
        } catch (dbError) {
          console.error("[LineItemFiles:GENERATE_THUMBS] Failed to update error status:", dbError);
        }
      }

      // Return appropriate status code and format based on error type
      if (isUnavailableError) {
        return res.status(503).json({
          success: false,
          code: 'THUMBNAILS_UNAVAILABLE',
          error: "Thumbnail generation temporarily unavailable",
          message: error.message || "Thumbnail generation temporarily unavailable - dependencies not installed"
        });
      }

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to generate thumbnails"
      });
    }
  });

  // Generate PDF page thumbnails - TEMPORARILY DISABLED
  // Dependencies (pdfjs-dist, canvas) not yet installed
  app.post("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId/generate-pdf-thumbnails", isAuthenticated, tenantContext, async (req: any, res) => {
    return res.status(501).json({
      error: "PDF thumbnail generation temporarily unavailable",
      message: "Feature requires additional dependencies to be installed"
    });
  });

  // Download a line item attachment (temp line items) - returns signed URL
  app.get("/api/line-items/:lineItemId/files/:fileId/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      const userId = req.user.id;
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[LineItemFiles:DOWNLOAD:TEMP] lineItemId=${lineItemId}, fileId=${fileId}`);

      // Get the attachment and verify it belongs to a temp line item owned by this user
      const [attachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId),
          eq(quoteAttachments.uploadedByUserId, userId),
          isNull(quoteAttachments.quoteId) // Temp items have null quoteId
        ))
        .limit(1);

      if (!attachment) {
        console.log(`[LineItemFiles:DOWNLOAD:TEMP] Attachment not found or access denied`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const resolved = await resolveOriginalFileAccess(attachment, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        return res.status(404).json({ success: false, error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      const signedUrl = resolved.downloadUrl;

      console.log(`[LineItemFiles:DOWNLOAD:TEMP] Generated signed URL for file ${fileId}`);

      return res.json({ success: true, data: { signedUrl, fileName: resolved.displayFilename, availabilityStatus: resolved.availabilityStatus } });
    } catch (error: any) {
      console.error("[LineItemFiles:DOWNLOAD:TEMP] Error:", error);
      return res.status(500).json({ success: false, error: error.message || "Failed to generate download URL" });
    }
  });

  app.delete("/api/quotes/:quoteId/line-items/:lineItemId/files/:fileId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { quoteId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      // Validate quote belongs to org and enforce lock before any attachment deletes
      const [quote] = await db.select({ id: quotes.id, status: quotes.status }).from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      if (!assertQuoteEditable(res, quote)) return;

      console.log(`[LineItemFiles:DELETE] quoteId=${quoteId}, lineItemId=${lineItemId}, fileId=${fileId}`);

      // Validate the line item belongs to this quote (access control)
      const [lineItem] = await db.select().from(quoteLineItems)
        .where(and(
          eq(quoteLineItems.id, lineItemId),
          eq(quoteLineItems.quoteId, quoteId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[LineItemFiles:DELETE] Line item not found or doesn't belong to quote`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Get the attachment by fileId and lineItemId only (not quoteId) to support files
      // uploaded before quote persistence. Access control is via line item validation above.
      const [existingAttachment] = await db.select().from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.quoteLineItemId, lineItemId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .limit(1);

      if (!existingAttachment) {
        console.log(`[LineItemFiles:DELETE] Attachment not found or doesn't match params`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      const pagePagesTableState = hasQuoteAttachmentPagesTable();
      const pageDerivativeRows = pagePagesTableState === true
        ? await db
            .select({
              thumbFileRecordId: quoteAttachmentPages.thumbFileRecordId,
              thumbKey: quoteAttachmentPages.thumbKey,
              previewFileRecordId: quoteAttachmentPages.previewFileRecordId,
              previewKey: quoteAttachmentPages.previewKey,
            })
            .from(quoteAttachmentPages)
            .where(and(
              eq(quoteAttachmentPages.attachmentId, existingAttachment.id),
              eq(quoteAttachmentPages.organizationId, organizationId),
            ))
        : [];

      console.log('[LineItemFiles:DELETE] page derivative preload', {
        quoteId,
        lineItemId,
        attachmentId: existingAttachment.id,
        fileRecordId: existingAttachment.fileRecordId ?? null,
        pagesTableState: pagePagesTableState,
        pageDerivativeRowCount: pageDerivativeRows.length,
        pageDerivativeRows: pageDerivativeRows.map((row) => ({
          thumbFileRecordId: row.thumbFileRecordId ?? null,
          thumbKey: row.thumbKey ?? null,
          previewFileRecordId: row.previewFileRecordId ?? null,
          previewKey: row.previewKey ?? null,
        })),
      });

      // Delete from database (and validate it actually deleted)
      const deleted = await db.delete(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, fileId),
          eq(quoteAttachments.organizationId, organizationId)
        ))
        .returning({ id: quoteAttachments.id });

      if (!deleted.length) {
        console.log(`[LineItemFiles:DELETE] Delete affected 0 rows`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      console.log(`[LineItemFiles:DELETE] Deleted attachment id=${fileId}`);

      // Best-effort cleanup of stored objects and linked assets (do not fail request if cleanup fails)
      try {
        const resolvedOriginal = existingAttachment.fileRecordId
          ? await canonicalFileReadResolver.resolveOriginal(String(existingAttachment.fileRecordId))
          : null;
        const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? existingAttachment.fileUrl ?? '');
        const storageProvider = resolvedOriginal?.providerType === 'local_filesystem'
          ? 'local'
          : resolvedOriginal?.providerType === 's3'
            ? 's3'
            : resolvedOriginal?.providerType === 'gcs'
              ? 'gcs'
              : resolvedOriginal?.providerType === 'azure_blob'
                ? 'azure_blob'
                : resolvedOriginal?.providerType === 'titan_managed'
                  ? 'titan_managed'
                  : resolvedOriginal?.providerType === 'supabase'
                    ? 'supabase'
                    : ((existingAttachment.storageProvider as 'local' | 's3' | 'gcs' | 'supabase' | 'azure_blob' | 'titan_managed' | null | undefined) ?? null);

        if (storageKey) {
          const [{ quoteRefs = 0 } = {}] = existingAttachment.fileRecordId
            ? await db
                .select({ quoteRefs: sql<number>`count(*)` })
                .from(quoteAttachments)
                .where(
                  and(
                    eq(quoteAttachments.organizationId, organizationId),
                    eq(quoteAttachments.fileRecordId, String(existingAttachment.fileRecordId))
                  )
                )
            : !storageProvider
              ? [{ quoteRefs: 0 }]
              : await db
                  .select({ quoteRefs: sql<number>`count(*)` })
                  .from(quoteAttachments)
                  .where(
                    and(
                      eq(quoteAttachments.organizationId, organizationId),
                      eq(quoteAttachments.fileUrl, storageKey),
                      eq(quoteAttachments.storageProvider, toLegacyStorageProvider(storageProvider) ?? 'supabase')
                    )
                  );

          const [{ orderRefs = 0 } = {}] = existingAttachment.fileRecordId
            ? await db
                .select({ orderRefs: sql<number>`count(*)` })
                .from(orderAttachments)
                .where(eq(orderAttachments.fileRecordId, String(existingAttachment.fileRecordId)))
            : !storageProvider
              ? [{ orderRefs: 0 }]
              : await db
                  .select({ orderRefs: sql<number>`count(*)` })
                  .from(orderAttachments)
                  .where(
                    and(
                      eq(orderAttachments.fileUrl, storageKey),
                      eq(orderAttachments.storageProvider, toLegacyStorageProvider(storageProvider) ?? 'supabase')
                    )
                  );

          let hasRemainingAssetLinksForFile = false;
          const normalizedFileKey = normalizeObjectKeyForDb(storageKey);

          try {
            const matchingAssets = existingAttachment.fileRecordId
              ? await db
                  .select({ id: assets.id })
                  .from(assets)
                  .where(and(eq(assets.organizationId, organizationId), eq(assets.fileRecordId, String(existingAttachment.fileRecordId))))
              : await db
                  .select({ id: assets.id })
                  .from(assets)
                  .where(and(eq(assets.organizationId, organizationId), eq(assets.fileKey, normalizedFileKey)));

            if (matchingAssets.length > 0) {
              await Promise.all(
                matchingAssets.map((asset) =>
                  db
                    .delete(assetLinks)
                    .where(
                      and(
                        eq(assetLinks.organizationId, organizationId),
                        eq(assetLinks.assetId, asset.id),
                        eq(assetLinks.parentType, 'quote_line_item'),
                        eq(assetLinks.parentId, lineItemId)
                      )
                    )
                )
              );

          console.log('[LineItemFiles:DELETE] final cleanup gate', {
            quoteId,
            lineItemId,
            attachmentId: existingAttachment.id,
            fileRecordId: existingAttachment.fileRecordId ?? null,
            storageKey,
            storageProvider,
            quoteRefs: Number(quoteRefs),
            orderRefs: Number(orderRefs),
          });

              const linkCounts = await Promise.all(
                matchingAssets.map(async (asset) => {
                  const [{ cnt = 0 } = {}] = await db
                    .select({ cnt: sql<number>`count(*)` })
                    .from(assetLinks)
                    .where(and(eq(assetLinks.organizationId, organizationId), eq(assetLinks.assetId, asset.id)));
                  return Number(cnt);
                })
              );

              hasRemainingAssetLinksForFile = linkCounts.some((count) => count > 0);

              if (!hasRemainingAssetLinksForFile && Number(quoteRefs) + Number(orderRefs) === 0) {
                for (const asset of matchingAssets) {
                  const variants = await db
                    .select({ key: assetVariants.key })
                    .from(assetVariants)
                    .where(and(eq(assetVariants.organizationId, organizationId), eq(assetVariants.assetId, asset.id)));

                  await deleteStoredObjectKeysIfUnreferenced({
                    organizationId,
                    fileRecordId: existingAttachment.fileRecordId ? String(existingAttachment.fileRecordId) : null,
                    legacyStorageProvider: toLegacyStorageProvider(storageProvider),
                    keys: [...variants.map((variant) => variant.key || ''), normalizedFileKey],
                    exclusions: { assetIds: [asset.id] },
                    logContext: {
                      route: "quote-line-item-attachment-delete",
                      quoteId,
                      lineItemId,
                      attachmentId: existingAttachment.id,
                      assetId: asset.id,
                    },
                  });

                  await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, asset.id)));
                }
              }
            }
          } catch (assetCleanupError) {
            console.error('[LineItemFiles:DELETE] Asset cleanup failed (non-blocking):', assetCleanupError);
          }

          if (Number(quoteRefs) + Number(orderRefs) === 0 && !hasRemainingAssetLinksForFile && storageProvider) {
            const derivativeRows = existingAttachment.fileRecordId
              ? await fileDerivativeRepository.listByFileRecordId(String(existingAttachment.fileRecordId))
              : [];
            const derivativeKeys = existingAttachment.fileRecordId
              ? derivativeRows.map((row) => row.objectKey ?? null)
              : [existingAttachment.thumbnailRelativePath ?? existingAttachment.thumbKey ?? null, existingAttachment.previewKey ?? null];

            const derivativeDeletion = await deleteStoredObjectKeysIfUnreferenced({
              organizationId,
              fileRecordId: existingAttachment.fileRecordId ? String(existingAttachment.fileRecordId) : null,
              legacyStorageProvider: toLegacyStorageProvider(storageProvider),
              keys: [storageKey, ...derivativeKeys],
              logContext: {
                route: "quote-line-item-attachment-delete",
                quoteId,
                lineItemId,
                attachmentId: existingAttachment.id,
              },
            });

            console.log('[LineItemFiles:DELETE] top-level derivative cleanup result', {
              quoteId,
              lineItemId,
              attachmentId: existingAttachment.id,
              keys: [storageKey, ...derivativeKeys],
              deletedKeys: derivativeDeletion.deletedKeys,
              failedKeys: derivativeDeletion.failedKeys,
            });

            for (const pageDerivativeRow of pageDerivativeRows) {
              const pageDerivativeCandidates = [
                {
                  fileRecordId: pageDerivativeRow.thumbFileRecordId,
                  fallbackKey: pageDerivativeRow.thumbKey,
                },
                {
                  fileRecordId: pageDerivativeRow.previewFileRecordId,
                  fallbackKey: pageDerivativeRow.previewKey,
                },
              ];

              for (const candidate of pageDerivativeCandidates) {
                const fileRecordId = candidate.fileRecordId ? String(candidate.fileRecordId) : null;
                const resolvedPageOriginal = fileRecordId
                  ? await canonicalFileReadResolver.resolveOriginal(fileRecordId)
                  : null;
                const pageStorageKey = resolvedPageOriginal?.objectKey ?? resolvedPageOriginal?.localPathRef ?? candidate.fallbackKey ?? null;
                console.log('[LineItemFiles:DELETE] page derivative candidate', {
                  quoteId,
                  lineItemId,
                  attachmentId: existingAttachment.id,
                  fileRecordId,
                  fallbackKey: candidate.fallbackKey ?? null,
                  resolvedPageStorageKey: pageStorageKey,
                  resolvedProviderType: resolvedPageOriginal?.providerType ?? null,
                  resolvedStatus: resolvedPageOriginal?.status ?? null,
                });
                if (!pageStorageKey) {
                  console.warn('[LineItemFiles:DELETE] page derivative key missing; skipping physical delete', {
                    quoteId,
                    lineItemId,
                    attachmentId: existingAttachment.id,
                    fileRecordId,
                    fallbackKey: candidate.fallbackKey ?? null,
                  });
                  continue;
                }

                const pageDeletion = await deleteStoredObjectKeysIfUnreferenced({
                  organizationId,
                  fileRecordId,
                  legacyStorageProvider: toLegacyStorageProvider(storageProvider),
                  keys: [pageStorageKey],
                  logContext: {
                    route: "quote-line-item-page-derivative-delete",
                    quoteId,
                    lineItemId,
                    attachmentId: existingAttachment.id,
                  },
                });

                console.log('[LineItemFiles:DELETE] page derivative delete result', {
                  quoteId,
                  lineItemId,
                  attachmentId: existingAttachment.id,
                  fileRecordId,
                  pageStorageKey,
                  deletedKeys: pageDeletion.deletedKeys,
                  failedKeys: pageDeletion.failedKeys,
                });

                if (fileRecordId && !pageDeletion.skipped && pageDeletion.failedKeys.length === 0) {
                  await fileRecordRepository.deleteById(fileRecordId);
                } else if (fileRecordId && (pageDeletion.skipped || pageDeletion.failedKeys.length > 0)) {
                  console.warn('[LineItemFiles:DELETE] Skipped page derivative fileRecord cleanup due to storage delete failures', {
                    fileRecordId,
                    failedKeys: pageDeletion.failedKeys,
                    skipped: pageDeletion.skipped,
                    reason: pageDeletion.reason ?? null,
                  });
                }
              }
            }

            if (existingAttachment.fileRecordId && !derivativeDeletion.skipped && derivativeDeletion.failedKeys.length === 0) {
              await fileDerivativeRepository.deleteByFileRecordId(String(existingAttachment.fileRecordId));
            } else if (existingAttachment.fileRecordId && (derivativeDeletion.skipped || derivativeDeletion.failedKeys.length > 0)) {
              console.warn('[LineItemFiles:DELETE] Skipped derivative row cleanup due to storage delete failures', {
                fileRecordId: String(existingAttachment.fileRecordId),
                failedKeys: derivativeDeletion.failedKeys,
                skipped: derivativeDeletion.skipped,
                reason: derivativeDeletion.reason ?? null,
              });
            }
          }
        }
      } catch {
        // ignore
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[LineItemFiles:DELETE] Error:", error);
      res.status(500).json({ error: "Failed to delete line item file" });
    }
  });
}
