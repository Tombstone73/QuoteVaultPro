import type { Express } from "express";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  auditLogs,
  orderLineItems,
  orders,
  productionAlertSeverityValues,
  productionAlerts,
  productionAlertPresets,
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
  presetId: z.string().trim().min(1).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const productionAlertPresetPayloadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  title: z.string().trim().min(1, "Title is required").max(160),
  message: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  alertType: alertTypeSchema.default("general_warning"),
  severity: alertSeveritySchema.default("warning"),
  visibleStations: z.array(alertStationSchema).min(1).max(5).default(["all"]),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const productionAlertPresetPatchSchema = productionAlertPresetPayloadSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "No preset fields to update" },
);

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

function serializePreset(row: typeof productionAlertPresets.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    message: row.message ?? null,
    alertType: row.alertType,
    severity: row.severity,
    visibleStations: normalizeVisibleStations(row.visibleStations),
    isActive: row.isActive,
    sortOrder: Number(row.sortOrder) || 0,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt as any).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt as any).toISOString() : null,
    metadata: row.metadataJson ?? null,
  };
}

const STARTER_ALERT_PRESETS = [
  {
    name: "Rick Red",
    title: "Rick Red",
    message: "Use Rick Red density preset in Onyx. Adjust reds before printing.",
    alertType: "color_match",
    severity: "critical",
    visibleStations: ["roll"],
    sortOrder: 10,
    starterKey: "rick_red",
  },
  {
    name: "PMS Match Required",
    title: "PMS Match Required",
    message: "Verify PMS/color match before production.",
    alertType: "pms_match",
    severity: "critical",
    visibleStations: ["roll", "flatbed"],
    sortOrder: 20,
    starterKey: "pms_match_required",
  },
  {
    name: "Customer Critical Color",
    title: "Customer Critical Color",
    message: "Customer is sensitive to color. Confirm color target before printing.",
    alertType: "customer_specific",
    severity: "critical",
    visibleStations: ["roll", "flatbed"],
    sortOrder: 30,
    starterKey: "customer_critical_color",
  },
  {
    name: "Laminate After Cure",
    title: "Laminate After Cure",
    message: "Allow print to cure before lamination.",
    alertType: "finishing_instruction",
    severity: "warning",
    visibleStations: ["roll"],
    sortOrder: 40,
    starterKey: "laminate_after_cure",
  },
  {
    name: "Print Back First",
    title: "Print Back First",
    message: "Print backside first per job setup.",
    alertType: "machine_setting",
    severity: "warning",
    visibleStations: ["flatbed"],
    sortOrder: 50,
    starterKey: "print_back_first",
  },
] as const;

