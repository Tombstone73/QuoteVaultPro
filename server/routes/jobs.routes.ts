/**
 * jobs.routes.ts
 *
 * Job Status Config, Line Item Workflow Transition, and Jobs/Production Workflow routes
 * extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/settings/job-statuses
 *   POST   /api/settings/job-statuses
 *   PATCH  /api/settings/job-statuses/:id
 *   DELETE /api/settings/job-statuses/:id
 *
 *   POST   /api/line-items/:lineItemId/workflow-transition
 *
 *   GET    /api/jobs
 *   GET    /api/jobs/:id
 *   PATCH  /api/jobs/:id
 *   POST   /api/jobs/:id/notes
 *
 * Placement: server/routes/jobs.routes.ts
 * Registered by: server/routes.ts via registerJobsRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import { orderLineItems, orders, auditLogs } from "@shared/schema";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerJobsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin, assertInternalUser } = middleware;

  // ============================================================
  // JOB STATUS CONFIGURATION (Admin Only)
  // ============================================================

  app.get("/api/settings/job-statuses", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const statuses = await storage.getJobStatuses(organizationId);
      res.json({ success: true, data: statuses });
    } catch (error) {
      console.error("Error fetching job statuses:", error);
      res.status(500).json({ error: "Failed to fetch job statuses" });
    }
  });

  app.post("/api/settings/job-statuses", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const status = await storage.createJobStatus(organizationId, req.body);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error("Error creating job status:", error);
      res.status(500).json({ error: "Failed to create job status" });
    }
  });

  app.patch("/api/settings/job-statuses/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const status = await storage.updateJobStatus(organizationId, req.params.id, req.body);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error("Error updating job status:", error);
      res.status(500).json({ error: "Failed to update job status" });
    }
  });

  app.delete("/api/settings/job-statuses/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      await storage.deleteJobStatus(organizationId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting job status:", error);
      res.status(500).json({ error: "Failed to delete job status" });
    }
  });

  // ============================================================
  // LINE ITEM WORKFLOW TRANSITION
  // ============================================================

  app.post("/api/line-items/:lineItemId/workflow-transition", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const lineItemId = String(req.params.lineItemId);
      const parsed = z.object({
        toState: z.enum([
          "new",
          "needs_design",
          "in_design",
          "awaiting_proof_approval",
          "ready_for_prepress",
          "in_prepress",
          "ready_for_production",
          "in_production",
          "completed",
          "on_hold",
          "canceled",
        ]),
        note: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const [currentLineItem] = await db
        .select({
          id: orderLineItems.id,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          designStatus: orderLineItems.designStatus,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!currentLineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const result = await db.transaction(async (tx) => {
        return transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId,
          toState: parsed.data.toState,
          actorUserId: userId,
          note: parsed.data.note ?? null,
          metadata: { source: "api_line_item_workflow_transition" },
        });
      });

      await db.insert(auditLogs).values({
        organizationId,
        userId,
        userName: req.user?.email || req.user?.name || null,
        actionType: "UPDATE",
        entityType: "order_line_item",
        entityId: lineItemId,
        entityName: `Line item ${lineItemId}`,
        description: `Workflow transition ${result.fromState} -> ${result.toState}`,
        oldValues: { workflowState: currentLineItem.workflowState, status: currentLineItem.status },
        newValues: {
          workflowState: result.toState,
          designStatus:
            parsed.data.toState === "needs_design" || parsed.data.toState === "in_design"
              ? parsed.data.toState
              : currentLineItem.designStatus,
          status: result.lifecycleStatus,
          ownerJobId: result.activeOwnerJobId,
          ownerStationKey: result.activeOwnerStationKey,
          ownerStepKey: result.activeOwnerStepKey,
        },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      } as any);

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Workflow] Error transitioning line item workflow:", error);
      return res.status(status).json({ error: error?.message || "Failed to transition workflow" });
    }
  });

  // ============================================================
  // JOBS & PRODUCTION WORKFLOW
  // ============================================================

  // List jobs (filterable)
  app.get("/api/jobs", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const statusKey = req.query.statusKey as string | undefined;
      const assignedToUserId = req.query.assignedToUserId as string | undefined;
      const orderId = req.query.orderId as string | undefined;
      const jobs = await storage.getJobs(organizationId, { statusKey, assignedToUserId, orderId });
      res.json({ success: true, data: jobs });
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Get single job detail
  app.get("/api/jobs/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const job = await storage.getJob(organizationId, req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({ success: true, data: job });
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  // Update job (status, assignedTo, notes, rollWidthUsedInches, materialId)
  app.patch("/api/jobs/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const role = req.user?.role || "";
      if (role === 'customer') {
        return res.status(403).json({ message: "Access denied" });
      }
      const updates: any = {};
      if (typeof req.body?.statusKey === 'string') updates.statusKey = req.body.statusKey;
      if (typeof req.body?.assignedTo === 'string') updates.assignedTo = req.body.assignedTo;
      if (typeof req.body?.notes === 'string') updates.notes = req.body.notes;
      // Production tracking fields - rollWidthUsedInches and materialId
      if (req.body?.rollWidthUsedInches !== undefined) {
        updates.rollWidthUsedInches = req.body.rollWidthUsedInches === null ? null : parseFloat(req.body.rollWidthUsedInches);
      }
      if (req.body?.materialId !== undefined) {
        updates.materialId = req.body.materialId === null ? null : req.body.materialId;
      }
      const userId = req.user?.claims?.sub || req.user?.id || undefined;
      const updated = await storage.updateJob(organizationId, req.params.id, updates, userId);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("Error updating job:", error);
      res.status(500).json({ error: "Failed to update job" });
    }
  });

  // Append a job note
  app.post("/api/jobs/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const role = req.user?.role || "";
      if (role === 'customer') {
        return res.status(403).json({ message: "Access denied" });
      }
      const noteText = (req.body?.noteText || '').toString();
      if (!noteText) return res.status(400).json({ message: "noteText required" });
      const userId = req.user?.claims?.sub || req.user?.id;
      const note = await storage.addJobNote(req.params.id, noteText, userId);
      res.json({ success: true, data: note });
    } catch (error) {
      console.error("Error adding job note:", error);
      res.status(500).json({ error: "Failed to add job note" });
    }
  });
}
