/**
 * orderLineItemFiles.routes.ts
 *
 * Order Line Item File routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/orders/:orderId/line-items/:lineItemId/files
 *   POST   /api/orders/:orderId/line-items/:lineItemId/files
 *   DELETE /api/orders/:orderId/line-items/:lineItemId/files/:fileId
 *
 * Placement: server/routes/orderLineItemFiles.routes.ts
 * Registered by: server/routes.ts via registerOrderLineItemFileRoutes
 */

import type { Express } from "express";
import { eq, and, desc, sql, or } from "drizzle-orm";
import { db } from "../db";
import {
  orders,
  orderLineItems,
  orderAttachments,
  quoteAttachments,
  assets,
  assetLinks,
  assetVariants,
  lineItemFiles,
} from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  normalizeObjectKeyForDb,
} from "../lib/supabaseObjectHelpers";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { createLineItemFileRecord } from "../services/lineItemFileRecordService";
import { deleteStoredObjectKeys } from "../services/storage/deleteStoredObjectKeys";
import { fileDerivativeRepository } from "../storage/fileDerivative.repo";
import { autoSyncCanonicalProofForLineItem } from "../services/proofingService";
import { getFileUploadNamingPolicy } from "../prepressFileService";
import { withOrderOriginalArtworkDisplayFilename } from "../services/originalArtworkFiles";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function toLegacyStorageProvider(provider: string | null | undefined): "local" | "s3" | "gcs" | "supabase" | null {
  if (provider === "local" || provider === "s3" || provider === "gcs" || provider === "supabase") {
    return provider;
  }
  return null;
}