async function ensureStarterAlertPresets(organizationId: string) {
  await db
    .insert(productionAlertPresets)
    .values(
      STARTER_ALERT_PRESETS.map((preset) => ({
        organizationId,
        name: preset.name,
        title: preset.title,
        message: preset.message,
        alertType: preset.alertType,
        severity: preset.severity,
        visibleStations: [...preset.visibleStations],
        isActive: true,
        sortOrder: preset.sortOrder,
        metadataJson: {
          starterPreset: true,
          starterKey: preset.starterKey,
        },
      })),
    )
    .onConflictDoNothing({
      target: [productionAlertPresets.organizationId, productionAlertPresets.name],
    });
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

async function writePresetAudit(args: {
  organizationId: string;
  userId: string | null;
  userName: string | null;
  req: any;
  actionType: string;
  preset: typeof productionAlertPresets.$inferSelect;
  description: string;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
}) {
  await db.insert(auditLogs).values({
    organizationId: args.organizationId,
    userId: args.userId,
    userName: args.userName,
    actionType: args.actionType,
    entityType: "production_alert_preset",
    entityId: args.preset.id,
    entityName: args.preset.name,
    description: args.description,
    oldValues: args.oldValues ?? null,
    newValues: args.newValues ?? serializePreset(args.preset),
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

  app.get("/api/production-alert-presets", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      await ensureStarterAlertPresets(organizationId);

      const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
      const rows = await db
        .select()
        .from(productionAlertPresets)
        .where(
          and(
            eq(productionAlertPresets.organizationId, organizationId),
            includeInactive ? undefined : eq(productionAlertPresets.isActive, true),
          ),
        )
        .orderBy(asc(productionAlertPresets.sortOrder), asc(productionAlertPresets.name));

      res.json({ success: true, data: rows.map((row) => serializePreset(row)) });
    } catch (error) {
      console.error("Error fetching production alert presets:", error);
      res.status(500).json({ success: false, error: "Failed to fetch production alert presets" });
    }
  });

  app.post("/api/production-alert-presets", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const parsed = productionAlertPresetPayloadSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: fromZodError(parsed.error).message });
      }

      const userId = getUserId(req.user);
      const payload = parsed.data;
      const [preset] = await db
        .insert(productionAlertPresets)
        .values({
          organizationId,
          name: payload.name,
          title: payload.title,
          message: payload.message ?? payload.notes ?? null,
          alertType: payload.alertType,
          severity: payload.severity,
          visibleStations: payload.visibleStations,
          isActive: payload.isActive ?? true,
          sortOrder: payload.sortOrder ?? 100,
          createdByUserId: userId,
          metadataJson: payload.metadata ?? null,
        })
        .returning();

      await writePresetAudit({
        organizationId,
        userId,
        userName: getUserName(req.user),
        req,
        actionType: "production_alert_preset.created",
        preset,
        description: `Created production alert preset: ${preset.name}`,
      });

      res.status(201).json({ success: true, data: serializePreset(preset) });
    } catch (error: any) {
      if (String(error?.message || "").includes("production_alert_presets_org_name_uidx")) {
        return res.status(409).json({ success: false, error: "A preset with that name already exists" });
      }
      console.error("Error creating production alert preset:", error);
      res.status(500).json({ success: false, error: "Failed to create production alert preset" });
    }
  });

  app.patch("/api/production-alert-presets/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ success: false, error: "Preset id required" });

      const parsed = productionAlertPresetPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: fromZodError(parsed.error).message });
      }

      const existingRows = await db
        .select()
        .from(productionAlertPresets)
        .where(and(eq(productionAlertPresets.organizationId, organizationId), eq(productionAlertPresets.id, id)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ success: false, error: "Production alert preset not found" });

      const payload = parsed.data;
      const now = new Date();
      const [updated] = await db
        .update(productionAlertPresets)
        .set({
          name: payload.name ?? existing.name,
          title: payload.title ?? existing.title,
          message: payload.message ?? payload.notes ?? existing.message,
          alertType: payload.alertType ?? existing.alertType,
          severity: payload.severity ?? existing.severity,
          visibleStations: payload.visibleStations ?? existing.visibleStations,
          isActive: payload.isActive ?? existing.isActive,
          sortOrder: payload.sortOrder ?? existing.sortOrder,
          metadataJson: payload.metadata ?? existing.metadataJson,
          updatedAt: now,
        })
        .where(and(eq(productionAlertPresets.organizationId, organizationId), eq(productionAlertPresets.id, id)))
        .returning();

      await writePresetAudit({
        organizationId,
        userId: getUserId(req.user),
        userName: getUserName(req.user),
        req,
        actionType: "production_alert_preset.updated",
        preset: updated,
        description: `Updated production alert preset: ${updated.name}`,
        oldValues: serializePreset(existing),
        newValues: serializePreset(updated),
      });

      res.json({ success: true, data: serializePreset(updated) });
    } catch (error: any) {
      if (String(error?.message || "").includes("production_alert_presets_org_name_uidx")) {
        return res.status(409).json({ success: false, error: "A preset with that name already exists" });
      }
      console.error("Error updating production alert preset:", error);
      res.status(500).json({ success: false, error: "Failed to update production alert preset" });
    }
  });

  app.patch("/api/production-alert-presets/:id/archive", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ success: false, error: "Preset id required" });

      const existingRows = await db
        .select()
        .from(productionAlertPresets)
        .where(and(eq(productionAlertPresets.organizationId, organizationId), eq(productionAlertPresets.id, id)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ success: false, error: "Production alert preset not found" });

      const [updated] = await db
        .update(productionAlertPresets)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(productionAlertPresets.organizationId, organizationId), eq(productionAlertPresets.id, id)))
        .returning();

      await writePresetAudit({
        organizationId,
        userId: getUserId(req.user),
        userName: getUserName(req.user),
        req,
        actionType: "production_alert_preset.archived",
        preset: updated,
        description: `Archived production alert preset: ${updated.name}`,
        oldValues: serializePreset(existing),
        newValues: serializePreset(updated),
      });

      res.json({ success: true, data: serializePreset(updated) });
    } catch (error) {
      console.error("Error archiving production alert preset:", error);
      res.status(500).json({ success: false, error: "Failed to archive production alert preset" });
    }
  });

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
      let presetMetadata: Record<string, unknown> = {};
      if (payload.presetId) {
        const presetRows = await db
          .select({ id: productionAlertPresets.id, name: productionAlertPresets.name })
          .from(productionAlertPresets)
          .where(and(eq(productionAlertPresets.organizationId, organizationId), eq(productionAlertPresets.id, payload.presetId)))
          .limit(1);
        const preset = presetRows[0];
        if (!preset) return res.status(400).json({ success: false, error: "Production alert preset not found" });
        presetMetadata = {
          productionAlertPresetId: preset.id,
          productionAlertPresetName: preset.name,
        };
      }
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
          metadataJson: {
            ...(payload.metadata ?? {}),
            ...presetMetadata,
          },
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
