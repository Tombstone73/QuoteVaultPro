/**
 * portalProof.routes.ts — /api/portal/proof/* routes (public, token-based)
 *
 * Routes:
 *   GET  /api/portal/proof/:token        — resolve proof for customer via access token
 *   POST /api/portal/proof/:token/action — record customer approve/reject/revision_request
 *
 * Authorization:
 *   - NO isAuthenticated, NO tenantContext, NO portalContext.
 *   - Org resolution is embedded in the proof access token (via validateProofToken).
 *   - Token validation rejects invalid, expired, or already-resolved tokens.
 */

import type { Express } from "express";
import { db } from "../db";
import { auditLogs, orderAttachments, lineItemProofVersions, quoteAttachmentPages } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { validateProofToken } from "../services/proofAccessTokenService";
import { buildProofInputSnapshot, recordProofResponse } from "../services/proofingService";
import { enrichAttachmentWithUrls, resolveOriginalFileAccess, resolveDerivativeFileAccess } from "../lib/supabaseObjectHelpers";
import { isSupabaseConfigured, SupabaseStorageService } from "../supabaseStorage";

export function registerPortalProofRoutes(app: Express): void {
  app.get("/api/portal/proof/:token", async (req: any, res) => {
    try {
      const validation = await validateProofToken(db, String(req.params.token));

      const [attachment] = await db
        .select({
          id: orderAttachments.id,
          orderId: orderAttachments.orderId,
          orderLineItemId: orderAttachments.orderLineItemId,
          fileRecordId: orderAttachments.fileRecordId,
          fileName: orderAttachments.fileName,
          originalFilename: orderAttachments.originalFilename,
          mimeType: orderAttachments.mimeType,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
          thumbStatus: orderAttachments.thumbStatus,
          createdAt: orderAttachments.createdAt,
        })
        .from(orderAttachments)
        .where(eq(orderAttachments.id, validation.proofVersion.proofFileId))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Proof attachment not found" });
      }

      const enrichedAttachment = await enrichAttachmentWithUrls(attachment);

      // Remap all artifact URLs to the token-scoped portal file proxy so external
      // recipients (no login session) can view and download without hitting the
      // auth-guarded /objects/* routes.
      const fileBase = `/api/portal/proof/${req.params.token}/file`;
      const displayFilename = encodeURIComponent(
        enrichedAttachment.originalFilename ?? enrichedAttachment.fileName ?? "download"
      );

      // Fetch customer-visible text fields snapshotted at send time.
      const [proofVersionTexts] = await db
        .select({
          customerMessage: lineItemProofVersions.customerMessage,
          customerVisibleDisclaimer: lineItemProofVersions.customerVisibleDisclaimer,
        })
        .from(lineItemProofVersions)
        .where(eq(lineItemProofVersions.id, validation.proofVersion.id))
        .limit(1);

      // Build the customer-facing line item display from the order-time snapshot.
      // Uses line item description (product name snapshot) and the resolved selectedOptionMap.
      // Catches and swallows errors so a snapshot failure never breaks the proof page.
      let lineItemDisplay: {
        productName: string | null;
        orderedSize: string | null;
        quantity: number | null;
        detectedArtworkSize: string | null;
        orderNumber: string | null;
        options: Array<{ label: string; value: string }>;
      } | null = null;
      try {
        const snapshot = await buildProofInputSnapshot(db, {
          organizationId: validation.tokenRecord.organizationId,
          lineItemId: validation.tokenRecord.lineItemId,
        });
        lineItemDisplay = {
          productName: snapshot.lineItemLabel?.trim() || null,
          orderedSize: snapshot.displaySizeLabel ?? null,
          quantity: snapshot.quantity ?? null,
          detectedArtworkSize: null, // not yet derivable; placeholder for future preflight data
          orderNumber: snapshot.orderNumber ?? null,
          // Convert the already-filtered selectedOptionMap to an ordered array for direct rendering
          options: Object.entries(snapshot.selectedOptionMap ?? {}).map(([label, value]) => ({ label, value })),
        };
      } catch {
        // Non-critical — proof page still renders without line item display
      }

      return res.json({
        success: true,
        data: {
          proofVersion: {
            id: validation.proofVersion.id,
            versionNumber: validation.proofVersion.versionNumber,
            createdAt: new Date(validation.proofVersion.createdAt).toISOString(),
          },
          lineItemDisplay,
          attachments: [
            {
              id: enrichedAttachment.id,
              fileName: enrichedAttachment.fileName,
              originalFilename: enrichedAttachment.originalFilename ?? null,
              mimeType: enrichedAttachment.mimeType ?? null,
              createdAt: new Date(enrichedAttachment.createdAt).toISOString(),
              originalUrl: enrichedAttachment.originalUrl ? fileBase : null,
              downloadUrl: enrichedAttachment.downloadUrl ? `${fileBase}?download=1&filename=${displayFilename}` : null,
              previewUrl: enrichedAttachment.previewUrl ? `${fileBase}?variant=preview` : null,
              thumbnailUrl: enrichedAttachment.thumbnailUrl ? `${fileBase}?variant=thumb` : null,
              pages: Array.isArray(enrichedAttachment.pages)
                ? enrichedAttachment.pages.map((page: any) => ({
                    pageIndex: page.pageIndex,
                    thumbUrl: page.thumbUrl ? `${fileBase}?variant=page-thumb&pageIndex=${page.pageIndex}` : null,
                    previewUrl: page.previewUrl ? `${fileBase}?variant=page-preview&pageIndex=${page.pageIndex}` : null,
                  }))
                : [],
            },
          ],
          status: validation.currentApprovalState.status,
          proofText: {
            customerNote: proofVersionTexts?.customerMessage?.trim() || null,
            disclaimer: proofVersionTexts?.customerVisibleDisclaimer?.trim() || null,
          },
        },
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[PortalProof] Error resolving proof token:", error);
      return res.status(status).json({ error: error?.message || "Failed to resolve portal proof" });
    }
  });

  /**
   * GET /api/portal/proof/:token/file
   * Token-scoped proof artifact endpoint for external (unauthenticated) recipients.
   *
   * Validates the proof token, resolves the artifact for the given variant, then
   * redirects to a short-lived Supabase signed URL (1 hour TTL).
   *
   * Query params:
   *   variant   — "original" (default) | "preview" | "thumb" | "page-thumb" | "page-preview"
   *   pageIndex — required for page-thumb / page-preview (0-based)
   *   download  — "1" to signal download intent (passed through; Supabase handles disposition)
   *   filename  — suggested filename for downloads (informational)
   *
   * Access scope: only the proof artifact associated with this token's proofVersionId.
   * Never exposes other files, buckets, or org assets.
   */
  app.get("/api/portal/proof/:token/file", async (req: any, res) => {
    try {
      const validation = await validateProofToken(db, String(req.params.token));
      const variant = (req.query.variant as string) || "original";

      const [attachment] = await db
        .select({
          id: orderAttachments.id,
          fileRecordId: orderAttachments.fileRecordId,
          fileName: orderAttachments.fileName,
          originalFilename: orderAttachments.originalFilename,
          mimeType: orderAttachments.mimeType,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
        })
        .from(orderAttachments)
        .where(eq(orderAttachments.id, validation.proofVersion.proofFileId))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Proof artifact not found" });
      }

      let objectPath: string | null = null;

      if (variant === "original") {
        const access = await resolveOriginalFileAccess(attachment);
        objectPath = access.objectPath;
      } else if (variant === "preview") {
        const access = await resolveDerivativeFileAccess(attachment, "preview");
        objectPath = access.objectPath;
      } else if (variant === "thumb") {
        const access = await resolveDerivativeFileAccess(attachment, "thumbnail");
        objectPath = access.objectPath;
      } else if (variant === "page-thumb" || variant === "page-preview") {
        const pageIndex = Math.max(0, parseInt(String(req.query.pageIndex ?? "0"), 10));
        const [page] = await db
          .select({
            id: quoteAttachmentPages.id,
            thumbFileRecordId: quoteAttachmentPages.thumbFileRecordId,
            previewFileRecordId: quoteAttachmentPages.previewFileRecordId,
          })
          .from(quoteAttachmentPages)
          .where(and(
            eq(quoteAttachmentPages.attachmentId, attachment.id),
            eq(quoteAttachmentPages.pageIndex, pageIndex),
          ))
          .limit(1);
        if (!page) return res.status(404).json({ error: "Proof page not found" });
        const fileRecordId = variant === "page-thumb" ? page.thumbFileRecordId : page.previewFileRecordId;
        if (!fileRecordId) return res.status(404).json({ error: "Page variant not available" });
        const access = await resolveOriginalFileAccess({ id: page.id, fileRecordId, mimeType: "image/jpeg" });
        objectPath = access.objectPath;
      }

      if (!objectPath) {
        return res.status(404).json({ error: "Proof file not available" });
      }

      if (!isSupabaseConfigured()) {
        console.error("[PortalProof/file] Supabase not configured — cannot serve proof artifact without auth");
        return res.status(503).json({ error: "File serving not available in this environment" });
      }

      const svc = new SupabaseStorageService();
      const signedUrl = await svc.getSignedDownloadUrl(objectPath, 3600);
      return res.redirect(302, signedUrl);
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[PortalProof/file] Error serving proof artifact:", error);
      return res.status(status).json({ error: error?.message || "Failed to serve proof artifact" });
    }
  });

  app.post("/api/portal/proof/:token/action", async (req: any, res) => {
    try {
      const parsed = z.object({
        action: z.enum(["approve", "reject", "revision_request"]),
        comment: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const validation = await validateProofToken(tx, String(req.params.token));

        if (validation.currentApprovalState.isOverridden) {
          throw Object.assign(new Error("This proof has already been resolved by manual approval override"), { statusCode: 409 });
        }

        if (validation.currentApprovalState.status !== "pending") {
          throw Object.assign(new Error("This proof has already been resolved"), { statusCode: 409 });
        }

        const decision = parsed.data.action === "approve"
          ? "approved"
          : parsed.data.action === "reject"
            ? "rejected"
            : "revision_requested";

        const responseResult = await recordProofResponse(tx, {
          organizationId: validation.lineItem.organizationId,
          proofVersionId: validation.proofVersion.id,
          actorUserId: null,
          responderName: validation.proofVersion.sentToName ?? null,
          responderEmail: validation.proofVersion.sentToEmail ?? null,
          responderSource: "customer",
          decision,
          responseNotes: parsed.data.comment ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId: validation.lineItem.organizationId,
          userId: null,
          userName: validation.proofVersion.sentToEmail || validation.proofVersion.sentToName || "External customer",
          actionType: "CREATE",
          entityType: "line_item_proof_approval",
          entityId: responseResult.approval.id,
          entityName: `Proof response ${responseResult.approval.id}`,
          description: `Customer recorded ${responseResult.approval.decision} response for proof version ${responseResult.approval.proofVersionId}`,
          newValues: {
            source: "customer",
            lineItemId: responseResult.approval.lineItemId,
            proofVersionId: responseResult.approval.proofVersionId,
            decision: responseResult.approval.decision,
            workflowState: responseResult.workflowTransition.toState,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const updatedValidation = await validateProofToken(tx, String(req.params.token));

        return {
          approval: responseResult.approval,
          workflowTransition: responseResult.workflowTransition,
          status: updatedValidation.currentApprovalState.status,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[PortalProof] Error recording customer proof action:", error);
      return res.status(status).json({ error: error?.message || "Failed to record customer proof action" });
    }
  });
}
