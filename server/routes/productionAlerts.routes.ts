import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  auditLogs,
  orderLineItems,
  orders,
  productionAlertSeverityValues,
  productionAlerts,
  productionAlertStationValues,
  productionAlertStatusValues,
  productionAlertTypeValues,
  productionEvents,
  productionJobs,
} from "@shared/schema";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";

const alertTypeSchema = z.enum(productionAlertTypeValues);
const alertSeveritySchema = z.enum(productionAlertSeverityValues);
const alertStationSchema = z.enum(productionAlertStationValues);
const alertStatusSchema = z.enum(productionAlertStatusValues);

const createProductionAlertSchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  orderLineItemId: z.string().trim().min(1).optional(),
  lineItemId: z.string().trim().min(1).optional(),
  productionJobId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1, "Title is required").max(160),
  message: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  alertType: alertTypeSchema.default("general_warning"),
  severity: alertSeveritySchema.default("warning"),
  visibleStations: z.array(alertStationSchema).min(1).max(5).default(["all"]),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const listProductionAlertQuerySchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  lineItemId: z.string().trim().min(1).optional(),
  orderLineItemId: z.string().trim().min(1).optional(),
  productionJobId: z.string().trim().min(1).optional(),
  station: alertStationSchema.optional(),
  status: alertStatusSchema.optional(),
});

function getUserId(user: any): string | null {
  return user?.claims?.sub ?? user?.id ?? null;
}

function getUserName(user: any): string | null {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.email || user?.claims?.email || user?.name || null;
}

function normalizeVisibleStations(value: unknown): string[] {
  if (!Array.isArray(value)) return ["all"];
  const stations = value.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
  return stations.length ? Array.from(new Set(stations)) : ["all"];
}

function stationCanSeeAlert(alert: { visibleStations: unknown }, station?: string): boolean {
  if (!station) return true;
  const visibleStations = normalizeVisibleStations(alert.visibleStations);
  return visibleStations.includes("all") || visibleStations.includes(station);
}

function serializeAlert(row: typeof productionAlerts.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderLineItemId: row.orderLineItemId ?? null,
    productionJobId: row.productionJobId ?? null,
    title: row.title,
    message: row.message ?? null,
    alertType: row.alertType,
    severity: row.severity,
    visibleStations: normalizeVisibleStations(row.visibleStations),
    status: row.status,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt as any).toISOString() : null,
    acknowledgedByUserId: row.acknowledgedByUserId ?? null,
    acknowledgedAt: row.acknowledgedAt ? new Date(row.acknowledgedAt as any).toISOString() : null,
    resolvedByUserId: row.resolvedByUserId ?? null,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt as any).toISOString() : null,
    metadata: row.metadataJson ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt as any).toISOString() : null,
  };
}

async function writeAlertAudit(args: {
  organizationId: string;
  userId: string | null;
  userName: string | null;
  req: any;
  actionType: string;
  alert: typeof productionAlerts.$inferSelect;
  description: string;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
}) {
  await db.insert(auditLogs).values({
    organizationId: args.organizationId,
    userId: args.userId,
    userName: args.userName,
    actionType: args.actionType,
    entityType: "production_alert",
    entityId: args.alert.id,
    entityName: args.alert.title,
    description: args.description,
    oldValues: args.oldValues ?? null,
    newValues: args.newValues ?? serializeAlert(args.alert),
    ipAddress: args.req.ip,
    userAgent: args.req.get?.("user-agent") ?? null,
  });
}

