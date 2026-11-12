import type { Express, Request, Response } from "express";
import { z } from "zod";
import { productionLabelPreviewRequestSchema, productionLabelPrintRequestSchema } from "@shared/productionItemLabels";
import { getRequestOrganizationId } from "../tenantContext";
import {
  listProductionLabelDestinations, loadProductionLabelSource, previewProductionLabels, ProductionLabelError, queueProductionLabels,
} from "../services/productionItemLabelService";

function sendFailure(res: Response, error: unknown) {
  if (error instanceof ProductionLabelError) return res.status(error.status).json({ success: false, error: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "Check the label quantities, ranges, and media dimensions." });
  console.error("[PRODUCTION ITEM LABELS]", error);
  return res.status(500).json({ success: false, error: "Could not complete the production label request. Retry from the print dialog." });
}

export function registerProductionItemLabelRoutes(app: Express, middleware: {
  isAuthenticated: any; tenantContext: any; assertInternalUser: (req: Request, res: Response) => boolean;
}) {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;
  app.get("/api/orders/:orderId/production-item-labels", isAuthenticated, tenantContext, async (req, res) => {
    if (!assertInternalUser(req, res)) return;
    try {
      const organizationId = getRequestOrganizationId(req);
      const source = await loadProductionLabelSource(organizationId, req.params.orderId);
      const destinations = await listProductionLabelDestinations(organizationId);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, data: { source, destinations } });
    } catch (error) { return sendFailure(res, error); }
  });
  app.post("/api/orders/:orderId/production-item-labels/preview", isAuthenticated, tenantContext, async (req, res) => {
    if (!assertInternalUser(req, res)) return;
    try {
      const input = productionLabelPreviewRequestSchema.parse(req.body);
      const { printer, ...preview } = await previewProductionLabels(getRequestOrganizationId(req), req.params.orderId, input.options, input.destination);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, data: { ...preview, destination: printer?.destination ?? null } });
    } catch (error) { return sendFailure(res, error); }
  });
  app.post("/api/orders/:orderId/production-item-labels/print", isAuthenticated, tenantContext, async (req, res) => {
    if (!assertInternalUser(req, res)) return;
    try {
      const user = req.user as { id?: string; claims?: { sub?: string } } | undefined;
      const userId = user?.claims?.sub ?? user?.id;
      if (!userId) return res.status(401).json({ success: false, error: "Sign in as staff before printing." });
      const input = productionLabelPrintRequestSchema.parse(req.body);
      if (req.header("Idempotency-Key") !== input.requestKey) return res.status(400).json({ success: false, error: "Print request keys must match." });
      const job = await queueProductionLabels(getRequestOrganizationId(req), req.params.orderId, userId, input);
      return res.status(job.duplicate ? 200 : 202).json({ success: true, data: job });
    } catch (error) { return sendFailure(res, error); }
  });
}
