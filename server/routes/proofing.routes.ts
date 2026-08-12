/**
 * proofing.routes.ts — /api/proofing/* routes (internal staff)
 *
 * Routes:
 *   GET  /api/proofing/queue                                          — list proofing queue
 *   GET  /api/proofing/line-item/:lineItemId                          — resolve line item proofing truth
 *   POST /api/proofing/line-item/:lineItemId/versions                 — create proof version
 *   POST /api/proofing/versions/:proofVersionId/send                  — mark proof sent for review (draft only)
 *   POST /api/proofing/versions/:proofVersionId/resend                — resend notification for awaiting_response version
 *   POST /api/proofing/versions/:proofVersionId/respond               — record proof response (staff)
 *   POST /api/proofing/line-item/:lineItemId/manual-approval-override — admin manual override
 *
 * Authorization:
 *   - All endpoints require isAuthenticated + tenantContext.
 *   - assertInternalUser (passed as dep) blocks customer role.
 *   - manual-approval-override additionally requires isAdmin.
 */

import type { Express } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { auditLogs, organizations } from "@shared/schema";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { proofQueueSliceSchema } from "@shared/proofing";
import { getRequestOrganizationId } from "../tenantContext";
import {
  cancelProofVersion,
  createAndSendProofVersion,
  createGeneratedDraftProofVersion,
  createGeneratedCombinedProofVersion,
  createLineItemProofVersionFromExistingAttachment,
  createLineItemProofVersion,
  generateLineItemArtworkPreviewDerivative,
  INCOMPLETE_PROOF_MESSAGE,
  buildEligibleProofArtworkDebugSummary,
  getProofArtworkPreparation,
  listEligibleProofArtworkSources,
  listProofingQueue,
  markLineItemProofNotRequired,
  recordManualProofApprovalOverride,
  recordManualProofApprovalOverrides,
  resolveEligibleProofArtworkPreviewForDisplay,
  resendProofVersion,
  resolveLineItemProofingTruth,
} from "../services/proofingService";
import { canonicalProofingOperations } from "../services/canonicalProofingOperations";
import { createProofAccessToken } from "../services/proofAccessTokenService";
import { emailService } from "../emailService";