export function registerOrderLineItemFileRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  // ===== ORDER LINE ITEM FILE ROUTES =====

  // Get files for an order line item (mirroring quote line item pattern)
  app.get("/api/orders/:orderId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { orderId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[OrderLineItemFiles:GET] orderId=${orderId}, lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Validate the order belongs to the organization
      const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) {
        console.log(`[OrderLineItemFiles:GET] Order not found or doesn't belong to organization`);
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate the line item exists and belongs to this order
      const [lineItem] = await db.select().from(orderLineItems)
        .where(and(
          eq(orderLineItems.id, lineItemId),
          eq(orderLineItems.orderId, orderId)
        ))
        .limit(1);

      if (!lineItem) {
        console.log(`[OrderLineItemFiles:GET] Line item not found or doesn't belong to order`);
        return res.status(404).json({ error: "Line item not found" });
      }

      // Query attachments by orderLineItemId (no direct organizationId column, validated via order)
      const files = await db.select().from(orderAttachments)
        .where(eq(orderAttachments.orderLineItemId, lineItemId))
        .orderBy(desc(orderAttachments.createdAt));

      // Enrich each attachment with signed URLs
      const logOnce = createRequestLogOnce();
      const namingPolicy = await getFileUploadNamingPolicy(organizationId);
      const enrichedFiles = await Promise.all(files.map((f) =>
        enrichAttachmentWithUrls(withOrderOriginalArtworkDisplayFilename(f, {
          orderNumber: order.orderNumber,
          namingPolicy,
        }), { logOnce })
      ));

      // PHASE 2: Include linked assets with enriched URLs
      const { assetRepository } = await import('../services/assets/AssetRepository');
      const { enrichAssetsWithRoles } = await import('../services/assets/enrichAssetWithUrls');
      const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'order_line_item', lineItemId);
      const enrichedAssets = (await enrichAssetsWithRoles(linkedAssets)).map((asset: any) =>
        withOrderOriginalArtworkDisplayFilename(asset, {
          orderNumber: order.orderNumber,
          namingPolicy,
        })
      );

      console.log(`[OrderLineItemFiles:GET] Found ${files.length} files + ${linkedAssets.length} assets for line item ${lineItemId}`);
      res.json({ success: true, data: enrichedFiles, assets: enrichedAssets });
    } catch (error) {
      console.error("[OrderLineItemFiles:GET] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Upload file to an order line item (asset pipeline, multipart upload)
  app.post("/api/orders/:orderId/line-items/:lineItemId/files", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { orderId, lineItemId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      console.log(`[OrderLineItemFiles:POST] orderId=${orderId}, lineItemId=${lineItemId}, orgId=${organizationId}`);

      // Validate the order belongs to the organization
      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate the line item exists and belongs to this order
      const [lineItem] = await db.select({ id: orderLineItems.id }).from(orderLineItems)
        .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)))
        .limit(1);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const contentType = String(req.headers['content-type'] || '');
      if (!contentType.includes('application/json')) {
        console.log(`[OrderLineItemFiles:POST] mode=unsupported contentType=${contentType}`);
        return res.status(415).json({
          success: false,
          error: 'Unsupported content type',
          message: 'This endpoint only supports application/json',
        });
      }

      console.log('[OrderLineItemFiles:POST] mode=json');

      const normalizeRole = (raw: any): string => {
        const val = String(raw || '').toLowerCase();
        return ['primary', 'attachment', 'proof', 'reference', 'other'].includes(val) ? val : 'primary';
      };

      const guessFileNameFromKey = (key: string): string => {
        const last = key.split('/').filter(Boolean).pop();
        return last || 'upload';
      };

      const normalizeStorageKeyFromAny = (raw: any): string | null => {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;

        // Accept either raw object key (uploads/...) or /objects/{key}
        const keyFromObjectsPrefix = trimmed.startsWith('/objects/')
          ? trimmed.replace(/^\/objects\//, '')
          : trimmed;

        // Assets expect storage keys (uploads/...), not http(s) URLs.
        if (keyFromObjectsPrefix.startsWith('http://') || keyFromObjectsPrefix.startsWith('https://')) return null;

        return normalizeObjectKeyForDb(keyFromObjectsPrefix);
      };

      type AttachCandidate =
        | {
            kind: 'existing-file-record';
            dedupeKey: string;
            fileKey: string;
            fileRecordId: string;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
            role?: string;
          }
        | {
            kind: 'existing-key';
            dedupeKey: string;
            fileKey: string;
            fileRecordId?: null;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
            role?: string;
          }
        | {
            kind: 'upload-session';
            dedupeKey: string;
            uploadId: string;
            fileName?: string;
            mimeType?: string;
            sizeBytes?: number;
            role?: string;
          };

      const body = req.body ?? {};
      const requestedTarget =
        (typeof body.requestedStorageTarget === 'string' ? body.requestedStorageTarget : null) ||
        (typeof body.storageTarget === 'string' ? body.storageTarget : null);
      const candidates: AttachCandidate[] = [];

      // 1) Preferred (current UI): fileName + fileUrl + optional metadata
      const singleKey = normalizeStorageKeyFromAny(body.fileUrl ?? body.fileKey ?? body.path ?? body.objectId);
      if (singleKey) {
        const singleFileRecordId = typeof body.fileRecordId === 'string' ? body.fileRecordId : null;
        candidates.push({
          kind: singleFileRecordId ? 'existing-file-record' : 'existing-key',
          dedupeKey: singleFileRecordId ? `file-record:${singleFileRecordId}` : `key:${singleKey}`,
          fileKey: singleKey,
          fileRecordId: singleFileRecordId,
          fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
          mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
          sizeBytes: body.fileSize != null ? Number(body.fileSize) : (body.sizeBytes != null ? Number(body.sizeBytes) : undefined),
          role: normalizeRole(body.role),
        });
      }

      // 2) Array form: files: [{ fileName, fileUrl/path/objectId, ... }]
      if (Array.isArray(body.files)) {
        for (const f of body.files) {
          const k = normalizeStorageKeyFromAny(f?.fileUrl ?? f?.fileKey ?? f?.path ?? f?.objectId);
          if (!k) continue;
          const candidateFileRecordId = typeof f?.fileRecordId === 'string' ? f.fileRecordId : null;
          candidates.push({
            kind: candidateFileRecordId ? 'existing-file-record' : 'existing-key',
            dedupeKey: candidateFileRecordId ? `file-record:${candidateFileRecordId}` : `key:${k}`,
            fileKey: k,
            fileRecordId: candidateFileRecordId,
            fileName: typeof f?.fileName === 'string' ? f.fileName : (typeof f?.originalFilename === 'string' ? f.originalFilename : undefined),
            mimeType: typeof f?.mimeType === 'string' ? f.mimeType : undefined,
            sizeBytes: f?.fileSize != null ? Number(f.fileSize) : (f?.sizeBytes != null ? Number(f.sizeBytes) : undefined),
            role: normalizeRole(f?.role ?? body.role),
          });
        }
      }

      // 3) Key list forms: objectIds/objectKeys/paths/keys (string[])
      const keyLists: any[] = [body.objectIds, body.objectKeys, body.paths, body.keys];
      for (const list of keyLists) {
        if (!Array.isArray(list)) continue;
        for (const rawKey of list) {
          const k = normalizeStorageKeyFromAny(rawKey);
          if (!k) continue;
          candidates.push({
            kind: 'existing-key',
            dedupeKey: `key:${k}`,
            fileKey: k,
            role: normalizeRole(body.role),
          });
        }
      }

      // 4) Chunked upload ids (if provided): uploadId/uploadIds
      const uploadIds: string[] = [];
      if (typeof body.uploadId === 'string' && body.uploadId.trim()) uploadIds.push(body.uploadId.trim());
      if (Array.isArray(body.uploadIds)) {
        for (const id of body.uploadIds) {
          if (typeof id === 'string' && id.trim()) uploadIds.push(id.trim());
        }
      }
      if (uploadIds.length > 0) {
        for (const uploadId of uploadIds) {
          candidates.push({
            kind: 'upload-session',
            dedupeKey: `upload:${uploadId}`,
            uploadId,
            role: normalizeRole(body.role),
          });
        }
      }

      // De-dupe by fileKey
      const uniqueCandidates = Array.from(
        new Map(candidates.map((c) => [c.dedupeKey, c])).values()
      );

      if (uniqueCandidates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing file identifiers',
          message: 'Provide fileUrl/path/objectId, files[], objectIds[], or uploadId/uploadIds.',
        });
      }

      const { assetRepository } = await import('../services/assets/AssetRepository');
      const { assetPreviewGenerator } = await import('../services/assets/AssetPreviewGenerator');
      const { enrichAssetWithUrls } = await import('../services/assets/enrichAssetWithUrls');

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;

      console.log(`[OrderLineItemFiles:POST] Attaching ${uniqueCandidates.length} object(s) to order_line_item ${lineItemId}`);

      const createdAssets: any[] = [];
      for (const c of uniqueCandidates) {
        const finalized: Awaited<ReturnType<typeof storageApplicationService.finalizeUpload<any>>> | null = c.kind === 'upload-session'
          ? await storageApplicationService.finalizeUpload({
              organizationId,
              createdByUserId: userId ?? null,
              requestedTarget,
              resource: {
                organizationId,
                resourceType: 'order',
                resourceId: orderId,
                lineItemId,
              },
              source: {
                kind: 'upload-session',
                uploadId: c.uploadId,
                expectedPurpose: 'order-attachment',
                expectedParentId: orderId,
              },
              persistLink: async (tx, stored) => {
                const [created] = await tx.insert(assets).values({
                  organizationId,
                  fileRecordId: stored.fileRecord.id,
                  fileKey: null,
                  fileName: stored.storedObject.originalFilename,
                  mimeType: stored.storedObject.mimeType,
                  sizeBytes: stored.storedObject.sizeBytes,
                }).returning();
                if (!created) throw new Error('Failed to create order line item asset');
                return created;
              },
            })
          : c.kind === 'existing-key'
            ? await storageApplicationService.finalizeUpload({
                organizationId,
              createdByUserId: userId ?? null,
                requestedTarget,
                resource: {
                  organizationId,
                  resourceType: 'order',
                  resourceId: orderId,
                  lineItemId,
                },
                source: {
                  kind: 'existing-key',
                  fileUrl: c.fileKey,
                  originalFilename: c.fileName || guessFileNameFromKey(c.fileKey),
                  mimeType: c.mimeType || null,
                  fileSize: c.sizeBytes || null,
                },
                persistLink: async (tx, stored) => {
                  const [created] = await tx.insert(assets).values({
                    organizationId,
                    fileRecordId: stored.fileRecord.id,
                    fileKey: null,
                    fileName: stored.storedObject.originalFilename,
                    mimeType: stored.storedObject.mimeType,
                    sizeBytes: stored.storedObject.sizeBytes,
                  }).returning();
                  if (!created) throw new Error('Failed to create order line item asset');
                  return created;
                },
              })
            : null;

          const candidateFileRecordId = c.kind === 'existing-file-record' ? c.fileRecordId : null;
          const candidateFileKey = c.kind === 'upload-session' ? null : c.fileKey;
          const candidateFileName = c.kind === 'upload-session'
            ? (c.fileName || 'upload')
            : (c.fileName || guessFileNameFromKey(c.fileKey));

          const asset: any = finalized?.linkedRecord ?? await assetRepository.createAsset(organizationId, {
            fileRecordId: candidateFileRecordId,
            fileKey: c.kind === 'existing-file-record' ? null : candidateFileKey,
            fileName: candidateFileName,
            mimeType: c.mimeType,
            sizeBytes: c.sizeBytes,
          } as any);

        await assetRepository.linkAsset(organizationId, asset.id, 'order_line_item', lineItemId, normalizeRole(c.role) as any);

        const resolvedOriginal = asset.fileRecordId
          ? await canonicalFileReadResolver.resolveOriginal(String(asset.fileRecordId))
          : null;
        const storagePath = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? candidateFileKey;

        if (userId && storagePath) {
          await createLineItemFileRecord({
            organizationId,
            orderId,
            lineItemId,
            role: 'original',
            storagePath,
            storageKey: storagePath,
            storageBucket: null,
            originalFilename: asset.fileName || candidateFileName,
            mimeType: asset.mimeType || c.mimeType || null,
            sizeBytes: asset.sizeBytes ?? c.sizeBytes ?? null,
            fileRecordId: asset.fileRecordId ?? candidateFileRecordId,
            uploadedByUserId: userId,
          });
        }

        setImmediate(() => {
          assetPreviewGenerator.generatePreviews(asset).catch((err) => {
            console.error('[AssetPreviewGenerator] async generatePreviews failed', err);
          });
        });
        createdAssets.push({ ...(await enrichAssetWithUrls(asset)), role: normalizeRole(c.role) });

        try {
          await storage.createOrderAuditLog({
            orderId,
            userId,
            userName,
            actionType: 'file_attached',
            fromStatus: null,
            toStatus: null,
            note: null,
            metadata: {
              structuredEvent: {
                eventType: 'file.attached',
                entityType: 'line_item',
                entityId: String(lineItemId),
                displayLabel: `Line item ${lineItemId}`,
                fieldKey: 'file',
                fromValue: null,
                toValue: asset.fileName,
                actorUserId: userId ?? null,
                createdAt: new Date().toISOString(),
                metadata: {
                  orderId,
                  lineItemId,
                  assetId: asset.id,
                  fileName: asset.fileName,
                  fileSizeBytes: asset.sizeBytes ?? c.sizeBytes ?? null,
                  mimeType: asset.mimeType ?? c.mimeType ?? null,
                  storageProvider: requestedTarget ?? null,
                  fileKey: resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? asset.fileKey ?? null,
                  role: normalizeRole(c.role),
                },
              },
            },
          });
        } catch (err) {
          console.warn('[OrderLineItemFiles:POST] audit log failed', err);
        }
      }
      if (userId) {
        try {
          await db.transaction((tx) =>
            autoSyncCanonicalProofForLineItem(tx, {
              organizationId,
              lineItemId,
              actorUserId: userId,
              reason: "artwork_saved",
            }),
          );
        } catch (proofSyncError) {
          console.error("[OrderLineItemFiles:POST] Auto proof sync failed (non-fatal)", proofSyncError);
        }
      }

      return res.json({
        success: true,
        data: [],
        assets: createdAssets,
        message: 'File attached',
      });
    } catch (error: any) {
      console.error("[OrderLineItemFiles:POST] Error:", error);
      res.status(500).json({ error: "Failed to upload line item file" });
    }
  });

  // Delete (unlink) a line item file (asset) from an order line item
  app.delete("/api/orders/:orderId/line-items/:lineItemId/files/:fileId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const { orderId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!order) return res.status(404).json({ error: 'Order not found' });

      const [li] = await db.select({ id: orderLineItems.id }).from(orderLineItems)
        .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)))
        .limit(1);

      if (!li) return res.status(404).json({ error: 'Line item not found' });

      // First try: DB-backed order attachments (some legacy/alternate UIs store these here)
      const deletedAttachment = await db.delete(orderAttachments)
        .where(and(
          eq(orderAttachments.id, fileId),
          eq(orderAttachments.orderId, orderId),
          eq(orderAttachments.orderLineItemId, lineItemId)
        ))
        .returning({
          id: orderAttachments.id,
          fileRecordId: orderAttachments.fileRecordId,
          storageProvider: orderAttachments.storageProvider,
          fileUrl: orderAttachments.fileUrl,
          relativePath: orderAttachments.relativePath,
          thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
        });

      if (deletedAttachment.length) {
        const record = deletedAttachment[0];
        try {
          const resolvedOriginal = record.fileRecordId
            ? await canonicalFileReadResolver.resolveOriginal(String(record.fileRecordId))
            : null;
          const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? record.relativePath ?? record.fileUrl ?? '');
          const effectiveStorageProvider = resolvedOriginal?.localPathRef
            ? 'local'
            : resolvedOriginal?.objectKey
              ? 'supabase'
              : record.storageProvider;

          if (storageKey) {
            const [{ orderRefs = 0 } = {}] = record.fileRecordId
              ? await db
                  .select({ orderRefs: sql<number>`count(*)` })
                  .from(orderAttachments)
                  .where(eq(orderAttachments.fileRecordId, String(record.fileRecordId)))
              : !effectiveStorageProvider
                ? [{ orderRefs: 0 }]
                : await db
                    .select({ orderRefs: sql<number>`count(*)` })
                    .from(orderAttachments)
                    .where(
                      and(
                        eq(orderAttachments.fileUrl, storageKey),
                        eq(orderAttachments.storageProvider, toLegacyStorageProvider(effectiveStorageProvider) ?? 'supabase')
                      )
                    );

            const [{ quoteRefs = 0 } = {}] = record.fileRecordId
              ? await db
                  .select({ quoteRefs: sql<number>`count(*)` })
                  .from(quoteAttachments)
                  .where(
                    and(
                      eq(quoteAttachments.organizationId, organizationId),
                      eq(quoteAttachments.fileRecordId, String(record.fileRecordId))
                    )
                  )
              : !effectiveStorageProvider
                ? [{ quoteRefs: 0 }]
                : await db
                    .select({ quoteRefs: sql<number>`count(*)` })
                    .from(quoteAttachments)
                    .where(
                      and(
                        eq(quoteAttachments.organizationId, organizationId),
                        eq(quoteAttachments.fileUrl, storageKey),
                        eq(quoteAttachments.storageProvider, toLegacyStorageProvider(effectiveStorageProvider) ?? 'supabase')
                      )
                    );

            let hasRemainingAssetLinksForFile = false;
            const normalizedFileKey = normalizeObjectKeyForDb(storageKey);

            try {
              const matchingAssets = record.fileRecordId
                ? await db
                    .select({ id: assets.id })
                    .from(assets)
                    .where(and(eq(assets.organizationId, organizationId), eq(assets.fileRecordId, String(record.fileRecordId))))
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
                          eq(assetLinks.parentType, 'order_line_item'),
                          eq(assetLinks.parentId, String(lineItemId))
                        )
                      )
                  )
                );

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

                if (!hasRemainingAssetLinksForFile && Number(orderRefs) + Number(quoteRefs) === 0) {
                  for (const asset of matchingAssets) {
                    const variants = await db
                      .select({ key: assetVariants.key })
                      .from(assetVariants)
                      .where(and(eq(assetVariants.organizationId, organizationId), eq(assetVariants.assetId, asset.id)));

                    await deleteStoredObjectKeys({
                      fileRecordId: record.fileRecordId ? String(record.fileRecordId) : null,
                      legacyStorageProvider: toLegacyStorageProvider(effectiveStorageProvider),
                      keys: [...variants.map((variant) => variant.key || ''), normalizedFileKey],
                    });

                    await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, asset.id)));
                  }
                }
              }
            } catch (assetCleanupError) {
              console.error('[OrderLineItemFiles:DELETE] Asset cleanup failed (non-blocking):', assetCleanupError);
            }

            if (record.fileRecordId || storageKey) {
              await db
                .update(lineItemFiles)
                .set({ status: 'superseded' })
                .where(
                  and(
                    eq(lineItemFiles.organizationId, organizationId),
                    eq(lineItemFiles.orderId, orderId),
                    eq(lineItemFiles.lineItemId, lineItemId),
                    eq(lineItemFiles.status, 'active'),
                    record.fileRecordId
                      ? eq(lineItemFiles.fileRecordId, String(record.fileRecordId))
                      : or(eq(lineItemFiles.storagePath, storageKey), eq(lineItemFiles.storageKey, storageKey))!
                  )
                );
            }

            if (Number(orderRefs) + Number(quoteRefs) === 0 && !hasRemainingAssetLinksForFile && effectiveStorageProvider) {
              const derivativeRows = record.fileRecordId
                ? await fileDerivativeRepository.listByFileRecordId(String(record.fileRecordId))
                : [];
              const derivativeKeys = record.fileRecordId
                ? derivativeRows.map((row) => row.objectKey ?? null)
                : [record.thumbnailRelativePath ?? record.thumbKey ?? null, record.previewKey ?? null];

              const derivativeDeletion = await deleteStoredObjectKeys({
                fileRecordId: record.fileRecordId ? String(record.fileRecordId) : null,
                legacyStorageProvider: effectiveStorageProvider,
                keys: [storageKey, ...derivativeKeys],
              });

              if (record.fileRecordId && derivativeDeletion.failedKeys.length === 0) {
                await fileDerivativeRepository.deleteByFileRecordId(String(record.fileRecordId));
              } else if (record.fileRecordId && derivativeDeletion.failedKeys.length > 0) {
                console.warn('[OrderLineItemFiles:DELETE] Skipped derivative row cleanup due to storage delete failures', {
                  fileRecordId: String(record.fileRecordId),
                  failedKeys: derivativeDeletion.failedKeys,
                });
              }
            }
          }
        } catch {
          // ignore
        }

        try {
          const userId = getUserId(req.user);
          const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;
          await storage.createOrderAuditLog({
            orderId,
            userId,
            userName,
            actionType: 'file_removed',
            fromStatus: null,
            toStatus: null,
            note: null,
            metadata: {
              structuredEvent: {
                eventType: 'file.removed',
                entityType: 'line_item',
                entityId: String(lineItemId),
                displayLabel: `Line item ${lineItemId}`,
                fieldKey: 'file',
                fromValue: record.fileUrl || record.relativePath || null,
                toValue: null,
                actorUserId: userId ?? null,
                createdAt: new Date().toISOString(),
                metadata: {
                  orderId,
                  lineItemId,
                  attachmentId: record.id,
                  storageProvider: record.storageProvider || null,
                  fileKey:
                    record.relativePath || record.fileUrl || null,
                },
              },
            },
          });
        } catch (err) {
          console.warn('[OrderLineItemFiles:DELETE] audit log failed', err);
        }

        const userId = getUserId(req.user);
        if (userId) {
          try {
            await db.transaction((tx) =>
              autoSyncCanonicalProofForLineItem(tx, {
                organizationId,
                lineItemId,
                actorUserId: userId,
                reason: "artwork_deleted",
              }),
            );
          } catch (proofSyncError) {
            console.error("[OrderLineItemFiles:DELETE] Auto proof sync failed after attachment delete (non-fatal)", proofSyncError);
          }
        }

        return res.json({ success: true });
      }

      // Second try: asset pipeline link unlink (validate link existed first)
      const { assetLinks: importedAssetLinks, assets: importedAssets } = await import('@shared/schema');
      const existingLink = await db.select({ id: importedAssetLinks.id }).from(importedAssetLinks)
        .where(and(
          eq(importedAssetLinks.organizationId, organizationId),
          eq(importedAssetLinks.assetId, fileId),
          eq(importedAssetLinks.parentType, 'order_line_item'),
          eq(importedAssetLinks.parentId, String(lineItemId))
        ))
        .limit(1);

      if (!existingLink.length) {
        return res.status(404).json({ error: 'File not found' });
      }

      const { assetRepository } = await import('../services/assets/AssetRepository');

      let removedAsset: any = null;
      try {
        removedAsset = await db
          .select({
            id: importedAssets.id,
            fileRecordId: importedAssets.fileRecordId,
            fileName: importedAssets.fileName,
            fileKey: importedAssets.fileKey,
            mimeType: importedAssets.mimeType,
            sizeBytes: importedAssets.sizeBytes,
          })
          .from(importedAssets)
          .where(and(eq(importedAssets.organizationId, organizationId), eq(importedAssets.id, fileId)))
          .limit(1)
          .then((rows) => rows[0]);
      } catch {
        removedAsset = null;
      }

      await assetRepository.unlinkAsset(organizationId, fileId, 'order_line_item', lineItemId);

      try {
        const resolvedOriginal = removedAsset?.fileRecordId
          ? await canonicalFileReadResolver.resolveOriginal(String(removedAsset.fileRecordId))
          : null;
        const storageKey = resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? removedAsset?.fileKey ?? null;

        if (removedAsset?.fileRecordId || storageKey) {
          await db
            .update(lineItemFiles)
            .set({ status: 'superseded' })
            .where(
              and(
                eq(lineItemFiles.organizationId, organizationId),
                eq(lineItemFiles.orderId, orderId),
                eq(lineItemFiles.lineItemId, lineItemId),
                eq(lineItemFiles.status, 'active'),
                removedAsset?.fileRecordId
                  ? eq(lineItemFiles.fileRecordId, String(removedAsset.fileRecordId))
                  : or(eq(lineItemFiles.storagePath, String(storageKey)), eq(lineItemFiles.storageKey, String(storageKey)))!
              )
            );
        }
      } catch (lineItemFileCleanupError) {
        console.warn('[OrderLineItemFiles:DELETE] line_item_files cleanup failed', lineItemFileCleanupError);
      }

      try {
        const userId = getUserId(req.user);
        const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;
        await storage.createOrderAuditLog({
          orderId,
          userId,
          userName,
          actionType: 'file_removed',
          fromStatus: null,
          toStatus: null,
          note: null,
          metadata: {
            structuredEvent: {
              eventType: 'file.removed',
              entityType: 'line_item',
              entityId: String(lineItemId),
              displayLabel: `Line item ${lineItemId}`,
              fieldKey: 'file',
              fromValue: removedAsset?.fileName || fileId,
              toValue: null,
              actorUserId: userId ?? null,
              createdAt: new Date().toISOString(),
              metadata: {
                orderId,
                lineItemId,
                assetId: fileId,
                fileName: removedAsset?.fileName || null,
                fileSizeBytes: removedAsset?.sizeBytes ?? null,
                mimeType: removedAsset?.mimeType ?? null,
                storageProvider: null,
                fileKey: removedAsset?.fileKey ?? null,
              },
            },
          },
        });
      } catch (err) {
        console.warn('[OrderLineItemFiles:DELETE] audit log failed', err);
      }

      const unlinkUserId = getUserId(req.user);
      if (unlinkUserId) {
        try {
          await db.transaction((tx) =>
            autoSyncCanonicalProofForLineItem(tx, {
              organizationId,
              lineItemId,
              actorUserId: unlinkUserId,
              reason: "artwork_deleted",
            }),
          );
        } catch (proofSyncError) {
          console.error("[OrderLineItemFiles:DELETE] Auto proof sync failed after asset unlink (non-fatal)", proofSyncError);
        }
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('[OrderLineItemFiles:DELETE] Error:', error);
      return res.status(500).json({ error: 'Failed to remove line item file' });
    }
  });
}
