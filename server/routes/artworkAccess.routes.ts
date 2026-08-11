import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { readArtworkFileForOrganization, type ArtworkAccessVariant } from "../services/artwork/ArtworkFileAccessService";

export function registerArtworkAccessRoutes(app: Express, middleware: {
  isAuthenticated: RequestHandler;
  tenantContext: RequestHandler;
  assertInternalUser: (req: any, res: any) => boolean;
}, dependencies: {
  readArtworkFileForOrganization?: typeof readArtworkFileForOrganization;
} = {}): void {
  const readArtwork = dependencies.readArtworkFileForOrganization ?? readArtworkFileForOrganization;
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
      if (!artwork) return res.status(404).json({ message: "Artwork file is unavailable." });

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
