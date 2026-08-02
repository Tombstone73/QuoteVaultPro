import busboy from "busboy";
import type { Express } from "express";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import {
  createPrepressProductionRun,
  createProductionRun,
  downloadProductionRunFile,
  listProductionRunFiles,
  listProductionRuns,
  ProductionRunError,
  recordProductionRunOutcome,
  reconcileCanceledProductionRun,
  repairCompletedProductionRunFulfillmentHandoff,
  reopenCompletedProductionRun,
  replaceProductionRunFile,
  retireProductionRunFile,
  transitionProductionRun,
  uploadProductionRunFile,
} from "../services/productionRunService";

const sheetPlanInputsSchema = z.object({
  sheetWidth: z.number().positive().nullable(),
  sheetHeight: z.number().positive().nullable(),
  allowRotation: z.boolean(),
  bleed: z.number().nonnegative(),
  spacing: z.number().nonnegative(),
  marginTop: z.number().nonnegative(),
  marginRight: z.number().nonnegative(),
  marginBottom: z.number().nonnegative(),
  marginLeft: z.number().nonnegative(),
});
const sheetPlanCalculatedSchema = z.object({
  canAutoPlan: z.boolean(),
  reason: z.string().nullable(),
  reasonCode: z.enum(["none", "empty", "missing_layout", "missing_inputs", "mixed_size", "item_too_large", "layout_error"]),
  inputKey: z.string().min(1),
  calculatorVersion: z.string().min(1),
  totalQuantity: z.number(),
  plannedSheetCount: z.number().int().positive().nullable(),
  nominalPiecesPerSheet: z.number().int().positive().nullable(),
  sheetWidth: z.number().positive().nullable(),
  sheetHeight: z.number().positive().nullable(),
  printPasses: z.number().int().positive().nullable(),
  fullSheets: z.number().int().nonnegative().nullable(),
  partialSheetPieces: z.number().int().nonnegative().nullable(),
  memberQuantities: z.array(z.object({ lineItemId: z.string().min(1), quantity: z.number().nonnegative() })),
});
const sheetPlanSchema = z.object({
  inputs: sheetPlanInputsSchema,
  calculated: sheetPlanCalculatedSchema,
  manualOverride: z.object({
    enabled: z.boolean(),
    plannedSheetCount: z.number().int().positive().nullable().optional(),
    nominalPiecesPerSheet: z.number().int().positive().nullable().optional(),
    reason: z.string().max(2000).nullable().optional(),
    inputKey: z.string().nullable().optional(),
  }).nullable().optional(),
}).optional().nullable();

const createSchema = z.object({
  orderId: z.string().min(1).nullable().optional(), stationKey: z.string().min(1).max(40),
  members: z.array(z.object({ productionJobId: z.string().min(1), allocatedQuantity: z.number().int().positive().optional() })).min(1),
  plannedSheetCount: z.number().int().positive().nullable().optional(), nominalPiecesPerSheet: z.number().int().positive().nullable().optional(),
  sheetWidth: z.number().positive().nullable().optional(), sheetHeight: z.number().positive().nullable().optional(), notes: z.string().max(10000).nullable().optional(), compatibilityOverrideReason: z.string().max(2000).nullable().optional(),
  productionFileStrategy: z.enum(["rip_managed", "staff_prepared"]).optional(),
  sheetPlan: sheetPlanSchema,
});
const createPrepressSchema = createSchema.extend({
  members: z.array(z.object({ lineItemId: z.string().min(1), allocatedQuantity: z.number().int().positive().optional() })).min(1),
});
const transitionSchema = z.object({ action: z.enum(["release", "start", "complete", "cancel"]), reason: z.string().max(2000).nullable().optional() });
const outcomeSchema = z.object({
  idempotencyKey: z.string().max(160).nullable().optional(),
  members: z.array(z.object({
    memberId: z.string().min(1),
    successfulQuantity: z.number().int().nonnegative(),
    damagedQuantity: z.number().int().nonnegative().optional(),
    remainingQuantity: z.number().int().nonnegative().optional(),
    outcomeStatus: z.enum(["pending", "completed", "partially_completed", "failed", "requires_reprint", "return_to_prepress", "cancelled", "hold_for_review"]).optional(),
    recoveryDisposition: z.enum(["none", "return_to_prepress", "return_to_production_queue", "requires_reprint", "hold_for_review", "cancel_remaining"]).nullable().optional(),
    operatorNote: z.string().max(4000).nullable().optional(),
    segments: z.array(z.record(z.string(), z.unknown())).optional(),
  })).min(1),
});
const retireFileSchema = z.object({ reason: z.string().max(2000).nullable().optional() });
const reopenCompletedRunSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
const userId = (user: any) => user?.claims?.sub ?? user?.id;
const actorRole = (req: any) => String(req.orgRole || req.user?.role || "").toLowerCase();
const actorIsAdmin = (req: any) => {
  const role = actorRole(req);
  return role === "owner" || role === "admin" || req.user?.isAdmin === true;
};

