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
import { randomUUID } from "node:crypto";
import { eq, and, desc, sql, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  orders,
  orderLineItems,
  orderAttachments,
  quoteAttachments,
  assets,
  assetLinks,
  assetVariants,
  lineItemArtwork,
  lineItemFiles,
} from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import {
  createRequestLogOnce,
  normalizeObjectKeyForDb,
  resolveOriginalFileAccess,
} from "../lib/supabaseObjectHelpers";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { createLineItemFileRecord } from "../services/lineItemFileRecordService";
import { deleteStoredObjectKeysIfUnreferenced } from "../services/storage/storageReferenceGuard";
import { fileDerivativeRepository } from "../storage/fileDerivative.repo";
import { autoSyncCanonicalProofForLineItem } from "../services/proofingService";
import {
  assignOrderLineItemArtworkSide,
  isOrderArtworkSide,
  OrderLineItemArtworkAssignmentError,
} from "../services/orderLineItemArtworkAssignmentService";
import {
  applyArtworkSideAssignmentToSpecs,
  removeArtworkFileReferencesFromSpecs,
} from "@shared/artworkSideAssignment";
import { buildArtworkAllocationStatus, defaultNewProductionArtworkAllocation } from "@shared/artworkAllocation";
import { repairArtworkRelationshipsForLineItem } from "../services/artworkRelationshipRepairService";
import { lineItemArtworkReadResolver } from "../services/artwork/LineItemArtworkReadResolver";
import { canonicalArtworkWriteService } from "../services/artwork/CanonicalArtworkWriteService";
import {
  ArtworkSetOperationError,
  createArtworkSet,
  updateArtworkSetQuantity,
} from "../services/artwork/artworkSetOperations";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

/**
 * A download can be rejected by authentication before the route handler runs.
 * Record safe lifecycle telemetry at the route boundary so a production 401 is
 * distinguishable from a canonical-file or provider read failure. Never log
 * cookie values, signed URLs, or file bytes here.
 */
function attachOrderArtworkDownloadDiagnostics(req: any, res: any, next: any): void {
  const requestId = typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].trim()
    ? req.headers["x-request-id"].trim()
    : randomUUID();
  const diagnostics = {
    requestId,
    stage: "authenticate",
    canonicalFileResolved: false,
    storageFetchAttempted: false,
  };
  req.orderArtworkDownloadDiagnostics = diagnostics;
  res.setHeader("X-Request-Id", requestId);
  res.once("finish", () => {
    console.info("[OrderLineItemFiles:DOWNLOAD:REQUEST]", {
      requestId: diagnostics.requestId,
      method: req.method,
      status: res.statusCode,
      authCookiePresent: Boolean(req.headers.cookie),
      authenticated: Boolean(req.isAuthenticated?.()),
      organizationContextPresent: Boolean(getRequestOrganizationId(req)),
      stage: diagnostics.stage,
      canonicalFileResolved: diagnostics.canonicalFileResolved,
      storageFetchAttempted: diagnostics.storageFetchAttempted,
    });
  });
  next();
}

function toLegacyStorageProvider(provider: string | null | undefined): "local" | "s3" | "gcs" | "supabase" | null {
  if (provider === "local" || provider === "s3" || provider === "gcs" || provider === "supabase") {
    return provider;
  }
  return null;
}

async function clearRemovedArtworkSideIntent(args: {
  orderId: string;
  lineItemId: string;
  fileIds: Array<string | null | undefined>;
  removedSide?: "front" | "back" | "both" | "na" | null;
}, executor: any = db): Promise<void> {
  const [lineItem] = await executor
    .select({ specsJson: orderLineItems.specsJson })
    .from(orderLineItems)
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orderLineItems.orderId, args.orderId)))
    .limit(1);
  if (!lineItem) return;

  const nextSpecsJson = removeArtworkFileReferencesFromSpecs({
    specsJson: lineItem.specsJson,
    fileIds: args.fileIds,
    removedSide: args.removedSide,
  });
  if (JSON.stringify(nextSpecsJson) === JSON.stringify(lineItem.specsJson ?? {})) return;

  await executor
    .update(orderLineItems)
    .set({ specsJson: nextSpecsJson, updatedAt: new Date() })
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orderLineItems.orderId, args.orderId)));
}