async function resolveAlertScope(args: {
  organizationId: string;
  orderId?: string;
  lineItemId?: string;
  productionJobId?: string;
}) {
  let orderId = args.orderId?.trim() || null;
  let orderLineItemId = args.lineItemId?.trim() || null;
  let productionJobId = args.productionJobId?.trim() || null;

  if (productionJobId) {
    const jobRows = await db
      .select({
        id: productionJobs.id,
        orderId: productionJobs.orderId,
        lineItemId: productionJobs.lineItemId,
      })
      .from(productionJobs)
      .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, productionJobId)))
      .limit(1);
    const job = jobRows[0];
    if (!job) return { error: "Production job not found" as const };
    orderId = job.orderId;
    orderLineItemId = orderLineItemId || job.lineItemId || null;
  }

  if (orderLineItemId) {
    const lineItemRows = await db
      .select({
        id: orderLineItems.id,
        orderId: orderLineItems.orderId,
      })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .where(and(eq(orders.organizationId, args.organizationId), eq(orderLineItems.id, orderLineItemId)))
      .limit(1);
    const lineItem = lineItemRows[0];
    if (!lineItem) return { error: "Line item not found" as const };
    orderId = lineItem.orderId;
  }

  if (orderId) {
    const orderRows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.organizationId, args.organizationId), eq(orders.id, orderId)))
      .limit(1);
    if (!orderRows[0]) return { error: "Order not found" as const };
  }

  if (!orderId) return { error: "orderId, lineItemId, or productionJobId is required" as const };

  return { orderId, orderLineItemId, productionJobId };
}

