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
import { db, hasQuoteAttachmentPagesTable } from "../db";
import {
  auditLogs,
  quotes,
  quoteAttachments,
  quoteAttachmentPages,
  quoteLineItems,
  orderAttachments,
  orders,
  orderLineItems,
  assets,
  assetLinks,
} from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { isPortalFileCategory, normalizePortalFileCategory } from "@shared/portalFileVisibility";
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
import { getSignedUrlFromCache, setSignedUrlInCache, getSignedUrlMeta, patchSignedUrlMeta } from "../lib/signedUrlCache";
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  normalizeObjectKeyForDb,
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
  scheduleSupabaseObjectSelfCheck,
  tryExtractSupabaseObjectKeyFromUrl
} from "../lib/supabaseObjectHelpers";
import type { FileRole, FileSide } from "../lib/supabaseObjectHelpers";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { ObjectPermission } from "../objectAcl";
import { resolveLocalStoragePath } from "../services/localStoragePath";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { deleteStoredObjectKeysIfUnreferenced } from "../services/storage/storageReferenceGuard";
import { CustomerUploadReviewError, promoteCustomerUpload, reviewCustomerUpload } from "../services/customerUploadReview.service";
import { storageRegistry } from "../services/storage/StorageRegistry";
import { storageProviderConfigRepository } from "../storage/storageProviderConfig.repo";
import { fileDerivativeRepository } from "../storage/fileDerivative.repo";
import { fileRecordRepository } from "../storage/fileRecord.repo";
import { extractNormalizedOrgIdFromKey, getTenantObjectKeyCandidates, normalizeTenantObjectKey } from "../utils/orgKeys";
import type { DownloadIntent } from "@shared/schema";

let hasLoggedPdfObjectsResponse = false;

function isThumbDiagnosticsPath(keyOrPath: string | null | undefined): boolean {
  const raw = (keyOrPath ?? "").trim().toLowerCase();
  if (!raw) return false;
  const normalized = raw.startsWith("/") ? raw.slice(1) : raw;
  return (
    normalized.startsWith("thumbs/") ||
    normalized.startsWith("thumbnails/") ||
    normalized.startsWith("objects/thumbs/") ||
    normalized.startsWith("objects/thumbnails/")
  );
}

function logThumb4xx(req: any, status: number, reason: "not_found" | "unauthorized" | "error", keyOrPath: string): void {
  if (!isThumbDiagnosticsPath(keyOrPath)) return;
  const host = typeof req.get === "function" ? req.get("host") : req.headers?.host;
  const cleanPath = keyOrPath.replace(/\?.*$/, "").replace(/^\/+/, "");
  console.warn(`[objects:thumb4xx] method=${req.method} path=/${cleanPath} status=${status} host=${host || "unknown"} reason=${reason}`);
}

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

async function resolveAttachmentDownloadTarget(
  attachment: {
    id: string;
    fileName: string;
    fileRecordId?: string | null;
    originalFilename?: string | null;
  },
  intent: DownloadIntent
): Promise<{ displayFilename: string; objectPath: string | null; availabilityStatus: string }> {
  void intent;
  const resolved = await resolveOriginalFileAccess(attachment);
  return {
    displayFilename: resolved.displayFilename,
    objectPath: resolved.objectPath,
    availabilityStatus: resolved.availabilityStatus,
  };
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

const portalAttachmentVisibilitySchema = z.object({
  customerVisible: z.boolean(),
  portalFileCategory: z.string().trim().optional().nullable(),
  portalDisplayName: z.string().trim().max(500).optional().nullable(),
  portalDescription: z.string().trim().max(2000).optional().nullable(),
});

const customerUploadReviewSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  reviewNote: z.string().trim().max(2000).optional().nullable(),
});

const customerUploadPromotionSchema = z.object({
  promotion: z.literal("reference"),
  confirmPromotion: z.literal(true),
});

function assertInternalStaffUser(req: any, res: any): boolean {
  if (req.user?.role === "customer" || !req.orgRole) {
    res.status(403).json({ error: "Access denied" });
    return false;
  }
  return true;
}