function handleProductionRunError(res: any, error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof ProductionRunError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, details: error.details ?? null });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: "PRODUCTION_RUN_INVALID", message: error.issues[0]?.message ?? "Invalid production run request." });
  console.error(`[production-runs] ${fallbackCode}`, error);
  return res.status(500).json({ success: false, code: fallbackCode, message: fallbackMessage });
}

function parseMultipartFile(req: any): Promise<{ buffer: Buffer; fileName: string; mimeType: string; fields: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    let fileBuffer: Buffer | null = null;
    let fileName = "";
    let mimeType = "";
    let fileSize = 0;
    const chunks: Buffer[] = [];
    const fields: Record<string, string> = {};
    const maxFileSizeBytes = 250 * 1024 * 1024;

    bb.on("file", (_name, file, info) => {
      fileName = info.filename;
      mimeType = info.mimeType;
      file.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > maxFileSizeBytes) {
          file.resume();
          return;
        }
        chunks.push(chunk);
      });
      file.on("end", () => {
        if (fileSize <= maxFileSizeBytes) fileBuffer = Buffer.concat(chunks);
      });
    });
    bb.on("field", (name, value) => { fields[name] = value; });
    bb.on("error", reject);
    bb.on("finish", () => {
      if (fileSize > maxFileSizeBytes) return reject(Object.assign(new Error("File size exceeds maximum allowed size of 250MB"), { statusCode: 400, code: "PRODUCTION_RUN_FILE_TOO_LARGE" }));
      if (!fileBuffer) return reject(Object.assign(new Error("No file uploaded"), { statusCode: 400, code: "PRODUCTION_RUN_FILE_REQUIRED" }));
      resolve({ buffer: fileBuffer, fileName, mimeType, fields });
    });
    req.pipe(bb);
  });
}

