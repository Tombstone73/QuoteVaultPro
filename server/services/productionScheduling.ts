import { db } from "../db";
import { orderLineItems, products, productionJobs, productionEvents, orders } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

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
}): Promise<{
  success: boolean;
  data: {
    createdJobCount: number;
    existingJobCount: number;
    skippedNonProductionCount: number;
    affectedLineItemIds: string[];
  };
  message: string;
}> {
  const { organizationId, orderId, lineItemIds, loadRoutingRules, appendEvent } = args;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[ProductionScheduling] Starting schedule for orderId=${orderId}, targetLineItems=${lineItemIds?.length ?? 'ALL'}`);
  }

  return await db.transaction(async (tx) => {
    // Load order to verify it exists and belongs to this org
    const [orderRecord] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
      .limit(1);

    if (!orderRecord) {
      throw new Error("Order not found");
    }

    // Load line items with their products to check requiresProductionJob flag
    let lineItemQuery = tx
      .select({
        lineItemId: orderLineItems.id,
        productId: orderLineItems.productId,
        status: orderLineItems.status,
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
        },
        message: "No line items require production",
      };
    }

    // Load production routing config (fail-soft: use defaults if missing)
    const routing = await loadRoutingRules(organizationId);
    const hasOrgRouting = routing.source === "org";
    
    // Default routing values when org config is missing/invalid
    const DEFAULT_STATION_KEY = "flatbed";
    const DEFAULT_STEP_KEY = "queued";
    
    if (!hasOrgRouting) {
      console.warn(`[ProductionScheduling] No org routing config (source=${routing.source}) for org ${organizationId}; using defaults`);
    }

    // Check existing production jobs for these line items
    const lineItemIdsToProcess = productionRequiredItems.map((item) => item.lineItemId);
    
    const existingJobs = lineItemIdsToProcess.length > 0
      ? await tx
          .select({
            lineItemId: productionJobs.lineItemId,
            jobId: productionJobs.id,
          })
          .from(productionJobs)
          .where(
            and(
              eq(productionJobs.organizationId, organizationId),
              inArray(productionJobs.lineItemId, lineItemIdsToProcess)
            )
          )
      : [];

    const existingJobsByLineItem = new Map(
      existingJobs.map((job) => [job.lineItemId, job.jobId])
    );

    let createdCount = 0;
    let existingCount = 0;
    const affectedIds: string[] = [];

    // Process each line item
    for (const item of productionRequiredItems) {
      // Check if job already exists
      if (existingJobsByLineItem.has(item.lineItemId)) {
        existingCount++;
        affectedIds.push(item.lineItemId);
        continue;
      }

      // Determine routing from line item status (fail-soft: use defaults if not found)
      const rule = routing.rules.find((r: any) => r.id === item.status);
      
      let stationKey: string;
      let stepKey: string;
      let usedDefaults = false;
      
      if (!rule || rule.sendToProduction !== true) {
        // No rule or not routed to production - use defaults to avoid blocking intake
        stationKey = DEFAULT_STATION_KEY;
        stepKey = DEFAULT_STEP_KEY;
        usedDefaults = true;
        console.warn(
          `[ProductionScheduling] No routing rule for lineItemId=${item.lineItemId} status=${item.status}; using defaults (${stationKey}/${stepKey})`
        );
      } else {
        const ruleStationKey = String(rule.stationKey ?? "").trim();
        const ruleStepKey = String((rule as any).stepKey ?? "").trim();
        
        if (!ruleStationKey || !ruleStepKey) {
          // Rule exists but incomplete - use defaults
          stationKey = DEFAULT_STATION_KEY;
          stepKey = DEFAULT_STEP_KEY;
          usedDefaults = true;
          console.warn(
            `[ProductionScheduling] Incomplete routing rule for lineItemId=${item.lineItemId}; using defaults (${stationKey}/${stepKey})`
          );
        } else {
          stationKey = ruleStationKey;
          stepKey = ruleStepKey;
        }
      }

      // Create production job
      const [inserted] = await tx
        .insert(productionJobs)
        .values({
          organizationId,
          orderId,
          lineItemId: item.lineItemId,
          stationKey,
          stepKey,
          status: "queued",
          totalSeconds: 0,
        })
        .returning({ id: productionJobs.id });

      // Log intake event
      await appendEvent({
        tx,
        organizationId,
        productionJobId: inserted.id,
        type: "intake",
        payload: {
          fromStatus: null,
          toStatus: item.status,
          stationKey,
          stepKey,
          source: "bulk_schedule",
          usedDefaultRouting: usedDefaults,
        },
      });

      createdCount++;
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
      if (createdCount > 0) {
        console.log(`[ProductionScheduling] Sample job: orderId=${orderId}, station=${DEFAULT_STATION_KEY}, step=${DEFAULT_STEP_KEY}`);
      }
    }

    return {
      success: true,
      data: {
        createdJobCount: createdCount,
        existingJobCount: existingCount,
        skippedNonProductionCount: skippedCount,
        affectedLineItemIds: affectedIds,
      },
      message,
    };
  });
}