/** Retire only a deleted customer-source edge; independent production art stays historical/current. */
async function retireCurrentCustomerSourceArtworkForFileRecord(args: {
  tx: any;
  organizationId: string;
  orderId: string;
  lineItemId: string;
  fileRecordId: string | null | undefined;
  actorUserId: string | null | undefined;
}): Promise<void> {
  if (!args.fileRecordId) return;
  await args.tx.update(lineItemArtwork).set({
    status: "superseded",
    supersededAt: new Date(),
    supersededByUserId: args.actorUserId ?? null,
  }).where(and(
    eq(lineItemArtwork.organizationId, args.organizationId),
    eq(lineItemArtwork.orderId, args.orderId),
    eq(lineItemArtwork.lineItemId, args.lineItemId),
    eq(lineItemArtwork.fileRecordId, args.fileRecordId),
    eq(lineItemArtwork.role, "customer_source"),
    eq(lineItemArtwork.status, "current"),
  ));
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

  app.post("/api/orders/:orderId/line-items/:lineItemId/repair-artwork-relationships", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const actorUserId = getUserId(req.user);
      const role = String(req.user?.role ?? req.user?.claims?.role ?? "").toLowerCase();
      if (!organizationId || !actorUserId) return res.status(401).json({ error: "Authentication and organization context are required." });
      if (role !== "owner" && role !== "admin") return res.status(403).json({ error: "Only owners and admins can repair artwork relationships." });
      const result = await repairArtworkRelationshipsForLineItem({
        organizationId,
        orderId: String(req.params.orderId),
        lineItemId: String(req.params.lineItemId),
        actorUserId,
        actorName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
      });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      if (error?.statusCode === 404) return res.status(404).json({ error: error.message });
      console.error("[OrderLineItemFiles:REPAIR_ARTWORK_RELATIONSHIPS] Failed", error);
      return res.status(500).json({ error: "Failed to repair artwork relationships." });
    }
  });

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

      // Ordinary artwork is canonical-only. Assets remain here only for
      // non-artwork reference material; neither legacy attachment nor asset
      // rows can repopulate an empty canonical artwork relationship.
      const resolution = await lineItemArtworkReadResolver.resolveForLineItem({
        organizationId,
        lineItemId,
        purpose: "order",
      });
      // Compatibility attachment IDs remain action handles for the existing
      // panel, but only when they correspond to a selected canonical record.
      // They never participate in artwork discovery.
      const compatibilityRows = await db
        .select({ id: orderAttachments.id, fileRecordId: orderAttachments.fileRecordId })
        .from(orderAttachments)
        .where(and(
          eq(orderAttachments.orderId, orderId),
          eq(orderAttachments.orderLineItemId, lineItemId),
          eq(orderAttachments.role, "artwork"),
        ));
      const compatibilityIdByFileRecordId = new Map(
        compatibilityRows
          .filter((row): row is { id: string; fileRecordId: string } => !!row.fileRecordId)
          .map((row) => [row.fileRecordId, row.id]),
      );
      const canonicalArtwork = resolution.artwork.map((artwork) => ({
        id: compatibilityIdByFileRecordId.get(artwork.fileRecordId) ?? artwork.relationshipId,
        fileRecordId: artwork.fileRecordId,
        fileName: artwork.file.originalFilename ?? "Artwork",
        originalFilename: artwork.file.originalFilename,
        fileUrl: artwork.file.contentPath,
        originalUrl: artwork.file.contentPath,
        downloadUrl: `${artwork.file.contentPath}?download=1`,
        previewUrl: `${artwork.file.contentPath}?variant=preview`,
        thumbUrl: `${artwork.file.contentPath}?variant=thumbnail`,
        thumbnailUrl: `${artwork.file.contentPath}?variant=thumbnail`,
        fileSize: artwork.file.sizeBytes,
        sizeBytes: artwork.file.sizeBytes,
        mimeType: artwork.file.mimeType,
        createdAt: artwork.createdAt.toISOString(),
        side: artwork.side === "unknown" ? "na" : artwork.side,
        role: "artwork" as const,
        productionQuantity: artwork.allocationQuantity,
        productionGroupId: artwork.allocationGroupId,
        source: "canonical" as const,
      }));
      const { assetRepository } = await import('../services/assets/AssetRepository');
      const { enrichAssetsWithRoles } = await import('../services/assets/enrichAssetWithUrls');
      const linkedAssets = await assetRepository.listAssetsForParent(organizationId, 'order_line_item', lineItemId);
      const enrichedAssets = await enrichAssetsWithRoles(linkedAssets.filter((asset: any) => asset.role === "reference"));

      console.log(`[OrderLineItemFiles:GET] Found ${canonicalArtwork.length} canonical artwork relationship(s) + ${enrichedAssets.length} reference asset(s) for line item ${lineItemId}`);
      res.json({ success: true, data: canonicalArtwork, assets: enrichedAssets });
    } catch (error) {
      console.error("[OrderLineItemFiles:GET] Error:", error);
      res.status(500).json({ error: "Failed to fetch line item files" });
    }
  });

  // Canonical artwork download.  The UI action handle can be either the
  // compatibility attachment ID or the canonical artwork relationship ID;
  // neither requires a persisted public/signed URL.
  app.get("/api/orders/:orderId/line-items/:lineItemId/files/:fileId/download/proxy", attachOrderArtworkDownloadDiagnostics, isAuthenticated, tenantContext, async (req: any, res) => {
    const diagnostics = req.orderArtworkDownloadDiagnostics;
    const requestId = diagnostics.requestId;
    const request = {
      requestId,
      orderId: String(req.params.orderId ?? ""),
      lineItemId: String(req.params.lineItemId ?? ""),
      requestedFileId: String(req.params.fileId ?? ""),
    };
    let stage = "validate_order_line_item";
    diagnostics.stage = stage;
    let relationshipType: "line_item_artwork" | "order_attachment" | "reference_asset" | null = null;
    let canonicalFileRecordId: string | null = null;
    const logFailure = (code: string, details: Record<string, unknown> = {}) => {
      console.warn("[OrderLineItemFiles:DOWNLOAD:PROXY]", {
        code,
        stage,
        ...request,
        relationshipType,
        canonicalFileRecordId,
        ...details,
      });
    };

    try {
      const { orderId, lineItemId, fileId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const [lineItem] = await db.select({ id: orderLineItems.id }).from(orderLineItems)
        .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId), eq(orders.organizationId, organizationId)))
        .limit(1);
      if (!lineItem) return res.status(404).json({ error: "Order line item not found" });

      stage = "resolve_artwork_relationship";
      diagnostics.stage = stage;
      const resolution = await lineItemArtworkReadResolver.resolveForLineItem({ organizationId, lineItemId, purpose: "order" });
      let artwork = resolution.artwork.find((item) => String(item.relationshipId) === String(fileId)) ?? null;
      if (artwork) relationshipType = "line_item_artwork";
      let downloadSource: {
        id?: string | null;
        fileRecordId?: string | null;
        fileName?: string | null;
        originalFilename?: string | null;
        mimeType?: string | null;
        fileUrl?: string | null;
        fileKey?: string | null;
      } | null = artwork ? {
        id: artwork.relationshipId,
        fileRecordId: artwork.fileRecordId,
        originalFilename: artwork.file.originalFilename,
        mimeType: artwork.file.mimeType,
      } : null;
      if (!artwork) {
        const [attachment] = await db.select().from(orderAttachments)
          .where(and(eq(orderAttachments.id, fileId), eq(orderAttachments.orderId, orderId), eq(orderAttachments.orderLineItemId, lineItemId), eq(orderAttachments.organizationId, organizationId)))
          .limit(1);
        if (attachment) {
          artwork = attachment.fileRecordId
            ? resolution.artwork.find((item) => item.fileRecordId === attachment.fileRecordId) ?? null
            : null;
          relationshipType = "order_attachment";
          downloadSource = artwork ? {
            id: artwork.relationshipId,
            fileRecordId: artwork.fileRecordId,
            originalFilename: artwork.file.originalFilename,
            mimeType: artwork.file.mimeType,
          } : attachment;
        }
      }
      if (!downloadSource) {
        const [asset] = await db.select({
          id: assets.id,
          fileRecordId: assets.fileRecordId,
          fileName: assets.fileName,
          fileKey: assets.fileKey,
          mimeType: assets.mimeType,
        }).from(assets)
          .innerJoin(assetLinks, and(
            eq(assetLinks.assetId, assets.id),
            eq(assetLinks.organizationId, organizationId),
            eq(assetLinks.parentType, "order_line_item"),
            eq(assetLinks.parentId, lineItemId),
          ))
          .where(and(eq(assets.id, fileId), eq(assets.organizationId, organizationId)))
          .limit(1);
        if (asset) relationshipType = "reference_asset";
        downloadSource = asset ?? null;
      }
      if (!downloadSource) {
        logFailure("FILE_RELATIONSHIP_NOT_FOUND");
        return res.status(404).json({ error: "Artwork file not found" });
      }

      canonicalFileRecordId = downloadSource.fileRecordId ? String(downloadSource.fileRecordId) : null;
      // Quotes already use resolveOriginalFileAccess to enter the authenticated
      // /objects canonical reader. Keep Orders on that proven boundary too.
      // The client performs one credential-aware fetch; Fetch follows this
      // same-origin redirect and receives the final attachment bytes without
      // navigating the operator to an API response.
      if (canonicalFileRecordId) {
        stage = "resolve_canonical_download_handle";
        diagnostics.stage = stage;
        const resolved = await resolveOriginalFileAccess(downloadSource, { logOnce: createRequestLogOnce() });
        diagnostics.canonicalFileResolved = resolved.availabilityStatus === "available";
        if (!resolved.downloadUrl) {
          logFailure("CANONICAL_FILE_NOT_FOUND", { availabilityStatus: resolved.availabilityStatus });
          return res.status(404).json({ error: "Artwork file is unavailable" });
        }
        stage = "redirect_canonical_object";
        diagnostics.stage = stage;
        logFailure("CANONICAL_OBJECT_REDIRECT", { availabilityStatus: resolved.availabilityStatus });
        return res.redirect(resolved.downloadUrl);
      }

      // Legacy attachments have no canonical file record and retain their
      // existing key-based compatibility path.
      stage = "resolve_legacy_attachment";
      diagnostics.stage = stage;
      const resolved = await resolveOriginalFileAccess(downloadSource, { logOnce: createRequestLogOnce() });
      if (!resolved.downloadUrl) {
        logFailure("DOWNLOAD_URL_RESOLUTION_FAILED", { availabilityStatus: resolved.availabilityStatus });
        return res.status(404).json({ error: "Artwork file is unavailable", availabilityStatus: resolved.availabilityStatus });
      }
      return res.redirect(resolved.downloadUrl);
    } catch (error: any) {
      const errorMessage = String(error?.message ?? "");
      const errorCode = error?.code === "ENOENT" || error?.status === 404 || /not found|does not exist|object.*missing/i.test(errorMessage)
        ? "STORAGE_OBJECT_NOT_FOUND"
        : error?.status === 403 || /access denied|forbidden|not authorized/i.test(errorMessage)
          ? "FILE_ACCESS_DENIED"
          : stage === "resolve_canonical_download_handle"
            ? "CANONICAL_DOWNLOAD_HANDLE_FAILED"
          : "DOWNLOAD_URL_RESOLUTION_FAILED";
      logFailure(errorCode, { errorName: error?.name ?? "Error", errorMessage: errorMessage || "Unknown failure" });
      if (errorCode === "STORAGE_OBJECT_NOT_FOUND") {
        return res.status(404).json({ error: "Artwork file is unavailable" });
      }
      if (errorCode === "FILE_ACCESS_DENIED") {
        return res.status(403).json({ error: "Artwork file access denied" });
      }
      return res.status(500).json({
        error: "Unable to prepare artwork download",
        code: errorCode,
        requestId,
      });
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
      const { triggerAssetPreviewGeneration } = await import('../workers/assetPreviewWorker');
      const { enrichAssetWithUrls } = await import('../services/assets/enrichAssetWithUrls');

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || null;

      console.log(`[OrderLineItemFiles:POST] Attaching ${uniqueCandidates.length} object(s) to order_line_item ${lineItemId}`);

      const createdAssets: any[] = [];
      for (const c of uniqueCandidates) {
        const normalizedAssetRole = normalizeRole(c.role);
        const createsOrdinaryArtwork = normalizedAssetRole !== "reference" && normalizedAssetRole !== "proof";
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
                if (createsOrdinaryArtwork) {
                  await canonicalArtworkWriteService.attachSourceArtwork({
                    tx,
                    organizationId,
                    orderId,
                    lineItemId,
                    fileRecordId: stored.fileRecord.id,
                    side: "na",
                    actorUserId: userId ?? null,
                    origin: "staff_upload",
                  });
                }
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
                if (createsOrdinaryArtwork) {
                  await canonicalArtworkWriteService.attachSourceArtwork({
                    tx,
                    organizationId,
                    orderId,
                    lineItemId,
                    fileRecordId: stored.fileRecord.id,
                    side: "na",
                    actorUserId: userId ?? null,
                    origin: "staff_upload",
                  });
                }
                return created;
                },
              })
            : null;

          const candidateFileRecordId = c.kind === 'existing-file-record' ? c.fileRecordId : null;
          const candidateFileKey = c.kind === 'upload-session' ? null : c.fileKey;
          const candidateFileName = c.kind === 'upload-session'
            ? (c.fileName || 'upload')
            : (c.fileName || guessFileNameFromKey(c.fileKey));

          if (createsOrdinaryArtwork && c.kind === "existing-file-record") {
            await db.transaction((tx) => canonicalArtworkWriteService.attachSourceArtwork({
              tx,
              organizationId,
              orderId,
              lineItemId,
              fileRecordId: c.fileRecordId,
              side: "na",
              actorUserId: userId ?? null,
              origin: "staff_upload",
            }));
          }
          const asset: any = finalized?.linkedRecord ?? await assetRepository.createAsset(organizationId, {
            fileRecordId: candidateFileRecordId,
            fileKey: c.kind === 'existing-file-record' ? null : candidateFileKey,
            fileName: candidateFileName,
            mimeType: c.mimeType,
            sizeBytes: c.sizeBytes,
          } as any);

        await assetRepository.linkAsset(organizationId, asset.id, 'order_line_item', lineItemId, normalizedAssetRole as any);

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

        const materializedRole = normalizedAssetRole === 'reference'
          ? 'reference'
          : normalizedAssetRole === 'proof'
            ? 'proof'
            : 'artwork';
        const materializedFileRecordId = asset.fileRecordId ?? candidateFileRecordId ?? null;
        const materializedFileUrl = materializedFileRecordId ? null : candidateFileKey;
        if (materializedFileRecordId || materializedFileUrl) {
          const existingAttachmentConditions = [
            eq(orderAttachments.orderId, orderId),
            eq(orderAttachments.orderLineItemId, lineItemId),
            materializedFileRecordId
              ? eq(orderAttachments.fileRecordId, materializedFileRecordId)
              : eq(orderAttachments.fileUrl, materializedFileUrl as string),
          ];
          const [existingAttachment] = await db
            .select()
            .from(orderAttachments)
            .where(and(...existingAttachmentConditions))
            .limit(1);

          if (!existingAttachment) {
            await db.insert(orderAttachments).values({
              orderId,
              orderLineItemId: lineItemId,
              fileRecordId: materializedFileRecordId,
              uploadedByUserId: userId ?? null,
              uploadedByName: userName,
              fileName: asset.fileName || candidateFileName,
              fileUrl: materializedFileUrl,
              fileSize: asset.sizeBytes ?? c.sizeBytes ?? null,
              sizeBytes: asset.sizeBytes ?? c.sizeBytes ?? null,
              mimeType: asset.mimeType ?? c.mimeType ?? null,
              role: materializedRole,
              side: "na",
              isPrimary: false,
              storageProvider: null,
              productionQuantity: materializedRole === "artwork" ? defaultNewProductionArtworkAllocation("artwork") : null,
              productionGroupId: null,
            });
          }
        }

        triggerAssetPreviewGeneration(asset, 'order-line-item-file');
        createdAssets.push({ ...(await enrichAssetWithUrls(asset)), role: normalizedAssetRole });

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
                  role: normalizedAssetRole,
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

  app.patch("/api/orders/:orderId/line-items/:lineItemId/files/:fileId/artwork-side", isAuthenticated, tenantContext, async (req: any, res) => {
    const { orderId, lineItemId, fileId } = req.params;
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
    if (!isOrderArtworkSide(req.body?.side)) {
      return res.status(400).json({ error: "Side must be front, back, or both", code: "INVALID_ARTWORK_SIDE" });
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const assigned = await assignOrderLineItemArtworkSide({
        organizationId,
        orderId,
        lineItemId,
        fileId,
        side: req.body.side,
        store: {
          findOrder: async (scopedOrganizationId, scopedOrderId) => {
            const [row] = await tx
              .select({ id: orders.id })
              .from(orders)
              .where(and(eq(orders.id, scopedOrderId), eq(orders.organizationId, scopedOrganizationId)))
              .limit(1);
            return row ?? null;
          },
          findLineItem: async (scopedOrderId, scopedLineItemId) => {
            const [row] = await tx
              .select({ id: orderLineItems.id })
              .from(orderLineItems)
              .where(and(eq(orderLineItems.id, scopedLineItemId), eq(orderLineItems.orderId, scopedOrderId)))
              .limit(1);
            return row ?? null;
          },
          findAttachment: async (scopedOrderId, scopedLineItemId, scopedFileId) => {
            const [row] = await tx
              .select()
              .from(orderAttachments)
              .where(and(
                eq(orderAttachments.id, scopedFileId),
                eq(orderAttachments.orderId, scopedOrderId),
                eq(orderAttachments.orderLineItemId, scopedLineItemId),
              ))
              .limit(1);
            if (row) return row;

            const [canonicalArtwork] = await tx
              .select({ fileRecordId: lineItemArtwork.fileRecordId })
              .from(lineItemArtwork)
              .where(and(
                eq(lineItemArtwork.id, scopedFileId),
                eq(lineItemArtwork.organizationId, organizationId),
                eq(lineItemArtwork.orderId, scopedOrderId),
                eq(lineItemArtwork.lineItemId, scopedLineItemId),
                eq(lineItemArtwork.status, "current"),
              ))
              .limit(1);
            if (canonicalArtwork) {
              const [materialized] = await tx.insert(orderAttachments).values({
                orderId: scopedOrderId,
                orderLineItemId: scopedLineItemId,
                fileRecordId: canonicalArtwork.fileRecordId,
                uploadedByUserId: getUserId(req.user) ?? null,
                uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
                fileName: "Artwork",
                fileUrl: null,
                fileSize: null,
                sizeBytes: null,
                mimeType: null,
                role: "artwork",
                side: "na",
                isPrimary: false,
                storageProvider: null,
                productionQuantity: defaultNewProductionArtworkAllocation("artwork"),
                productionGroupId: null,
              }).returning();
              return materialized ?? null;
            }

            // Newer line-item uploads are canonical assets. Materialize the
            // order_attachment link on first side assignment because that is
            // where Front/Back/Both metadata is persisted and consumed.
            const [assetRow] = await tx
              .select({
                id: assets.id,
                fileRecordId: assets.fileRecordId,
                fileKey: assets.fileKey,
                fileName: assets.fileName,
                mimeType: assets.mimeType,
                sizeBytes: assets.sizeBytes,
              })
              .from(assets)
              .innerJoin(assetLinks, and(
                eq(assetLinks.assetId, assets.id),
                eq(assetLinks.organizationId, organizationId),
                eq(assetLinks.parentType, "order_line_item"),
                eq(assetLinks.parentId, scopedLineItemId),
              ))
              .where(and(eq(assets.id, scopedFileId), eq(assets.organizationId, organizationId)))
              .limit(1);
            if (!assetRow) {
              // Prepress originals use line_item_files rather than assets. The
              // same endpoint accepts that stable file ID and materializes the
              // canonical order_attachment side metadata on first assignment.
              const [prepressFile] = await tx
                .select()
                .from(lineItemFiles)
                .where(and(
                  eq(lineItemFiles.id, scopedFileId),
                  eq(lineItemFiles.organizationId, organizationId),
                  eq(lineItemFiles.orderId, scopedOrderId),
                  eq(lineItemFiles.lineItemId, scopedLineItemId),
                  eq(lineItemFiles.role, "original"),
                  eq(lineItemFiles.status, "active"),
                ))
                .limit(1);
              if (!prepressFile) return null;

              if (prepressFile.fileRecordId) {
                const [existingLink] = await tx
                  .select()
                  .from(orderAttachments)
                  .where(and(
                    eq(orderAttachments.orderId, scopedOrderId),
                    eq(orderAttachments.orderLineItemId, scopedLineItemId),
                    eq(orderAttachments.fileRecordId, prepressFile.fileRecordId),
                  ))
                  .limit(1);
                if (existingLink) return existingLink;
              }

              const [materialized] = await tx
                .insert(orderAttachments)
                .values({
                  orderId: scopedOrderId,
                  orderLineItemId: scopedLineItemId,
                  fileRecordId: prepressFile.fileRecordId,
                  uploadedByUserId: prepressFile.createdByUserId,
                  fileName: prepressFile.originalFilename,
                  fileUrl: prepressFile.storageKey || prepressFile.storagePath,
                  fileSize: prepressFile.sizeBytes,
                  sizeBytes: prepressFile.sizeBytes,
                  mimeType: prepressFile.mimeType,
                  role: "artwork",
                  side: "na",
                  isPrimary: false,
                  storageProvider: null,
                  productionQuantity: defaultNewProductionArtworkAllocation("artwork"),
                  productionGroupId: null,
                })
                .returning();
              return materialized ?? null;
            }

            if (assetRow.fileRecordId) {
              const [existingLink] = await tx
                .select()
                .from(orderAttachments)
                .where(and(
                  eq(orderAttachments.orderId, scopedOrderId),
                  eq(orderAttachments.orderLineItemId, scopedLineItemId),
                  eq(orderAttachments.fileRecordId, assetRow.fileRecordId),
                ))
                .limit(1);
              if (existingLink) return existingLink;
            }

            const [materialized] = await tx
              .insert(orderAttachments)
              .values({
                orderId: scopedOrderId,
                orderLineItemId: scopedLineItemId,
                fileRecordId: assetRow.fileRecordId,
                uploadedByUserId: getUserId(req.user) ?? null,
                uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
                fileName: assetRow.fileName,
                fileUrl: assetRow.fileKey,
                fileSize: assetRow.sizeBytes,
                sizeBytes: assetRow.sizeBytes,
                mimeType: assetRow.mimeType,
                role: "artwork",
                side: "na",
                isPrimary: false,
                storageProvider: null,
                productionQuantity: defaultNewProductionArtworkAllocation("artwork"),
                productionGroupId: null,
              })
              .returning();
            return materialized ?? null;
          },
          clearConflictingSides: async ({ orderId: scopedOrderId, lineItemId: scopedLineItemId, exceptFileId, sides }) => {
            await tx
              .update(orderAttachments)
              .set({ side: "na", updatedAt: new Date() })
              .where(and(
                eq(orderAttachments.orderId, scopedOrderId),
                eq(orderAttachments.orderLineItemId, scopedLineItemId),
                ne(orderAttachments.id, exceptFileId),
                inArray(orderAttachments.side, sides),
              ));
          },
          updateAttachmentMetadata: async (scopedFileId, patch) => {
            const [row] = await tx
              .update(orderAttachments)
              .set({ ...patch, updatedAt: new Date() })
              .where(and(
                eq(orderAttachments.id, scopedFileId),
                eq(orderAttachments.orderId, orderId),
                eq(orderAttachments.orderLineItemId, lineItemId),
              ))
              .returning();
            return row ?? null;
          },
          },
        });

        const [lineItem] = await tx
          .select({ specsJson: orderLineItems.specsJson })
          .from(orderLineItems)
          .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)))
          .limit(1);
        if (lineItem && assigned.fileRecordId) {
          const [canonicalArtwork] = await tx
            .select({ id: lineItemArtwork.id })
            .from(lineItemArtwork)
            .where(and(
              eq(lineItemArtwork.organizationId, organizationId),
              eq(lineItemArtwork.orderId, orderId),
              eq(lineItemArtwork.lineItemId, lineItemId),
              eq(lineItemArtwork.fileRecordId, assigned.fileRecordId),
              eq(lineItemArtwork.status, "current"),
            ))
            .limit(1);
          if (canonicalArtwork) {
            const conflictingSides: Array<"front" | "back" | "both"> = req.body.side === "both"
              ? ["front", "back", "both"]
              : [req.body.side, "both"];
            await tx.update(lineItemArtwork)
              .set({ side: "unknown" })
              .where(and(
                eq(lineItemArtwork.organizationId, organizationId),
                eq(lineItemArtwork.orderId, orderId),
                eq(lineItemArtwork.lineItemId, lineItemId),
                eq(lineItemArtwork.status, "current"),
                ne(lineItemArtwork.id, canonicalArtwork.id),
                inArray(lineItemArtwork.side, conflictingSides),
              ));
            await tx.update(lineItemArtwork)
              .set({ side: req.body.side })
              .where(and(eq(lineItemArtwork.id, canonicalArtwork.id), eq(lineItemArtwork.organizationId, organizationId)));
          }
        }
        if (lineItem) {
          await tx
            .update(orderLineItems)
            .set({
              specsJson: applyArtworkSideAssignmentToSpecs({
                specsJson: lineItem.specsJson,
                fileId: assigned.id,
                fileRecordId: assigned.fileRecordId,
                side: req.body.side,
              }),
              updatedAt: new Date(),
            })
            .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId)));
        }
        return assigned;
      });

      const userId = getUserId(req.user);
      try {
        await storage.createOrderAuditLog({
          orderId,
          orderLineItemId: lineItemId,
          userId,
          userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
          actionType: "file_updated",
          fromStatus: null,
          toStatus: null,
          note: `Artwork assigned to ${req.body.side}`,
          metadata: { fileId, lineItemId, side: req.body.side } as any,
        });
      } catch (auditError) {
        console.warn("[OrderLineItemFiles:ARTWORK_SIDE] Audit log failed after assignment", auditError);
      }

      if (userId) {
        try {
          await db.transaction((tx) => autoSyncCanonicalProofForLineItem(tx, {
            organizationId,
            lineItemId,
            actorUserId: userId,
            reason: "artwork_saved",
          }));
        } catch (proofSyncError) {
          console.warn("[OrderLineItemFiles:ARTWORK_SIDE] Proof sync failed after assignment", proofSyncError);
        }
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error instanceof OrderLineItemArtworkAssignmentError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      const enumValueRejected = error?.code === "22P02" && /file_side/i.test(String(error?.message || ""));
      console.error("[OrderLineItemFiles:ARTWORK_SIDE] Failed", {
        orderId,
        lineItemId,
        fileId,
        side: req.body?.side,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
      if (enumValueRejected) {
        return res.status(409).json({
          error: "Artwork side support is not available until the current database migration is applied",
          code: "ARTWORK_SIDE_SCHEMA_NOT_READY",
        });
      }
      return res.status(500).json({ error: "Failed to assign artwork side", code: "ARTWORK_SIDE_UPDATE_FAILED" });
    }
  });

  // An Artwork Set is one finished output. Its quantity is deliberately
  // repeated on each member file for legacy projections, while the shared
  // allocation validator counts the set once.
  app.post("/api/orders/:orderId/line-items/:lineItemId/artwork-sets", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
    const artworkIds = Array.isArray(req.body?.artworkIds) ? req.body.artworkIds.map(String) : [];
    try {
      const result = await createArtworkSet({
        organizationId,
        orderId: req.params.orderId,
        lineItemId: req.params.lineItemId,
        artworkIds,
        productionQuantity: req.body?.productionQuantity,
        userId: getUserId(req.user) ?? null,
        userName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
      });
      return res.status(201).json({ success: true, data: result, allocation: result.allocation });
    } catch (error: any) {
      if (error instanceof ArtworkSetOperationError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("[OrderLineItemFiles:ARTWORK_SET_CREATE] Failed", { orderId: req.params.orderId, lineItemId: req.params.lineItemId, message: error?.message });
      return res.status(500).json({ error: "Failed to create Artwork Set", code: "ARTWORK_SET_CREATE_FAILED" });
    }
  });

  app.patch("/api/orders/:orderId/line-items/:lineItemId/artwork-sets/:productionGroupId", isAuthenticated, tenantContext, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
    try {
      const result = await updateArtworkSetQuantity({
        organizationId,
        orderId: req.params.orderId,
        lineItemId: req.params.lineItemId,
        productionGroupId: String(req.params.productionGroupId ?? ""),
        productionQuantity: req.body?.productionQuantity,
        userId: getUserId(req.user) ?? null,
        userName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
      });
      return res.json({ success: true, data: result, allocation: result.allocation });
    } catch (error: any) {
      if (error instanceof ArtworkSetOperationError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("[OrderLineItemFiles:ARTWORK_SET_UPDATE] Failed", { orderId: req.params.orderId, lineItemId: req.params.lineItemId, message: error?.message });
      return res.status(500).json({ error: "Failed to update Artwork Set", code: "ARTWORK_SET_UPDATE_FAILED" });
    }
  });

  // Customer artwork remains a separate relationship, but a promoted final
  // file records its source attachment. Keep that canonical production row in
  // sync whenever the mapping is unambiguous.
  app.patch("/api/orders/:orderId/line-items/:lineItemId/files/:fileId/artwork-allocation", isAuthenticated, tenantContext, async (req: any, res) => {
    const { orderId, lineItemId, fileId } = req.params;
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
    const role = req.body?.role === "reference" ? "reference" : req.body?.role === "artwork" ? "artwork" : null;
    const rawQuantity = req.body?.productionQuantity;
    const productionQuantity = rawQuantity == null || rawQuantity === "" ? null : Number(rawQuantity);
    const productionGroupId = typeof req.body?.productionGroupId === "string" && req.body.productionGroupId.trim()
      ? req.body.productionGroupId.trim()
      : null;
    if (!role || (role === "artwork" && productionQuantity !== null && (!Number.isInteger(productionQuantity) || productionQuantity <= 0))) {
      return res.status(400).json({ error: "Production artwork quantity must be a positive whole number, or blank while the draft is incomplete.", code: "INVALID_ARTWORK_ALLOCATION" });
    }
    if (role === "reference" && (productionQuantity !== null || productionGroupId !== null)) {
      return res.status(400).json({ error: "Reference-only files cannot have a production allocation.", code: "REFERENCE_HAS_ALLOCATION" });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [lineItem] = await tx.select({ id: orderLineItems.id, quantity: orderLineItems.quantity })
          .from(orderLineItems)
          .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
          .where(and(eq(orderLineItems.id, lineItemId), eq(orderLineItems.orderId, orderId), eq(orders.organizationId, organizationId)))
          .limit(1);
        if (!lineItem) throw Object.assign(new Error("Line item not found"), { statusCode: 404 });

        let [attachment] = await tx.select().from(orderAttachments).where(and(
          eq(orderAttachments.id, fileId), eq(orderAttachments.orderId, orderId), eq(orderAttachments.orderLineItemId, lineItemId),
        )).limit(1);
        if (!attachment) {
          const [canonicalArtwork] = await tx.select({ fileRecordId: lineItemArtwork.fileRecordId })
            .from(lineItemArtwork)
            .where(and(
              eq(lineItemArtwork.id, fileId),
              eq(lineItemArtwork.organizationId, organizationId),
              eq(lineItemArtwork.orderId, orderId),
              eq(lineItemArtwork.lineItemId, lineItemId),
              eq(lineItemArtwork.status, "current"),
            ))
            .limit(1);
          if (canonicalArtwork) {
            [attachment] = await tx.insert(orderAttachments).values({
              orderId, orderLineItemId: lineItemId, fileRecordId: canonicalArtwork.fileRecordId,
              uploadedByUserId: getUserId(req.user) ?? null, uploadedByName: null,
              fileName: "Artwork", fileUrl: null, fileSize: null, sizeBytes: null,
              mimeType: null, role: "artwork", side: "na", isPrimary: false,
              productionQuantity: defaultNewProductionArtworkAllocation("artwork"), productionGroupId: null,
            }).returning();
          }
        }
        if (!attachment) {
          const [asset] = await tx.select({ fileRecordId: assets.fileRecordId, fileName: assets.fileName, fileKey: assets.fileKey, mimeType: assets.mimeType, sizeBytes: assets.sizeBytes })
            .from(assets).innerJoin(assetLinks, and(eq(assetLinks.assetId, assets.id), eq(assetLinks.organizationId, organizationId), eq(assetLinks.parentType, "order_line_item"), eq(assetLinks.parentId, lineItemId)))
            .where(and(eq(assets.id, fileId), eq(assets.organizationId, organizationId))).limit(1);
          if (!asset) throw Object.assign(new Error("Artwork file is not attached to this line item"), { statusCode: 404 });
          [attachment] = await tx.insert(orderAttachments).values({
            orderId, orderLineItemId: lineItemId, fileRecordId: asset.fileRecordId ?? null,
            uploadedByUserId: getUserId(req.user) ?? null, uploadedByName: null,
            fileName: asset.fileName, fileUrl: asset.fileKey ?? null, fileSize: asset.sizeBytes ?? null, sizeBytes: asset.sizeBytes ?? null,
            mimeType: asset.mimeType ?? null, role: "artwork", side: "na", isPrimary: false,
            productionQuantity: defaultNewProductionArtworkAllocation("artwork"), productionGroupId: null,
          }).returning();
        }
        const [updated] = await tx.update(orderAttachments).set({
          role,
          productionQuantity: role === "artwork" ? productionQuantity : null,
          productionGroupId: role === "artwork" ? productionGroupId : null,
          updatedAt: new Date(),
        }).where(eq(orderAttachments.id, attachment.id)).returning();
        if (updated?.fileRecordId) {
          await tx.update(lineItemArtwork).set({
            allocationQuantity: role === "artwork" ? productionQuantity : null,
            allocationGroupId: role === "artwork" ? productionGroupId : null,
          }).where(and(
            eq(lineItemArtwork.organizationId, organizationId),
            eq(lineItemArtwork.orderId, orderId),
            eq(lineItemArtwork.lineItemId, lineItemId),
            eq(lineItemArtwork.fileRecordId, updated.fileRecordId),
            eq(lineItemArtwork.status, "current"),
          ));
        }
        const members = await tx.select({ id: orderAttachments.id, role: orderAttachments.role, side: orderAttachments.side, productionQuantity: orderAttachments.productionQuantity, productionGroupId: orderAttachments.productionGroupId })
          .from(orderAttachments).where(and(eq(orderAttachments.orderId, orderId), eq(orderAttachments.orderLineItemId, lineItemId)));
        const mappedFinalCandidates = role === "artwork"
          ? await tx.select({ id: lineItemFiles.id, productionGroupId: lineItemFiles.productionGroupId }).from(lineItemFiles).where(and(
              eq(lineItemFiles.organizationId, organizationId),
              eq(lineItemFiles.orderId, orderId),
              eq(lineItemFiles.lineItemId, lineItemId),
              eq(lineItemFiles.role, "final"),
              eq(lineItemFiles.status, "active"),
              eq(lineItemFiles.sourceOrderAttachmentId, attachment.id),
            ))
          : [];
        const mappedFinalGroupIds = new Set(mappedFinalCandidates.map((file) => file.productionGroupId?.trim() || ""));
        const mappedFinals = mappedFinalCandidates.length <= 1 || (mappedFinalGroupIds.size === 1 && !mappedFinalGroupIds.has(""))
          ? mappedFinalCandidates
          : [];
        if (mappedFinals.length > 0) {
          await tx.update(lineItemFiles).set({
            productionQuantity,
            productionGroupId,
          }).where(and(
            eq(lineItemFiles.organizationId, organizationId),
            inArray(lineItemFiles.id, mappedFinals.map((file) => file.id)),
          ));
        }
        const canonicalMembers = mappedFinals.length > 0
          ? await tx.select({ id: lineItemFiles.id, role: lineItemFiles.role, side: lineItemFiles.sourceArtworkSide, productionQuantity: lineItemFiles.productionQuantity, productionGroupId: lineItemFiles.productionGroupId })
              .from(lineItemFiles).where(and(
                eq(lineItemFiles.organizationId, organizationId),
                eq(lineItemFiles.lineItemId, lineItemId),
                eq(lineItemFiles.role, "final"),
                eq(lineItemFiles.status, "active"),
              ))
          : [];
        return {
          updated,
          status: buildArtworkAllocationStatus({
            lineQuantity: lineItem.quantity,
            members: canonicalMembers.length > 0 ? canonicalMembers : members,
          }),
          canonicalFinalArtwork: {
            updated: mappedFinals.length > 0,
            finalFileIds: mappedFinals.map((file) => file.id),
          },
        };
      });
      await storage.createOrderAuditLog({
        orderId, orderLineItemId: lineItemId, userId: getUserId(req.user), userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
        actionType: "artwork_allocation_updated", fromStatus: null, toStatus: null,
        note: role === "reference" ? "Artwork marked reference-only" : `Production allocation set to ${productionQuantity ?? "unallocated"}`,
        metadata: { attachmentId: result.updated.id, productionQuantity: result.updated.productionQuantity, productionGroupId: result.updated.productionGroupId, role, canonicalFinalFileIds: result.canonicalFinalArtwork.finalFileIds },
      });
      return res.json({ success: true, data: result.updated, allocation: result.status, canonicalFinalArtwork: result.canonicalFinalArtwork });
    } catch (error: any) {
      if (error?.statusCode === 404) return res.status(404).json({ error: error.message });
      console.error("[OrderLineItemFiles:ARTWORK_ALLOCATION] Failed", { orderId, lineItemId, fileId, message: error?.message });
      return res.status(500).json({ error: "Failed to update artwork allocation", code: "ARTWORK_ALLOCATION_UPDATE_FAILED" });
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

      const actorUserId = getUserId(req.user);

      // First try: DB-backed order attachments (some legacy/alternate UIs store these here)
      const deletedAttachment = await db.transaction(async (tx) => {
        // Do this before deleting the attachment: the foreign key deliberately
        // nulls sourceOrderAttachmentId on delete, which would otherwise erase
        // the only safe identity for the original-file mirror.
        await tx.update(lineItemFiles)
          .set({ status: "retired" })
          .where(and(
            eq(lineItemFiles.organizationId, organizationId),
            eq(lineItemFiles.orderId, orderId),
            eq(lineItemFiles.lineItemId, lineItemId),
            eq(lineItemFiles.role, "original"),
            eq(lineItemFiles.status, "active"),
            eq(lineItemFiles.sourceOrderAttachmentId, fileId),
          ));
        const removed = await tx.delete(orderAttachments)
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
            side: orderAttachments.side,
          });
        const record = removed[0];
        if (record) {
          await retireCurrentCustomerSourceArtworkForFileRecord({
            tx,
            organizationId,
            orderId,
            lineItemId,
            fileRecordId: record.fileRecordId,
            actorUserId,
          });
          await clearRemovedArtworkSideIntent({
            orderId,
            lineItemId,
            fileIds: [record.id, record.fileRecordId],
            removedSide: record.side,
          }, tx);
          if (actorUserId) {
            await autoSyncCanonicalProofForLineItem(tx, {
              organizationId,
              lineItemId,
              actorUserId,
              reason: "artwork_deleted",
            });
          }
        }
        return removed;
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

                    await deleteStoredObjectKeysIfUnreferenced({
                      organizationId,
                      fileRecordId: record.fileRecordId ? String(record.fileRecordId) : null,
                      legacyStorageProvider: toLegacyStorageProvider(effectiveStorageProvider),
                      keys: [...variants.map((variant) => variant.key || ''), normalizedFileKey],
                      exclusions: { assetIds: [asset.id] },
                      logContext: {
                        route: "order-line-item-attachment-delete",
                        orderId,
                        lineItemId,
                        attachmentId: record.id,
                        assetId: asset.id,
                      },
                    });

                    await db.delete(assets).where(and(eq(assets.organizationId, organizationId), eq(assets.id, asset.id)));
                  }
                }
              }
            } catch (assetCleanupError) {
              console.error('[OrderLineItemFiles:DELETE] Asset cleanup failed (non-blocking):', assetCleanupError);
            }

            if (Number(orderRefs) + Number(quoteRefs) === 0 && !hasRemainingAssetLinksForFile && effectiveStorageProvider) {
              const derivativeRows = record.fileRecordId
                ? await fileDerivativeRepository.listByFileRecordId(String(record.fileRecordId))
                : [];
              const derivativeKeys = record.fileRecordId
                ? derivativeRows.map((row) => row.objectKey ?? null)
                : [record.thumbnailRelativePath ?? record.thumbKey ?? null, record.previewKey ?? null];

              const derivativeDeletion = await deleteStoredObjectKeysIfUnreferenced({
                organizationId,
                fileRecordId: record.fileRecordId ? String(record.fileRecordId) : null,
                legacyStorageProvider: effectiveStorageProvider,
                keys: [storageKey, ...derivativeKeys],
                logContext: {
                  route: "order-line-item-attachment-delete",
                  orderId,
                  lineItemId,
                  attachmentId: record.id,
                },
              });

              if (record.fileRecordId && !derivativeDeletion.skipped && derivativeDeletion.failedKeys.length === 0) {
                await fileDerivativeRepository.deleteByFileRecordId(String(record.fileRecordId));
              } else if (record.fileRecordId && (derivativeDeletion.skipped || derivativeDeletion.failedKeys.length > 0)) {
                console.warn('[OrderLineItemFiles:DELETE] Skipped derivative row cleanup due to storage delete failures', {
                  fileRecordId: String(record.fileRecordId),
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

        try {
          const userId = actorUserId;
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

      await db.transaction(async (tx) => {
        await tx.delete(assetLinks).where(and(
          eq(assetLinks.organizationId, organizationId),
          eq(assetLinks.assetId, fileId),
          eq(assetLinks.parentType, 'order_line_item'),
          eq(assetLinks.parentId, String(lineItemId)),
        ));
        await retireCurrentCustomerSourceArtworkForFileRecord({
          tx,
          organizationId,
          orderId,
          lineItemId,
          fileRecordId: removedAsset?.fileRecordId,
          actorUserId,
        });
        await clearRemovedArtworkSideIntent({
          orderId,
          lineItemId,
          fileIds: [fileId, removedAsset?.fileRecordId],
        }, tx);
        if (actorUserId) {
          await autoSyncCanonicalProofForLineItem(tx, {
            organizationId,
            lineItemId,
            actorUserId,
            reason: "artwork_deleted",
          });
        }
      });

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

      return res.json({ success: true });
    } catch (error) {
      console.error('[OrderLineItemFiles:DELETE] Error:', error);
      return res.status(500).json({ error: 'Failed to remove line item file' });
    }
  });
}
