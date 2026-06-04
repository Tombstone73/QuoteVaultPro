/**
 * companySettings.routes.ts
 *
 * Company Settings routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET   /api/company-settings
 *   POST  /api/company-settings
 *   PATCH /api/company-settings/:id
 *
 * Placement: server/routes/companySettings.routes.ts
 * Registered by: server/routes.ts via registerCompanySettingsRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { assets } from "@shared/schema";
import {
  INVOICE_LOGO_MAX_BYTES,
  INVOICE_LOGO_TOO_LARGE_MESSAGE,
  INVOICE_LOGO_UNSUPPORTED_TYPE_MESSAGE,
  companyInfoInvoiceBrandingSchema,
  isInvoiceLogoAcceptedMimeType,
  normalizeCompanySettingsDto,
  toCompanySettingsDbPayload,
} from "@shared/companyInfoInvoiceBranding";
import { storageApplicationService } from "../services/storage/StorageApplicationService";
import { enrichAssetWithUrls } from "../services/assets/enrichAssetWithUrls";

function getUserId(user: any): string | null {
  return user?.claims?.sub || user?.id || null;
}

const logoUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().refine(isInvoiceLogoAcceptedMimeType, INVOICE_LOGO_UNSUPPORTED_TYPE_MESSAGE),
  dataBase64: z.string().min(1, "Logo file is empty"),
});

function decodeLogoUpload(body: unknown): { fileName: string; mimeType: string; buffer: Buffer } {
  const parsed = logoUploadSchema.parse(body);
  const buffer = Buffer.from(parsed.dataBase64, "base64");
  if (!buffer.length) {
    throw new Error("Logo file is empty");
  }
  if (buffer.length > INVOICE_LOGO_MAX_BYTES) {
    const error = new Error(INVOICE_LOGO_TOO_LARGE_MESSAGE) as Error & { statusCode?: number };
    error.statusCode = 413;
    throw error;
  }
  return {
    fileName: parsed.fileName,
    mimeType: parsed.mimeType,
    buffer,
  };
}

function getZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message || fromZodError(error).message;
}

export function registerCompanySettingsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin } = middleware;

  // Company Settings routes
  app.get("/api/company-settings", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getCompanySettings(organizationId);
      res.json(normalizeCompanySettingsDto(settings ?? null));
    } catch (error) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: "Failed to fetch company settings" });
    }
  });

  app.post("/api/company-settings", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = companyInfoInvoiceBrandingSchema.parse(req.body);
      const settingsPayload = toCompanySettingsDbPayload(settingsData);
      const existing = await storage.getCompanySettings(organizationId);
      const settings = existing
        ? await storage.updateCompanySettings(organizationId, existing.id, settingsPayload)
        : await storage.createCompanySettings(organizationId, settingsPayload);
      res.json(normalizeCompanySettingsDto(settings));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating company settings:", error);
      res.status(500).json({ message: "Failed to create company settings" });
    }
  });

  app.patch("/api/company-settings/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = companyInfoInvoiceBrandingSchema.partial().parse(req.body);
      const existing = await storage.getCompanySettings(organizationId);
      const merged = companyInfoInvoiceBrandingSchema.parse({
        ...normalizeCompanySettingsDto(existing ?? null),
        ...settingsData,
      });
      const updateData = toCompanySettingsDbPayload(merged);
      const settings = existing
        ? await storage.updateCompanySettings(organizationId, req.params.id, updateData)
        : await storage.createCompanySettings(organizationId, updateData);
      res.json(normalizeCompanySettingsDto(settings));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating company settings:", error);
      res.status(500).json({ message: "Failed to update company settings" });
    }
  });

  app.post("/api/company-settings/invoice-logo", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const upload = decodeLogoUpload(req.body);
      const finalized = await storageApplicationService.finalizeUpload({
        organizationId,
        createdByUserId: getUserId(req.user),
        resource: {
          organizationId,
          resourceType: "organization",
          resourceId: organizationId,
        },
        source: {
          kind: "buffer",
          buffer: upload.buffer,
          originalFilename: upload.fileName,
          mimeType: upload.mimeType,
        },
        persistLink: async (tx, stored) => {
          const [created] = await tx.insert(assets).values({
            organizationId,
            fileRecordId: stored.fileRecord.id,
            fileKey: stored.storedObject.objectKey ?? stored.storedObject.localPathRef ?? null,
            fileName: stored.storedObject.originalFilename,
            mimeType: stored.storedObject.mimeType,
            sizeBytes: stored.storedObject.sizeBytes,
            sha256: stored.storedObject.checksum,
            status: "uploaded",
            previewStatus: "pending",
          }).returning();

          if (!created) throw new Error("Failed to create invoice logo asset");
          return created;
        },
      });

      const asset = await enrichAssetWithUrls(finalized.linkedRecord as any);
      const dataUrl = `data:${upload.mimeType};base64,${upload.buffer.toString("base64")}`;

      res.json({
        success: true,
        assetId: asset.id,
        invoiceLogoAssetId: asset.id,
        invoiceLogoUrl: dataUrl,
        previewUrl: asset.originalUrl ?? asset.fileUrl ?? dataUrl,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: getZodMessage(error) });
      }
      const message = error instanceof Error ? error.message : "Failed to upload invoice logo";
      const status = typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : 400;
      if (status >= 500) {
        console.error("Error uploading invoice logo:", error);
      }
      res.status(status).json({ success: false, message });
    }
  });
}