function normalizePortalVisibilityPatch(input: z.infer<typeof portalAttachmentVisibilitySchema>) {
  const category = input.customerVisible
    ? normalizePortalFileCategory(input.portalFileCategory)
    : input.portalFileCategory && isPortalFileCategory(input.portalFileCategory)
      ? input.portalFileCategory
      : null;

  return {
    customerVisible: input.customerVisible,
    portalFileCategory: category,
    portalDisplayName: input.portalDisplayName || null,
    portalDescription: input.portalDescription || null,
  };
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
    platformIsAdmin: any;
  }
) {
  const { isAuthenticated, isAdmin, platformIsAdmin, tenantContext: tenantContextMiddleware } = middleware;

  app.patch("/api/quotes/:quoteId/line-items/:lineItemId/attachments/:attachmentId/artwork-allocation", isAuthenticated, tenantContextMiddleware, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    const quantity = req.body?.productionQuantity == null || req.body?.productionQuantity === "" ? null : Number(req.body.productionQuantity);
    const role = req.body?.role === "reference" ? "reference" : req.body?.role === "artwork" ? "artwork" : null;
    const groupId = typeof req.body?.productionGroupId === "string" && req.body.productionGroupId.trim() ? req.body.productionGroupId.trim() : null;
    if (!organizationId || !role || (role === "artwork" && quantity !== null && (!Number.isInteger(quantity) || quantity <= 0)) || (role === "reference" && (quantity !== null || groupId !== null))) {
      return res.status(400).json({ error: "Invalid artwork allocation" });
    }
    const [updated] = await db.update(quoteAttachments).set({
      productionQuantity: role === "artwork" ? quantity : null,
      productionGroupId: role === "artwork" ? groupId : null,
      productionRole: role,
      updatedAt: new Date(),
    }).where(and(
      eq(quoteAttachments.id, req.params.attachmentId),
      eq(quoteAttachments.quoteId, req.params.quoteId),
      eq(quoteAttachments.quoteLineItemId, req.params.lineItemId),
      eq(quoteAttachments.organizationId, organizationId),
    )).returning();
    if (!updated) return res.status(404).json({ error: "Quote artwork attachment not found" });
    return res.json({ success: true, data: updated });
  });

  const tryResolveProviderHandle = async (args: {
    organizationId: string;
    providerConfigId: string | null;
    key: string;
  }): Promise<{ kind: "signed_url" | "local_path"; value: string } | null> => {
    if (!args.providerConfigId) {
      return null;
    }

    const providerConfig = await storageProviderConfigRepository.getByIdForOrganization(args.organizationId, args.providerConfigId);
    if (!providerConfig) {
      return null;
    }

    const adapter = storageRegistry.getAdapter(providerConfig.providerType);
    return adapter.getDownloadHandle({
      providerConfig,
      objectKey: providerConfig.providerType === "local_filesystem" ? null : args.key,
      localPathRef: providerConfig.providerType === "local_filesystem" ? args.key : null,
    });
  };

  const deleteQuoteAttachmentWithCleanup = async (args: {
    organizationId: string;
    quoteId: string;
    attachmentId: string;
    quoteLineItemId: string | null;
  }) => {
    const predicates = [
      eq(quoteAttachments.id, args.attachmentId),
      eq(quoteAttachments.quoteId, args.quoteId),
      eq(quoteAttachments.organizationId, args.organizationId),
      args.quoteLineItemId === null
        ? isNull(quoteAttachments.quoteLineItemId)
        : eq(quoteAttachments.quoteLineItemId, args.quoteLineItemId),
    ];

    const [attachment] = await db
      .select()
      .from(quoteAttachments)
      .where(and(...predicates))
      .limit(1);

    if (!attachment) {
      return false;
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
            eq(quoteAttachmentPages.attachmentId, attachment.id),
            eq(quoteAttachmentPages.organizationId, args.organizationId),
          ))
      : [];

    console.log('[QuoteAttachments:DELETE] page derivative preload', {
      quoteId: args.quoteId,
      attachmentId: attachment.id,
      fileRecordId: attachment.fileRecordId ?? null,
      pagesTableState: pagePagesTableState,
      pageDerivativeRowCount: pageDerivativeRows.length,
      pageDerivativeRows: pageDerivativeRows.map((row) => ({
        thumbFileRecordId: row.thumbFileRecordId ?? null,
        thumbKey: row.thumbKey ?? null,
        previewFileRecordId: row.previewFileRecordId ?? null,
        previewKey: row.previewKey ?? null,
      })),
    });

    await db.delete(quoteAttachments).where(and(...predicates));

    try {
      const resolvedOriginal = attachment.fileRecordId
        ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
        : null;
      const storageKey = String(resolvedOriginal?.objectKey ?? resolvedOriginal?.localPathRef ?? attachment.fileUrl ?? "");
      const storageProvider = resolvedOriginal?.providerType === "local_filesystem"
        ? "local"
        : resolvedOriginal?.providerType === "s3"
          ? "s3"
          : resolvedOriginal?.objectKey
            ? "supabase"
            : ((attachment.storageProvider as "local" | "s3" | "gcs" | "supabase" | null | undefined) ?? null);

      if (!storageKey) {
        return true;
      }

      const [{ quoteRefs = 0 } = {}] = attachment.fileRecordId
        ? await db
            .select({ quoteRefs: sql<number>`count(*)` })
            .from(quoteAttachments)
            .where(
              and(
                eq(quoteAttachments.organizationId, args.organizationId),
                eq(quoteAttachments.fileRecordId, String(attachment.fileRecordId))
              )
            )
        : !storageProvider
          ? [{ quoteRefs: 0 }]
          : await db
              .select({ quoteRefs: sql<number>`count(*)` })
              .from(quoteAttachments)
              .where(
                and(
                  eq(quoteAttachments.organizationId, args.organizationId),
                  eq(quoteAttachments.fileUrl, storageKey),
                  eq(quoteAttachments.storageProvider, storageProvider)
                )
              );

      const [{ orderRefs = 0 } = {}] = attachment.fileRecordId
        ? await db
            .select({ orderRefs: sql<number>`count(*)` })
            .from(orderAttachments)
            .where(eq(orderAttachments.fileRecordId, String(attachment.fileRecordId)))
        : !storageProvider
          ? [{ orderRefs: 0 }]
          : await db
              .select({ orderRefs: sql<number>`count(*)` })
              .from(orderAttachments)
              .where(
                and(
                  eq(orderAttachments.fileUrl, storageKey),
                  eq(orderAttachments.storageProvider, storageProvider)
                )
              );

      console.log('[QuoteAttachments:DELETE] final cleanup gate', {
        quoteId: args.quoteId,
        attachmentId: attachment.id,
        fileRecordId: attachment.fileRecordId ?? null,
        storageKey,
        storageProvider,
        quoteRefs: Number(quoteRefs),
        orderRefs: Number(orderRefs),
      });

      let hasRemainingAssetLinksForFile = false;
      try {
        const matchingAssets = attachment.fileRecordId
          ? await db
              .select({ id: assets.id })
              .from(assets)
              .where(and(eq(assets.organizationId, args.organizationId), eq(assets.fileRecordId, String(attachment.fileRecordId))))
          : await db
              .select({ id: assets.id })
              .from(assets)
              .where(and(eq(assets.organizationId, args.organizationId), eq(assets.fileKey, normalizeObjectKeyForDb(storageKey))));

        if (matchingAssets.length > 0) {
          const linkCounts = await Promise.all(
            matchingAssets.map(async (asset) => {
              const [{ cnt = 0 } = {}] = await db
                .select({ cnt: sql<number>`count(*)` })
                .from(assetLinks)
                .where(and(eq(assetLinks.organizationId, args.organizationId), eq(assetLinks.assetId, asset.id)));
              return Number(cnt);
            })
          );

          hasRemainingAssetLinksForFile = linkCounts.some((count) => count > 0);
        }
      } catch (assetRefError) {
        console.error("[QuoteAttachments:DELETE] Asset reference check failed (non-blocking):", assetRefError);
      }

      if (Number(quoteRefs) + Number(orderRefs) === 0 && !hasRemainingAssetLinksForFile && storageProvider) {
        const derivativeRows = attachment.fileRecordId
          ? await fileDerivativeRepository.listByFileRecordId(String(attachment.fileRecordId))
          : [];
        const derivativeKeys = attachment.fileRecordId
          ? derivativeRows.map((row) => row.objectKey ?? null)
          : [(attachment as any).thumbKey ?? null, (attachment as any).previewKey ?? null];

        const derivativeDeletion = await deleteStoredObjectKeysIfUnreferenced({
          organizationId: args.organizationId,
          fileRecordId: attachment.fileRecordId ? String(attachment.fileRecordId) : null,
          legacyStorageProvider: storageProvider,
          keys: [storageKey, ...derivativeKeys],
          logContext: {
            route: "quote-attachment-delete",
            quoteId: args.quoteId,
            attachmentId: attachment.id,
          },
        });

        console.log('[QuoteAttachments:DELETE] top-level derivative cleanup result', {
          quoteId: args.quoteId,
          attachmentId: attachment.id,
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
            console.log('[QuoteAttachments:DELETE] page derivative candidate', {
              quoteId: args.quoteId,
              attachmentId: attachment.id,
              fileRecordId,
              fallbackKey: candidate.fallbackKey ?? null,
              resolvedPageStorageKey: pageStorageKey,
              resolvedProviderType: resolvedPageOriginal?.providerType ?? null,
              resolvedStatus: resolvedPageOriginal?.status ?? null,
            });
            if (!pageStorageKey) {
              console.warn('[QuoteAttachments:DELETE] page derivative key missing; skipping physical delete', {
                quoteId: args.quoteId,
                attachmentId: attachment.id,
                fileRecordId,
                fallbackKey: candidate.fallbackKey ?? null,
              });
              continue;
            }

            const pageDeletion = await deleteStoredObjectKeysIfUnreferenced({
              organizationId: args.organizationId,
              fileRecordId,
              legacyStorageProvider: storageProvider,
              keys: [pageStorageKey],
              logContext: {
                route: "quote-attachment-page-derivative-delete",
                quoteId: args.quoteId,
                attachmentId: attachment.id,
              },
            });

            console.log('[QuoteAttachments:DELETE] page derivative delete result', {
              quoteId: args.quoteId,
              attachmentId: attachment.id,
              fileRecordId,
              pageStorageKey,
              deletedKeys: pageDeletion.deletedKeys,
              failedKeys: pageDeletion.failedKeys,
            });

            if (fileRecordId && !pageDeletion.skipped && pageDeletion.failedKeys.length === 0) {
              await fileRecordRepository.deleteById(fileRecordId);
            } else if (fileRecordId && (pageDeletion.skipped || pageDeletion.failedKeys.length > 0)) {
              console.warn("[QuoteAttachments:DELETE] Skipped page derivative fileRecord cleanup due to storage delete failures", {
                fileRecordId,
                failedKeys: pageDeletion.failedKeys,
                skipped: pageDeletion.skipped,
                reason: pageDeletion.reason ?? null,
              });
            }
          }
        }

        if (attachment.fileRecordId && !derivativeDeletion.skipped && derivativeDeletion.failedKeys.length === 0) {
          await fileDerivativeRepository.deleteByFileRecordId(String(attachment.fileRecordId));
        } else if (attachment.fileRecordId && (derivativeDeletion.skipped || derivativeDeletion.failedKeys.length > 0)) {
          console.warn("[QuoteAttachments:DELETE] Skipped derivative row cleanup due to storage delete failures", {
            fileRecordId: String(attachment.fileRecordId),
            failedKeys: derivativeDeletion.failedKeys,
            skipped: derivativeDeletion.skipped,
            reason: derivativeDeletion.reason ?? null,
          });
        }
      }
    } catch (cleanupError) {
      console.error("[QuoteAttachments:DELETE] Storage cleanup failed (non-blocking):", cleanupError);
    }

    return true;
  };

  const persistQuoteAttachment = async (args: {
    quoteId: string;
    organizationId: string;
    userId: string | null;
    userName: string;
    description?: string | null;
    requestedTarget?: string | null;
    thumbStatus?: string;
    pageCountStatus?: string;
    source:
      | {
          kind: "buffer";
          buffer: Buffer;
          originalFilename: string;
          mimeType: string;
        }
      | {
          kind: "upload-session";
          uploadId: string;
          expectedPurpose: "quote-attachment";
          expectedParentId: string;
        }
      | {
          kind: "existing-key";
          fileUrl: string;
          originalFilename: string;
          mimeType?: string | null;
          fileSize?: number | null;
          checksum?: string | null;
          storedFilename?: string | null;
          extension?: string | null;
        };
  }) => {
    const finalized = await storageApplicationService.finalizeUpload({
      organizationId: args.organizationId,
      createdByUserId: args.userId,
      requestedTarget: args.requestedTarget,
      resource: {
        organizationId: args.organizationId,
        resourceType: "quote",
        resourceId: args.quoteId,
      },
      source: args.source,
      persistLink: async (tx, stored) => {
        const [created] = await tx.insert(quoteAttachments).values({
          quoteId: args.quoteId,
          quoteLineItemId: null,
          organizationId: args.organizationId,
          fileRecordId: stored.fileRecord.id,
          uploadedByUserId: args.userId,
          uploadedByName: args.userName,
          description: args.description || null,
          bucket: stored.storedObject.bucket ?? "titan-private",
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
          thumbStatus: (args.thumbStatus as any) ?? "uploaded",
          pageCountStatus: (args.pageCountStatus as any) ?? undefined,
        }).returning();

        if (!created) {
          throw new Error("Failed to create quote attachment link");
        }

        return created;
      },
    });

    void import("../workers/thumbnailWorker")
      .then(({ triggerThumbnailGenerationForAttachment }) => {
        triggerThumbnailGenerationForAttachment({
          attachmentType: "quote",
          attachmentId: String(finalized.linkedRecord.id),
          reason: "quote-attachment-upload",
        });
      })
      .catch((error) => {
        console.error("[QuoteAttachments:POST] Failed to trigger thumbnail generation:", error);
      });

    return finalized.linkedRecord;
  };

  app.get("/objects/health", (req: any, res) => {
    return res.json({
      ok: true,
      host: req.get("host") ?? null,
      time: new Date().toISOString(),
    });
  });

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

      const requestedKeyRaw = normalizeObjectKeyForDb(decodedKey);
      const requestedKey = normalizeTenantObjectKey(requestedKeyRaw);
      if (!requestedKey) return res.status(400).json({ error: "Invalid key" });

      const candidateKeys = getTenantObjectKeyCandidates(requestedKeyRaw);
      if (candidateKeys.length === 0) return res.status(400).json({ error: "Invalid key" });

      // Tenant safety (compatible with legacy keys):
      // - If the key contains an org segment anywhere, enforce it matches organizationId.
      // - Otherwise allow (mirrors existing behavior while still avoiding arbitrary URLs).
      const orgInKey = extractNormalizedOrgIdFromKey(requestedKeyRaw);
      if (orgInKey && orgInKey !== organizationId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const rawFilename = (req.query.filename ?? "").toString();
      const resolvedName = (rawFilename || path.basename(requestedKey) || "download")
        .replace(/[\r\n\t\0]/g, " ")
        .replace(/"/g, "'")
        .slice(0, 240);

      const bucketParamRaw = (req.query.bucket ?? "").toString().trim();
      const bucketParam = /^[a-z0-9._-]+$/i.test(bucketParamRaw) ? bucketParamRaw : "";
      const providerConfigId = typeof req.query.providerConfigId === "string" ? req.query.providerConfigId : null;

      if (providerConfigId) {
        for (const keyToTry of candidateKeys) {
          try {
            const handle = await tryResolveProviderHandle({
              organizationId,
              providerConfigId,
              key: keyToTry,
            });

            if (!handle) {
              break;
            }

            if (handle.kind === "local_path") {
              await fsPromises.access(handle.value, fsPromises.constants.R_OK);
              return res.download(path.resolve(handle.value), resolvedName);
            }

            const upstream = await fetch(handle.value);
            if (!upstream.ok) {
              throw new Error(`Upstream fetch failed: ${upstream.status} ${upstream.statusText}`);
            }

            res.setHeader("Content-Disposition", `attachment; filename="${resolvedName}"`);
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
            res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

            const body: any = (upstream as any).body;
            if (body && typeof Readable.fromWeb === "function") {
              const nodeStream = Readable.fromWeb(body);
              nodeStream.on("error", (err) => {
                console.error("[objects:download] Stream error:", err);
                if (!res.headersSent) res.status(500).end();
              });
              return nodeStream.pipe(res);
            }

            return res.send(Buffer.from(await upstream.arrayBuffer()));
          } catch (providerError: any) {
            if (process.env.NODE_ENV === "development") {
              console.log(`[objects:download] provider miss key="${keyToTry}":`, providerError?.message || providerError);
            }
          }
        }
      }

      // 1) Supabase: fetch bytes server-side and stream with attachment headers.
      if (isSupabaseConfigured()) {
        const supabaseService = new SupabaseStorageService(bucketParam || undefined);
        for (const keyToTry of candidateKeys) {
          try {
            const _dlBucket = supabaseService.bucketName;
            const _dlCached = getSignedUrlFromCache(_dlBucket, keyToTry);
            const signedUrl = _dlCached ?? await supabaseService.getSignedDownloadUrl(keyToTry, 3600);
            if (!_dlCached) setSignedUrlInCache(_dlBucket, keyToTry, signedUrl);
            const upstream = await fetch(signedUrl);
            if (!upstream.ok) {
              throw new Error(`Upstream fetch failed: ${upstream.status} ${upstream.statusText}`);
            }

            if (process.env.NODE_ENV === "development" && keyToTry !== requestedKey) {
              console.log(`[objects:download] resolved via fallback requested="${requestedKey}" key="${keyToTry}"`);
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
            // keep trying candidates
            if (process.env.NODE_ENV === "development") {
              console.log(`[objects:download] supabase miss key="${keyToTry}":`, supabaseError?.message || supabaseError);
            }
          }
        }
      }

      // 2) Local filesystem
      for (const keyToTry of candidateKeys) {
        try {
          const localPath = resolveLocalStoragePath(keyToTry);
          await fsPromises.access(localPath, fsPromises.constants.R_OK);
          if (process.env.NODE_ENV === "development" && keyToTry !== requestedKey) {
            console.log(`[objects:download] local resolved via fallback requested="${requestedKey}" key="${keyToTry}"`);
          }
          return res.download(path.resolve(localPath), resolvedName);
        } catch {
          // keep trying
        }
      }

      // 3) GCS via Replit ObjectStorage
      const userId = getUserId((req as any).user);
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
            return res.status(403).json({ error: "Access denied" });
          }

          if (process.env.NODE_ENV === "development" && keyToTry !== requestedKey) {
            console.log(`[objects:download] gcs resolved via fallback requested="${requestedKey}" key="${keyToTry}"`);
          }

          res.setHeader("Content-Disposition", `attachment; filename="${resolvedName}"`);
          return objectStorageService.downloadObject(objectFile, res);
        } catch {
          // keep trying
        }
      }

      throw new ObjectNotFoundError();
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
    const requestedKeyRaw = normalizeObjectKeyForDb(objectPath);
    const requestedKey = normalizeTenantObjectKey(requestedKeyRaw);
    const candidateKeys = getTenantObjectKeyCandidates(requestedKeyRaw);

    if (isDev) {
      const compatKey = normalizeTenantObjectKey(requestedKeyRaw);
      console.log(
        `[objects] request="${objectPath}" key="${requestedKeyRaw}"` +
          (requestedKeyRaw !== compatKey ? ` compat="${compatKey}"` : "")
      );
    }

    if (!requestedKeyRaw) {
      logThumb4xx(req, 400, "error", objectPath);
      return res.status(400).json({ error: "Invalid object path" });
    }

    // Tenant safety (compatible with legacy keys):
    // - If the key contains an org segment anywhere, enforce it matches organizationId.
    // - Otherwise allow (mirrors existing behavior while still avoiding obvious cross-tenant reads).
    const orgInKey = extractNormalizedOrgIdFromKey(requestedKeyRaw);
    if (orgInKey && orgInKey !== organizationId) {
      logThumb4xx(req, 403, "unauthorized", requestedKeyRaw);
      return res.status(403).json({ error: "Access denied" });
    }

    const wantsDownload =
      req.query.download === "1" ||
      req.query.download === "true" ||
      req.query.disposition === "attachment";

    const rawFilename = (req.query.filename ?? "").toString();

    const bucketParamRaw = (req.query.bucket ?? "").toString().trim();
    const bucketParam = /^[a-z0-9._-]+$/i.test(bucketParamRaw) ? bucketParamRaw : "";
    const providerConfigId = typeof req.query.providerConfigId === "string" ? req.query.providerConfigId : null;

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
        if (providerConfigId) {
          try {
            const handle = await tryResolveProviderHandle({
              organizationId,
              providerConfigId,
              key: keyToTry,
            });

            if (handle) {
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

              if (handle.kind === "local_path") {
                await fsPromises.access(handle.value, fsPromises.constants.R_OK);
                const contentType = isPdf
                  ? (!wantsDownload ? contentTypes[".pdf"] : (assetMeta?.mimeType || contentTypes[".pdf"]))
                  : (contentTypes[ext] || assetMeta?.mimeType || "application/octet-stream");

                res.setHeader("Content-Type", contentType);
                res.setHeader(
                  "Content-Disposition",
                  `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`
                );
                res.setHeader("Cache-Control", wantsDownload ? "private, max-age=0, must-revalidate" : "public, max-age=86400");
                res.removeHeader("X-Frame-Options");
                const ancestors = getFrameAncestors(req);
                res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);
                return res.sendFile(path.resolve(handle.value));
              }

              const upstream = await fetch(handle.value);
              if (!upstream.ok) {
                const e: any = new Error(`Upstream fetch failed: ${upstream.status} ${upstream.statusText}`);
                e.status = upstream.status;
                throw e;
              }

              const upstreamType = upstream.headers.get("content-type") || "";
              const inferredType = contentTypes[ext] || "";
              const contentType = isPdf
                ? (!wantsDownload ? "application/pdf" : (upstreamType || assetMeta?.mimeType || "application/pdf"))
                : isImage
                  ? (upstreamType || assetMeta?.mimeType || inferredType || "image/*")
                  : (upstreamType || assetMeta?.mimeType || inferredType || "application/octet-stream");

              res.setHeader("Content-Type", contentType);
              res.setHeader(
                "Content-Disposition",
                `${wantsDownload ? "attachment" : "inline"}; filename="${safeName}"`
              );
              res.setHeader("Cache-Control", wantsDownload ? "private, max-age=0, must-revalidate" : "public, max-age=86400");
              res.removeHeader("X-Frame-Options");
              const ancestors = getFrameAncestors(req);
              res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);

              const body: any = (upstream as any).body;
              if (body && typeof Readable.fromWeb === "function") {
                const nodeStream = Readable.fromWeb(body);
                nodeStream.on("error", (err) => {
                  console.error("[objects] upstream stream error:", err);
                  if (!res.headersSent) res.status(500).end();
                });
                return nodeStream.pipe(res);
              }

              return res.send(Buffer.from(await upstream.arrayBuffer()));
            }
          } catch (providerError: any) {
            if (isNotFoundError(providerError)) {
              logExpectedNotFoundOnce("provider", keyToTry);
            } else if (isDev) {
              console.warn(`[objects] provider error key="${keyToTry}":`, providerError?.message || providerError);
            } else {
              console.error("[objects] provider error:", providerError);
            }
          }
        }

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
            const _bucket = supabaseService.bucketName;
            const _cached = getSignedUrlFromCache(_bucket, keyToTry);
            const signedUrl = _cached ?? await supabaseService.getSignedDownloadUrl(keyToTry, 3600);
            if (!_cached) setSignedUrlInCache(_bucket, keyToTry, signedUrl);

            if (isDev) {
              const via = keyToTry === requestedKey ? "direct" : "fallback";
              console.log(`[objects] resolved provider=supabase via=${via} key="${keyToTry}" cache=${_cached ? "hit" : "miss"}`);
            }

            // ETag: serve 304 Not Modified without an upstream fetch when the client's
            // If-None-Match matches our cached upstream ETag for this object.
            // Only applies to inline (non-download) responses which carry public Cache-Control.
            if (!wantsDownload) {
              const ifNoneMatch = ((req.headers["if-none-match"] as string) || "").trim();
              if (ifNoneMatch && ifNoneMatch !== "*") {
                const _meta = getSignedUrlMeta(_bucket, keyToTry);
                if (_meta?.etag) {
                  const clientTags = ifNoneMatch.split(",").map((t) => t.trim());
                  if (clientTags.includes(_meta.etag)) {
                    res.setHeader("ETag", _meta.etag);
                    if (_meta.lastModified) res.setHeader("Last-Modified", _meta.lastModified);
                    res.removeHeader("X-Frame-Options");
                    const _304ancestors = getFrameAncestors(req);
                    res.setHeader("Content-Security-Policy", `frame-ancestors ${_304ancestors.join(" ")};`);
                    if (isDev) console.log(`[objects] 304 key="${keyToTry}" etag=${_meta.etag}`);
                    return res.status(304).end();
                  }
                }
              }
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

            // Capture upstream validators; patch cache entry so future requests can 304 without fetching.
            const _upstreamETag = upstream.headers.get("etag") ?? undefined;
            const _upstreamLastModified = upstream.headers.get("last-modified") ?? undefined;
            if (_upstreamETag || _upstreamLastModified) {
              patchSignedUrlMeta(_bucket, keyToTry, _upstreamETag, _upstreamLastModified);
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
            if (!wantsDownload) {
              if (_upstreamETag) res.setHeader("ETag", _upstreamETag);
              if (_upstreamLastModified) res.setHeader("Last-Modified", _upstreamLastModified);
            }
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
            const via = keyToTry === requestedKey ? "direct" : "fallback";
            console.log(`[objects] resolved provider=local via=${via} key="${keyToTry}" path="${localPath}"`);
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
        logThumb4xx(req, 404, "not_found", requestedKey);
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
            logThumb4xx(req, 403, "unauthorized", keyToTry);
            return res.status(403).json({ error: "Access denied", path: req.path, objectPath: keyToTry });
          }

          if (isDev) {
            const via = keyToTry === requestedKey ? "direct" : "fallback";
            console.log(`[objects] resolved provider=gcs via=${via} key="${keyToTry}"`);
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
        logExpectedNotFoundOnce("any", requestedKeyRaw);
        if (isDev) {
          console.log(`[objects] 404 - Object not found. Object path: "${objectPath}", Error:`, error.message);
        }
        logThumb4xx(req, 404, "not_found", requestedKeyRaw || objectPath);
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
   * GET /api/assets/:id/download
   * Download an asset file by ID
   * Proxies through /objects/ endpoint
   */
  app.get("/api/assets/:id/download", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const assetId = req.params.id; // Asset IDs are strings (varchar)
      if (!assetId) {
        return res.status(400).json({ error: "Invalid asset ID" });
      }

      const organizationId = getRequestOrganizationId(req);
      
      // Lookup asset
      const [asset] = await db
        .select({
          fileRecordId: assets.fileRecordId,
          fileKey: assets.fileKey,
          fileName: assets.fileName,
          mimeType: assets.mimeType,
        })
        .from(assets)
        .where(and(
          eq(assets.id, assetId),
          eq(assets.organizationId, organizationId)
        ))
        .limit(1);

      if (!asset) {
        return res.status(404).json({ error: "Asset not found" });
      }

      const resolved = await resolveOriginalFileAccess(asset);
      if (!resolved.downloadUrl) {
        return res.status(404).json({ error: "Asset unavailable", availabilityStatus: resolved.availabilityStatus });
      }

      return res.redirect(302, resolved.downloadUrl);
    } catch (error) {
      console.error("[/api/assets/:id/download] Error:", error);
      return res.status(500).json({ error: "Failed to download asset" });
    }
  });

  /**
   * GET /api/assets/:id/thumb
   * Get thumbnail for an asset by ID
   * Proxies through /objects/ endpoint
   */
  app.get("/api/assets/:id/thumb", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const assetId = req.params.id; // Asset IDs are strings (varchar)
      if (!assetId) {
        return res.status(400).json({ error: "Invalid asset ID" });
      }

      const organizationId = getRequestOrganizationId(req);
      
      // Lookup asset
      const [asset] = await db
        .select({
          id: assets.id,
          fileRecordId: assets.fileRecordId,
          fileName: assets.fileName,
        })
        .from(assets)
        .where(and(
          eq(assets.id, assetId),
          eq(assets.organizationId, organizationId)
        ))
        .limit(1);

      if (!asset) {
        // No thumbnail available, return 404
        return res.status(404).json({ error: "Thumbnail not found" });
      }

      const thumbAccess = await resolveDerivativeFileAccess(asset, "thumbnail", {
        logOnce: createRequestLogOnce(),
      });

      if (!thumbAccess.url || !thumbAccess.objectPath) {
        return res.status(404).json({ error: "Thumbnail not found" });
      }

      // Redirect to authenticated /objects/ proxy
      const objectPath = thumbAccess.objectPath;
      const filename = asset.fileName ? `thumb_${asset.fileName}` : 'thumbnail';
      const redirectUrl = `/objects/${objectPath}?filename=${encodeURIComponent(filename)}`;
      
      return res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("[/api/assets/:id/thumb] Error:", error);
      return res.status(500).json({ error: "Failed to fetch thumbnail" });
    }
  });

  /**
   * POST /api/objects/upload
   * Get signed upload URL for direct file upload to storage
   * Admin-only endpoint
   */
  app.post("/api/objects/upload", isAuthenticated, tenantContextMiddleware, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const body = (req.body ?? {}) as any;
      const fileName = typeof body.fileName === "string" ? body.fileName : null;
      const fileSizeBytes =
        body.fileSizeBytes != null
          ? Number(body.fileSizeBytes)
          : body.fileSize != null
            ? Number(body.fileSize)
            : 0;
      const requestedStorageTarget =
        typeof body.requestedStorageTarget === "string"
          ? body.requestedStorageTarget
          : typeof body.storageTarget === "string"
            ? body.storageTarget
            : null;

      const initiated = await storageApplicationService.initiateUpload({
        organizationId,
        fileName,
        fileSizeBytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : 0,
        requestedTarget: requestedStorageTarget,
      });

      res.json(initiated);
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res.status(error?.statusCode ?? 500).json({
        message: error?.message || "Failed to get upload URL",
        code: error?.code ?? null,
        maxUploadBytes: error?.maxUploadBytes ?? null,
      });
    }
  });

  /**
   * POST /api/objects/acl
   * Set ACL policy for an object (GCS only)
   * Admin-only endpoint
   */
  // Object paths are not tenant-scoped by this legacy endpoint. Keep its
  // established global-admin boundary until object ownership is enforced.
  app.post("/api/objects/acl", isAuthenticated, platformIsAdmin, async (req: any, res) => {
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

      const { uploadId, fileName, fileUrl, fileSize, mimeType, description, fileBuffer, originalFilename, storageTarget, requestedStorageTarget } = req.body;

      const requestedTarget =
        (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
        (typeof storageTarget === 'string' ? storageTarget : null);
      const { hasPageCountStatusColumn } = await import("../db");
      const pdfColumnsExist = hasPageCountStatusColumn() === true;

      const bufferForDecision = fileBuffer ? Buffer.from(fileBuffer, 'base64') : null;

      // Detect if this is a PDF (by mimeType or filename)
      const resolvedUploadName = (originalFilename || fileName || "") as string;
      const lowerMime = (mimeType || "").toString().toLowerCase();
      const isPdfEarly = lowerMime.includes("pdf") || resolvedUploadName.toLowerCase().endsWith(".pdf");

      const thumbStatus = isPdfEarly && pdfColumnsExist ? ("thumb_pending" as const) : ("uploaded" as const);
      const pageCountStatus = pdfColumnsExist ? (isPdfEarly ? ("detecting" as const) : ("unknown" as const)) : undefined;

      if (isPdfEarly && !pdfColumnsExist) {
        console.warn(
          `[QuoteFiles:POST] PDF detected but page_count_status column missing; PDF processing disabled for ${resolvedUploadName}`
        );
      }

      if (uploadId && typeof uploadId === "string") {
        const attachment = await persistQuoteAttachment({
          quoteId: req.params.id,
          organizationId,
          userId,
          userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
          description,
          requestedTarget,
          thumbStatus,
          pageCountStatus,
          source: {
            kind: "upload-session",
            uploadId,
            expectedPurpose: "quote-attachment",
            expectedParentId: req.params.id,
          },
        });

        const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
        return res.json({ success: true, data: enrichedAttachment });
      }

      // Support both legacy and new upload methods
      if (!fileName && !originalFilename) {
        return res.status(400).json({ error: "fileName or originalFilename is required" });
      }
      if (!fileBuffer && !fileUrl) {
        return res.status(400).json({ error: "fileUrl is required for legacy uploads" });
      }

      const attachment = fileBuffer && originalFilename
        ? await persistQuoteAttachment({
            quoteId: req.params.id,
            organizationId,
            userId,
            userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
            description,
            requestedTarget,
            thumbStatus,
            pageCountStatus,
            source: {
              kind: "buffer",
              buffer: bufferForDecision || Buffer.from(fileBuffer, 'base64'),
              originalFilename,
              mimeType: (mimeType || 'application/octet-stream') as string,
            },
          })
        : fileUrl && (fileUrl.startsWith("http://") || fileUrl.startsWith("https://"))
          ? (
              await db.insert(quoteAttachments).values({
                quoteId: req.params.id,
                organizationId,
                uploadedByUserId: userId,
                uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
                description: description || null,
                fileName,
                fileUrl,
                fileSize: fileSize || null,
                mimeType: mimeType || null,
                originalFilename: originalFilename || fileName || null,
                storageProvider: undefined,
                bucket: "titan-private",
                thumbStatus,
                pageCountStatus: pageCountStatus as any,
              }).returning()
            )[0]
          : await persistQuoteAttachment({
              quoteId: req.params.id,
              organizationId,
              userId,
              userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
              description,
              requestedTarget,
              thumbStatus,
              pageCountStatus,
              source: {
                kind: "existing-key",
                fileUrl: normalizeObjectKeyForDb(fileUrl),
                originalFilename: (originalFilename || fileName) as string,
                mimeType: mimeType || null,
                fileSize: fileSize || null,
              },
            });

      const canonicalOriginal = attachment.fileRecordId
        ? await canonicalFileReadResolver.resolveOriginal(String(attachment.fileRecordId))
        : null;
      const canonicalStorageKey = canonicalOriginal?.objectKey ?? canonicalOriginal?.localPathRef ?? null;
      const canonicalStorageProvider = canonicalOriginal?.providerType
        ?? (canonicalOriginal?.localPathRef ? "local_filesystem" : canonicalOriginal?.objectKey ? "supabase" : null);

      // Best-effort self-check for Supabase-backed keys (non-blocking)
      if (canonicalStorageProvider === "supabase" && canonicalStorageKey) {
        res.on("finish", () => {
          scheduleSupabaseObjectSelfCheck({
            bucket: "titan-private",
            path: canonicalStorageKey,
            context: { attachmentType: "quote", quoteId: req.params.id, attachmentId: attachment.id },
          });
        });
      }

      // Fire-and-forget thumbnail generation for images (non-blocking)
      // Use isSupportedImageType helper which supports both mimeType and fileName-based detection
      const { isSupportedImageType } = await import("../services/thumbnailGenerator");
      const attachmentFileNameForThumb = attachment.originalFilename || attachment.fileName || null;
      const isSupportedImage = isSupportedImageType(attachment.mimeType, attachmentFileNameForThumb);
      const hasStorageProviderForThumb = !!canonicalStorageProvider;
      const isNotHttpUrlForThumb = !!canonicalStorageKey;

      if (
        isSupportedImage &&
        hasStorageProviderForThumb &&
        isNotHttpUrlForThumb &&
        canonicalStorageKey &&
        (canonicalStorageProvider === "local_filesystem" || canonicalStorageProvider === "supabase")
      ) {
        const { generateImageDerivatives, isThumbnailGenerationEnabled } = await import(
          "../services/thumbnailGenerator"
        );
        if (isThumbnailGenerationEnabled()) {
          void generateImageDerivatives(
            attachment.id,
            "quote",
            canonicalStorageKey,
            attachment.mimeType || null,
            canonicalStorageProvider,
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
          `[QuoteFiles:POST] Skipping thumbnail generation for ${attachment.id}: canonicalStorageProvider=${canonicalStorageProvider}, canonicalStorageKey=${canonicalStorageKey}`
        );
      }

      // Fire-and-forget PDF thumbnail generation for PDFs (non-blocking)
      const attachmentFileNameForPdf = (
        (attachment.originalFilename ?? attachment.fileName ?? "") as string
      ).toLowerCase();
      const isPdf =
        (attachment.mimeType ?? "").toLowerCase().includes("pdf") || attachmentFileNameForPdf.endsWith(".pdf");
      const normalizedStorageProvider = canonicalStorageProvider;

      if (
        isPdf &&
        pdfColumnsExist &&
        normalizedStorageProvider &&
        isNotHttpUrlForThumb &&
        canonicalStorageKey
      ) {
        res.on("finish", () => {
          setImmediate(() => {
            void (async () => {
              try {
                const { processPdfAttachmentDerivedData } = await import("../services/pdfProcessing");
                await processPdfAttachmentDerivedData({
                  orgId: organizationId,
                  attachmentId: attachment.id,
                  storageKey: canonicalStorageKey,
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

      const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
      res.json({ success: true, data: enrichedAttachment });
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

      const deleted = await deleteQuoteAttachmentWithCleanup({
        organizationId,
        quoteId: req.params.id,
        attachmentId: req.params.fileId,
        quoteLineItemId: null,
      });

      if (!deleted) return res.status(404).json({ error: "Quote attachment not found" });

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

      const { filename, mimeType, size, purpose, quoteId, orderId, temporary } = req.body || {};
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
        const isTemporaryOrderUpload = temporary === true;
        if (!isTemporaryOrderUpload && (!orderId || typeof orderId !== "string"))
          return res.status(400).json({ error: "orderId is required for order-attachment" });

        // Validate order belongs to org
        if (!isTemporaryOrderUpload) {
          const order = await storage.getOrderById(organizationId, orderId);
          if (!order) return res.status(404).json({ error: "Order not found" });
        }
      }

      // Chunk staging is temporary, but this checks the eventual canonical
      // destination before accepting potentially large data onto Railway disk.
      const intake = await storageApplicationService.preflightCanonicalUpload({
        organizationId,
        fileName: filename,
        fileSizeBytes: Number(size),
      });

      const { createUploadSession } = await import("../services/chunkedUploads");
      const session = await createUploadSession({
        organizationId,
        createdByUserId: userId,
        purpose,
        quoteId: purpose === "quote-attachment" ? quoteId : null,
        orderId: purpose === "order-attachment" && typeof orderId === "string" ? orderId : null,
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
          storageTarget: intake.storageTarget,
          maxUploadBytes: intake.maxUploadBytes ?? null,
        },
      });
    } catch (error: any) {
      console.error("[Uploads:Init] Error:", error);
      return res.status(error?.statusCode ?? 500).json({
        error: error?.message || "Failed to initialize upload",
        code: error?.code ?? null,
        maxUploadBytes: error?.maxUploadBytes ?? null,
      });
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
      const { quoteId, orderId, temporary } = req.body || {};
      if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

      const isTemporaryOrderUpload = temporary === true;
      // Require either quoteId/orderId, except finalized TEMP order uploads during /orders/new.
      if (!quoteId && !orderId && !isTemporaryOrderUpload) return res.status(400).json({ error: "quoteId or orderId is required" });
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

  app.post("/api/quotes/:quoteId/attachments/:attachmentId/customer-upload-review", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalStaffUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const parsed = customerUploadReviewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });

      const updated = await reviewCustomerUpload({
        organizationId,
        entityType: "quote",
        entityId: req.params.quoteId,
        attachmentId: req.params.attachmentId,
        status: parsed.data.status,
        reviewNote: parsed.data.reviewNote,
        actorUserId: userId,
        actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
        ipAddress: req.ip,
        userAgent: req.get?.("user-agent") || null,
      });
      return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
    } catch (error: any) {
      if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
      console.error("[QuoteAttachments:CustomerUploadReview] Error:", error);
      return res.status(500).json({ error: "Failed to review customer upload" });
    }
  });

  app.post("/api/quotes/:quoteId/attachments/:attachmentId/customer-upload-promotion", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalStaffUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const parsed = customerUploadPromotionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });

      const updated = await promoteCustomerUpload({
        organizationId,
        entityType: "quote",
        entityId: req.params.quoteId,
        attachmentId: req.params.attachmentId,
        promotion: parsed.data.promotion,
        actorUserId: userId,
        actorUserName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
        ipAddress: req.ip,
        userAgent: req.get?.("user-agent") || null,
      });
      return res.json({ success: true, data: await enrichAttachmentWithUrls(updated) });
    } catch (error: any) {
      if (error instanceof CustomerUploadReviewError) return res.status(error.statusCode).json({ error: error.message });
      console.error("[QuoteAttachments:CustomerUploadPromotion] Error:", error);
      return res.status(500).json({ error: "Failed to promote customer upload" });
    }
  });

  app.patch("/api/quotes/:quoteId/attachments/:attachmentId/portal-visibility", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalStaffUser(req, res)) return;

      const { quoteId, attachmentId } = req.params;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);

      const parsed = portalAttachmentVisibilitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") || "Invalid portal visibility payload" });
      }

      const [quote] = await db
        .select({ id: quotes.id })
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
        .limit(1);
      if (!quote) return res.status(404).json({ error: "Attachment not found" });

      const [existing] = await db
        .select()
        .from(quoteAttachments)
        .where(and(
          eq(quoteAttachments.id, attachmentId),
          eq(quoteAttachments.quoteId, quoteId),
          eq(quoteAttachments.organizationId, organizationId),
          isNull(quoteAttachments.quoteLineItemId)
        ))
        .limit(1);

      if (!existing) return res.status(404).json({ error: "Attachment not found" });

      const patch = normalizePortalVisibilityPatch(parsed.data);
      const [updated] = await db
        .update(quoteAttachments)
        .set({
          ...patch,
          portalVisibilityUpdatedAt: new Date(),
          portalVisibilityUpdatedBy: userId,
          updatedAt: new Date(),
        } as any)
        .where(and(
          eq(quoteAttachments.id, attachmentId),
          eq(quoteAttachments.quoteId, quoteId),
          eq(quoteAttachments.organizationId, organizationId),
          isNull(quoteAttachments.quoteLineItemId)
        ))
        .returning();

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId,
          userName: `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email || null,
          actionType: "portal_file_visibility.updated",
          entityType: "quote_attachment",
          entityId: attachmentId,
          entityName: updated?.originalFilename || updated?.fileName || attachmentId,
          description: patch.customerVisible
            ? "Quote attachment marked visible in the customer portal."
            : "Quote attachment hidden from the customer portal.",
          oldValues: {
            customerVisible: existing.customerVisible,
            portalFileCategory: existing.portalFileCategory,
            portalDisplayName: existing.portalDisplayName,
            portalDescription: existing.portalDescription,
          },
          newValues: patch,
          ipAddress: req.ip,
          userAgent: req.get?.("user-agent") || null,
        } as any);
      } catch (auditError) {
        console.error("[QuoteAttachments:PortalVisibility] Audit log failed:", auditError);
      }

      const enriched = await enrichAttachmentWithUrls(updated);
      return res.json({ success: true, data: enriched });
    } catch (error) {
      console.error("[QuoteAttachments:PortalVisibility] Error:", error);
      return res.status(500).json({ error: "Failed to update portal visibility" });
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
        requestedStorageTarget,
        storageTarget,
        // Legacy link-only contract (fallback)
        fileName,
        fileUrl,
        fileSize,
        mimeType,
      } = req.body;

      const requestedTarget =
        (typeof requestedStorageTarget === 'string' ? requestedStorageTarget : null) ||
        (typeof storageTarget === 'string' ? storageTarget : null);
      const { hasPageCountStatusColumn } = await import("../db");
      const pdfColumnsExist = hasPageCountStatusColumn() === true;

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
        let created = await persistQuoteAttachment({
          quoteId,
          organizationId,
          userId,
          userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
          description,
          requestedTarget,
          source: {
            kind: "upload-session",
            uploadId,
            expectedPurpose: "quote-attachment",
            expectedParentId: quoteId,
          },
        });

        const createdFileName = (created.originalFilename ?? created.fileName ?? "").toString();
        const createdMimeType = (created.mimeType ?? "").toString().toLowerCase();
        const isPdfUpload = createdMimeType.includes("pdf") || createdFileName.toLowerCase().endsWith(".pdf");

        if (isPdfUpload && pdfColumnsExist) {
          const [updated] = await db
            .update(quoteAttachments)
            .set({
              thumbStatus: "thumb_pending",
              pageCountStatus: "detecting" as any,
              updatedAt: new Date(),
            })
            .where(and(eq(quoteAttachments.id, created.id), eq(quoteAttachments.organizationId, organizationId)))
            .returning();

          if (updated) {
            created = updated;
          }
        }

        try {
          const canonicalOriginal = created.fileRecordId
            ? await canonicalFileReadResolver.resolveOriginal(String(created.fileRecordId))
            : null;
          const canonicalStorageKey = canonicalOriginal?.objectKey ?? canonicalOriginal?.localPathRef ?? null;
          const canonicalStorageProvider = canonicalOriginal?.providerType
            ?? (canonicalOriginal?.localPathRef ? "local_filesystem" : canonicalOriginal?.objectKey ? "supabase" : null);

          if (isPdfUpload && pdfColumnsExist && canonicalStorageKey && canonicalStorageProvider) {
            res.on("finish", () => {
              setImmediate(() => {
                void (async () => {
                  try {
                    const { processPdfAttachmentDerivedData } = await import("../services/pdfProcessing");
                    await processPdfAttachmentDerivedData({
                      orgId: organizationId,
                      attachmentId: created.id,
                      storageKey: canonicalStorageKey,
                      storageProvider: canonicalStorageProvider,
                      mimeType: created.mimeType || null,
                      attachmentType: "quote",
                    });
                  } catch (error: any) {
                    console.error(`[QuoteAttachments:POST] PDF kickoff failed for ${created.id}:`, error);
                  }
                })();
              });
            });
          }
        } catch (kickoffPreparationError: any) {
          console.error(`[QuoteAttachments:POST] PDF kickoff preparation failed (non-blocking) for ${created.id}:`, kickoffPreparationError);
        }

        const enriched = await enrichAttachmentWithUrls(created);
        return res.json({ success: true, data: [enriched] });
      }

      // Preferred: atomic upload+link in a single request.
      // Body format:
      // { files: [{ originalFilename, mimeType, sizeBytes, fileBufferBase64 }], description? }
      if (Array.isArray(files) && files.length > 0) {
        try {
          const inserted = [];

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

            const created = await persistQuoteAttachment({
              quoteId,
              organizationId,
              userId,
              userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
              description,
              requestedTarget,
              source: {
                kind: "buffer",
                buffer: Buffer.from(fileBufferBase64, "base64"),
                originalFilename,
                mimeType: fileMimeType,
              },
            });

            inserted.push(created);
          }

          const enrichedInserted = await Promise.all(inserted.map((file) => enrichAttachmentWithUrls(file)));
          return res.json({ success: true, data: enrichedInserted });
        } catch (error: any) {
          console.error("[QuoteAttachments:POST] Atomic upload failed:", error);
          return res.status(500).json({ error: error?.message || "Failed to upload attachments" });
        }
      }

      // Fallback: link-only (legacy) contract
      if (!fileName) return res.status(400).json({ error: "fileName is required" });
      if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" });

      const isHttp = fileUrl.startsWith('http://') || fileUrl.startsWith('https://');
      const attachment = isHttp
        ? (
            await db.insert(quoteAttachments).values({
              quoteId,
              quoteLineItemId: null,
              organizationId,
              uploadedByUserId: userId,
              uploadedByName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
              fileName,
              originalFilename: fileName,
              fileUrl,
              relativePath: null,
              fileSize: fileSize || null,
              mimeType: mimeType || null,
              description: description || null,
              bucket: "titan-private",
              storageProvider: undefined,
            }).returning()
          )[0]
        : await persistQuoteAttachment({
            quoteId,
            organizationId,
            userId,
            userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
            description,
            requestedTarget,
            source: {
              kind: "existing-key",
              fileUrl: normalizeObjectKeyForDb(fileUrl),
              originalFilename: fileName,
              mimeType: mimeType || null,
              fileSize: fileSize || null,
            },
          });

      const enrichedAttachment = await enrichAttachmentWithUrls(attachment);
      return res.json({ success: true, data: enrichedAttachment });
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
        const resolved = await resolveAttachmentDownloadTarget(attachment, downloadIntent);
        if (!resolved.objectPath) {
          return res.status(404).json({ error: "File unavailable", availabilityStatus: resolved.availabilityStatus });
        }
        return res.redirect(`/objects/${resolved.objectPath}?download=1&filename=${encodeURIComponent(resolved.displayFilename)}`);
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

      const deleted = await deleteQuoteAttachmentWithCleanup({
        organizationId,
        quoteId,
        attachmentId,
        quoteLineItemId: null,
      });

      if (!deleted) return res.status(404).json({ error: "Attachment not found" });

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
          fileRecordId: quoteAttachments.fileRecordId,
          fileName: quoteAttachments.fileName,
          originalFilename: quoteAttachments.originalFilename,
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
          fileRecordId: quoteAttachments.fileRecordId,
          fileName: quoteAttachments.fileName,
          originalFilename: quoteAttachments.originalFilename,
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
        const resolved = await resolveAttachmentDownloadTarget(att, "original");
        if (resolved.objectPath) files.push({ filename: resolved.displayFilename, objectPath: resolved.objectPath });
      }

      for (const att of lineItemAttachmentRows) {
        const resolved = await resolveAttachmentDownloadTarget(att, "original");
        const filenameWithLabel = `line-item-${att.quoteLineItemId}/${resolved.displayFilename}`;
        if (resolved.objectPath) files.push({ filename: filenameWithLabel, objectPath: resolved.objectPath });
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
        fileRecordId?: string | null;
        fileName: string;
        originalFilename?: string | null;
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
            fileRecordId: orderAttachments.fileRecordId,
            fileName: orderAttachments.fileName,
            originalFilename: orderAttachments.originalFilename,
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
              fileRecordId: quoteAttachments.fileRecordId,
              fileName: quoteAttachments.fileName,
              originalFilename: quoteAttachments.originalFilename,
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
              fileRecordId: orderAttachments.fileRecordId,
              fileName: orderAttachments.fileName,
              originalFilename: orderAttachments.originalFilename,
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
              fileRecordId: quoteAttachments.fileRecordId,
              fileName: quoteAttachments.fileName,
              originalFilename: quoteAttachments.originalFilename,
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
            fileRecordId: attachmentsToInclude[0].fileRecordId,
            fileName: attachmentsToInclude[0].fileName,
            originalFilename: attachmentsToInclude[0].originalFilename,
          } : null
        });
      }

      // Build file list with paths using the resolver
      const files: Array<{ filename: string; objectPath: string }> = [];
      const missingFiles: string[] = [];

      for (const att of attachmentsToInclude) {
        const resolved = await resolveAttachmentDownloadTarget(att, downloadIntent);
        
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
