/**
 * design.routes.ts
 *
 * Route registration for the Design Queue workflow (/api/design/*).
 * Extracted from server/routes.ts — behavior-preserving, no contract changes.
 *
 * Placement: server/routes/design.routes.ts
 * Exported surface: registerDesignRoutes
 */

import type { Express } from "express";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  auditLogs,
  customers,
  lineItemFiles,
  materials,
  orderAttachments,
  orderAuditLog,
  orderLineItems,
  orders,
} from "@shared/schema";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import {
  completeLineItemDesign,
  transitionLineItemWorkflowState,
} from "../services/lineItemWorkflowService";
import { autoSyncCanonicalProofForLineItem } from "../services/proofingService";
import { getLatestProofFeedbackByLineItemId } from "../services/proofFeedbackProjectionService";
import { syncDesignCostSummary } from "../services/designCostSummaryService";
import {
  buildDesignWorkspaceState,
  designNoteKindSchema,
} from "../services/designWorkspaceState";
import {
  isDesignOwnershipJob,
  resolveActiveProductionOwners,
} from "../services/productionOwnership";

// ---------------------------------------------------------------------------
// Local utility (mirrors top-level helper in routes.ts)
// ---------------------------------------------------------------------------

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const getDesignLineItemContext = async (organizationId: string, lineItemId: string) => {
  const [lineItem] = await db
    .select({
      id: orderLineItems.id,
      orderId: orderLineItems.orderId,
      status: orderLineItems.status,
      workflowState: orderLineItems.workflowState,
      designStatus: orderLineItems.designStatus,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
    .limit(1);

  return lineItem ?? null;
};

const listDesignAuditRows = async (organizationId: string, lineItemId: string) => {
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actionType: auditLogs.actionType,
      entityType: auditLogs.entityType,
      description: auditLogs.description,
      userName: auditLogs.userName,
      newValues: auditLogs.newValues,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        eq(auditLogs.entityType, "order_line_item"),
        eq(auditLogs.entityId, lineItemId),
      ),
    )
    .orderBy(asc(auditLogs.createdAt));
};

const insertDesignAuditLog = async (args: {
  organizationId: string;
  userId: string;
  userName: string | null;
  req: any;
  lineItemId: string;
  actionType: string;
  description: string;
  newValues?: any;
  oldValues?: any;
}) => {
  await db.insert(auditLogs).values({
    organizationId: args.organizationId,
    userId: args.userId,
    userName: args.userName,
    actionType: args.actionType,
    entityType: "order_line_item",
    entityId: args.lineItemId,
    entityName: `Line item ${args.lineItemId}`,
    description: args.description,
    oldValues: args.oldValues ?? null,
    newValues: args.newValues ?? null,
    ipAddress: args.req.ip || null,
    userAgent: args.req.headers["user-agent"] || null,
  } as any);
};