export function registerProductionRunRoutes(app: Express, deps: { isAuthenticated: any; tenantContext: any; assertInternalUser: any }) {
  app.get("/api/production/runs", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const result = await listProductionRuns({
        organizationId,
        orderId: typeof req.query.orderId === "string" ? req.query.orderId : null,
        stationKey: typeof req.query.station === "string" ? req.query.station : typeof req.query.view === "string" ? req.query.view : null,
        status: req.query.status === "queued" || req.query.status === "in_progress" || req.query.status === "done" ? req.query.status : null,
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error("[production-runs] list failed", error);
      return res.status(500).json({ success: false, code: "PRODUCTION_RUN_LIST_FAILED", message: "Unable to list production runs." });
    }
  });

  app.post("/api/production/runs", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const result = await createProductionRun({ organizationId, actorUserId, ...createSchema.parse(req.body) });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ProductionRunError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, details: error.details ?? null });
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: "PRODUCTION_RUN_INVALID", message: error.issues[0]?.message ?? "Invalid production run." });
      console.error("[production-runs] create failed", error); return res.status(500).json({ success: false, code: "PRODUCTION_RUN_CREATE_FAILED", message: "Unable to create production run." });
    }
  });
  app.post("/api/production/runs/prepress", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const result = await createPrepressProductionRun({ organizationId, actorUserId, ...createPrepressSchema.parse(req.body) });
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ProductionRunError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, details: error.details ?? null });
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: "PRODUCTION_RUN_INVALID", message: error.issues[0]?.message ?? "Invalid production run." });
      console.error("[production-runs] prepress create failed", error); return res.status(500).json({ success: false, code: "PRODUCTION_RUN_CREATE_FAILED", message: "Unable to create production run." });
    }
  });
  app.get("/api/production/runs/:runId/files", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const includeHistory = ["1", "true"].includes(String(req.query.includeHistory || "").toLowerCase());
      return res.json({ success: true, data: await listProductionRunFiles({ organizationId, runId: req.params.runId, includeHistory }) });
    } catch (error) {
      return handleProductionRunError(res, error, "PRODUCTION_RUN_FILE_LIST_FAILED", "Unable to list production run files.");
    }
  });
  app.post("/api/production/runs/:runId/files/upload", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const parsed = await parseMultipartFile(req);
      const result = await uploadProductionRunFile({ organizationId, actorUserId, runId: req.params.runId, buffer: parsed.buffer, originalFilename: parsed.fileName, mimeType: parsed.mimeType || "application/octet-stream" });
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error?.statusCode && error?.code) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      return handleProductionRunError(res, error, "PRODUCTION_RUN_FILE_UPLOAD_FAILED", "Unable to upload production run file.");
    }
  });
  app.post("/api/production/runs/:runId/files/:fileId/replace", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const parsed = await parseMultipartFile(req);
      return res.json({ success: true, data: await replaceProductionRunFile({ organizationId, actorUserId, actorRole: actorRole(req), isAdmin: actorIsAdmin(req), runId: req.params.runId, fileId: req.params.fileId, buffer: parsed.buffer, originalFilename: parsed.fileName, mimeType: parsed.mimeType || "application/octet-stream" }) });
    } catch (error: any) {
      if (error?.statusCode && error?.code) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      return handleProductionRunError(res, error, "PRODUCTION_RUN_FILE_REPLACE_FAILED", "Unable to replace production run file.");
    }
  });
  app.post("/api/production/runs/:runId/files/:fileId/retire", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const body = retireFileSchema.parse(req.body ?? {});
      return res.json({ success: true, data: await retireProductionRunFile({ organizationId, actorUserId, actorRole: actorRole(req), isAdmin: actorIsAdmin(req), runId: req.params.runId, fileId: req.params.fileId, reason: body.reason ?? null }) });
    } catch (error) {
      return handleProductionRunError(res, error, "PRODUCTION_RUN_FILE_RETIRE_FAILED", "Unable to retire production run file.");
    }
  });
  app.get("/api/production/runs/:runId/files/:fileId/download", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user) ?? null;
      if (!organizationId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const inline = ["1", "true"].includes(String(req.query.inline || "").toLowerCase());
      await downloadProductionRunFile({ organizationId, actorUserId, runId: req.params.runId, fileId: req.params.fileId, inline, res });
    } catch (error) {
      if (res.headersSent) return;
      return handleProductionRunError(res, error, "PRODUCTION_RUN_FILE_DOWNLOAD_FAILED", "Unable to download production run file.");
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
  app.post("/api/production/runs/:runId/reconcile-canceled-members", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      if (!actorIsAdmin(req)) return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Only an administrator may reconcile a canceled production run." });
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      return res.json({ success: true, data: await reconcileCanceledProductionRun({ organizationId, actorUserId, runId: req.params.runId }) });
    } catch (error) {
      return handleProductionRunError(res, error, "PRODUCTION_RUN_RECONCILE_FAILED", "Unable to reconcile the canceled production run.");
    }
  });
  app.post("/api/production/runs/:runId/reopen-completed", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      if (!actorIsAdmin(req)) return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Only an administrator may reopen a completed production run." });
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const body = reopenCompletedRunSchema.parse(req.body ?? {});
      return res.json({ success: true, data: await reopenCompletedProductionRun({ organizationId, actorUserId, runId: req.params.runId, reason: body.reason }) });
    } catch (error) {
      return handleProductionRunError(res, error, "PRODUCTION_RUN_REOPEN_FAILED", "Unable to reopen the completed production run.");
    }
  });
  app.post("/api/production/runs/:runId/repair-fulfillment-handoff", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      if (!actorIsAdmin(req)) return res.status(403).json({ success: false, code: "FORBIDDEN", message: "Only an administrator may repair a production run fulfillment handoff." });
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      return res.json({ success: true, data: await repairCompletedProductionRunFulfillmentHandoff({ organizationId, actorUserId, runId: req.params.runId }) });
    } catch (error) {
      return handleProductionRunError(res, error, "PRODUCTION_RUN_HANDOFF_REPAIR_FAILED", "Unable to repair the production run fulfillment handoff.");
    }
  });
  app.post("/api/production/runs/:runId/outcomes", deps.isAuthenticated, deps.tenantContext, async (req: any, res) => {
    try {
      if (!deps.assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req); const actorUserId = userId(req.user);
      if (!organizationId || !actorUserId) return res.status(401).json({ success: false, code: "UNAUTHENTICATED", message: "User is not authenticated." });
      const body = outcomeSchema.parse(req.body ?? {});
      return res.json({ success: true, data: await recordProductionRunOutcome({ organizationId, actorUserId, runId: req.params.runId, ...body }) });
    } catch (error) {
      if (error instanceof ProductionRunError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: "PRODUCTION_RUN_OUTCOME_INVALID", message: error.issues[0]?.message ?? "Invalid production outcome." });
      console.error("[production-runs] outcome failed", error); return res.status(500).json({ success: false, code: "PRODUCTION_RUN_OUTCOME_FAILED", message: "Unable to record production run outcome." });
    }
  });
}