export function registerProductionAlertRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, assertInternalUser } = middleware;

  app.get("/api/production-alerts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const parsed = listProductionAlertQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: fromZodError(parsed.error).message });
      }

      const productionJobId = parsed.data.productionJobId;
      const lineItemId = parsed.data.lineItemId ?? parsed.data.orderLineItemId;
      const conditions: any[] = [eq(productionAlerts.organizationId, organizationId)];

      if (parsed.data.status) {
        conditions.push(eq(productionAlerts.status, parsed.data.status));
      }

      if (productionJobId) {
        const scope = await resolveAlertScope({ organizationId, productionJobId });
        if ("error" in scope) return res.status(404).json({ success: false, error: scope.error });
        const scopeConditions: any[] = [
          eq(productionAlerts.productionJobId, productionJobId),
          eq(productionAlerts.orderId, scope.orderId),
        ];
        if (scope.orderLineItemId) {
          scopeConditions.push(eq(productionAlerts.orderLineItemId, scope.orderLineItemId));
        }
        conditions.push(or(...scopeConditions));
      } else if (lineItemId) {
        conditions.push(eq(productionAlerts.orderLineItemId, lineItemId));
      } else if (parsed.data.orderId) {
        conditions.push(eq(productionAlerts.orderId, parsed.data.orderId));
      }

      const rows = await db
        .select()
        .from(productionAlerts)
        .where(and(...conditions))
        .orderBy(desc(productionAlerts.createdAt));

      const alerts = rows
        .filter((row) => stationCanSeeAlert(row, parsed.data.station))
        .map((row) => serializeAlert(row));

      res.json({ success: true, data: alerts });
    } catch (error) {
      console.error("Error fetching production alerts:", error);
      res.status(500).json({ success: false, error: "Failed to fetch production alerts" });
    }
  });

  app.post("/api/production-alerts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const parsed = createProductionAlertSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: fromZodError(parsed.error).message });
      }

      const payload = parsed.data;
      const scope = await resolveAlertScope({
        organizationId,
        orderId: payload.orderId,
        lineItemId: payload.orderLineItemId ?? payload.lineItemId,
        productionJobId: payload.productionJobId,
      });
      if ("error" in scope) return res.status(400).json({ success: false, error: scope.error });

      const userId = getUserId(req.user);
      const [alert] = await db
        .insert(productionAlerts)
        .values({
          organizationId,
          orderId: scope.orderId,
          orderLineItemId: scope.orderLineItemId ?? null,
          productionJobId: scope.productionJobId ?? null,
          title: payload.title,
          message: payload.message ?? payload.notes ?? null,
          alertType: payload.alertType,
          severity: payload.severity,
          visibleStations: payload.visibleStations,
          status: "active",
          createdByUserId: userId,
          metadataJson: payload.metadata ?? null,
        })
        .returning();

      await writeAlertAudit({
        organizationId,
        userId,
        userName: getUserName(req.user),
        req,
        actionType: "production_alert.created",
        alert,
        description: `Created production alert: ${alert.title}`,
      });

      res.status(201).json({ success: true, data: serializeAlert(alert) });
    } catch (error) {
      console.error("Error creating production alert:", error);
      res.status(500).json({ success: false, error: "Failed to create production alert" });
    }
  });

  app.patch("/api/production-alerts/:id/acknowledge", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ success: false, error: "Alert id required" });

      const existingRows = await db
        .select()
        .from(productionAlerts)
        .where(and(eq(productionAlerts.organizationId, organizationId), eq(productionAlerts.id, id)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ success: false, error: "Production alert not found" });
      if (existing.status === "resolved" || existing.status === "cancelled" || existing.status === "archived") {
        return res.status(409).json({ success: false, error: `Cannot acknowledge ${existing.status} alert` });
      }

      const userId = getUserId(req.user);
      const now = new Date();
      const [updated] = await db
        .update(productionAlerts)
        .set({
          status: "acknowledged",
          acknowledgedByUserId: existing.acknowledgedByUserId ?? userId,
          acknowledgedAt: existing.acknowledgedAt ?? now,
          updatedAt: now,
        })
        .where(and(eq(productionAlerts.organizationId, organizationId), eq(productionAlerts.id, id)))
        .returning();

      const productionJobId = String(req.body?.productionJobId || existing.productionJobId || "").trim();
      if (productionJobId) {
        const jobRows = await db
          .select({
            id: productionJobs.id,
            orderId: productionJobs.orderId,
            lineItemId: productionJobs.lineItemId,
          })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, productionJobId)))
          .limit(1);
        const job = jobRows[0];
        if (job) {
          await db.insert(productionEvents).values({
            organizationId,
            productionJobId: job.id,
            orderId: job.orderId,
            orderLineItemId: job.lineItemId ?? existing.orderLineItemId ?? null,
            actorUserId: userId,
            type: "production_alert_acknowledged",
            payload: {
              alertId: existing.id,
              title: existing.title,
              severity: existing.severity,
              alertType: existing.alertType,
            },
          });
        }
      }

      await writeAlertAudit({
        organizationId,
        userId,
        userName: getUserName(req.user),
        req,
        actionType: "production_alert.acknowledged",
        alert: updated,
        description: `Acknowledged production alert: ${updated.title}`,
        oldValues: serializeAlert(existing),
        newValues: serializeAlert(updated),
      });

      res.json({ success: true, data: serializeAlert(updated) });
    } catch (error) {
      console.error("Error acknowledging production alert:", error);
      res.status(500).json({ success: false, error: "Failed to acknowledge production alert" });
    }
  });

  app.patch("/api/production-alerts/:id/resolve", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ success: false, error: "Alert id required" });

      const existingRows = await db
        .select()
        .from(productionAlerts)
        .where(and(eq(productionAlerts.organizationId, organizationId), eq(productionAlerts.id, id)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ success: false, error: "Production alert not found" });

      const userId = getUserId(req.user);
      const now = new Date();
      const [updated] = await db
        .update(productionAlerts)
        .set({
          status: "resolved",
          resolvedByUserId: userId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(productionAlerts.organizationId, organizationId), eq(productionAlerts.id, id)))
        .returning();

      await writeAlertAudit({
        organizationId,
        userId,
        userName: getUserName(req.user),
        req,
        actionType: "production_alert.resolved",
        alert: updated,
        description: `Resolved production alert: ${updated.title}`,
        oldValues: serializeAlert(existing),
        newValues: serializeAlert(updated),
      });

      res.json({ success: true, data: serializeAlert(updated) });
    } catch (error) {
      console.error("Error resolving production alert:", error);
      res.status(500).json({ success: false, error: "Failed to resolve production alert" });
    }
  });
}
