import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { readArtworkFileForOrganization, type ArtworkAccessVariant } from "../services/artwork/ArtworkFileAccessService";
import { requestArtworkDerivativeRecovery } from "../services/artwork/requestArtworkDerivativeRecovery";

export function registerArtworkAccessRoutes(app: Express, middleware: {
  isAuthenticated: RequestHandler;
  tenantContext: RequestHandler;
  assertInternalUser: (req: any, res: any) => boolean;
}, dependencies: {
  readArtworkFileForOrganization?: typeof readArtworkFileForOrganization;
  requestArtworkDerivativeRecovery?: typeof requestArtworkDerivativeRecovery;
  inspectArtworkPdfSize?: typeof import("../services/artwork/ArtworkPdfSizeService").inspectArtworkPdfSize;
} = {}): void {
  const readArtwork = dependencies.readArtworkFileForOrganization ?? readArtworkFileForOrganization;
  const requestRecovery = dependencies.requestArtworkDerivativeRecovery ?? requestArtworkDerivativeRecovery;
  app.post("/api/artwork/pdf-size", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    if (!middleware.assertInternalUser(req, res)) return;
    const organizationId = getRequestOrganizationId(req);
    const userId = req.user?.id ?? req.user?.claims?.sub;
    const source = z.union([
      z.object({ uploadId: z.string().uuid() }).strict(),
      z.object({ fileRecordId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/) }).strict(),
    ]).safeParse(req.body);
    if (!organizationId || !userId || !source.success) return res.status(400).json({ message: "Dimensions unavailable." });
    res.setHeader("Cache-Control", "no-store");
    try {
      const inspect = dependencies.inspectArtworkPdfSize ?? (await import("../services/artwork/ArtworkPdfSizeService")).inspectArtworkPdfSize;
      const analysis = await inspect({ organizationId, userId, source: source.data });
      if (!analysis) return res.status(404).json({ message: "Dimensions unavailable." });
      return res.json({ success: true, data: { analysis } });
    } catch {
      return res.status(422).json({ message: "Dimensions unavailable." });
    }
  });
  app.get("/api/artwork/file-records/:fileRecordId/content", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    if (!middleware.assertInternalUser(req, res)) return;
    const organizationId = getRequestOrganizationId(req);
    const parsed = z.object({ fileRecordId: z.string().trim().min(1) }).safeParse(req.params);
    if (!organizationId || !parsed.success) return res.status(404).json({ message: "Artwork file is unavailable." });

    const variant: ArtworkAccessVariant = req.query?.variant === "thumbnail"
      ? "thumbnail"
      : req.query?.variant === "preview"
        ? "preview"
        : "original";
    try {
      const artwork = await readArtwork({ organizationId, fileRecordId: parsed.data.fileRecordId, variant });
      if (!artwork) {
        if (variant !== "original") {
          try {
            await requestRecovery({ organizationId, fileRecordId: parsed.data.fileRecordId, variant });
          } catch (recoveryError) {
            console.error("[ArtworkAccess] Could not request derivative recovery", recoveryError);
          }
        }
        return res.status(404).json({ message: "Artwork file is unavailable." });
      }

      const filename = artwork.filename.replace(/[\r\n\\"]/g, "_");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.setHeader("Content-Disposition", `${req.query?.download === "1" ? "attachment" : "inline"}; filename="${filename}"`);
      res.type(artwork.mimeType);
      return res.send(artwork.buffer);
    } catch (error) {
      console.error("[ArtworkAccess] Failed to read canonical artwork", error);
      return res.status(404).json({ message: "Artwork file is unavailable." });
    }
  });
}
