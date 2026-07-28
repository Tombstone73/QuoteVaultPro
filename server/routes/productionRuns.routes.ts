import type { Express } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { createProductionRun, ProductionRunError, transitionProductionRun } from "../services/productionRunService";

const createSchema = z.object({
  orderId: z.string().min(1), stationKey: z.string().min(1).max(40),
  members: z.array(z.object({ productionJobId: z.string().min(1), allocatedQuantity: z.number().int().positive().optional() })).min(1),
  plannedSheetCount: z.number().int().positive().nullable().optional(), nominalPiecesPerSheet: z.number().int().positive().nullable().optional(),
  sheetWidth: z.number().positive().nullable().optional(), sheetHeight: z.number().positive().nullable().optional(), notes: z.string().max(10000).nullable().optional(), compatibilityOverrideReason: z.string().max(2000).nullable().optional(),
});
const transitionSchema = z.object({ action: z.enum(["release", "start", "complete", "cancel"]), reason: z.string().max(2000).nullable().optional() });
const userId = (user: any) => user?.claims?.sub ?? user?.id;

export function registerProductionRunRoutes(app: Express, deps: { isAuthenticated: any; tenantContext: any; assertInternalUser: any }) {
  app.post("/api/production/runs", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const result = await createProductionRun({ organizationId, actorUserId, ...createSchema.parse(req.body) });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ProductionRunError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: "PRODUCTION_RUN_INVALID", message: error.issues[0]?.message ?? "Invalid production run." });
      console.error("[production-runs] create failed", error); return res.status(500).json({ success: false, code: "PRODUCTION_RUN_CREATE_FAILED", message: "Unable to create production run." });
    }
  });
  app.post("/api/production/runs/:runId/transition", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      return res.json({ success: true, data: await transitionProductionRun({ organizationId, actorUserId, runId: req.params.runId, ...transitionSchema.parse(req.body) }) });
    } catch (error) {
      if (error instanceof ProductionRunError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      return res.status(500).json({ success: false, code: "PRODUCTION_RUN_TRANSITION_FAILED", message: "Unable to transition production run." });
    }
  });
}
