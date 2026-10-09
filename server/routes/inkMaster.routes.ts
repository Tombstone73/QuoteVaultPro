import type { Express, Request, Response } from "express";
import { z } from "zod";
import { inkMasterPrinterInputSchema, inkMasterSpecInputSchema } from "@shared/inkMaster";
import { getRequestOrganizationId } from "../tenantContext";
import * as inkMasterService from "../services/inkMasterService";

const idSchema = z.string().min(1).max(100);
const printerPatchSchema = inkMasterPrinterInputSchema.partial().refine((value) => Object.keys(value).length > 0);
const specPatchSchema = inkMasterSpecInputSchema.partial().refine((value) => Object.keys(value).length > 0);

function respondError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, code: "INK_MASTER_VALIDATION_ERROR", error: "Invalid Ink Master input", details: error.errors });
  }
  if (error instanceof inkMasterService.InkMasterError) {
    return res.status(error.status).json({ success: false, code: error.status === 404 ? "INK_MASTER_NOT_FOUND" : "INK_MASTER_CONFLICT", error: error.message });
  }
  if ((error as { code?: string })?.code === "23505") {
    return res.status(409).json({ success: false, code: "INK_MASTER_DUPLICATE", error: "A printer with this name already exists" });
  }
  if ((error as { code?: string })?.code === "23503") {
    return res.status(409).json({ success: false, code: "INK_MASTER_PRINTER_UNAVAILABLE", error: "Select a printer in this organization" });
  }
  console.error("[Ink Master] Request failed", error);
  return res.status(500).json({ success: false, code: "INK_MASTER_ERROR", error: "Ink Master request failed" });
}

function handle(work: (req: Request) => Promise<unknown>, status = 200) {
  return async (req: Request, res: Response) => {
    try {
      const data = await work(req);
      return res.status(status).json({ success: true, data });
    } catch (error) {
      return respondError(res, error);
    }
  };
}

export function registerInkMasterRoutes(
  app: Express,
  middleware: { isAuthenticated: any; tenantContext: any },
  service: typeof inkMasterService = inkMasterService,
) {
  const { isAuthenticated, tenantContext } = middleware;
  const base = "/api/mini-apps/ink-master";

  // tenantContext requires an active staff membership and rejects portal users.
  app.get(`${base}/printers`, isAuthenticated, tenantContext,
    handle((req) => service.listInkMasterPrinters(getRequestOrganizationId(req))));
  app.post(`${base}/printers`, isAuthenticated, tenantContext,
    handle((req) => service.createInkMasterPrinter(getRequestOrganizationId(req), inkMasterPrinterInputSchema.parse(req.body)), 201));
  app.patch(`${base}/printers/:id`, isAuthenticated, tenantContext,
    handle((req) => service.updateInkMasterPrinter(getRequestOrganizationId(req), idSchema.parse(req.params.id), printerPatchSchema.parse(req.body))));
  app.delete(`${base}/printers/:id`, isAuthenticated, tenantContext,
    handle((req) => service.setInkMasterPrinterActive(getRequestOrganizationId(req), idSchema.parse(req.params.id), false)));
  app.post(`${base}/printers/:id/activate`, isAuthenticated, tenantContext,
    handle((req) => service.setInkMasterPrinterActive(getRequestOrganizationId(req), idSchema.parse(req.params.id), true)));

  app.get(`${base}/specs`, isAuthenticated, tenantContext,
    handle((req) => service.listInkMasterSpecs(getRequestOrganizationId(req))));
  app.post(`${base}/specs`, isAuthenticated, tenantContext,
    handle((req) => service.createInkMasterSpec(getRequestOrganizationId(req), inkMasterSpecInputSchema.parse(req.body)), 201));
  app.patch(`${base}/specs/:id`, isAuthenticated, tenantContext,
    handle((req) => service.updateInkMasterSpec(getRequestOrganizationId(req), idSchema.parse(req.params.id), specPatchSchema.parse(req.body))));
  app.delete(`${base}/specs/:id`, isAuthenticated, tenantContext,
    handle((req) => service.deleteInkMasterSpec(getRequestOrganizationId(req), idSchema.parse(req.params.id))));
}