/** Matches the pattern used in platform.ts for invite link generation. */
function getBaseUrl(req: any): string {
  return (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

/** Load the org's active default proof disclaimer text (customer-safe). */
async function loadOrgProofDisclaimer(organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const text = (row?.settings as any)?.preferences?.proofing?.defaultProofDisclaimerText;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

/**
 * Normalize an email subject to ASCII-safe punctuation so mail clients render it correctly.
 * Replaces common non-ASCII typographic characters that cause UTF-8/Latin-1 mojibake.
 * Must be applied to every outbound subject just before transport — do not mutate stored templates.
 */
function sanitizeEmailSubject(subject: string): string {
  return subject
    .replace(/[\u2013\u2014]/g, " - ")  // en dash, em dash → spaced hyphen
    .replace(/[\u2018\u2019]/g, "'")     // smart single quotes → straight apostrophe
    .replace(/[\u201C\u201D]/g, '"')     // smart double quotes → straight double quote
    .replace(/ {2,}/g, " ")             // collapse multiple spaces
    .trim();
}

/** Build the built-in default proof notification subject (ASCII-safe). */
function buildDefaultProofEmailSubject(versionNumber: number): string {
  return `Proof Ready for Review - Version ${versionNumber}`;
}

function normalizeProofRecipientEmails(value: string | null | undefined): string | null {
  const emails = String(value || "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (emails.length === 0) return null;
  const invalid = emails.find((email) => !z.string().email().safeParse(email).success);
  if (invalid) {
    throw Object.assign(new Error(`Invalid proof recipient email: ${invalid}`), { statusCode: 400 });
  }
  return emails.join(", ");
}

function buildProofEmailHtml(args: {
  proofLink: string;
  versionNumber: number;
  sentToName: string | null;
  customerMessage: string | null;
  fromName: string;
}): string {
  const greeting = args.sentToName ? `Hi ${args.sentToName},` : "Hi,";
  const customBody = args.customerMessage
    ? `<p style="margin:0 0 16px 0;">${args.customerMessage.replace(/\n/g, "<br>")}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <p style="margin:0 0 16px 0;">${greeting}</p>
  <p style="margin:0 0 16px 0;">A proof is ready for your review (Version ${args.versionNumber}). Please click the button below to view and respond.</p>
  ${customBody}
  <div style="text-align:center;margin:32px 0;">
    <a href="${args.proofLink}"
       style="display:inline-block;background-color:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;font-weight:600;">
      Review Proof
    </a>
  </div>
  <p style="margin:0 0 8px 0;font-size:13px;color:#666;">
    If the button doesn't work, copy and paste this link into your browser:
  </p>
  <p style="margin:0 0 24px 0;font-size:13px;word-break:break-all;">
    <a href="${args.proofLink}" style="color:#2563eb;">${args.proofLink}</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="margin:0;font-size:12px;color:#999;">
    This link expires in 30 days. If you have questions, reply to this email or contact your account manager.
  </p>
</body>
</html>`;
}

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

export function registerProofingRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
    assertInternalUser: (req: any, res: any) => boolean;
  }
): void {
  const { isAuthenticated, tenantContext, isAdmin, assertInternalUser } = middleware;

  app.get("/api/proofing/queue", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const parsedSlice = proofQueueSliceSchema.safeParse(req.query?.slice ?? "all");
      if (!parsedSlice.success) {
        return res.status(400).json({ error: fromZodError(parsedSlice.error).message });
      }

      const queue = await listProofingQueue(db, {
        organizationId,
        slice: parsedSlice.data,
      });

      return res.json({ success: true, data: queue });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error fetching proofing queue:", error);
      return res.status(status).json({ error: error?.message || "Failed to fetch proofing queue" });
    }
  });

  app.get("/api/proofing/line-item/:lineItemId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const truth = await resolveLineItemProofingTruth(db, {
        organizationId,
        lineItemId: String(req.params.lineItemId),
      });

      return res.json({ success: true, data: truth });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error resolving line-item proofing truth:", error);
      return res.status(status).json({ error: error?.message || "Failed to resolve proofing truth" });
    }
  });

  app.get("/api/proofing/line-item/:lineItemId/eligible-artwork", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const preparation = await getProofArtworkPreparation(db, {
        organizationId,
        lineItemId: String(req.params.lineItemId),
      });
      const sources = preparation.sources;
      const eligibleCount = sources.filter((source) => source.eligible).length;
      const debug =
        eligibleCount === 0 && process.env.NODE_ENV !== "production"
          ? await buildEligibleProofArtworkDebugSummary(db, {
              organizationId,
              lineItemId: String(req.params.lineItemId),
              sources,
            })
          : undefined;

      return res.json({
        success: true,
        data: {
          sources,
          artworkSummary: {
            totalQuantity: preparation.totalQuantity,
            artworkCount: preparation.artworkCount,
            allocationMode: preparation.allocationMode,
            allocationIssue: preparation.allocationIssue,
          },
          eligibleCount,
          disabledReason: eligibleCount > 0 ? null : "no eligible artwork found",
          disabledReasonCode: eligibleCount > 0 ? null : "no_eligible_artwork_found",
          ...(debug ? { debug } : {}),
        },
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error resolving eligible artwork:", error);
      return res.status(status).json({
        success: false,
        error: error?.message || "Failed to resolve eligible artwork",
        reason: error?.code || "eligible_artwork_lookup_failed",
      });
    }
  });

  app.get("/api/proofing/line-item/:lineItemId/eligible-artwork/:sourceType/:sourceId/preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const parsed = z.object({
        lineItemId: z.string().trim().min(1),
        sourceType: z.enum(["line_item_artwork", "line_item_asset", "line_item_file"]),
        sourceId: z.string().trim().min(1),
      }).safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: "Invalid artwork preview request" });
      }
      const variant = req.query?.variant === "thumbnail" ? "thumbnail" : "preview";

      const { source, preview } = await resolveEligibleProofArtworkPreviewForDisplay(db, {
        organizationId,
        ...parsed.data,
        variant,
      });

      if (preview.kind === "unavailable" || !preview.sourceBuffer) {
        return res.status(404).json({
          success: false,
          error: preview.previewError || "Artwork preview is unavailable.",
          reason: preview.reason,
        });
      }

      const filename = String(source.originalFilename || source.fileName || "artwork").replace(/[\r\n\\"]/g, "_");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      // Thumbnail derivatives are images even when the source artwork is a PDF.
      // The response MIME type must describe the bytes sent to the <img> element.
      res.type(preview.mimeType || source.mimeType || "application/octet-stream");
      return res.send(preview.sourceBuffer);
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error resolving artwork preview:", error);
      return res.status(status).json({
        success: false,
        error: error?.message || "Failed to resolve artwork preview",
      });
    }
  });

  app.post("/api/proofing/line-items/:lineItemId/generate-preview", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const parsed = z.object({ sourceId: z.string().trim().min(1).optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ success: false, message: fromZodError(parsed.error).message });
      const result = await db.transaction(async (tx) => generateLineItemArtworkPreviewDerivative(tx, {
        organizationId,
        lineItemId: String(req.params.lineItemId),
        sourceId: parsed.data.sourceId ?? null,
      }));

      return res.json({ success: true, data: result, message: result.message });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error generating artwork preview derivative:", error);
      return res.status(status).json({ success: false, message: error?.message || "Failed to generate artwork preview derivative" });
    }
  });

  app.post("/api/proofing/combined/review", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const parsed = z.object({ lineItemIds: z.array(z.string().min(1)).min(2) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, error: fromZodError(parsed.error).message });
      const rows = await Promise.all(Array.from(new Set(parsed.data.lineItemIds)).map(async (lineItemId) => {
        const sources = await listEligibleProofArtworkSources(db, { organizationId, lineItemId });
        return { lineItemId, sources, eligibleCount: sources.filter((source) => source.eligible).length };
      }));
      return res.json({ success: true, data: { rows } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      return res.status(status).json({ success: false, error: error?.message || "Failed to review combined proof selection" });
    }
  });

  app.post("/api/proofing/combined/versions", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        lineItemIds: z.array(z.string().min(1)).min(2),
        internalNotes: z.string().optional().nullable(),
      }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: fromZodError(parsed.error).message });
      }

      const created = await db.transaction(async (tx) => {
        const result = await createGeneratedCombinedProofVersion(tx, {
          organizationId,
          lineItemIds: parsed.data.lineItemIds,
          actorUserId: userId,
          internalNotes: parsed.data.internalNotes ?? null,
        });
        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_version",
          entityId: result.proofVersion.id,
          entityName: `Combined proof v${result.proofVersion.versionNumber}`,
          description: `Created combined proof draft for ${result.lineItems.length} line items`,
          newValues: {
            lineItemIds: result.lineItems.map((lineItem) => lineItem.lineItemId),
            proofFileId: result.proofVersion.proofFileId,
            versionNumber: result.proofVersion.versionNumber,
            status: result.proofVersion.status,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);
        return result;
      });

      return res.json({ success: true, data: created });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error creating combined proof version:", error);
      return res.status(status).json({
        success: false,
        error: error?.message || "Failed to create combined proof",
        reason: error?.code || null,
        lineItemIds: error?.lineItemIds || undefined,
      });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/versions", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const requestBody = req.body?.mode
        ? req.body
        : req.body?.proofFileId
          ? { ...req.body, mode: "uploaded" }
          : req.body;

      const parsed = z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("uploaded"),
          proofFileId: z.string().min(1),
          internalNotes: z.string().optional().nullable(),
        }),
        z.object({
          mode: z.literal("existing_attachment"),
          attachmentId: z.string().min(1),
          internalNotes: z.string().optional().nullable(),
        }),
        z.object({
          mode: z.literal("generated"),
          artworkSourceIds: z.array(z.string().min(1)).optional(),
          internalNotes: z.string().optional().nullable(),
        }),
      ]).safeParse(requestBody);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItemId = String(req.params.lineItemId);
      const created = await db.transaction(async (tx) => {
        let proofVersion: any;
        let proofing: any;

        if (parsed.data.mode === "generated") {
          const result = await createGeneratedDraftProofVersion(tx, {
            organizationId,
            lineItemId,
            actorUserId: userId,
            artworkSourceIds: parsed.data.artworkSourceIds ?? null,
            internalNotes: parsed.data.internalNotes ?? null,
          });
          proofVersion = result.proofVersion;
          proofing = result.proofing;
        } else if (parsed.data.mode === "existing_attachment") {
          proofVersion = await createLineItemProofVersionFromExistingAttachment(tx, {
            organizationId,
            lineItemId,
            attachmentId: parsed.data.attachmentId,
            createdByUserId: userId,
            internalNotes: parsed.data.internalNotes ?? null,
          });
          proofing = await resolveLineItemProofingTruth(tx, {
            organizationId,
            lineItemId,
          });
        } else {
          proofVersion = await createLineItemProofVersion(tx, {
            organizationId,
            lineItemId,
            proofFileId: parsed.data.proofFileId,
            createdByUserId: userId,
            internalNotes: parsed.data.internalNotes ?? null,
            sourceAction: "proof_file_uploaded",
          });
          proofing = await resolveLineItemProofingTruth(tx, {
            organizationId,
            lineItemId,
          });
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_version",
          entityId: proofVersion.id,
          entityName: `Proof v${proofVersion.versionNumber}`,
          description: `Created ${parsed.data.mode === "generated" ? "generated" : "uploaded"} proof draft v${proofVersion.versionNumber} for line item ${lineItemId}`,
          newValues: {
            lineItemId,
            mode: parsed.data.mode,
            proofFileId: proofVersion.proofFileId,
            versionNumber: proofVersion.versionNumber,
            status: proofVersion.status,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        return { proofVersion, proofing };
      });

      return res.json({ success: true, data: created });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error creating proof version:", error);
      return res.status(status).json({
        success: false,
        error: error?.message || "Failed to create proof version",
        reason: error?.code || null,
      });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/send-proof", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("uploaded"),
          proofFileId: z.string().min(1),
          internalNotes: z.string().optional().nullable(),
          sentToName: z.string().optional().nullable(),
          sentToEmail: z.string().optional().nullable(),
          customerMessage: z.string().optional().nullable(),
          subject: z.string().optional().nullable(),
        }),
        z.object({
          mode: z.literal("generated"),
          artworkSourceIds: z.array(z.string().min(1)).optional(),
          internalNotes: z.string().optional().nullable(),
          sentToName: z.string().optional().nullable(),
          sentToEmail: z.string().optional().nullable(),
          customerMessage: z.string().optional().nullable(),
          subject: z.string().optional().nullable(),
        }),
      ]).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const normalizedSentToEmail = normalizeProofRecipientEmails(parsed.data.sentToEmail);
      const lineItemId = String(req.params.lineItemId);
      const customerVisibleDisclaimer = await loadOrgProofDisclaimer(organizationId);

      type EmailPayload = { to: string; rawToken: string; versionNumber: number; sentToName: string | null; customerMessage: string | null; subject: string | null };

      const { emailPayload: proofEmailPayload, ...result } = await db.transaction(async (tx) => {
        const created = await createAndSendProofVersion(tx, {
          organizationId,
          lineItemId,
          actorUserId: userId,
          mode: parsed.data.mode,
          proofFileId: "proofFileId" in parsed.data ? parsed.data.proofFileId : null,
          artworkSourceIds: "artworkSourceIds" in parsed.data ? parsed.data.artworkSourceIds ?? null : null,
          internalNotes: parsed.data.internalNotes ?? null,
          sentToName: parsed.data.sentToName ?? null,
          sentToEmail: normalizedSentToEmail,
          customerMessage: parsed.data.customerMessage ?? null,
          customerVisibleDisclaimer,
        });

        // Create portal access token whenever a recipient email is supplied.
        // Token creation requires proof to be in awaiting_response (guaranteed above).
        let emailPayload: EmailPayload | null = null;
        if (normalizedSentToEmail) {
          const tokenResult = await createProofAccessToken(tx, {
            organizationId,
            lineItemId,
            proofVersionId: created.proofVersion.id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            createdBy: userId,
          });
          emailPayload = {
            to: normalizedSentToEmail,
            rawToken: tokenResult.rawToken,
            versionNumber: created.proofVersion.versionNumber,
            sentToName: parsed.data.sentToName ?? null,
            customerMessage: parsed.data.customerMessage ?? null,
            subject: parsed.data.subject?.trim() || null,
          };
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_version",
          entityId: created.proofVersion.id,
          entityName: `Proof v${created.proofVersion.versionNumber}`,
          description: `${parsed.data.mode === "generated" ? "Generated" : "Uploaded"} and sent proof version ${created.proofVersion.versionNumber} for line item ${lineItemId}`,
          newValues: {
            lineItemId,
            proofFileId: created.proofVersion.proofFileId,
            versionNumber: created.proofVersion.versionNumber,
            status: created.proofVersion.status,
            mode: parsed.data.mode,
            snapshot: created.snapshot,
            artifact: created.artifact,
            workflowState: created.workflowTransition.toState,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId,
        });

        return { ...created, proofing, emailPayload };
      });

      // Send email after transaction commits — failure is logged but does not roll back.
      if (proofEmailPayload) {
        const baseUrl = getBaseUrl(req);
        const proofLink = `${baseUrl}/portal/proof/${proofEmailPayload.rawToken}`;
        emailService
          .sendEmail(organizationId, {
            to: proofEmailPayload.to,
            subject: sanitizeEmailSubject(proofEmailPayload.subject || buildDefaultProofEmailSubject(proofEmailPayload.versionNumber)),
            html: buildProofEmailHtml({
              proofLink,
              versionNumber: proofEmailPayload.versionNumber,
              sentToName: proofEmailPayload.sentToName,
              customerMessage: proofEmailPayload.customerMessage,
              fromName: req.user?.name || req.user?.email || "Your account manager",
            }),
          })
          .catch((err: any) => {
            console.error("[Proofing] Failed to send proof email after send-proof:", err?.message ?? err);
          });
      }

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error creating and sending proof:", error);
      if (status === 400 && error?.message === INCOMPLETE_PROOF_MESSAGE) {
        return res.status(400).json({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
      }
      return res.status(status).json({
        success: false,
        error: error?.message || "Failed to create and send proof",
        reason: error?.code || null,
      });
    }
  });

  app.post("/api/proofing/versions/:proofVersionId/send", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        sentToName: z.string().optional().nullable(),
        sentToEmail: z.string().optional().nullable(),
        customerMessage: z.string().optional().nullable(),
        subject: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const normalizedSentToEmail = normalizeProofRecipientEmails(parsed.data.sentToEmail);
      const customerVisibleDisclaimer = await loadOrgProofDisclaimer(organizationId);
      type SendEmailPayload = { to: string; rawToken: string; versionNumber: number; sentToName: string | null; customerMessage: string | null; subject: string | null };

      const { emailPayload: sendEmailPayload, ...result } = await db.transaction(async (tx) => {
        const sendResult = await canonicalProofingOperations.sendVersion(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          sentToName: parsed.data.sentToName ?? null,
          sentToEmail: normalizedSentToEmail,
          customerMessage: parsed.data.customerMessage ?? null,
          customerVisibleDisclaimer,
        });

        // Create portal access token whenever a recipient email is supplied.
        let emailPayload: SendEmailPayload | null = null;
        if (normalizedSentToEmail) {
          const tokenResult = await createProofAccessToken(tx, {
            organizationId,
            lineItemId: sendResult.proofVersion.lineItemId,
            proofVersionId: sendResult.proofVersion.id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            createdBy: userId,
          });
          emailPayload = {
            to: normalizedSentToEmail,
            rawToken: tokenResult.rawToken,
            versionNumber: sendResult.proofVersion.versionNumber,
            sentToName: parsed.data.sentToName ?? null,
            customerMessage: parsed.data.customerMessage ?? null,
            subject: parsed.data.subject?.trim() || null,
          };
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "line_item_proof_version",
          entityId: sendResult.proofVersion.id,
          entityName: `Proof v${sendResult.proofVersion.versionNumber}`,
          description: `Sent proof version ${sendResult.proofVersion.versionNumber} for review`,
          oldValues: {
            status: "draft",
            workflowState: sendResult.workflowTransition.fromState,
          },
          newValues: {
            status: sendResult.proofVersion.status,
            lineItemId: sendResult.proofVersion.lineItemId,
            workflowState: sendResult.workflowTransition.toState,
            sentToEmail: sendResult.proofVersion.sentToEmail,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: sendResult.proofVersion.lineItemId,
        });

        return { ...sendResult, proofing, emailPayload };
      });

      if (sendEmailPayload) {
        const baseUrl = getBaseUrl(req);
        const proofLink = `${baseUrl}/portal/proof/${sendEmailPayload.rawToken}`;
        emailService
          .sendEmail(organizationId, {
            to: sendEmailPayload.to,
            subject: sanitizeEmailSubject(sendEmailPayload.subject || buildDefaultProofEmailSubject(sendEmailPayload.versionNumber)),
            html: buildProofEmailHtml({
              proofLink,
              versionNumber: sendEmailPayload.versionNumber,
              sentToName: sendEmailPayload.sentToName,
              customerMessage: sendEmailPayload.customerMessage,
              fromName: req.user?.name || req.user?.email || "Your account manager",
            }),
          })
          .catch((err: any) => {
            console.error("[Proofing] Failed to send proof email after versions/send:", err?.message ?? err);
          });
      }

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error sending proof version for review:", error);
      if (status === 400 && error?.message === INCOMPLETE_PROOF_MESSAGE) {
        return res.status(400).json({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
      }
      return res.status(status).json({ error: error?.message || "Failed to send proof version for review" });
    }
  });

  /**
   * POST /api/proofing/versions/:proofVersionId/resend
   * Re-send the proof notification for an already-sent (awaiting_response) version.
   * Revokes old access tokens, creates a fresh one, and fires the email again.
   * Does NOT create a new proof version or change the version's status.
   */
  app.post("/api/proofing/versions/:proofVersionId/resend", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        sentToName: z.string().optional().nullable(),
        sentToEmail: z.string().optional().nullable(),
        customerMessage: z.string().optional().nullable(),
        subject: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const normalizedSentToEmail = normalizeProofRecipientEmails(parsed.data.sentToEmail);
      const customerVisibleDisclaimer = await loadOrgProofDisclaimer(organizationId);
      type ResendEmailPayload = { to: string; rawToken: string; versionNumber: number; sentToName: string | null; customerMessage: string | null; subject: string | null };

      const { emailPayload: resendEmailPayload, ...result } = await db.transaction(async (tx) => {
        const resendResult = await resendProofVersion(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          sentToName: parsed.data.sentToName ?? null,
          sentToEmail: normalizedSentToEmail,
          customerMessage: parsed.data.customerMessage ?? null,
          customerVisibleDisclaimer,
        });

        let emailPayload: ResendEmailPayload | null = null;
        if (normalizedSentToEmail) {
          const tokenResult = await createProofAccessToken(tx, {
            organizationId,
            lineItemId: resendResult.proofVersion.lineItemId,
            proofVersionId: resendResult.proofVersion.id,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            createdBy: userId,
          });
          emailPayload = {
            to: normalizedSentToEmail,
            rawToken: tokenResult.rawToken,
            versionNumber: resendResult.proofVersion.versionNumber,
            sentToName: parsed.data.sentToName ?? null,
            customerMessage: parsed.data.customerMessage ?? null,
            subject: parsed.data.subject?.trim() || null,
          };
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "line_item_proof_version",
          entityId: resendResult.proofVersion.id,
          entityName: `Proof v${resendResult.proofVersion.versionNumber}`,
          description: `Resent proof notification for version ${resendResult.proofVersion.versionNumber}`,
          newValues: {
            sentToEmail: resendResult.proofVersion.sentToEmail,
            sentAt: resendResult.proofVersion.sentAt,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: resendResult.proofVersion.lineItemId,
        });

        return { ...resendResult, proofing, emailPayload };
      });

      if (resendEmailPayload) {
        const baseUrl = getBaseUrl(req);
        const proofLink = `${baseUrl}/portal/proof/${resendEmailPayload.rawToken}`;
        emailService
          .sendEmail(organizationId, {
            to: resendEmailPayload.to,
            subject: sanitizeEmailSubject(resendEmailPayload.subject || buildDefaultProofEmailSubject(resendEmailPayload.versionNumber)),
            html: buildProofEmailHtml({
              proofLink,
              versionNumber: resendEmailPayload.versionNumber,
              sentToName: resendEmailPayload.sentToName,
              customerMessage: resendEmailPayload.customerMessage,
              fromName: req.user?.name || req.user?.email || "Your account manager",
            }),
          })
          .catch((err: any) => {
            console.error("[Proofing] Failed to send resend proof email:", err?.message ?? err);
          });
      }

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error resending proof notification:", error);
      if (status === 400 && error?.message === INCOMPLETE_PROOF_MESSAGE) {
        return res.status(400).json({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
      }
      return res.status(status).json({ error: error?.message || "Failed to resend proof notification" });
    }
  });

  app.post("/api/proofing/versions/:proofVersionId/cancel", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        reason: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const cancelResult = await cancelProofVersion(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          reason: parsed.data.reason ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "line_item_proof_version",
          entityId: cancelResult.proofVersion.id,
          entityName: `Proof v${cancelResult.proofVersion.versionNumber}`,
          description: `Cancelled proof version ${cancelResult.proofVersion.versionNumber}`,
          oldValues: {
            status: "awaiting_response",
          },
          newValues: {
            status: cancelResult.proofVersion.status,
            orderId: cancelResult.lineItem.orderId,
            lineItemId: cancelResult.lineItem.lineItemId,
            reason: parsed.data.reason ?? null,
            workflowState: cancelResult.workflowTransition?.toState ?? cancelResult.lineItem.workflowState,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: cancelResult.lineItem.lineItemId,
        });

        return {
          proofId: cancelResult.lineItem.lineItemId,
          versionId: cancelResult.proofVersion.id,
          status: cancelResult.proofVersion.status,
          proofing,
        };
      });

      return res.json({ success: true, data: result, message: "Proof version cancelled." });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error cancelling proof version:", error);
      return res.status(status).json({ success: false, message: error?.message || "Failed to cancel proof version" });
    }
  });

  app.post("/api/proofing/versions/:proofVersionId/respond", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        decision: z.enum(["approved", "rejected", "revision_requested"]),
        responseNotes: z.string().optional().nullable(),
        responderName: z.string().optional().nullable(),
        responderEmail: z.string().optional().nullable(),
        responderSource: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const responseResult = await canonicalProofingOperations.recordResponse(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          responderName: parsed.data.responderName ?? null,
          responderEmail: parsed.data.responderEmail ?? null,
          responderSource: parsed.data.responderSource ?? null,
          decision: parsed.data.decision,
          responseNotes: parsed.data.responseNotes ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_approval",
          entityId: responseResult.approval.id,
          entityName: `Proof response ${responseResult.approval.id}`,
          description: `Recorded ${responseResult.approval.decision} response for proof version ${responseResult.approval.proofVersionId}`,
          newValues: {
            lineItemId: responseResult.approval.lineItemId,
            proofVersionId: responseResult.approval.proofVersionId,
            decision: responseResult.approval.decision,
            workflowState: responseResult.workflowTransition.toState,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: responseResult.approval.lineItemId,
        });

        return {
          ...responseResult,
          proofing,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error recording proof response:", error);
      return res.status(status).json({ error: error?.message || "Failed to record proof response" });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/manual-approval-override", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        proofVersionId: z.string().min(1).optional().nullable(),
        overrideReason: z.string().trim().min(1, "Override reason is required"),
        internalNote: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItemId = String(req.params.lineItemId);
      const result = await db.transaction(async (tx) => {
        const overrideResult = await recordManualProofApprovalOverride(tx, {
          organizationId,
          lineItemId,
          proofVersionId: parsed.data.proofVersionId ?? null,
          actorUserId: userId,
          actorName: req.user?.name ?? null,
          actorEmail: req.user?.email ?? null,
          overrideReason: parsed.data.overrideReason,
          internalNote: parsed.data.internalNote ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_manual_approval_override",
          entityId: overrideResult.manualApprovalOverride.id,
          entityName: `Manual proof override ${overrideResult.manualApprovalOverride.id}`,
          description: `Manual approval override recorded for proof version ${overrideResult.manualApprovalOverride.proofVersionId}`,
          newValues: {
            source: "manual_override",
            lineItemId,
            proofVersionId: overrideResult.manualApprovalOverride.proofVersionId,
            overrideReason: overrideResult.manualApprovalOverride.overrideReason,
            internalNote: overrideResult.manualApprovalOverride.internalNote,
            workflowState: overrideResult.workflowTransition.toState,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId,
        });

        return {
          ...overrideResult,
          proofing,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error recording manual approval override:", error);
      return res.status(status).json({ error: error?.message || "Failed to record manual approval override" });
    }
  });

  app.post("/api/proofing/line-items/manual-approval-override", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        lineItemIds: z.array(z.string().trim().min(1, "Each selected proof item must have a valid id")).min(1, "Select at least one proof item to override").max(100),
        overrideReason: z.string().trim().min(1, "Override reason is required"),
        internalNote: z.string().optional().nullable(),
      }).superRefine((value, ctx) => {
        if (new Set(value.lineItemIds).size !== value.lineItemIds.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lineItemIds"], message: "Selected proof items must not contain duplicates" });
        }
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const overrides = await recordManualProofApprovalOverrides(tx, {
          organizationId,
          lineItemIds: parsed.data.lineItemIds,
          actorUserId: userId,
          actorName: req.user?.name ?? null,
          actorEmail: req.user?.email ?? null,
          overrideReason: parsed.data.overrideReason,
          internalNote: parsed.data.internalNote ?? null,
        });

        const items = [];
        for (let index = 0; index < overrides.length; index += 1) {
          const lineItemId = parsed.data.lineItemIds[index]!;
          const overrideResult = overrides[index]!;
          await tx.insert(auditLogs).values({
            organizationId,
            userId,
            userName: req.user?.email || req.user?.name || null,
            actionType: "CREATE",
            entityType: "line_item_proof_manual_approval_override",
            entityId: overrideResult.manualApprovalOverride.id,
            entityName: `Manual proof override ${overrideResult.manualApprovalOverride.id}`,
            description: `Manual approval override recorded for proof version ${overrideResult.manualApprovalOverride.proofVersionId}`,
            newValues: {
              source: "manual_override",
              lineItemId,
              proofVersionId: overrideResult.manualApprovalOverride.proofVersionId,
              overrideReason: overrideResult.manualApprovalOverride.overrideReason,
              internalNote: overrideResult.manualApprovalOverride.internalNote,
              workflowState: overrideResult.workflowTransition.toState,
            },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
          } as any);

          items.push({
            lineItemId,
            ...overrideResult,
            proofing: await resolveLineItemProofingTruth(tx, { organizationId, lineItemId }),
          });
        }
        return { items };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error recording bulk manual approval override:", error);
      return res.status(status).json({ error: error?.message || "Failed to record manual approval overrides" });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/mark-proof-not-required", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: "User ID not found" });

      const parsed = z.object({
        reason: z.string().min(1, "Reason is required").max(1000),
        internalNote: z.string().max(2000).optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ success: false, message: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const markResult = await markLineItemProofNotRequired(tx, {
          organizationId,
          lineItemId: String(req.params.lineItemId),
          actorUserId: userId,
          reason: parsed.data.reason,
          internalNote: parsed.data.internalNote ?? null,
        });
        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: String(req.params.lineItemId),
        });
        return { ...markResult, proofing };
      });

      return res.json({ success: true, data: result, message: "Proof gate removed for this line item." });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Proofing] Error marking proof not required:", error);
      return res.status(status).json({ success: false, message: error?.message || "Failed to mark proof not required" });
    }
  });
}
