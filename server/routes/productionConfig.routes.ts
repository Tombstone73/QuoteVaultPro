import { randomUUID } from "crypto";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { orderLineItems, orders, products, productionJobs } from "@shared/schema";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { ensureProductionMapForOrg } from "../services/productionMapService";
import { getInitialWorkflowState, transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import { resolveInitialProductionRoute } from "../services/productionRoutingResolver";
import {
  appendEvent,
  createProductionStationStep,
  ensureActiveStationExists,
  getActiveProductionStationsForOrganization,
  getProductionConfigForOrganization,
  getProductionLineItemStatusRulesForOrganization,
  getProductionStationStepKeysForStation,
  getProductionStationStepState,
  getProductionStationStepsForOrganization,
  loadProductionLineItemStatusRulesForOrganization,
  normalizeProductionStepKey,
  normalizeProductionStepLabel,
  productionLineItemStatusRulesSchema,
  productionManagedStepTriggerSchema,
  reorderProductionStationSteps,
  setProductionLineItemStatusRulesForOrganization,
  updateProductionStationStep,
} from "./production.shared";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

export function registerProductionConfigRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser } = middleware;

  app.get("/api/production/config", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const config = await getProductionConfigForOrganization(organizationId);
      res.json({ success: true, data: config });
    } catch (error) {
      console.error("Error fetching production config:", error);
      res.status(500).json({ error: "Failed to fetch production config" });
    }
  });

  app.get("/api/production/stations", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const data = await getActiveProductionStationsForOrganization(organizationId);

      res.json({ success: true, data });
    } catch (error) {
      console.error("Error fetching production stations:", error);
      res.status(500).json({ error: "Failed to fetch production stations" });
    }
  });

  app.post("/api/production/repair", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const report = await ensureProductionMapForOrg(organizationId);
      if (report.failed.length > 0) {
        return res.status(500).json({ error: "Production map repair failed", data: report });
      }
      return res.json({ success: true, data: report });
    } catch (error) {
      console.error("Error repairing production map:", error);
      return res.status(500).json({ error: "Failed to repair production map" });
    }
  });

  app.get("/api/production/steps", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const stationSteps = await getProductionStationStepsForOrganization(organizationId);
      res.json({ success: true, data: stationSteps });
    } catch (error) {
      console.error("Error fetching production steps:", error);
      res.status(500).json({ error: "Failed to fetch production steps" });
    }
  });

  app.post("/api/production/steps", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const parsed = z
        .object({
          stationKey: z.string().min(1),
          key: z.string().optional().nullable(),
          label: z.string().min(1),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid step payload" });

      const stationKey = String(parsed.data.stationKey).trim();
      const label = normalizeProductionStepLabel(parsed.data.label);
      const key = normalizeProductionStepKey(parsed.data.key ?? label);
      if (!stationKey || !label || !key) return res.status(400).json({ error: "Invalid step payload" });

      if (!(await ensureActiveStationExists(organizationId, stationKey))) {
        return res.status(400).json({ error: `Station '${stationKey}' is not active` });
      }

      const existingKeys = await getProductionStationStepKeysForStation(organizationId, stationKey);
      if (existingKeys.includes(key)) {
        return res.status(409).json({ error: `Step '${key}' already exists for station '${stationKey}'` });
      }

      await createProductionStationStep({ organizationId, stationKey, key, label });
      const stationSteps = await getProductionStationStepsForOrganization(organizationId);
      res.json({ success: true, data: stationSteps });
    } catch (error) {
      console.error("Error creating production step:", error);
      res.status(500).json({ error: "Failed to create production step" });
    }
  });

  app.patch(
    "/api/production/steps/:stationKey/:key",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const stationKey = String(req.params.stationKey ?? "").trim();
        const key = normalizeProductionStepKey(req.params.key);
        if (!stationKey || !key) return res.status(400).json({ error: "Invalid step path" });

        const parsed = z
          .object({
            label: z.string().min(1).optional(),
            active: z.boolean().optional(),
            triggers: z.array(productionManagedStepTriggerSchema).optional(),
          })
          .refine(
            (value) =>
              typeof value.label !== "undefined" ||
              typeof value.active !== "undefined" ||
              typeof value.triggers !== "undefined",
            {
              message: "No step fields to update",
            },
          )
          .safeParse(req.body ?? {});

        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid step payload" });
        }

        const existingKeys = await getProductionStationStepKeysForStation(organizationId, stationKey);
        if (!existingKeys.includes(key)) return res.status(404).json({ error: "Step not found" });

        await updateProductionStationStep({
          organizationId,
          stationKey,
          key,
          label: parsed.data.label ? normalizeProductionStepLabel(parsed.data.label) : undefined,
          active: typeof parsed.data.active === "boolean" ? parsed.data.active : undefined,
          triggers: typeof parsed.data.triggers !== "undefined" ? parsed.data.triggers : undefined,
        });

        const stationSteps = await getProductionStationStepsForOrganization(organizationId);
        res.json({ success: true, data: stationSteps });
      } catch (error) {
        console.error("Error updating production step:", error);
        res.status(500).json({ error: "Failed to update production step" });
      }
    },
  );

  app.put(
    "/api/production/steps/:stationKey/reorder",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const stationKey = String(req.params.stationKey ?? "").trim();
        if (!stationKey) return res.status(400).json({ error: "Invalid station path" });

        const parsed = z
          .object({
            keys: z.array(z.string().min(1)).min(1),
          })
          .safeParse(req.body ?? {});

        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid reorder payload" });
        }

        await reorderProductionStationSteps({
          organizationId,
          stationKey,
          keys: parsed.data.keys,
        });

        const stationSteps = await getProductionStationStepsForOrganization(organizationId);
        res.json({ success: true, data: stationSteps });
      } catch (error) {
        const message = String((error as any)?.message || "Failed to reorder production steps");
        if (message.includes("Reorder payload")) {
          return res.status(400).json({ error: message });
        }
        console.error("Error reordering production steps:", error);
        res.status(500).json({ error: "Failed to reorder production steps" });
      }
    },
  );

  app.get(
    "/api/production/settings/line-item-statuses",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const rules = await getProductionLineItemStatusRulesForOrganization(organizationId);
        res.json({ success: true, data: rules });
      } catch (error) {
        console.error("Error fetching production line item status rules:", error);
        res.status(500).json({ error: "Failed to fetch production settings" });
      }
    },
  );

  app.put(
    "/api/production/settings/line-item-statuses",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const parsed = productionLineItemStatusRulesSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid rules" });

        const rules = parsed.data;
        const keys = new Set<string>();
        for (const rule of rules) {
          const id = String((rule as any).id ?? (rule as any).key ?? "").trim();
          if (!id) return res.status(400).json({ error: "Invalid id" });
          if (keys.has(id)) return res.status(400).json({ error: `Duplicate id: ${id}` });
          keys.add(id);

          if ((rule as any).sendToProduction === true) {
            const stationKey = String((rule as any).stationKey ?? "").trim();
            if (!stationKey) {
              return res.status(400).json({ error: `Status '${id}' routes to production but has no station.` });
            }

            if (!(await ensureActiveStationExists(organizationId, stationKey))) {
              return res.status(400).json({ error: `Status '${id}' references inactive or missing station '${stationKey}'.` });
            }

            const stepKey = String((rule as any).stepKey ?? (rule as any).defaultStepKey ?? "").trim();
            if (stepKey) {
              const stepState = await getProductionStationStepState(organizationId, stationKey, stepKey);
              if (stepState === "missing") {
                return res.status(400).json({ error: `Status '${id}' references missing step '${stepKey}' for station '${stationKey}'.` });
              }
              if (stepState === "inactive") {
                return res.status(400).json({ error: `Status '${id}' references inactive step '${stepKey}' for station '${stationKey}'.` });
              }
            }
          }
        }

        await setProductionLineItemStatusRulesForOrganization(organizationId, rules);
        const next = await getProductionLineItemStatusRulesForOrganization(organizationId);
        res.json({ success: true, data: next });
      } catch (error) {
        console.error("Error saving production line item status rules:", error);
        res.status(500).json({ error: "Failed to save production settings" });
      }
    },
  );

  app.post(
    "/api/production/intake/from-line-item/:lineItemId",
    isAuthenticated,
    tenantContext,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const lineItemId = String(req.params.lineItemId);

        const [lineItem] = await db
          .select({
            id: orderLineItems.id,
            orderId: orderLineItems.orderId,
            productTypeId: products.productTypeId,
            status: orderLineItems.status,
            requiresDesign: orderLineItems.requiresDesign,
            requiresProofApproval: orderLineItems.requiresProofApproval,
            requiresPrepress: orderLineItems.requiresPrepress,
          })
          .from(orderLineItems)
          .leftJoin(products, eq(orderLineItems.productId, products.id))
          .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
          .where(and(eq(orders.organizationId, organizationId), eq(orderLineItems.id, lineItemId)))
          .limit(1);

        if (!lineItem) return res.status(404).json({ error: "Order line item not found" });

        const resolvedRoute = await resolveInitialProductionRoute({
          organizationId,
          productTypeId: lineItem.productTypeId,
          lineItemRequiresDesignSnapshot:
            typeof lineItem.requiresDesign === "boolean" ? lineItem.requiresDesign : undefined,
          lineItemRequiresPrepressSnapshot:
            typeof lineItem.requiresPrepress === "boolean" ? lineItem.requiresPrepress : undefined,
        });

        const stationKey = String(resolvedRoute.stationKey ?? "").trim();
        const stepKey = String(resolvedRoute.stepKey ?? "").trim();
        if (!stationKey || !stepKey) {
          console.warn(
            `[ProductionIntake] Resolver returned missing station/step; skipping job creation for lineItemId=${lineItem.id} status=${lineItem.status}`,
          );
          return res.json({
            success: true,
            data: null,
            warnings: ["Routing resolver missing station/step; no job created."],
          });
        }

        const job = await db.transaction(async (tx) => {
          const targetState = getInitialWorkflowState({
            requiresDesign: Boolean(lineItem.requiresDesign),
            requiresPrepress: Boolean(lineItem.requiresPrepress),
            requiresProofApproval: Boolean(lineItem.requiresProofApproval),
          });

          const transition = await transitionLineItemWorkflowState(tx, {
            organizationId,
            lineItemId: lineItem.id,
            toState: targetState,
            actorUserId: getUserId(req.user) ?? null,
            metadata: {
              source: "production_intake",
              routingReason: resolvedRoute.reason,
              resolvedStationKey: stationKey,
              resolvedStepKey: stepKey,
            },
          });

          if (!transition.activeOwnerJobId) {
            return null;
          }

          const [out] = await tx
            .select({
              id: productionJobs.id,
              orderId: productionJobs.orderId,
              lineItemId: productionJobs.lineItemId,
              stationKey: productionJobs.stationKey,
              stepKey: productionJobs.stepKey,
              status: productionJobs.status,
            })
            .from(productionJobs)
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, transition.activeOwnerJobId)))
            .limit(1);
          return out;
        });

        res.json({ success: true, data: job });
      } catch (error) {
        console.error("Error ingesting production job from line item:", error);
        res.status(500).json({ error: "Failed to intake production job" });
      }
    },
  );

  app.post(
    "/api/orders/:orderId/production/schedule",
    isAuthenticated,
    tenantContext,
    async (req: any, res) => {
      const traceId = randomUUID();
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const orderId = String(req.params.orderId);
        const lineItemIds = Array.isArray(req.body.lineItemIds)
          ? req.body.lineItemIds.filter((id: any) => typeof id === "string" && id.length > 0)
          : undefined;

        if (Array.isArray(req.body.lineItemIds) && lineItemIds && lineItemIds.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No line items to schedule",
            traceId,
          });
        }

        const { scheduleOrderLineItemsForProduction } = await import("../services/productionScheduling");

        const result = await scheduleOrderLineItemsForProduction({
          organizationId,
          orderId,
          lineItemIds,
          loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
          appendEvent,
          traceId,
        });

        res.json(result);
      } catch (error: any) {
        const formatError = (input: any) => {
          if (!input || typeof input !== "object") return null;
          return {
            code: input.code,
            constraint: input.constraint,
            table: input.table,
            detail: input.detail,
            message: input.message,
          };
        };

        console.error("Error scheduling line items for production:", {
          traceId,
          error: formatError(error),
          cause: formatError(error?.cause),
        });
        res.status(500).json({
          success: false,
          error: "Scheduling failed",
          traceId,
        });
      }
    },
  );
}
