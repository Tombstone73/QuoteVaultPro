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
import { auditLogs, orderAttachments, lineItemProofVersions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { validateProofToken } from "../services/proofAccessTokenService";
import { buildProofInputSnapshot, recordProofResponse } from "../services/proofingService";
import { enrichAttachmentWithUrls } from "../lib/supabaseObjectHelpers";

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

      // Fetch customer-visible text fields snapshotted at send time.
      const [proofVersionTexts] = await db
        .select({
          customerMessage: lineItemProofVersions.customerMessage,
          customerVisibleDisclaimer: lineItemProofVersions.customerVisibleDisclaimer,
        })
        .from(lineItemProofVersions)
        .where(eq(lineItemProofVersions.id, validation.proofVersion.id))
        .limit(1);

      // Build customer-safe proof specs from the line item snapshot.
      // Catch and swallow errors so a snapshot failure never breaks the proof page.
      let proofSpecs: {
        orderNumber: string | null;
        displaySizeLabel: string | null;
        quantity: number | null;
        selectedOptionMap: Record<string, string>;
      } | null = null;
      try {
        const snapshot = await buildProofInputSnapshot(db, {
          organizationId: validation.tokenRecord.organizationId,
          lineItemId: validation.tokenRecord.lineItemId,
        });
        proofSpecs = {
          orderNumber: snapshot.orderNumber ?? null,
          displaySizeLabel: snapshot.displaySizeLabel ?? null,
          quantity: snapshot.quantity ?? null,
          selectedOptionMap: snapshot.selectedOptionMap ?? {},
        };
      } catch {
        // Non-critical — proof page still renders without specs
      }

      return res.json({
        success: true,
        data: {
          proofVersion: {
            id: validation.proofVersion.id,
            versionNumber: validation.proofVersion.versionNumber,
            createdAt: new Date(validation.proofVersion.createdAt).toISOString(),
          },
          proofSpecs,
          attachments: [
            {
              id: enrichedAttachment.id,
              fileName: enrichedAttachment.fileName,
              originalFilename: enrichedAttachment.originalFilename ?? null,
              mimeType: enrichedAttachment.mimeType ?? null,
              createdAt: new Date(enrichedAttachment.createdAt).toISOString(),
              originalUrl: enrichedAttachment.originalUrl ?? null,
              downloadUrl: enrichedAttachment.downloadUrl ?? null,
              previewUrl: enrichedAttachment.previewUrl ?? null,
              thumbnailUrl: enrichedAttachment.thumbnailUrl ?? null,
              pages: Array.isArray(enrichedAttachment.pages)
                ? enrichedAttachment.pages.map((page: any) => ({
                    pageIndex: page.pageIndex,
                    thumbUrl: page.thumbUrl ?? null,
                    previewUrl: page.previewUrl ?? null,
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