const insertDesignTimelineLog = async (args: {
  orderId: string;
  orderLineItemId: string;
  actorUserId: string;
  actionType: string;
  previousDesignStatus?: string | null;
  newDesignStatus?: string | null;
  sessionId?: string | null;
  note?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) => {
  await db.insert(orderAuditLog).values({
    orderId: args.orderId,
    orderLineItemId: args.orderLineItemId,
    userId: args.actorUserId,
    actionType: args.actionType,
    fromStatus: args.previousDesignStatus ?? null,
    toStatus: args.newDesignStatus ?? null,
    note: args.note ?? args.reason ?? null,
    metadata: {
      orderId: args.orderId,
      orderLineItemId: args.orderLineItemId,
      previousDesignStatus: args.previousDesignStatus ?? null,
      newDesignStatus: args.newDesignStatus ?? null,
      actorUserId: args.actorUserId,
      sessionId: args.sessionId ?? null,
      note: args.note ?? null,
      reason: args.reason ?? null,
      ...(args.metadata ?? {}),
    },
  } as any);
};

const buildDesignWorkspacePayload = async (args: {
  organizationId: string;
  lineItem: Awaited<ReturnType<typeof getDesignLineItemContext>> extends infer T ? T : never;
}) => {
  const auditRows = await listDesignAuditRows(args.organizationId, args.lineItem.id);
  const workspace = buildDesignWorkspaceState({ lineItem: args.lineItem, auditRows });
  const latestProofFeedback = await getLatestProofFeedbackByLineItemId({
    organizationId: args.organizationId,
    lineItemId: args.lineItem.id,
  });
  const designCostSummary = await syncDesignCostSummary({
    organizationId: args.organizationId,
    lineItemId: args.lineItem.id,
    auditRows,
  });

  return {
    effectiveState: workspace.effectiveState,
    session: workspace.session,
    totalTrackedMs: workspace.totalTrackedMs,
    rawTrackedMs: workspace.rawTrackedMs,
    totalAdjustmentMs: workspace.totalAdjustmentMs,
    notes: workspace.notes,
    adjustments: workspace.adjustments,
    activity: workspace.activity,
    latestProofFeedback,
    designCostSummary,
  };
};

const executeExplicitLineItemWorkflowAction = async (args: {
  req: any;
  res: any;
  lineItemId: string;
  toState: "needs_design" | "in_design";
  source: string;
  description: string;
  note?: string | null;
  timelineActionType?: string | null;
}) => {
  const organizationId = getRequestOrganizationId(args.req);
  if (!organizationId) {
    args.res.status(500).json({ error: "Missing organization context" });
    return;
  }

  const userId = getUserId(args.req.user);
  if (!userId) {
    args.res.status(401).json({ error: "User ID not found" });
    return;
  }

  const [currentLineItem] = await db
    .select({
      id: orderLineItems.id,
      orderId: orderLineItems.orderId,
      status: orderLineItems.status,
      workflowState: orderLineItems.workflowState,
      designStatus: orderLineItems.designStatus,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, organizationId)))
    .limit(1);

  if (!currentLineItem) {
    args.res.status(404).json({ error: "Line item not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    return transitionLineItemWorkflowState(tx, {
      organizationId,
      lineItemId: args.lineItemId,
      toState: args.toState,
      actorUserId: userId,
      note: args.note ?? null,
      metadata: { source: args.source },
    });
  });

  await db.insert(auditLogs).values({
    organizationId,
    userId,
    userName: args.req.user?.email || args.req.user?.name || null,
    actionType: "UPDATE",
    entityType: "order_line_item",
    entityId: args.lineItemId,
    entityName: `Line item ${args.lineItemId}`,
    description: args.description,
    oldValues: { workflowState: currentLineItem.workflowState, status: currentLineItem.status },
    newValues: {
      workflowState: result.toState,
      designStatus:
        result.toState === "needs_design" || result.toState === "in_design"
          ? result.toState
          : currentLineItem.designStatus,
      status: result.lifecycleStatus,
      ownerJobId: result.activeOwnerJobId,
      ownerStationKey: result.activeOwnerStationKey,
      ownerStepKey: result.activeOwnerStepKey,
    },
    ipAddress: args.req.ip || null,
    userAgent: args.req.headers["user-agent"] || null,
  } as any);

  if (args.timelineActionType) {
    await insertDesignTimelineLog({
      orderId: currentLineItem.orderId,
      orderLineItemId: args.lineItemId,
      actorUserId: userId,
      actionType: args.timelineActionType,
      previousDesignStatus: currentLineItem.designStatus ?? currentLineItem.workflowState,
      newDesignStatus: result.toState === "in_design" ? "in_design" : currentLineItem.designStatus ?? result.toState,
      note: args.note ?? null,
      metadata: {
        source: args.source,
        ownerJobId: result.activeOwnerJobId,
      },
    });
  }

  args.res.json({ success: true, data: result });
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerDesignRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser } = middleware;

  // GET /api/design/queue
  app.get("/api/design/queue", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const items = await db
        .select({
          lineItemId: orderLineItems.id,
          orderId: orders.id,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          designStatus: orderLineItems.designStatus,
          requiresDesign: orderLineItems.requiresDesign,
          requiresProofApproval: orderLineItems.requiresProofApproval,
          requiresPrepress: orderLineItems.requiresPrepress,
          description: orderLineItems.description,
          productType: orderLineItems.productType,
          quantity: orderLineItems.quantity,
          width: orderLineItems.width,
          height: orderLineItems.height,
          sqft: orderLineItems.sqft,
          orderNumber: orders.orderNumber,
          dueDate: orders.dueDate,
          priority: orders.priority,
          customerName: customers.companyName,
          materialName: materials.name,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(materials, eq(orderLineItems.materialId, materials.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            inArray(orderLineItems.workflowState, ["needs_design", "in_design"] as any),
            notInArray(orders.state, ["closed", "canceled", "production_complete"]),
          ),
        )
        .orderBy(asc(orders.dueDate), desc(orders.priority));

      const lineItemIds = items.map((item) => item.lineItemId);
      const activeOwnerByLineItem = lineItemIds.length > 0
        ? await resolveActiveProductionOwners(db, {
            organizationId,
            lineItemIds,
            debugLabel: "GET /api/design/queue",
          })
        : new Map<string, any>();

      const fileCounts = lineItemIds.length > 0
        ? await db
            .select({
              lineItemId: lineItemFiles.lineItemId,
              role: lineItemFiles.role,
              count: sql<number>`count(*)::int`,
            })
            .from(lineItemFiles)
            .where(and(inArray(lineItemFiles.lineItemId, lineItemIds), eq(lineItemFiles.status, "active")))
            .groupBy(lineItemFiles.lineItemId, lineItemFiles.role)
        : [];

      const bridgedArtworkCounts = lineItemIds.length > 0
        ? await db
            .select({
              lineItemId: orderAttachments.orderLineItemId,
              role: orderAttachments.role,
              count: sql<number>`count(*)::int`,
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
            .where(
              and(
                eq(orders.organizationId, organizationId),
                inArray(orderAttachments.orderLineItemId as any, lineItemIds),
                inArray(orderAttachments.role, ["artwork", "proof"] as any),
              ),
            )
            .groupBy(orderAttachments.orderLineItemId, orderAttachments.role)
        : [];

      const queue = items
        .filter((item) => {
          const activeOwner = activeOwnerByLineItem.get(item.lineItemId);
          return isDesignOwnershipJob(activeOwner) || ["needs_design", "in_design"].includes(String(item.workflowState || ""));
        })
        .map((item) => {
          const activeOwner = activeOwnerByLineItem.get(item.lineItemId) ?? null;
          const originals =
            (fileCounts.find((row) => row.lineItemId === item.lineItemId && row.role === "original")?.count || 0) +
            (bridgedArtworkCounts.find((row) => row.lineItemId === item.lineItemId && row.role === "artwork")?.count || 0);
          const proofs = bridgedArtworkCounts.find((row) => row.lineItemId === item.lineItemId && row.role === "proof")?.count || 0;

          return {
            lineItemId: item.lineItemId,
            orderId: item.orderId,
            jobNumber: item.orderNumber,
            customerName: item.customerName ?? "—",
            productName: item.description,
            printType: item.productType ?? null,
            media: item.materialName ?? null,
            dueDate: item.dueDate ?? null,
            status: item.status,
            workflowState: item.workflowState,
            designStatus: item.designStatus ?? item.workflowState,
            designStage: item.designStatus ?? item.workflowState,
            rush: item.priority === "rush",
            quantity: Number(item.quantity) || 0,
            width: item.width != null ? Number(item.width) : null,
            height: item.height != null ? Number(item.height) : null,
            sqFootage: item.sqft != null ? Number(item.sqft) : null,
            requiresDesign: item.requiresDesign,
            requiresProofApproval: item.requiresProofApproval,
            requiresPrepress: item.requiresPrepress,
            activeOwnerJobId: activeOwner?.id ?? null,
            activeOwnerStationKey: activeOwner?.stationKey ?? null,
            activeOwnerStepKey: activeOwner?.stepKey ?? null,
            fileCounts: {
              originals,
              proofs,
            },
          };
        });

      return res.json({ success: true, data: queue });
    } catch (error: any) {
      console.error("[Design] Error fetching queue:", error);
      return res.status(500).json({ error: error?.message || "Failed to fetch design queue" });
    }
  });

  // GET /api/design/line-item/:lineItemId/workspace
  app.get("/api/design/line-item/:lineItemId/workspace", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const lineItemId = String(req.params.lineItemId);
      const lineItem = await getDesignLineItemContext(organizationId, lineItemId);

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const workspace = await buildDesignWorkspacePayload({ organizationId, lineItem });

      return res.json({
        success: true,
        data: workspace,
      });
    } catch (error: any) {
      console.error("[Design] Error fetching workspace detail:", error);
      return res.status(500).json({ error: error?.message || "Failed to fetch design workspace detail" });
    }
  });

  // POST /api/design/line-item/:lineItemId/session
  app.post("/api/design/line-item/:lineItemId/session", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const lineItemId = String(req.params.lineItemId);
      const parsed = z
        .object({
          action: z.enum(["start", "pause", "resume"]),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItem = await getDesignLineItemContext(organizationId, lineItemId);
      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const auditRows = await listDesignAuditRows(organizationId, lineItemId);
  const workspace = buildDesignWorkspaceState({ lineItem, auditRows });
      const userName = req.user?.email || req.user?.name || null;

      if (parsed.data.action === "start") {
        if (workspace.session.status === "active") {
          return res.json({ success: true, data: workspace });
        }

        await insertDesignAuditLog({
          organizationId,
          userId,
          userName,
          req,
          lineItemId,
          actionType: workspace.session.status === "paused" ? "design_session_resumed" : "design_session_started",
          description: workspace.session.status === "paused" ? "Resumed design session" : "Started design session",
          newValues: {
            sessionState: "active",
          },
        });

        await insertDesignTimelineLog({
          orderId: lineItem.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: workspace.session.status === "paused" ? "design_resumed" : "design_started",
          previousDesignStatus: lineItem.designStatus ?? lineItem.workflowState,
          newDesignStatus: lineItem.designStatus ?? lineItem.workflowState,
          sessionId: (workspace.session as any)?.sessionId ?? null,
        });
      }

      if (parsed.data.action === "pause") {
        if (workspace.session.status !== "active") {
          return res.status(400).json({ error: "No active design session to pause" });
        }

        await insertDesignAuditLog({
          organizationId,
          userId,
          userName,
          req,
          lineItemId,
          actionType: "design_session_paused",
          description: "Paused design session",
          newValues: {
            sessionState: "paused",
          },
        });

        await insertDesignTimelineLog({
          orderId: lineItem.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: "design_paused",
          previousDesignStatus: lineItem.designStatus ?? lineItem.workflowState,
          newDesignStatus: lineItem.designStatus ?? lineItem.workflowState,
          sessionId: (workspace.session as any)?.sessionId ?? null,
        });
      }

      if (parsed.data.action === "resume") {
        if (workspace.session.status !== "paused") {
          return res.status(400).json({ error: "No paused design session to resume" });
        }

        await insertDesignAuditLog({
          organizationId,
          userId,
          userName,
          req,
          lineItemId,
          actionType: "design_session_resumed",
          description: "Resumed design session",
          newValues: {
            sessionState: "active",
          },
        });

        await insertDesignTimelineLog({
          orderId: lineItem.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: "design_resumed",
          previousDesignStatus: lineItem.designStatus ?? lineItem.workflowState,
          newDesignStatus: lineItem.designStatus ?? lineItem.workflowState,
          sessionId: (workspace.session as any)?.sessionId ?? null,
        });
      }

      const updatedAudits = await listDesignAuditRows(organizationId, lineItemId);
      const updatedWorkspace = buildDesignWorkspaceState({ lineItem, auditRows: updatedAudits });

      return res.json({ success: true, data: updatedWorkspace });
    } catch (error: any) {
      console.error("[Design] Error updating session:", error);
      return res.status(500).json({ error: error?.message || "Failed to update design session" });
    }
  });

  // POST /api/design/line-item/:lineItemId/notes
  app.post("/api/design/line-item/:lineItemId/notes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const lineItemId = String(req.params.lineItemId);
      const parsed = z
        .object({
          noteText: z.string().trim().min(1).max(4000),
          noteKind: designNoteKindSchema.default("internal_note"),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItem = await getDesignLineItemContext(organizationId, lineItemId);
      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const userName = req.user?.email || req.user?.name || null;

      await insertDesignAuditLog({
        organizationId,
        userId,
        userName,
        req,
        lineItemId,
        actionType: "design_note_added",
        description:
          parsed.data.noteKind === "progress_update"
            ? "Added design progress update"
            : parsed.data.noteKind === "blocker_update"
              ? "Added design blocker update"
              : "Added internal design note",
        newValues: {
          noteKind: parsed.data.noteKind,
          noteText: parsed.data.noteText,
        },
      });

      const updatedAudits = await listDesignAuditRows(organizationId, lineItemId);
      const updatedWorkspace = buildDesignWorkspaceState({ lineItem, auditRows: updatedAudits });

      return res.json({ success: true, data: updatedWorkspace.notes });
    } catch (error: any) {
      console.error("[Design] Error saving note:", error);
      return res.status(500).json({ error: error?.message || "Failed to save design note" });
    }
  });

  // POST /api/design/line-item/:lineItemId/time-adjustments
  app.post(
    "/api/design/line-item/:lineItemId/time-adjustments",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;

        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const userId = getUserId(req.user);
        if (!userId) return res.status(401).json({ error: "User ID not found" });

        const lineItemId = String(req.params.lineItemId);
        const parsed = z
          .object({
            adjustedTotalMinutes: z.number().finite().min(0).max(5256000),
            reason: z.string().trim().min(3).max(1000),
          })
          .safeParse(req.body);

        if (!parsed.success) {
          return res.status(400).json({ error: fromZodError(parsed.error).message });
        }

        const lineItem = await getDesignLineItemContext(organizationId, lineItemId);
        if (!lineItem) {
          return res.status(404).json({ error: "Line item not found" });
        }

        const auditRows = await listDesignAuditRows(organizationId, lineItemId);
        const workspace = buildDesignWorkspaceState({ lineItem, auditRows });
        const beforeMs = workspace.totalTrackedMs;
        const afterMs = Math.round(parsed.data.adjustedTotalMinutes * 60_000);
        const deltaMs = afterMs - beforeMs;

        if (deltaMs === 0) {
          return res.json({ success: true, data: workspace });
        }

        await insertDesignAuditLog({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          req,
          lineItemId,
          actionType: "design_time_adjusted",
          description: "Adjusted tracked design time",
          oldValues: {
            totalTrackedMs: beforeMs,
          },
          newValues: {
            reason: parsed.data.reason,
            beforeMs,
            afterMs,
            deltaMs,
          },
        });

        const updatedAudits = await listDesignAuditRows(organizationId, lineItemId);
        const updatedWorkspace = buildDesignWorkspaceState({ lineItem, auditRows: updatedAudits });

        return res.json({ success: true, data: updatedWorkspace });
      } catch (error: any) {
        console.error("[Design] Error adjusting tracked time:", error);
        return res.status(500).json({ error: error?.message || "Failed to adjust tracked time" });
      }
    },
  );

  // POST /api/design/line-item/:lineItemId/send
  app.post("/api/design/line-item/:lineItemId/send", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      await executeExplicitLineItemWorkflowAction({
        req,
        res,
        lineItemId: String(req.params.lineItemId),
        toState: "needs_design",
        source: "api_design_send",
        description: "Sent line item to Design",
        note: typeof req.body?.note === "string" ? req.body.note : null,
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Design] Error sending line item to design:", error);
      res.status(status).json({ error: error?.message || "Failed to send line item to design" });
    }
  });

  // POST /api/design/line-item/:lineItemId/start
  app.post("/api/design/line-item/:lineItemId/start", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      await executeExplicitLineItemWorkflowAction({
        req,
        res,
        lineItemId: String(req.params.lineItemId),
        toState: "in_design",
        source: "api_design_start",
        description: "Started Design work on line item",
        note: typeof req.body?.note === "string" ? req.body.note : null,
        timelineActionType: "design_started",
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Design] Error starting design:", error);
      res.status(status).json({ error: error?.message || "Failed to start design" });
    }
  });

  // POST /api/design/line-item/:lineItemId/return-to-needs-design
  app.post("/api/design/line-item/:lineItemId/return-to-needs-design", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      await executeExplicitLineItemWorkflowAction({
        req,
        res,
        lineItemId: String(req.params.lineItemId),
        toState: "needs_design",
        source: "api_design_return_to_needs_design",
        description: "Returned line item to Needs Design",
        note: typeof req.body?.note === "string" ? req.body.note : null,
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Design] Error returning line item to needs design:", error);
      res.status(status).json({ error: error?.message || "Failed to return line item to needs design" });
    }
  });

  // POST /api/design/line-item/:lineItemId/complete
  app.post("/api/design/line-item/:lineItemId/complete", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const lineItemId = String(req.params.lineItemId);
      const note = typeof req.body?.note === "string" ? req.body.note : null;

      const [currentLineItem] = await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          designStatus: orderLineItems.designStatus,
          requiresProofApproval: orderLineItems.requiresProofApproval,
          requiresPrepress: orderLineItems.requiresPrepress,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);

      if (!currentLineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const result = await db.transaction(async (tx) => {
        const completed = await completeLineItemDesign(tx, {
          organizationId,
          lineItemId,
          actorUserId: userId,
          note,
          metadata: { source: "api_design_complete" },
        });

        if (completed.toState === "awaiting_proof_approval" && currentLineItem.requiresProofApproval) {
          await autoSyncCanonicalProofForLineItem(tx, {
            organizationId,
            lineItemId,
            actorUserId: userId,
            reason: "design_completed",
          });
        }

        return completed;
      });

      await db.insert(auditLogs).values({
        organizationId,
        userId,
        userName: req.user?.email || req.user?.name || null,
        actionType: "UPDATE",
        entityType: "order_line_item",
        entityId: lineItemId,
        entityName: `Line item ${lineItemId}`,
        description: "Completed Design work on line item",
        oldValues: {
          workflowState: currentLineItem.workflowState,
          designStatus: currentLineItem.designStatus,
          status: currentLineItem.status,
        },
        newValues: {
          workflowState: result.toState,
          designStatus: "design_complete",
          status: result.lifecycleStatus,
          requiresProofApproval: currentLineItem.requiresProofApproval,
          requiresPrepress: currentLineItem.requiresPrepress,
          ownerJobId: result.activeOwnerJobId,
          ownerStationKey: result.activeOwnerStationKey,
          ownerStepKey: result.activeOwnerStepKey,
        },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      } as any);

      await insertDesignTimelineLog({
        orderId: currentLineItem.orderId,
        orderLineItemId: lineItemId,
        actorUserId: userId,
        actionType: "design_completed",
        previousDesignStatus: currentLineItem.designStatus ?? currentLineItem.workflowState,
        newDesignStatus: "design_complete",
        note,
        metadata: {
          ownerJobId: result.activeOwnerJobId,
          ownerStationKey: result.activeOwnerStationKey,
          ownerStepKey: result.activeOwnerStepKey,
        },
      });

      if (result.toState === "awaiting_proof_approval") {
        await insertDesignTimelineLog({
          orderId: currentLineItem.orderId,
          orderLineItemId: lineItemId,
          actorUserId: userId,
          actionType: "design_sent_to_proofing",
          previousDesignStatus: currentLineItem.designStatus ?? currentLineItem.workflowState,
          newDesignStatus: "design_complete",
          note,
          metadata: {
            workflowState: result.toState,
            ownerJobId: result.activeOwnerJobId,
          },
        });
      }

      const designAudits = await listDesignAuditRows(organizationId, lineItemId);
      const designWorkspace = buildDesignWorkspaceState({ lineItem: currentLineItem, auditRows: designAudits });

      if (designWorkspace.session.status === "active" || designWorkspace.session.status === "paused") {
        await insertDesignAuditLog({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          req,
          lineItemId,
          actionType: "design_session_completed",
          description: "Completed design session",
          newValues: {
            sessionState: "completed",
          },
        });
      }

      return res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("[Design] Error completing design:", error);
      res.status(status).json({ error: error?.message || "Failed to complete design" });
    }
  });
}
