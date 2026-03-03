import { db } from "../db";
import { orderLineItems, products, productionJobs, orders } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { routeLineItemToProduction } from "./productionRoutingService";
import { resolveInitialProductionRoute } from "./productionRoutingResolver";

/**
 * scheduleOrderLineItemsForProduction
 * 
 * Atomically creates ProductionJobs for line items that require production.
 * - If lineItemIds is omitted, targets ALL production-required line items in the order.
 * - If lineItemIds is provided, targets ONLY those items (still filtered by requiresProductionJob).
 * - Idempotent: does not duplicate jobs if they already exist.
 * - Transactional: either all jobs are created/verified, or nothing changes.
 * 
 * Returns:
 * - createdJobCount: number of new jobs created
 * - existingJobCount: number of jobs that already existed
 * - skippedNonProductionCount: number of items skipped (product doesn't require production)
 * - affectedLineItemIds: array of line item IDs that now have production jobs
 */
export async function scheduleOrderLineItemsForProduction(args: {
  organizationId: string;
  orderId: string;
  lineItemIds?: string[];
  loadRoutingRules: (orgId: string) => Promise<{ source: string; rules: any[] }>;
  appendEvent: (args: { tx: any; organizationId: string; productionJobId: string; type: "intake" | "routing_override" | "timer_started" | "timer_stopped" | "note" | "reprint_incremented" | "media_used_set"; payload?: any }) => Promise<void>;
  traceId?: string;
}): Promise<{
  success: boolean;
  data: {
    createdJobCount: number;
    existingJobCount: number;
    skippedNonProductionCount: number;
    affectedLineItemIds: string[];
    lineItemDiagnostics: Record<string, {
      stationKey: string;
      stepKey: string;
      routingReason: string;
      routingSource?: string;
      idempotencyNote?: string;
    }>;
  };
  message: string;
}> {
  const { organizationId, orderId, lineItemIds, loadRoutingRules: _loadRoutingRules, appendEvent, traceId } = args;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[ProductionScheduling] Starting schedule for orderId=${orderId}, targetLineItems=${lineItemIds?.length ?? 'ALL'}`);
  }

  return await db.transaction(async (tx) => {
    let step = "start";
    try {
      // Load order to verify it exists and belongs to this org
      step = "load_order";
      const [orderRecord] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
        .limit(1);

      if (!orderRecord) {
        throw new Error("Order not found");
      }

      // Load line items with their products to check requiresProductionJob flag.
      // Join productTypes to get production routing defaults; join materials as fallback.
      step = "load_line_items";
      const lineItemQuery = tx
        .select({
          lineItemId: orderLineItems.id,
          productId: orderLineItems.productId,
          productTypeId: products.productTypeId,
          materialId: orderLineItems.materialId,
          status: orderLineItems.status,
          lineItemRequiresPrepressSnapshot: orderLineItems.requiresPrepress,
          requiresProductionJob: products.requiresProductionJob,
        })
        .from(orderLineItems)
        .innerJoin(products, eq(orderLineItems.productId, products.id))
        .where(and(
          eq(orderLineItems.orderId, orderId),
          // Filter to selected items if specified
          lineItemIds && lineItemIds.length > 0 ? inArray(orderLineItems.id, lineItemIds) : undefined
        ))
        .$dynamic();

      const lineItemRecords = await lineItemQuery;

      if (lineItemRecords.length === 0) {
        return {
          success: true,
          data: {
            createdJobCount: 0,
            existingJobCount: 0,
            skippedNonProductionCount: 0,
            affectedLineItemIds: [],
            lineItemDiagnostics: {},
          },
          message: "No line items found",
        };
      }

      // Filter to only those requiring production
      const productionRequiredItems = lineItemRecords.filter((item) => item.requiresProductionJob === true);
      const skippedCount = lineItemRecords.length - productionRequiredItems.length;

      if (productionRequiredItems.length === 0) {
        return {
          success: true,
          data: {
            createdJobCount: 0,
            existingJobCount: 0,
            skippedNonProductionCount: skippedCount,
            affectedLineItemIds: [],
            lineItemDiagnostics: {},
          },
          message: "No line items require production",
        };
      }

      // Check existing production jobs for these line items
      const lineItemIdsToProcess = productionRequiredItems.map((item) => item.lineItemId);
      if (lineItemIdsToProcess.length === 0) {
        return {
          success: true,
          data: {
            createdJobCount: 0,
            existingJobCount: 0,
            skippedNonProductionCount: skippedCount,
            affectedLineItemIds: [],
            lineItemDiagnostics: {},
          },
          message: "No line items require production",
        };
      }

      step = "load_existing_jobs";
      const existingJobs = await tx
        .select({
          lineItemId: productionJobs.lineItemId,
          jobId: productionJobs.id,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
        })
        .from(productionJobs)
        .where(
          and(
            eq(productionJobs.organizationId, organizationId),
            inArray(productionJobs.lineItemId, lineItemIdsToProcess)
          )
        );

      const existingJobsByLineItem = new Map(existingJobs.map((job) => [job.lineItemId, job]));

      let createdCount = 0;
      let existingCount = 0;
      const affectedIds: string[] = [];
      const lineItemDiagnostics: Record<string, {
        stationKey: string;
        stepKey: string;
        routingReason: string;
        routingSource?: string;
        idempotencyNote?: string;
      }> = {};

      // Process each line item
      for (const item of productionRequiredItems) {
        // Check if job already exists
        const existingJobForLineItem = existingJobsByLineItem.get(item.lineItemId);
        if (existingJobForLineItem) {
          existingCount++;
          affectedIds.push(item.lineItemId);
          lineItemDiagnostics[item.lineItemId] = {
            stationKey: String(existingJobForLineItem.stationKey ?? ""),
            stepKey: String(existingJobForLineItem.stepKey ?? ""),
            routingReason: "existing_job_already_linked_to_line_item",
            routingSource: "existing",
            idempotencyNote: "Production job already existed before scheduling request",
          };
          continue;
        }

        // TODO: keep line-item status lifecycle-only; routing is resolved from org/productType/snapshot fields.
        step = "resolve_initial_route";
        const route = await resolveInitialProductionRoute({
          organizationId,
          productTypeId: item.productTypeId,
          lineItemRequiresPrepressSnapshot:
            typeof item.lineItemRequiresPrepressSnapshot === "boolean"
              ? item.lineItemRequiresPrepressSnapshot
              : undefined,
        });

        const stationKey = route.stationKey;
        const stepKey = route.stepKey;

        // Create production job via canonical routing service
        step = "route_line_item_to_production";
        const routingResult = await routeLineItemToProduction({
          tx,
          organizationId,
          orderId,
          lineItemId: item.lineItemId,
          stationKey,
          stepKey,
          trigger: "scheduler",
          extraEventPayload: {
            fromStatus: null,
            toStatus: item.status,
            source: "bulk_schedule",
            routingReason: route.reason,
          },
        });

        if (routingResult.outcome === "existing" && routingResult.reason) {
          console.warn(
            `[ProductionScheduling] lineItemId=${item.lineItemId} not re-routed to ${stationKey}/${stepKey}: ${routingResult.reason}`,
          );
        }

        if (routingResult.outcome === "created") {
          createdCount++;
        } else {
          existingCount++;
        }

        lineItemDiagnostics[item.lineItemId] = {
          stationKey: routingResult.stationKey,
          stepKey: routingResult.stepKey,
          routingReason: route.reason,
          routingSource: route.reason.includes("product")
            ? "product"
            : route.reason.includes("snapshot")
              ? "snapshot"
              : route.reason.includes("org")
                ? "org"
                : "default",
          idempotencyNote: routingResult.outcome === "existing"
            ? routingResult.reason || "Existing non-void production job reused"
            : undefined,
        };
        affectedIds.push(item.lineItemId);
      }

      const totalAffected = affectedIds.length;
      let message = "";
      if (createdCount > 0 && existingCount > 0) {
        message = `Created ${createdCount} new job(s), ${existingCount} already existed`;
      } else if (createdCount > 0) {
        message = `Created ${createdCount} production job(s)`;
      } else if (existingCount > 0) {
        message = `${existingCount} item(s) already in production`;
      } else {
        message = "No jobs created (line items not routed to production)";
      }

      if (skippedCount > 0) {
        message += `. Skipped ${skippedCount} non-production item(s)`;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(`[ProductionScheduling] Completed for orderId=${orderId}: created=${createdCount}, existing=${existingCount}, skipped=${skippedCount}`);
      }

      return {
        success: true,
        data: {
          createdJobCount: createdCount,
          existingJobCount: existingCount,
          skippedNonProductionCount: skippedCount,
          affectedLineItemIds: affectedIds,
          lineItemDiagnostics,
        },
        message,
      };
    } catch (err: any) {
      console.error("[SchedulingFail]", {
        traceId,
        step,
        code: err?.code,
        constraint: err?.constraint,
        table: err?.table,
        detail: err?.detail,
        message: err?.message,
      });
      if (err?.cause) {
        console.error("[SchedulingFail.cause]", {
          traceId,
          step,
          code: err.cause?.code,
          constraint: err.cause?.constraint,
          table: err.cause?.table,
          detail: err.cause?.detail,
          message: err.cause?.message,
        });
      }
      throw err;
    }
  });
}
