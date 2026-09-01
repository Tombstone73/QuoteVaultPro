import type { Express } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  assets,
  assetLinks,
  auditLogs,
  customerContacts,
  customers,
  lineItemFiles,
  materials,
  orderAttachments,
  orderLineItems,
  orders,
  productionAlerts,
  productionEvents,
  productionJobs,
  productionRunMembers,
  productionRuns,
  productionStationSteps,
  products,
  reprintRequests,
  users,
} from "@shared/schema";
import { ACTIVE_PRODUCTION_RUN_STATUSES } from "@shared/productionRunLifecycle";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import {
  appendEvent,
  consumeReservedMaterialsForLineItem,
  getProductionConfigForOrganization,
  getTimerStateForJob,
  productionStatusSchema,
  productionViewKeySchema,
  toSeconds,
} from "./production.shared";
import { stationResolver } from "../services/stations/stationResolver";
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
} from "../lib/supabaseObjectHelpers";
import {
  isDesignOwnershipJob,
  isPrepressOwnershipJob,
  resolveActiveProductionOwners,
} from "../services/productionOwnership";
import { routeLineItemToProduction } from "../services/productionRoutingService";
import { assertParentOrderInProductionForJob } from "../services/orderProductionGate";
import { isCanceledOrder, isTerminalProductionStatus } from "@shared/operationalState";
import { documentNumberMatchesSearch } from "@shared/documentNumbering";
import { normalizeProductionStationKey } from "@shared/productionStations";
import { MAX_PRODUCTION_BULK_ITEMS, dedupeProductionJobIds, validateProductionBulkSelection } from "@shared/productionBulk";
import {
  buildPrepressOptionRows,
  extractFinishingBullets,
  resolvePrepressJobSpecificationsDisplay,
  type ProductionDisplayOptionRow,
} from "./flatStockNesting.shared";
import {
  calculateSheetProductionLayout,
  resolveLineItemProductionArtwork,
  resolveProductionArtworkSides,
  resolveProductionPreviewUrl,
  resolveProductionSides,
  resolveSheetConfiguration,
} from "@shared/productionHydration";
import { sortFinalProductionFiles } from "@shared/productionFileHydration";
import { resolveProductionCompletionRoute } from "../services/productionCompletionRouting";
import { resolveLineItemProductionDueDate } from "../services/productionDueDate";
import { resolveProductionCompletionLineItemState } from "../services/productionCompletionLineItemState";
import {
  completedProductionSearchText,
  describeCompletedArtworkSummary,
  resolveCompletedArtworkQuantityMode,
} from "@shared/productionCompleted";
import { buildArtworkAllocationStatus } from "@shared/artworkAllocation";
import { ReturnToPrepressError, getReturnToPrepressBlockedReason } from "../services/productionReturnToPrepressService";
import { lineItemArtworkReadResolver } from "../services/artwork/LineItemArtworkReadResolver";
import { canonicalPrepressOperations } from "../services/canonicalPrepressOperations";
import { canonicalProductionOperations } from "../services/canonicalProductionOperations";

/**
 * Canonical station key for the Fulfillment station.
 * Production jobs at non-prepress, non-design stations route here on completion.
 * Reaching fulfillment marks the line item fulfillment-ready/completed; the
 * fulfillment job still records the physical handoff separately.
 */
const FULFILLMENT_STATION_KEY = "fulfillment";
const COMPLETION_RECOVERY_HOURS = 24;
const completedHistoryRangeSchema = z.enum(["24h", "7d", "30d"]);
const COMPLETED_HISTORY_RANGE_DAYS: Record<z.infer<typeof completedHistoryRangeSchema>, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};
const DEFAULT_PRINTER_OPTIONS_BY_STATION: Record<string, string[]> = {
  roll: ["S40", "S60", "Canon"],
  wide_roll: ["S40", "S60", "Canon"],
  flatbed: ["Jetson"],
};

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stationLabel(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "Unassigned";
  switch (normalized) {
    case "wide_roll":
    case "roll":
      return "Roll";
    case "flatbed":
      return "Flatbed";
    case "prepress":
      return "Prepress";
    case "design":
      return "Design";
    case "fulfillment":
      return "Fulfillment";
    case "done":
    case "completed":
      return "Completed";
    default:
      return normalized
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") || "Unassigned";
  }
}

function userDisplayName(row: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string | null {
  if (!row) return null;
  const name = [row.firstName, row.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return name || row.email || null;
}

// Shared with the Order-level shortcut to repair the Order projection from
// existing canonical Production/Fulfillment handoff records without completing
// a fulfillment job.
export async function markOrderReadyForFulfillmentIfProductionComplete(
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    actorUserId: string;
    productionJobId: string;
  },
) {
  const remainingActiveProduction = await tx
    .select({ id: productionJobs.id })
    .from(productionJobs)
    .where(and(
      eq(productionJobs.organizationId, args.organizationId),
      eq(productionJobs.orderId, args.orderId),
      sql`lower(coalesce(${productionJobs.stationKey}, '')) <> ${FULFILLMENT_STATION_KEY}`,
      sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`,
    ))
    .limit(1);

  if (remainingActiveProduction[0]) {
    return { changed: false, reason: "active_production_jobs_remaining" as const };
  }

  const [order] = await tx
    .select({
      id: orders.id,
      state: orders.state,
      status: orders.status,
      canceledAt: orders.canceledAt,
      productionCompletedAt: orders.productionCompletedAt,
    })
    .from(orders)
    .where(and(eq(orders.organizationId, args.organizationId), eq(orders.id, args.orderId)))
    .limit(1);

  if (!order || isCanceledOrder(order)) {
    return { changed: false, reason: "order_missing_or_canceled" as const };
  }

  const nowIso = new Date().toISOString();
  await tx
    .update(orders)
    .set({
      state: "production_complete",
      status: "ready_for_shipment",
      routingTarget: FULFILLMENT_STATION_KEY,
      productionCompletedAt: order.productionCompletedAt ?? nowIso,
      updatedAt: sql`now()`,
    } as any)
    .where(and(eq(orders.organizationId, args.organizationId), eq(orders.id, args.orderId)));

  await appendEvent({
    tx,
    organizationId: args.organizationId,
    productionJobId: args.productionJobId,
    type: "note",
    actorUserId: args.actorUserId,
    payload: {
      eventType: "order_ready_for_fulfillment",
      orderId: args.orderId,
      routingTarget: FULFILLMENT_STATION_KEY,
      previousOrderState: order.state ?? null,
      previousOrderStatus: order.status ?? null,
    },
  });

  return { changed: true, reason: "order_marked_ready_for_fulfillment" as const };
}

async function restoreOrderProductionStateAfterUndo(
  tx: any,
  args: {
    organizationId: string;
    orderId: string;
    actorUserId: string;
    productionJobId: string;
  },
) {
  const activeFulfillment = await tx
    .select({ id: productionJobs.id })
    .from(productionJobs)
    .where(and(
      eq(productionJobs.organizationId, args.organizationId),
      eq(productionJobs.orderId, args.orderId),
      eq(productionJobs.stationKey, FULFILLMENT_STATION_KEY),
      sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`,
    ))
    .limit(1);

  if (activeFulfillment[0]) {
    return { changed: false, reason: "active_fulfillment_remains" as const };
  }

  await tx
    .update(orders)
    .set({
      state: "open",
      status: "in_production",
      routingTarget: null,
      productionCompletedAt: null,
      updatedAt: sql`now()`,
    } as any)
    .where(and(
      eq(orders.organizationId, args.organizationId),
      eq(orders.id, args.orderId),
      eq(orders.state as any, "production_complete"),
    ));

  await appendEvent({
    tx,
    organizationId: args.organizationId,
    productionJobId: args.productionJobId,
    type: "note",
    actorUserId: args.actorUserId,
    payload: {
      eventType: "order_fulfillment_readiness_restored_by_undo",
      orderId: args.orderId,
    },
  });

  return { changed: true, reason: "order_restored_to_production" as const };
}

// Exported for the Order-level production shortcut.  The shortcut must use this
// exact operation so station completion, material consumption, audit events,
// and fulfillment handoff remain owned by Production.
export async function completeProductionJobWorkflow(
  tx: any,
  args: {
    organizationId: string;
    userId: string;
    jobId: string;
    skipProduction: boolean | "auto";
    /** Order-level supervisory completion of never-started work. This records
     * explicit bypass provenance and must not consume materials that were not used. */
    manualOverride?: {
      source: "order_complete_production_override";
      bypassedPrerequisites: string[];
    } | null;
    auditUserName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  if (!args.organizationId) {
    throw Object.assign(new Error("Missing organization context"), { statusCode: 500 });
  }
  if (!args.userId) {
    throw Object.assign(new Error("User ID not found"), { statusCode: 401 });
  }

  const now = new Date();
  const restoreUntil = addHours(now, COMPLETION_RECOVERY_HOURS);
  const jobRows = await tx
    .select()
    .from(productionJobs)
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
  if (job.status === "done") return job;
  if (isTerminalProductionStatus(job.status)) {
    throw Object.assign(new Error("Cannot complete a terminal production job."), { statusCode: 409 });
  }

  const effectiveSkipProduction = args.skipProduction === "auto" ? job.status === "queued" : args.skipProduction;
  const manualOverride = args.manualOverride ?? null;

  const [stepDefinition] = await tx
    .select({ triggers: productionStationSteps.triggers })
    .from(productionStationSteps)
    .where(and(
      eq(productionStationSteps.organizationId, args.organizationId),
      eq(productionStationSteps.stationKey, String(job.stationKey ?? "")),
      eq(productionStationSteps.key, String(job.stepKey ?? "queued")),
      eq(productionStationSteps.active, true),
    ))
    .limit(1);
  const productionConfig = await getProductionConfigForOrganization(args.organizationId);
  const completionRoute = resolveProductionCompletionRoute({
    stationKey: job.stationKey,
    stepKey: job.stepKey,
    finishingMode: productionConfig.finishingMode,
    triggers: stepDefinition?.triggers ?? [],
  });
  if (completionRoute.kind === "missing_mapping") {
    throw Object.assign(new Error(
      `Cannot complete ${completionRoute.stationKey}/${completionRoute.stepKey}: configure an on-complete route in Production & Operations settings.`,
    ), { statusCode: 409 });
  }

  await assertParentOrderInProductionForJob(tx, {
    organizationId: args.organizationId,
    job,
    action: "complete production job",
  });

  if (job.status === "queued" && !effectiveSkipProduction) {
    throw Object.assign(new Error("Cannot complete from queued without skipProduction"), { statusCode: 400 });
  }

  const lastTimer = await tx
    .select({ createdAt: productionEvents.createdAt, type: productionEvents.type })
    .from(productionEvents)
    .where(
      and(
        eq(productionEvents.organizationId, args.organizationId),
        eq(productionEvents.productionJobId, args.jobId),
        inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
      ),
    )
    .orderBy(desc(productionEvents.createdAt))
    .limit(1);
  const last = lastTimer[0];
  if (last?.type === "timer_started") {
    const startedAtMs = new Date(last.createdAt as any).getTime();
    const deltaSeconds = toSeconds(now.getTime() - startedAtMs);
    await appendEvent({
      tx,
      organizationId: args.organizationId,
      productionJobId: args.jobId,
      type: "timer_stopped",
      actorUserId: args.userId,
      payload: { seconds: deltaSeconds },
    });
    await tx
      .update(productionJobs)
      .set({ totalSeconds: (Number(job.totalSeconds) || 0) + deltaSeconds })
      .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)));
  }

  await tx
    .update(productionJobs)
    .set({
      status: "done",
      completedAt: now,
      completedByUserId: args.userId,
      previousStatus: job.status,
      previousStation: job.stationKey,
      restoreUntil,
      restoredAt: null,
      restoredByUserId: null,
      restoreReason: null,
      updatedAt: now,
    })
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)));

  if (job.lineItemId && job.orderId) {
    if (!manualOverride) {
      await consumeReservedMaterialsForLineItem(tx, {
        organizationId: args.organizationId,
        orderId: job.orderId,
        lineItemId: job.lineItemId,
        productionJobId: args.jobId,
        userId: args.userId,
      });
    }

    const [lineItem] = await tx
      .select({
        workflowState: orderLineItems.workflowState,
        status: orderLineItems.status,
      })
      .from(orderLineItems)
      .where(and(eq(orderLineItems.orderId, job.orderId), eq(orderLineItems.id, job.lineItemId)))
      .limit(1);

    if (lineItem && lineItem.workflowState !== "completed" && lineItem.workflowState !== "canceled") {
      const completingStationKey = String(job.stationKey ?? "").trim().toLowerCase();
      const isFulfillmentStation = completingStationKey === FULFILLMENT_STATION_KEY;
      const isPrepressStation = isPrepressOwnershipJob(job);
      const isDesignStation = isDesignOwnershipJob(job);

      if (isFulfillmentStation) {
        await tx
          .update(orderLineItems)
          .set({ workflowState: "completed", status: "complete", updatedAt: now })
          .where(eq(orderLineItems.id, job.lineItemId));

        await appendEvent({
          tx,
          organizationId: args.organizationId,
          productionJobId: args.jobId,
          type: "note",
          payload: {
            eventType: "workflow_transition",
            fromState: lineItem.workflowState,
            toState: "completed",
            lifecycleStatus: "complete",
            ownerAction: "completed",
            actorUserId: args.userId,
            metadata: {
              source: "fulfillment_job_complete",
              skipProduction: effectiveSkipProduction,
              previousLifecycleStatus: lineItem.status,
            },
          },
        });
      } else if (isPrepressStation || isDesignStation) {
        console.warn(
          `[ProductionJobComplete] Station "${completingStationKey}" job ${args.jobId} completed via job-complete endpoint. ` +
          `Line item workflow state unchanged (was: ${lineItem.workflowState}). ` +
          `Use /prepress/.../send-to-print or design-complete routes for workflow advancement.`,
        );
      } else if (completionRoute.kind === "route") {
        const target = completionRoute.route;
        console.log(
          `[ProductionJobComplete] Station "${completingStationKey}" job ${args.jobId} complete - routing line item ${job.lineItemId} to ${target.stationKey}.`,
        );
        try {
          await routeLineItemToProduction({
            tx,
            organizationId: args.organizationId,
            orderId: job.orderId,
            lineItemId: job.lineItemId,
            stationKey: target.stationKey,
            stepKey: target.stepKey,
            trigger: "line_item_status",
            actorUserId: args.userId,
            extraEventPayload: {
              routingReason: "production_station_complete",
              completionRouteSource: target.source,
              previousStationKey: completingStationKey,
              previousJobId: args.jobId,
            },
          });

          const completionLineItemState = resolveProductionCompletionLineItemState(target.stationKey);
          if (completionLineItemState) {
            // A line that has completed its production route is fulfillment-ready.
            // Persist that terminal line state immediately so billing and order
            // summaries cannot remain stale while the fulfillment job is queued.
            await tx
              .update(orderLineItems)
              .set({ ...completionLineItemState, updatedAt: now })
              .where(eq(orderLineItems.id, job.lineItemId));

            await appendEvent({
              tx,
              organizationId: args.organizationId,
              productionJobId: args.jobId,
              type: "note",
              payload: {
                eventType: "workflow_transition",
                fromState: lineItem.workflowState,
                toState: "completed",
                lifecycleStatus: "complete",
                ownerAction: "routed_to_fulfillment",
                actorUserId: args.userId,
                metadata: {
                  source: "production_completion_routed_to_fulfillment",
                  previousLifecycleStatus: lineItem.status,
                  targetStationKey: FULFILLMENT_STATION_KEY,
                },
              },
            });

            await markOrderReadyForFulfillmentIfProductionComplete(tx, {
              organizationId: args.organizationId,
              orderId: job.orderId,
              actorUserId: args.userId,
              productionJobId: args.jobId,
            });
          }
        } catch (routeErr: any) {
          throw Object.assign(
            new Error(
              `[ProductionJobComplete] Cannot route line item ${job.lineItemId} to ${target.stationKey} after completing station "${completingStationKey}". ` +
              (routeErr?.message ?? String(routeErr)) +
              ` - ensure a station with key="${target.stationKey}" exists in Production Settings for this organization.`,
            ),
            { statusCode: routeErr?.statusCode ?? 409, cause: routeErr },
          );
        }
      }
    }
  }

  await tx.insert(auditLogs).values({
    organizationId: args.organizationId,
    userId: args.userId,
    userName: args.auditUserName || null,
    actionType: "UPDATE",
    entityType: "production_job",
    entityId: args.jobId,
    entityName: args.jobId,
    description: manualOverride
      ? "Production job completed by Order-level override"
      : effectiveSkipProduction ? "Production job completed (skip production)" : "Production job completed",
    oldValues: { status: job.status, stationKey: job.stationKey },
    newValues: {
      status: "done",
      completedAt: now.toISOString(),
      restoreUntil: restoreUntil.toISOString(),
      manualOverride,
      materialsConsumed: !manualOverride,
    },
    ipAddress: args.ipAddress || null,
    userAgent: args.userAgent || null,
  } as any);

  await appendEvent({
    tx,
    organizationId: args.organizationId,
    productionJobId: args.jobId,
    type: "note",
    actorUserId: args.userId,
    payload: {
      eventType: "production_job_completed",
      previousStatus: job.status,
      previousStation: job.stationKey,
      completedAt: now.toISOString(),
      restoreUntil: restoreUntil.toISOString(),
      skipProduction: effectiveSkipProduction,
      manualOverride,
      materialsConsumed: !manualOverride,
    },
  });

  const updatedRows = await tx
    .select()
    .from(productionJobs)
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)))
    .limit(1);
  return {
    ...updatedRows[0],
    nextStationKey: completionRoute.kind === "route" ? completionRoute.route.stationKey : null,
    nextStepKey: completionRoute.kind === "route" ? completionRoute.route.stepKey : null,
  };
}

/**
 * Shared status transition used by the single-job and bulk endpoints. Keeping
 * this in one workflow is important because a bulk action must produce the
 * same events and audit trail as an individual change.
 */
async function updateProductionJobStatusWorkflow(
  tx: any,
  args: {
    organizationId: string;
    userId?: string | null;
    jobId: string;
    status: string;
    stepKey?: string | null;
    auditUserName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  const now = new Date();
  const jobRows = await tx
    .select()
    .from(productionJobs)
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
  if (isTerminalProductionStatus(job.status) && args.status !== job.status) {
    throw Object.assign(new Error("Cannot advance a terminal production job."), { statusCode: 409 });
  }

  const stepKeyUnchanged = args.stepKey === undefined || job.stepKey === args.stepKey;
  if (job.status === args.status && stepKeyUnchanged) return job;

  if (args.status !== "canceled") {
    await assertParentOrderInProductionForJob(tx, {
      organizationId: args.organizationId,
      job,
      action: "update production job status",
    });
  }

  const updateData: any = { status: args.status, updatedAt: now };
  if (args.stepKey !== undefined) updateData.stepKey = args.stepKey;
  if (args.status === "in_progress" && !job.startedAt) updateData.startedAt = now;

  await tx
    .update(productionJobs)
    .set(updateData)
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)));

  await appendEvent({
    tx,
    organizationId: args.organizationId,
    productionJobId: args.jobId,
    type: "status_changed",
    payload: {
      previousStatus: job.status,
      newStatus: args.status,
      previousStepKey: job.stepKey,
      newStepKey: args.stepKey === undefined ? job.stepKey : args.stepKey,
      actorUserId: args.userId ?? null,
    },
  });

  await tx.insert(auditLogs).values({
    organizationId: args.organizationId,
    userId: args.userId ?? null,
    userName: args.auditUserName || null,
    actionType: "UPDATE",
    entityType: "production_job",
    entityId: args.jobId,
    entityName: args.jobId,
    description: `Production job status changed to ${args.status}`,
    oldValues: { status: job.status },
    newValues: { status: args.status },
    ipAddress: args.ipAddress || null,
    userAgent: args.userAgent || null,
  } as any);

  const updatedRows = await tx
    .select()
    .from(productionJobs)
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.id, args.jobId)))
    .limit(1);
  return updatedRows[0];
}

/**
 * Map the order's stored shipping method onto a human ticket label.
 * Returns null when no method is set (the ticket then shows blank/unknown).
 */
function mapFulfillmentLabel(shippingMethod: string | null | undefined): string | null {
  switch (String(shippingMethod || "").trim().toLowerCase()) {
    case "pickup":
      return "Pickup";
    case "deliver":
    case "delivery":
      return "Delivery";
    case "ship":
    case "shipping":
      return "Shipping";
    default:
      return null;
  }
}

function resolvePrinterOptionsForStation(config: any, stationKey: unknown): string[] {
  const key = normalizeProductionStationKey(String(stationKey ?? "")) ?? String(stationKey ?? "").trim().toLowerCase();
  const configured = config?.printerOptionsByStation?.[key];
  if (Array.isArray(configured)) {
    return configured.map((value) => String(value || "").trim()).filter(Boolean);
  }
  return DEFAULT_PRINTER_OPTIONS_BY_STATION[key] ?? [];
}

function resolveLaminationFromOptionRows(rows: ProductionDisplayOptionRow[]): { label: string; source: "option" | "none" } {
  const row = rows.find((candidate) => /laminat|lamination|finish|coating/i.test(candidate.optionLabel));
  if (!row) return { label: "None", source: "none" };
  const selected = String(row.selectedLabel || "").trim();
  if (!selected || /^none$/i.test(selected) || /^no$/i.test(selected)) return { label: "None", source: "none" };
  return { label: selected, source: "option" };
}

function buildLineItemProductionDisplay(lineItem: any) {
  const optionRows = buildPrepressOptionRows(lineItem);
  return {
    optionRows,
    finishingRequirements: extractFinishingBullets(lineItem),
    lamination: resolveLaminationFromOptionRows(optionRows),
  };
}

function normalizeProductionAlertStations(value: unknown): string[] {
  if (!Array.isArray(value)) return ["all"];
  const stations = value.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
  return stations.length ? Array.from(new Set(stations)) : ["all"];
}

function productionAlertVisibleForStation(alert: { visibleStations: unknown }, stationKey: unknown): boolean {
  const station = normalizeProductionStationKey(String(stationKey ?? "")) ?? String(stationKey ?? "").trim().toLowerCase();
  const visibleStations = normalizeProductionAlertStations(alert.visibleStations);
  return visibleStations.includes("all") || (station ? visibleStations.includes(station) : true);
}

function serializeProductionAlert(row: typeof productionAlerts.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    orderLineItemId: row.orderLineItemId ?? null,
    productionJobId: row.productionJobId ?? null,
    title: row.title,
    message: row.message ?? null,
    alertType: row.alertType,
    severity: row.severity,
    visibleStations: normalizeProductionAlertStations(row.visibleStations),
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

const productionQueueSortBySchema = z.enum(["newest", "oldest", "due_date", "customer", "priority", "status"]);
const productionQueueSortDirectionSchema = z.enum(["asc", "desc"]);

type ProductionQueueSortBy = z.infer<typeof productionQueueSortBySchema>;
type ProductionQueueSortDirection = z.infer<typeof productionQueueSortDirectionSchema>;

function normalizeProductionJobStatusFilter(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") return undefined;
  if (normalized === "completed" || normalized === "complete") return "done";
  if (normalized === "cancelled") return "canceled";
  return normalized;
}

function compareNullableDates(left: unknown, right: unknown, direction: ProductionQueueSortDirection): number {
  const missingValue = direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const leftTime = left ? new Date(left as any).getTime() : missingValue;
  const rightTime = right ? new Date(right as any).getTime() : missingValue;
  const safeLeft = Number.isFinite(leftTime) ? leftTime : missingValue;
  const safeRight = Number.isFinite(rightTime) ? rightTime : missingValue;
  return direction === "asc" ? safeLeft - safeRight : safeRight - safeLeft;
}

function compareStrings(left: unknown, right: unknown, direction: ProductionQueueSortDirection): number {
  const comparison = String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base", numeric: true });
  return direction === "asc" ? comparison : -comparison;
}

function priorityRank(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "rush" || normalized === "urgent") return 0;
  if (normalized === "high") return 1;
  if (normalized === "normal" || normalized === "standard") return 2;
  if (normalized === "low") return 3;
  return 4;
}

function statusRank(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "in_progress") return 0;
  if (normalized === "paused") return 1;
  if (normalized === "queued") return 2;
  if (normalized === "done" || normalized === "completed") return 3;
  return 4;
}

function sortProductionQueueJobs<T extends {
  id?: string | null;
  status?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  order?: {
    customerName?: string | null;
    dueDate?: unknown;
    priority?: string | null;
    orderNumber?: string | null;
  };
}>(
  jobs: T[],
  sortBy: ProductionQueueSortBy,
  sortDirection: ProductionQueueSortDirection,
): T[] {
  const sorted = [...jobs].sort((left, right) => {
    let comparison = 0;
    switch (sortBy) {
      case "newest":
        comparison = compareNullableDates(left.createdAt, right.createdAt, "desc");
        break;
      case "oldest":
        comparison = compareNullableDates(left.createdAt, right.createdAt, "asc");
        break;
      case "due_date":
        comparison = compareNullableDates(left.order?.dueDate, right.order?.dueDate, sortDirection);
        break;
      case "customer":
        comparison = compareStrings(left.order?.customerName, right.order?.customerName, sortDirection);
        break;
      case "priority": {
        const leftRank = priorityRank(left.order?.priority);
        const rightRank = priorityRank(right.order?.priority);
        comparison = sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
        break;
      }
      case "status": {
        const leftRank = statusRank(left.status);
        const rightRank = statusRank(right.status);
        comparison = sortDirection === "asc" ? leftRank - rightRank : rightRank - leftRank;
        break;
      }
    }

    if (comparison !== 0) return comparison;

    const orderComparison = compareStrings(left.order?.orderNumber, right.order?.orderNumber, "asc");
    if (orderComparison !== 0) return orderComparison;

    return compareStrings(left.id, right.id, "asc");
  });

  return sorted;
}

export function registerProductionJobsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser } = middleware;

  // 1) GET /api/production/jobs?status=&station=&orderId=
  app.get("/api/production/jobs", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const statusRaw = req.query.status as string | undefined;
      const viewRaw = req.query.view as string | undefined;
      const stationRaw = req.query.station as string | undefined;
      const stationCandidate = stationRaw ?? viewRaw;
      const searchRaw = req.query.search as string | undefined;
      const sortByRaw = req.query.sortBy as string | undefined;
      const sortDirectionRaw = req.query.sortDirection as string | undefined;
      const orderIdRaw = req.query.orderId as string | undefined;
      const normalizedStatusFilter = normalizeProductionJobStatusFilter(statusRaw);
      const statusParsed = normalizedStatusFilter ? productionStatusSchema.safeParse(normalizedStatusFilter) : null;
      const viewParsed = viewRaw ? productionViewKeySchema.safeParse(viewRaw) : null;
      const stationParsed = stationCandidate ? productionViewKeySchema.safeParse(stationCandidate) : null;
      const sortByParsed = sortByRaw ? productionQueueSortBySchema.safeParse(sortByRaw) : null;
      const sortDirectionParsed = sortDirectionRaw ? productionQueueSortDirectionSchema.safeParse(sortDirectionRaw) : null;
      if (statusParsed && !statusParsed.success) {
        return res.status(400).json({ error: "Invalid status" });
      }
      if (sortByParsed && !sortByParsed.success) {
        return res.status(400).json({ error: "Invalid sortBy" });
      }
      if (sortDirectionParsed && !sortDirectionParsed.success) {
        return res.status(400).json({ error: "Invalid sortDirection" });
      }
      if (viewParsed && !viewParsed.success) {
        return res.status(400).json({ error: "Invalid view" });
      }
      // BUGFIX: Make station optional to support Overview page showing ALL jobs across all stations
      if (stationCandidate && !stationParsed?.success) {
        return res.status(400).json({ error: "Invalid station" });
      }
      const status = statusParsed?.success ? statusParsed.data : undefined;
      const view = viewParsed?.success ? viewParsed.data : undefined;
      const station = normalizeProductionStationKey(stationParsed?.data) ?? stationParsed?.data; // May be undefined for "all stations" query
      const resolvedStationId = station
        ? await stationResolver.resolveStationId({ organizationId, stationKey: station })
        : null;
      const stationAliases = station === "roll"
        ? ["roll", "wide_roll"]
        : station === "flatbed"
          ? ["flatbed"]
          : station ? [station] : [];
      const search = typeof searchRaw === "string" ? searchRaw.trim() : "";
      const sortBy = sortByParsed?.success ? sortByParsed.data : "due_date";
      const sortDirection = sortDirectionParsed?.success ? sortDirectionParsed.data : "asc";
      const direction = sortDirection === "desc" ? desc : asc;
      const dbOrderBy = (() => {
        switch (sortBy) {
          case "newest":
            return [desc(productionJobs.createdAt), asc(productionJobs.id)];
          case "oldest":
            return [asc(productionJobs.createdAt), asc(productionJobs.id)];
          case "due_date":
            return [direction(orders.dueDate), asc(orders.orderNumber), asc(productionJobs.id)];
          case "customer":
            return [direction(customers.companyName), asc(orders.orderNumber), asc(productionJobs.id)];
          case "priority":
            return [direction(orders.priority), asc(orders.orderNumber), asc(productionJobs.id)];
          case "status":
            return [direction(productionJobs.status), asc(orders.orderNumber), asc(productionJobs.id)];
        }
      })();

      const config = await getProductionConfigForOrganization(organizationId);
      if (process.env.NODE_ENV !== "production") {
        console.log("[DEV][GET /api/production/jobs] params:", { organizationId, status, view, station, sortBy, sortDirection, enabledViews: config.enabledViews });
      }
      if (station && !config.enabledViews.includes(station)) {
        // Station not in this org's enabledViews — return empty rather than 403.
        if (process.env.NODE_ENV !== "production") {
          console.log("[DEV][GET /api/production/jobs] station '" + station + "' not in enabledViews " + JSON.stringify(config.enabledViews) + " — returning []");
        }
        return res.json({ success: true, data: [] });
      }

      // FIX: lineItemId filter was too strict - production_jobs can exist without line items during initial intake
      // Station scoping is OPTIONAL - when omitted, returns ALL jobs across all stations (for Overview)
      // orderId filtering for sibling production jobs on same order
      const whereClause = and(
        eq(productionJobs.organizationId, organizationId),
        station
          ? (resolvedStationId
              ? or(sql`production_jobs.station_id = ${resolvedStationId}`, inArray(productionJobs.stationKey as any, stationAliases))
              : inArray(productionJobs.stationKey as any, stationAliases))
          : undefined,
        status ? eq(productionJobs.status, status) : undefined,
        orderIdRaw ? eq(productionJobs.orderId, orderIdRaw) : undefined,
      );

      const prepressGateApplies = station && (station === 'flatbed' || station === 'roll');
      const activeBoardQuery = !status || !["done", "void", "canceled", "cancelled"].includes(String(status).toLowerCase());

      const baseRows = await db
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          assignedPrinterId: productionJobs.assignedPrinterId,
          assignedPrinterName: productionJobs.assignedPrinterName,
          assignedPrinterByUserId: productionJobs.assignedPrinterByUserId,
          assignedPrinterAt: productionJobs.assignedPrinterAt,
          startedAt: productionJobs.startedAt,
          completedAt: productionJobs.completedAt,
          completedByUserId: productionJobs.completedByUserId,
          previousStatus: productionJobs.previousStatus,
          previousStation: productionJobs.previousStation,
          restoreUntil: productionJobs.restoreUntil,
          restoredAt: productionJobs.restoredAt,
          restoredByUserId: productionJobs.restoredByUserId,
          restoreReason: productionJobs.restoreReason,
          totalSeconds: productionJobs.totalSeconds,
          createdAt: productionJobs.createdAt,
          updatedAt: productionJobs.updatedAt,
          orderNumber: orders.orderNumber,
          displayNumber: orders.displayNumber,
          numberCore: orders.numberCore,
          poNumber: orders.poNumber,
          notesInternal: orders.notesInternal,
          dueDate: orders.dueDate,
          priority: orders.priority,
          fulfillmentStatus: orders.fulfillmentStatus,
          routingTarget: orders.routingTarget,
          customerId: customers.id,
          customerName: customers.companyName,
          // Prepress gate fields (null when no line item linked)
          lineItemRequiresPrepress: orderLineItems.requiresPrepress,
          lineItemStatus: orderLineItems.status,
          lineItemProductionNotes: orderLineItems.productionNotes,
        })
        .from(productionJobs)
        .innerJoin(orders, eq(productionJobs.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(orderLineItems, eq(productionJobs.lineItemId, orderLineItems.id))
        .where(whereClause)
        .orderBy(...dbOrderBy);

      const lineItemIdsForOwnership = Array.from(
        new Set(
          baseRows
            .map((row) => row.lineItemId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );

      const activeOwnerByLineItem = lineItemIdsForOwnership.length > 0
        ? await resolveActiveProductionOwners(db, {
            organizationId,
            lineItemIds: lineItemIdsForOwnership,
            debugLabel: "GET /api/production/jobs",
          })
        : new Map<string, any>();

      let filteredRows = baseRows.filter((row) => {
        if (!row.lineItemId) {
          return activeBoardQuery ? !["done", "void", "canceled", "cancelled"].includes(String(row.status || "").toLowerCase()) : true;
        }

        if (!activeBoardQuery) {
          return true;
        }

        const activeOwner = activeOwnerByLineItem.get(row.lineItemId);
        if (!activeOwner) {
          return false;
        }

        if (activeOwner.id !== row.id) {
          return false;
        }

        if (prepressGateApplies && isPrepressOwnershipJob(activeOwner)) {
          return false;
        }

        return true;
      });

      if (activeBoardQuery && filteredRows.length > 0) {
        const candidateJobIds = filteredRows.map((row) => row.id);
        const groupedMemberRows = await db
          .select({ productionJobId: productionRunMembers.productionJobId })
          .from(productionRunMembers)
          .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
          .where(and(
            eq(productionRunMembers.organizationId, organizationId),
            inArray(productionRunMembers.productionJobId, candidateJobIds),
            inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]),
            sql`coalesce(${productionRunMembers.remainingQuantity}, 0) > 0`,
          ));
        const groupedJobIds = new Set(groupedMemberRows.map((row) => row.productionJobId));
        if (groupedJobIds.size > 0) {
          filteredRows = filteredRows.filter((row) => !groupedJobIds.has(row.id));
        }
      }

      // DEV-only logging: show how many items were gated
      if (process.env.NODE_ENV !== "production") {
        const gatedCount = baseRows.length - filteredRows.length;
        if (gatedCount > 0) {
          console.log(`[DEV][GET /api/production/jobs] owner filter excluded ${gatedCount} of ${baseRows.length} rows`, {
            station: station ?? null,
            prepressGateApplies,
            activeBoardQuery,
          });
        }
      }

      if (filteredRows.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const jobIds = filteredRows.map((r) => r.id);

      const timerEventRows = await db
        .select({
          productionJobId: productionEvents.productionJobId,
          type: productionEvents.type,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
          ),
        )
        .orderBy(desc(productionEvents.createdAt));

      const latestTimerEventByJobId = new Map<string, { type: string; createdAt: any }>();
      for (const row of timerEventRows) {
        if (!latestTimerEventByJobId.has(row.productionJobId)) {
          latestTimerEventByJobId.set(row.productionJobId, { type: row.type, createdAt: row.createdAt });
        }
      }

      const reprintCountsRows = await db
        .select({
          productionJobId: productionEvents.productionJobId,
          count: sql<number>`count(*)::int`,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            eq(productionEvents.type, "reprint_incremented"),
          ),
        )
        .groupBy(productionEvents.productionJobId);

      const reprintCountByJobId = new Map<string, number>();
      for (const r of reprintCountsRows) {
        reprintCountByJobId.set(r.productionJobId, Number(r.count) || 0);
      }

      const noteRows = await db
        .select({
          id: productionEvents.id,
          productionJobId: productionEvents.productionJobId,
          actorUserId: productionEvents.actorUserId,
          payload: productionEvents.payload,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            eq(productionEvents.type, "note"),
          ),
        )
        .orderBy(desc(productionEvents.createdAt))
        .limit(500);

      const notesByJobId = new Map<string, Array<{ id: string; text: string; createdAt: string; actorUserId: string | null }>>();
      for (const row of noteRows) {
        const list = notesByJobId.get(row.productionJobId) ?? [];
        if (list.length >= 5) continue;
        const text = typeof (row.payload as any)?.text === "string" ? (row.payload as any).text : "";
        if (!text.trim()) continue;
        const actorUserId =
          typeof row.actorUserId === "string" && row.actorUserId
            ? row.actorUserId
            : typeof (row.payload as any)?.actorUserId === "string"
              ? (row.payload as any).actorUserId
              : null;
        list.push({ id: row.id, text, actorUserId, createdAt: new Date(row.createdAt as any).toISOString() });
        notesByJobId.set(row.productionJobId, list);
      }

      const routingEventRows = await db
        .select({
          productionJobId: productionEvents.productionJobId,
          type: productionEvents.type,
          payload: productionEvents.payload,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            inArray(productionEvents.type, ["intake", "routing_override"]),
          ),
        )
        .orderBy(desc(productionEvents.createdAt));

      const latestRoutingEventByJobId = new Map<string, { payload: any; type: string }>();
      for (const row of routingEventRows) {
        if (!latestRoutingEventByJobId.has(row.productionJobId)) {
          latestRoutingEventByJobId.set(row.productionJobId, {
            payload: row.payload ?? {},
            type: row.type,
          });
        }
      }

      // Batched order enrichment for cockpit UI (no schema changes, no N+1)
      const orderIds = Array.from(new Set(filteredRows.map((r) => r.orderId)));

      // Collect BOTH order IDs (for context) AND explicit line item IDs from production_jobs
      // This ensures we fetch the specific line item each job references, even if it's
      // not the first/default line item for the order
      const productionLineItemIds = Array.from(
        new Set(
          filteredRows
            .map((r) => r.lineItemId)
            .filter((v): v is string => typeof v === "string" && !!v.trim()),
        ),
      );

      const activeFinalFileRows = productionLineItemIds.length > 0
        ? await db
            .select({
              id: lineItemFiles.id,
              lineItemId: lineItemFiles.lineItemId,
              fileRecordId: lineItemFiles.fileRecordId,
              productionQuantity: lineItemFiles.productionQuantity,
              productionGroupId: lineItemFiles.productionGroupId,
            })
            .from(lineItemFiles)
            .where(and(
              eq(lineItemFiles.organizationId, organizationId),
              inArray(lineItemFiles.lineItemId, productionLineItemIds),
              eq(lineItemFiles.role, "final"),
              eq(lineItemFiles.status, "active"),
            ))
            .orderBy(desc(lineItemFiles.createdAt))
        : [];
      const finalFileRecordIdsByLineItem = new Map<string, string[]>();
      const finalFileAllocationByLineItemAndRecordId = new Map<string, { productionQuantity: number | null; productionGroupId: string | null }>();
      for (const file of activeFinalFileRows) {
        if (!file.fileRecordId) continue;
        const current = finalFileRecordIdsByLineItem.get(file.lineItemId) ?? [];
        if (!current.includes(file.fileRecordId)) current.push(file.fileRecordId);
        finalFileRecordIdsByLineItem.set(file.lineItemId, current);
        finalFileAllocationByLineItemAndRecordId.set(`${file.lineItemId}:${file.fileRecordId}`, {
          productionQuantity: file.productionQuantity ?? null,
          productionGroupId: file.productionGroupId ?? null,
        });
      }

      // Query strategy: Fetch line items by order ID (for context) OR by explicit line item ID
      // This handles both normal cases (line items belong to order) and edge cases
      // (orphaned/reassigned line items that production_jobs still references)
      const lineItemRows = await db
        .select({
          orderId: orderLineItems.orderId,
          id: orderLineItems.id,
          description: orderLineItems.description,
          quantity: orderLineItems.quantity,
          width: orderLineItems.width,
          height: orderLineItems.height,
          productId: orderLineItems.productId,
          materialId: orderLineItems.materialId,
          productType: orderLineItems.productType,
          status: orderLineItems.status,
          sortOrder: orderLineItems.sortOrder,
          selectedOptions: orderLineItems.selectedOptions, // For deriving Sides (single/double)
          optionSelectionsJson: orderLineItems.optionSelectionsJson,
          pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
          specsJson: orderLineItems.specsJson,
          productionNotes: orderLineItems.productionNotes,
          createdAt: orderLineItems.createdAt,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            or(
              inArray(orderLineItems.orderId, orderIds),
              productionLineItemIds.length > 0 ? inArray(orderLineItems.id, productionLineItemIds) : undefined,
            ),
          ),
        )
        .orderBy(asc(orderLineItems.orderId), asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

      const materialIds = Array.from(
        new Set(
          lineItemRows
            .map((li) => li.materialId)
            .filter((v): v is string => typeof v === "string" && !!v.trim()),
        ),
      );

      const materialRows = materialIds.length
        ? await db
            .select({ id: materials.id, name: materials.name })
            .from(materials)
            .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)))
        : [];

      const materialNameById = new Map<string, string>();
      for (const m of materialRows) {
        materialNameById.set(m.id, m.name);
      }

      const productIds = Array.from(new Set(
        lineItemRows.map((li) => li.productId).filter((value): value is string => typeof value === "string" && !!value.trim()),
      ));
      const productById = new Map<string, { name: string; shopName: string | null; pricingProfileConfig: unknown; sheetWidth: unknown; sheetHeight: unknown; materialType: unknown }>();
      if (productIds.length > 0) {
        const productRows = await db
          .select({
            id: products.id,
            name: products.name,
            shopName: products.shopName,
            pricingProfileConfig: products.pricingProfileConfig,
            sheetWidth: products.sheetWidth,
            sheetHeight: products.sheetHeight,
            materialType: products.materialType,
          })
          .from(products)
          .where(and(eq(products.organizationId, organizationId), inArray(products.id, productIds)));
        for (const product of productRows) productById.set(product.id, product);
      }

      const lineItemsByOrderId = new Map<
        string,
        Array<{
          id: string;
          lineNumber: number;
          description: string;
          quantity: number;
          width: any;
          height: any;
          productId: string | null;
          productFormalName: string | null;
          productShopName: string | null;
          pricingProfileConfig: unknown;
          sheetWidth: unknown;
          sheetHeight: unknown;
          materialType: unknown;
          materialId: string | null;
          materialName: string | null;
          productType: string;
          status: string;
          sortOrder: number;
          selectedOptions: any; // ADDED: For Sides derivation
          optionSelectionsJson: any;
          pbv2SnapshotJson: any;
          specsJson: any;
          productionNotes: string | null;
          createdAt: any;
        }>
      >();

      const lineItemById = new Map<
        string,
        {
          id: string;
          lineNumber: number;
          description: string;
          quantity: number;
          width: any;
          height: any;
          productId: string | null;
          productFormalName: string | null;
          productShopName: string | null;
          pricingProfileConfig: unknown;
          sheetWidth: unknown;
          sheetHeight: unknown;
          materialType: unknown;
          materialId: string | null;
          materialName: string | null;
          productType: string;
          status: string;
          sortOrder: number;
          selectedOptions: any; // ADDED: For Sides derivation
          optionSelectionsJson: any;
          pbv2SnapshotJson: any;
          specsJson: any;
          productionNotes: string | null;
          createdAt: any;
        }
      >();
      for (const li of lineItemRows) {
        const list = lineItemsByOrderId.get(li.orderId) ?? [];
        const mapped = {
          id: li.id,
          lineNumber: list.length + 1,
          description: li.description,
          quantity: Number(li.quantity) || 0,
          width: li.width,
          height: li.height,
          productId: li.productId ?? null,
          productFormalName: li.productId ? productById.get(li.productId)?.name ?? null : null,
          productShopName: li.productId ? productById.get(li.productId)?.shopName ?? null : null,
          pricingProfileConfig: li.productId ? productById.get(li.productId)?.pricingProfileConfig ?? null : null,
          sheetWidth: li.productId ? productById.get(li.productId)?.sheetWidth ?? null : null,
          sheetHeight: li.productId ? productById.get(li.productId)?.sheetHeight ?? null : null,
          materialType: li.productId ? productById.get(li.productId)?.materialType ?? null : null,
          materialId: li.materialId ?? null,
          materialName: li.materialId ? materialNameById.get(li.materialId) ?? null : null,
          productType: li.productType,
          status: li.status,
          sortOrder: Number(li.sortOrder) || 0,
          selectedOptions: li.selectedOptions ?? [], // ADDED: Pass through selected_options
          optionSelectionsJson: li.optionSelectionsJson ?? null,
          pbv2SnapshotJson: li.pbv2SnapshotJson ?? null,
          specsJson: li.specsJson ?? null,
          productionNotes: li.productionNotes ?? null,
          createdAt: li.createdAt,
        };
        list.push(mapped);
        lineItemsByOrderId.set(li.orderId, list);
        lineItemById.set(li.id, mapped);
      }

      // Batch once for the production board so every card shares canonical-first
      // precedence and legacy fallback without an N+1 query pattern.
      const resolvedArtworkByLineItem = await lineItemArtworkReadResolver.resolveForLineItems({
        organizationId,
        lineItemIds: productionLineItemIds,
        purpose: "production",
      });

      const alertScopeClauses: any[] = [
        inArray(productionAlerts.orderId, orderIds),
        inArray(productionAlerts.productionJobId, jobIds),
      ];
      if (productionLineItemIds.length > 0) {
        alertScopeClauses.push(inArray(productionAlerts.orderLineItemId, productionLineItemIds));
      }
      const productionAlertRows = await db
        .select()
        .from(productionAlerts)
        .where(
          and(
            eq(productionAlerts.organizationId, organizationId),
            inArray(productionAlerts.status, ["active", "acknowledged"]),
            or(...alertScopeClauses),
          ),
        )
        .orderBy(desc(productionAlerts.createdAt));

      const alertsByProductionJobId = new Map<string, ReturnType<typeof serializeProductionAlert>[]>();
      for (const row of filteredRows) {
        const alerts = productionAlertRows
          .filter((alert) => {
            const directJobMatch = alert.productionJobId && alert.productionJobId === row.id;
            const lineItemMatch = row.lineItemId && alert.orderLineItemId && alert.orderLineItemId === row.lineItemId;
            const orderMatch = !alert.orderLineItemId && !alert.productionJobId && alert.orderId === row.orderId;
            return (directJobMatch || lineItemMatch || orderMatch) && productionAlertVisibleForStation(alert, row.stationKey);
          })
          .map((alert) => serializeProductionAlert(alert));
        alertsByProductionJobId.set(row.id, alerts);
      }

      const attachmentRows = await db
        .select({
          id: orderAttachments.id,
          orderId: orderAttachments.orderId,
          orderLineItemId: orderAttachments.orderLineItemId,
          fileRecordId: orderAttachments.fileRecordId,
          fileName: orderAttachments.fileName,
          mimeType: orderAttachments.mimeType,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
          role: orderAttachments.role,
          side: orderAttachments.side,
          isPrimary: orderAttachments.isPrimary,
          thumbStatus: orderAttachments.thumbStatus,
          createdAt: orderAttachments.createdAt,
        })
        .from(orderAttachments)
        .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            inArray(orderAttachments.orderId, orderIds),
            eq(orderAttachments.role, "artwork"),
          ),
        )
        .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.side), desc(orderAttachments.createdAt));

      // ALSO fetch artwork from new assets + assetLinks system (newer uploads may use this)
      // Join: assetLinks -> assets to get files linked to orders or line items
      const assetLinkRows = await db
        .select({
          id: assets.id,
          parentType: assetLinks.parentType,
          parentId: assetLinks.parentId,
          role: assetLinks.role,
          fileName: assets.fileName,
          fileRecordId: assets.fileRecordId,
          mimeType: assets.mimeType,
          thumbKey: assets.thumbKey,
          previewKey: assets.previewKey,
          previewStatus: assets.previewStatus,
          createdAt: assetLinks.createdAt,
        })
        .from(assetLinks)
        .innerJoin(assets, eq(assetLinks.assetId, assets.id))
        .where(
          and(
            eq(assetLinks.organizationId, organizationId),
            or(
              // Assets linked to orders
              and(
                eq(assetLinks.parentType, "order"),
                inArray(assetLinks.parentId, orderIds),
              ),
              // Assets linked to line items (if we have production line item IDs)
              productionLineItemIds.length > 0
                ? and(
                    eq(assetLinks.parentType, "order_line_item"),
                    inArray(assetLinks.parentId, productionLineItemIds),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(desc(assetLinks.createdAt));

      const artworkByOrderId = new Map<
        string,
        Array<{
          id: string;
          orderLineItemId: string | null;
          fileRecordId: string | null;
          fileName: string;
          mimeType: string | null;
          fileUrl: string | null;
          availabilityStatus?: 'available' | 'archived' | 'restoring' | 'missing';
          thumbKey: string | null;
          previewKey: string | null;
          thumbUrl: string | null;
          previewUrl: string | null;
          thumbnailUrl: string | null;
          side: string;
          isPrimary: boolean;
          productionQuantity: number | null;
          productionGroupId: string | null;
          thumbStatus: string | null;
        }>
      >();

      const artworkByLineItemId = new Map<
        string,
        Array<{
          id: string;
          orderLineItemId: string | null;
          fileRecordId: string | null;
          fileName: string;
          mimeType: string | null;
          fileUrl: string | null;
          availabilityStatus?: 'available' | 'archived' | 'restoring' | 'missing';
          thumbKey: string | null;
          previewKey: string | null;
          thumbUrl: string | null;
          previewUrl: string | null;
          thumbnailUrl: string | null;
          side: string;
          isPrimary: boolean;
          productionQuantity: number | null;
          productionGroupId: string | null;
          thumbStatus: string | null;
        }>
      >();

      const attachmentLogOnce = createRequestLogOnce();
      const enrichedAttachmentRows = await Promise.all(
        attachmentRows.map((row) => enrichAttachmentWithUrls(row, { logOnce: attachmentLogOnce })),
      );

      for (const a of enrichedAttachmentRows) {
        const finalAllocation = a.orderLineItemId && a.fileRecordId
          ? finalFileAllocationByLineItemAndRecordId.get(`${a.orderLineItemId}:${a.fileRecordId}`)
          : null;
        const mapped = {
          id: a.id,
          orderLineItemId: a.orderLineItemId ?? null,
          fileRecordId: a.fileRecordId ?? null,
          fileName: a.fileName,
          mimeType: a.mimeType ?? null,
          fileUrl: a.originalUrl ?? null,
          availabilityStatus: a.availabilityStatus,
          thumbKey: a.thumbKey ?? null,
          previewKey: a.previewKey ?? null,
          thumbUrl: a.thumbUrl ?? null,
          previewUrl: a.previewUrl ?? null,
          thumbnailUrl: a.thumbnailUrl ?? null,
          side: a.side ?? "unassigned",
          isPrimary: !!a.isPrimary,
          productionQuantity: finalAllocation?.productionQuantity ?? null,
          productionGroupId: finalAllocation?.productionGroupId ?? null,
          thumbStatus: a.thumbStatus ?? null,
        };

        // By order (fallback)
        const orderList = artworkByOrderId.get(a.orderId) ?? [];
        if (orderList.length < 6) {
          orderList.push(mapped);
          artworkByOrderId.set(a.orderId, orderList);
        }

        // By line item (preferred)
        if (a.orderLineItemId) {
          const liList = artworkByLineItemId.get(a.orderLineItemId) ?? [];
          if (liList.length < 6) {
            liList.push(mapped);
            artworkByLineItemId.set(a.orderLineItemId, liList);
          }
        }
      }

      // Process new assets/assetLinks data and merge into artwork maps
      const assetLogOnce = createRequestLogOnce();
      const { enrichAssetPreviewUrls } = await import('../services/assets/enrichAssetWithUrls');
      for (const link of assetLinkRows) {
        const [originalAccess, enrichedAsset] = await Promise.all([
          resolveOriginalFileAccess(link, { logOnce: assetLogOnce }),
          enrichAssetPreviewUrls(link as any),
        ]);
        const finalAllocation = link.parentType === "order_line_item" && link.fileRecordId
          ? finalFileAllocationByLineItemAndRecordId.get(`${link.parentId}:${link.fileRecordId}`)
          : null;
        const mapped = {
          id: link.id,
          orderLineItemId: link.parentType === "order_line_item" ? link.parentId : null,
          fileRecordId: link.fileRecordId ?? null,
          fileName: link.fileName,
          mimeType: (link as any).mimeType ?? null,
          fileUrl: originalAccess.originalUrl,
          availabilityStatus: originalAccess.availabilityStatus,
          thumbKey: link.thumbKey ?? null,
          previewKey: link.previewKey ?? null,
          thumbUrl: (enrichedAsset as any).thumbUrl ?? null,
          previewUrl: (enrichedAsset as any).previewUrl ?? null,
          thumbnailUrl:
            (enrichedAsset as any).previewThumbnailUrl ??
            (enrichedAsset as any).thumbnailUrl ??
            (enrichedAsset as any).thumbUrl ??
            null,
          side: "unassigned", // Side metadata is genuinely unavailable; UI must not assign it by position.
          isPrimary: false, // New assets system doesn't track isPrimary yet
          productionQuantity: finalAllocation?.productionQuantity ?? null,
          productionGroupId: finalAllocation?.productionGroupId ?? null,
          thumbStatus: link.previewStatus ?? null,
        };

        // Add to appropriate map based on parentType
        if (link.parentType === "order") {
          const orderList = artworkByOrderId.get(link.parentId) ?? [];
          if (orderList.length < 6) {
            orderList.push(mapped);
            artworkByOrderId.set(link.parentId, orderList);
          }
        } else if (link.parentType === "order_line_item") {
          const liList = artworkByLineItemId.get(link.parentId) ?? [];
          if (liList.length < 6) {
            liList.push(mapped);
            artworkByLineItemId.set(link.parentId, liList);
          }
        }
      }

      const normalizeObjectsUrl = (url: string | null | undefined): string | undefined => {
        if (!url) return undefined;
        if (url.startsWith("/objects/")) return url;
        if (url.startsWith("http")) {
          const match = url.match(/\/objects\/(.+?)(?:\?|$)/);
          if (match) return `/objects/${match[1]}`;
          return url;
        }
        return `/objects/${String(url).replace(/^\/+/, "")}`;
      };

      const getFileExt = (fileNameOrUrl: string | null | undefined): string => {
        const s = String(fileNameOrUrl || "").toLowerCase();
        const noQuery = s.split("?")[0];
        const idx = noQuery.lastIndexOf(".");
        return idx >= 0 ? noQuery.slice(idx + 1) : "";
      };

      const isImageExt = (ext: string): boolean =>
        ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "svg"].includes(ext);

      const computePreviewUrl = (art: any): string | undefined => {
        const preview = resolveProductionPreviewUrl(art);
        return preview ? normalizeObjectsUrl(preview) : undefined;
      };

      const now = Date.now();
      const data = filteredRows.map((row) => {
        const lastTimer = latestTimerEventByJobId.get(row.id);
        const isRunning = lastTimer?.type === "timer_started";
        const runningSince = isRunning ? new Date(lastTimer!.createdAt as any).toISOString() : null;
        const currentSeconds =
          Number(row.totalSeconds) +
          (isRunning ? toSeconds(now - new Date(lastTimer!.createdAt as any).getTime()) : 0);

        const orderLineItemsList = lineItemsByOrderId.get(row.orderId) ?? [];

        // CRITICAL: Use the SPECIFIC line item referenced by production_jobs.line_item_id
        // This ensures derived fields (qty/size/sides/media) match what the job is actually producing
        const primaryLineItem = row.lineItemId ? lineItemById.get(row.lineItemId) ?? null : orderLineItemsList[0] ?? null;


        // DEV: Log when production job references a line item that wasn't found
        if (process.env.NODE_ENV === "development" && row.lineItemId && !primaryLineItem) {
          console.warn(`[Production Job ${row.id}] Line item ${row.lineItemId} not found. Order ${row.orderId} has ${orderLineItemsList.length} line items.`);
        }

        // Ensure the primary line item appears first in the items array for UI consistency
        // If production job has a specific line_item_id, that line item should be primary
        const orderLineItemsTop = primaryLineItem
          ? [
              primaryLineItem,
              ...orderLineItemsList.filter((li) => li.id !== primaryLineItem.id).slice(0, 2),
            ]
          : orderLineItemsList.slice(0, 3);
        const totalQuantity = orderLineItemsList.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);

        const resolvedLineItemArtwork = row.lineItemId
          ? (resolvedArtworkByLineItem.get(row.lineItemId)?.artwork ?? []).map((artwork) => ({
              id: artwork.id,
              orderLineItemId: artwork.lineItemId,
              fileRecordId: artwork.fileRecordId,
              fileName: artwork.file.originalFilename ?? "Artwork",
              mimeType: artwork.file.mimeType,
              fileUrl: artwork.file.contentPath,
              thumbKey: null,
              previewKey: null,
              thumbUrl: artwork.fileRecordId ? `${artwork.file.contentPath}?variant=thumbnail` : null,
              previewUrl: artwork.fileRecordId ? `${artwork.file.contentPath}?variant=preview` : null,
              thumbnailUrl: artwork.fileRecordId ? `${artwork.file.contentPath}?variant=thumbnail` : null,
              side: artwork.side,
              isPrimary: true,
              productionQuantity: artwork.fileRecordId
                ? finalFileAllocationByLineItemAndRecordId.get(`${row.lineItemId}:${artwork.fileRecordId}`)?.productionQuantity ?? null
                : null,
              productionGroupId: artwork.fileRecordId
                ? finalFileAllocationByLineItemAndRecordId.get(`${row.lineItemId}:${artwork.fileRecordId}`)?.productionGroupId ?? null
                : null,
              thumbStatus: null,
            }))
          : [];
        const artwork = row.lineItemId
          ? resolveLineItemProductionArtwork({
              lineItemArtwork: resolvedLineItemArtwork,
              orderArtwork: [],
              productionFileRecordIds: finalFileRecordIdsByLineItem.get(row.lineItemId) ?? [],
            })
          : artworkByOrderId.get(row.orderId) ?? [];

        // DEV: Log when production job has no artwork
        if (process.env.NODE_ENV === "development" && artwork.length === 0) {
          console.warn(`[Production Job ${row.id}] No artwork found. LineItemId: ${row.lineItemId}, OrderId: ${row.orderId}`);
        }

        const sidesSet = new Set<string>();
        for (const a of artwork) {
          const s = (a.side || "").toLowerCase();
          if (s === "front" || s === "back") sidesSet.add(s);
        }
        const artworkBasedSides = sidesSet.size > 0 ? sidesSet.size : null;

        // DERIVE DISPLAY FIELDS (Backend responsibility - UI should not infer)
        // These fields are computed here to keep business logic centralized and consistent.

        // 1) Media: Material name from joined materials table, fallback to line item description
        let media = String(primaryLineItem?.materialName || "").trim();
        if (!media) {
          // Fallback: Use line item description if no material name
          media = String(primaryLineItem?.description || "").trim();
        }
        if (!media) {
          media = "—"; // Only show "—" if both materialName and description are empty
        }

        // 2) Size: Format width × height if both exist
        const width = primaryLineItem?.width;
        const height = primaryLineItem?.height;
        const size = (width && height) ? `${width} × ${height}` : "—";

        const qty = Number(primaryLineItem?.quantity ?? 0) || 0;
        const lineItemDueDate = resolveLineItemProductionDueDate(primaryLineItem?.specsJson);
        // The persisted PBV2 selection is authoritative; an artwork count cannot tell us print intent.
        const resolvedPrintSides = resolveProductionSides(primaryLineItem);
        const sheetConfiguration = resolveSheetConfiguration(primaryLineItem ?? {});
        const productionLayout = calculateSheetProductionLayout({
          stationKey: row.stationKey,
          materialType: sheetConfiguration.materialType,
          widthIn: width,
          heightIn: height,
          quantity: qty,
          sheetWidthIn: sheetConfiguration.sheetWidthIn,
          sheetHeightIn: sheetConfiguration.sheetHeightIn,
          allowRotation: sheetConfiguration.allowRotation,
          sides: resolvedPrintSides,
        });

        // Job description: Prefer line item description, fallback to "Job #{id}"
        const jobDescription = String(primaryLineItem?.description || "").trim() || `Job #${row.id.slice(-8)}`;
        const lineItemDisplay = buildLineItemProductionDisplay(primaryLineItem);
        if (primaryLineItem?.productShopName) {
          media = resolvePrepressJobSpecificationsDisplay({
            productName: primaryLineItem.productFormalName ?? primaryLineItem.description,
            productShopName: primaryLineItem.productShopName,
            optionRows: lineItemDisplay.optionRows,
          }).productLabel;
        }
        if (primaryLineItem) {
          (primaryLineItem as any).optionSelectionsJson = {
            ...((primaryLineItem as any).optionSelectionsJson ?? {}),
            lamination: lineItemDisplay.lamination.label,
          };
          (primaryLineItem as any).optionRows = lineItemDisplay.optionRows;
        }
        const printerOptions = resolvePrinterOptionsForStation(config, row.stationKey);

        // Explicit preview/file URLs for fast board/list thumbnail rendering
        const assignedArtworkSides = resolveProductionArtworkSides(artwork);
        const primaryArt = artwork.find((a) => !!a?.isPrimary);
        const isDoubleSided = resolvedPrintSides === "Double-sided";
        // For double-sided work, Front and Back can only come from explicit side
        // assignments. Attachment/upload order is never an assignment signal.
        const frontArt = assignedArtworkSides.front ?? (isDoubleSided ? null : primaryArt ?? artwork[0] ?? null);
        const backArt = assignedArtworkSides.back;
        const sameArtworkBothSides = assignedArtworkSides.isSameArtwork;
        const artworkThumbs = (artwork ?? []).slice(0, 6).map((a) => ({
          id: a.id,
          fileName: a.fileName,
          fileUrl: a.fileUrl,
          fileRecordId: a.fileRecordId,
          mimeType: a.mimeType,
          thumbnailUrl: a.thumbnailUrl,
          thumbKey: a.thumbKey,
          previewKey: a.previewKey,
          thumbUrl: a.thumbUrl,
          previewUrl: a.previewUrl,
          side: a.side,
          isPrimary: a.isPrimary,
          productionQuantity: a.productionQuantity ?? null,
          productionGroupId: a.productionGroupId ?? null,
          allocatedQuantity: a.productionQuantity ?? null,
          thumbStatus: a.thumbStatus,
          sameAsFront: sameArtworkBothSides && a.id === backArt?.id,
        }));

        const frontFileUrl = frontArt ? normalizeObjectsUrl(frontArt.fileUrl) : undefined;
        const backFileUrl = backArt ? normalizeObjectsUrl(backArt.fileUrl) : undefined;
        const frontPreviewUrl = frontArt ? computePreviewUrl(frontArt) : undefined;
        const backPreviewUrl = backArt ? computePreviewUrl(backArt) : undefined;

        const notes = notesByJobId.get(row.id) ?? [];
        const routingMeta = latestRoutingEventByJobId.get(row.id);
        const routingPayload = routingMeta?.payload ?? {};
        const routingReasonRaw = routingPayload?.routingReason;
        const routingSourceRaw = routingPayload?.source ?? routingPayload?.trigger ?? routingMeta?.type;
        const idempotencyNoteRaw = routingPayload?.idempotencyNote;
        const returnToPrepressBlockedReason = getReturnToPrepressBlockedReason({
          lineItemId: row.lineItemId,
          status: row.status,
          timerIsRunning: isRunning,
        });

        return {
          id: row.id,
          // Stable, UI-ready fields (no guessing / no missing keys)
          productionJobId: row.id, // Explicit production job ID for clarity
          jobId: row.id,
          lineItemId: String(row.lineItemId ?? ""),
          lineNumber: primaryLineItem?.lineNumber ?? null,
          orderId: row.orderId,
          orderNumber: String(row.orderNumber ?? ""), // Order number at top level for easy access
          displayNumber: row.displayNumber,
          numberCore: row.numberCore,
          customerName: String(row.customerName ?? "—"),
          lineItemDueDate,
          dueDate: lineItemDueDate ?? row.dueDate ?? null,
          stationKey: String(row.stationKey ?? ""),
          stepKey: String(row.stepKey ?? ""),
          routingReason: typeof routingReasonRaw === "string" && routingReasonRaw.trim() ? String(routingReasonRaw) : null,
          routingSource: typeof routingSourceRaw === "string" && String(routingSourceRaw).trim() ? String(routingSourceRaw) : null,
          idempotencyNote:
            typeof idempotencyNoteRaw === "string" && String(idempotencyNoteRaw).trim()
              ? String(idempotencyNoteRaw)
              : null,
          // LIVE LINE ITEM FIELDS (top-level for easy frontend access)
          qty,                // LIVE: from line item, updates when qty changed
          jobDescription,     // LIVE: from line item description
          size,              // LIVE: computed from line item width/height
          sides: resolvedPrintSides,
          media,             // LIVE: from line item material or description
          optionRows: lineItemDisplay.optionRows,
          finishingRequirements: lineItemDisplay.finishingRequirements,
          lamination: lineItemDisplay.lamination,
          productionSpecs: {
            orderedQuantity: qty,
            widthIn: Number(width) || null,
            heightIn: Number(height) || null,
            printSides: resolvedPrintSides,
            material: media,
            optionRows: lineItemDisplay.optionRows,
            finishingRequirements: lineItemDisplay.finishingRequirements,
          },
          productionLayout,
          productionAlerts: alertsByProductionJobId.get(row.id) ?? [],
          printerOptions,
          assignedPrinterId: row.assignedPrinterId ?? null,
          assignedPrinterName: row.assignedPrinterName ?? null,
          assignedPrinterByUserId: row.assignedPrinterByUserId ?? null,
          assignedPrinterAt: row.assignedPrinterAt ? new Date(row.assignedPrinterAt as any).toISOString() : null,
          // Legacy field for backwards compatibility
          mediaLabel: media,
          // NEW: explicit preview URLs for Production Overview thumbnails
          frontPreviewUrl,
          backPreviewUrl,
          frontFileUrl,
          backFileUrl,
          artwork: artworkThumbs,
          notes,
          internalNotes: row.notesInternal ?? null,
          productionNotes: primaryLineItem?.productionNotes ?? row.lineItemProductionNotes ?? null,
          poNumber: row.poNumber ?? null,
          // Back-compat: treat view as stationKey
          view: station ?? view ?? config.defaultView,
          status: row.status,
          returnToPrepressEligible: !returnToPrepressBlockedReason,
          returnToPrepressBlockedReason,
          startedAt: toIso(row.startedAt),
          completedAt: toIso(row.completedAt),
          completedByUserId: row.completedByUserId ?? null,
          previousStatus: row.previousStatus ?? null,
          previousStation: row.previousStation ?? null,
          previousStationLabel: stationLabel(row.previousStation),
          restoreUntil: toIso(row.restoreUntil),
          restoredAt: toIso(row.restoredAt),
          restoredByUserId: row.restoredByUserId ?? null,
          restoreReason: row.restoreReason ?? null,
          undoAllowed: !!row.completedAt && !!row.restoreUntil && new Date(row.restoreUntil as any).getTime() > Date.now(),
          totalSeconds: Number(row.totalSeconds) || 0,
          timer: {
            isRunning,
            runningSince,
            currentSeconds,
          },
          reprintCount: reprintCountByJobId.get(row.id) ?? 0,
          order: {
            id: row.orderId,
            customerId: row.customerId,
            orderNumber: row.orderNumber,
            displayNumber: row.displayNumber,
            numberCore: row.numberCore,
            customerName: row.customerName,
            internalNotes: row.notesInternal ?? null,
            poNumber: row.poNumber ?? null,
            dueDate: row.dueDate,
            priority: row.priority,
            fulfillmentStatus: row.fulfillmentStatus,
            routingTarget: row.routingTarget,
            lineItems: {
              count: orderLineItemsList.length,
              totalQuantity,
              primary: primaryLineItem,
              items: orderLineItemsTop,
            },
            artwork,
            sides: artworkBasedSides, // Keep original artwork-based count for backwards compatibility
          },
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      const filtered = search
        ? data.filter((j) => {
            const q = search.toLowerCase();
            const notesText = [
              j.productionNotes,
              j.internalNotes,
              ...(j.notes ?? []).map((note: any) => note.text),
            ].join(" ");
            const fileNames = [
              ...(j.artwork ?? []).map((art: any) => art.fileName),
              ...(j.order?.artwork ?? []).map((art: any) => art.fileName),
            ].join(" ");
            const orderNumber = String(j.order?.orderNumber ?? "").toLowerCase();
            const customerName = String(j.order?.customerName ?? "").toLowerCase();
            const desc = String(j.order?.lineItems?.primary?.description ?? j.jobDescription ?? "").toLowerCase();
            const formalProductName = String(j.order?.lineItems?.primary?.productFormalName ?? "").toLowerCase();
            const media = String(j.media ?? j.mediaLabel ?? j.order?.lineItems?.primary?.materialName ?? "").toLowerCase();
            const jobNumber = String(j.id ?? "").toLowerCase();
            const poNumber = String(j.order?.poNumber ?? j.poNumber ?? "").toLowerCase();
            return documentNumberMatchesSearch({
              query: search,
              displayNumber: j.order?.displayNumber ?? j.displayNumber,
              numberCore: j.order?.numberCore ?? j.numberCore,
              legacyNumber: j.order?.orderNumber,
            }) ||
              orderNumber.includes(q) ||
              jobNumber.includes(q) ||
              poNumber.includes(q) ||
              customerName.includes(q) ||
              desc.includes(q) ||
              formalProductName.includes(q) ||
              media.includes(q) ||
              notesText.toLowerCase().includes(q) ||
              fileNames.toLowerCase().includes(q);
          })
        : data;

      const sorted = sortProductionQueueJobs(filtered, sortBy, sortDirection);

      // DEV: Log response shape for verification
      if (process.env.NODE_ENV === "development" && sorted.length > 0) {
        console.log(`[GET /api/production/jobs] Returning ${sorted.length} jobs. Sample keys:`, Object.keys(sorted[0]));

        const g: any = global as any;
        if (!g.__dev_logged_production_jobs_preview_coverage) {
          g.__dev_logged_production_jobs_preview_coverage = true;
          const withFront = sorted.filter((j: any) => !!j.frontPreviewUrl).length;
          console.log(`[GET /api/production/jobs] preview coverage`, {
            total: sorted.length,
            withFrontPreviewUrl: withFront,
          });
        }
      }

      res.json({ success: true, data: sorted });
    } catch (error) {
      console.error("Error fetching production jobs:", error);
      res.status(500).json({ error: "Failed to fetch production jobs" });
    }
  });

  app.get("/api/production/jobs/recently-completed", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });

      const stationRaw = (req.query.station as string | undefined) ?? (req.query.view as string | undefined);
      const stationParsed = stationRaw ? productionViewKeySchema.safeParse(stationRaw) : null;
      if (stationRaw && !stationParsed?.success) {
        return res.status(400).json({ success: false, message: "Invalid station" });
      }

      const station = normalizeProductionStationKey(stationParsed?.data) ?? stationParsed?.data;
      const stationAliases = station === "roll"
        ? ["roll", "wide_roll"]
        : station === "flatbed"
          ? ["flatbed"]
          : station ? [station] : [];
      const rangeParsed = completedHistoryRangeSchema.safeParse(req.query.range ?? "7d");
      if (!rangeParsed.success) {
        return res.status(400).json({ success: false, message: "Invalid completed-history range" });
      }
      const range = rangeParsed.data;
      const includeHistory = ["1", "true"].includes(String(req.query.includeHistory || "").toLowerCase());
      const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
      const cutoff = addHours(new Date(), -(COMPLETED_HISTORY_RANGE_DAYS[range] * 24));
      const nowMs = Date.now();

      const rows = await db
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          previousStatus: productionJobs.previousStatus,
          previousStation: productionJobs.previousStation,
          completedAt: productionJobs.completedAt,
          completedByUserId: productionJobs.completedByUserId,
          restoreUntil: productionJobs.restoreUntil,
          restoredAt: productionJobs.restoredAt,
          restoreReason: productionJobs.restoreReason,
          orderNumber: orders.orderNumber,
          displayNumber: orders.displayNumber,
          customerName: customers.companyName,
          itemDescription: orderLineItems.description,
          lineItemSortOrder: orderLineItems.sortOrder,
          lineItemQuantity: orderLineItems.quantity,
          lineItemWidth: orderLineItems.width,
          lineItemHeight: orderLineItems.height,
          lineItemMaterialId: orderLineItems.materialId,
          lineItemProductId: orderLineItems.productId,
          lineItemSpecsJson: orderLineItems.specsJson,
          productType: orderLineItems.productType,
          completedByFirstName: users.firstName,
          completedByLastName: users.lastName,
          completedByEmail: users.email,
        })
        .from(productionJobs)
        .innerJoin(orders, eq(orders.id, productionJobs.orderId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
        .leftJoin(users, eq(users.id, productionJobs.completedByUserId))
        .where(and(
          eq(productionJobs.organizationId, organizationId),
          eq(productionJobs.status, "done"),
          includeHistory ? undefined : isNull(productionJobs.restoredAt),
          gte(productionJobs.completedAt, cutoff),
          stationAliases.length > 0 ? inArray(productionJobs.stationKey as any, stationAliases) : undefined,
        ))
        .orderBy(desc(productionJobs.completedAt), desc(productionJobs.updatedAt))
        .limit(500);

      const lineItemIds = Array.from(new Set(rows
        .map((row) => row.lineItemId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
      const prepressOwnerRows = lineItemIds.length > 0
        ? await db.select({ lineItemId: productionJobs.lineItemId }).from(productionJobs).where(and(
          eq(productionJobs.organizationId, organizationId),
          inArray(productionJobs.lineItemId, lineItemIds),
          eq(productionJobs.stationKey, "prepress"),
          inArray(productionJobs.status, ["queued", "in_progress", "paused"]),
        ))
        : [];
      const prepressOwnedLineItemIds = new Set(prepressOwnerRows.map((row) => row.lineItemId));
      // Older recoveries may predate restoredAt. Canonical active Prepress
      // ownership supersedes that historical completion in the normal view.
      const authoritativeRows = includeHistory ? rows : rows.filter((row) => !row.lineItemId || !prepressOwnedLineItemIds.has(row.lineItemId));
      const completedJobIds = authoritativeRows.map((row) => row.id);
      const completedRunMembers = completedJobIds.length > 0
        ? await db.select({
            productionJobId: productionRunMembers.productionJobId,
            runId: productionRuns.id,
            runNumber: productionRuns.runNumber,
            runStatus: productionRuns.status,
          }).from(productionRunMembers)
            .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
            .where(and(
              eq(productionRunMembers.organizationId, organizationId),
              inArray(productionRunMembers.productionJobId, completedJobIds),
            ))
        : [];
      const completedRunByJobId = new Map(completedRunMembers.map((member) => [member.productionJobId, member]));
      const materialIds = Array.from(new Set(rows
        .map((row) => row.lineItemMaterialId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
      const productIds = Array.from(new Set(rows
        .map((row) => row.lineItemProductId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)));

      const [finalFileRows, artworkAttachmentRows, artworkAssetRows, materialRows, productRows] = await Promise.all([
        lineItemIds.length > 0
          ? db.select({ lineItemId: lineItemFiles.lineItemId, fileRecordId: lineItemFiles.fileRecordId })
            .from(lineItemFiles)
            .where(and(
              eq(lineItemFiles.organizationId, organizationId),
              inArray(lineItemFiles.lineItemId, lineItemIds),
              eq(lineItemFiles.role, "final"),
              eq(lineItemFiles.status, "active"),
            ))
          : Promise.resolve([]),
        lineItemIds.length > 0
          ? db.select({
              id: orderAttachments.id,
              orderLineItemId: orderAttachments.orderLineItemId,
              fileRecordId: orderAttachments.fileRecordId,
              fileName: orderAttachments.fileName,
              mimeType: orderAttachments.mimeType,
              thumbKey: orderAttachments.thumbKey,
              previewKey: orderAttachments.previewKey,
              thumbnailUrl: orderAttachments.thumbnailUrl,
              thumbStatus: orderAttachments.thumbStatus,
              thumbError: orderAttachments.thumbError,
              side: orderAttachments.side,
              productionQuantity: orderAttachments.productionQuantity,
              productionGroupId: orderAttachments.productionGroupId,
              isPrimary: orderAttachments.isPrimary,
              createdAt: orderAttachments.createdAt,
            })
            .from(orderAttachments)
            .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
            .where(and(
              eq(orders.organizationId, organizationId),
              inArray(orderAttachments.orderLineItemId, lineItemIds),
              eq(orderAttachments.role, "artwork"),
            ))
            .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.side), desc(orderAttachments.createdAt))
          : Promise.resolve([]),
        lineItemIds.length > 0
          ? db.select({ asset: assets, lineItemId: assetLinks.parentId, linkRole: assetLinks.role })
            .from(assetLinks)
            .innerJoin(assets, eq(assets.id, assetLinks.assetId))
            .where(and(
              eq(assetLinks.organizationId, organizationId),
              eq(assetLinks.parentType, "order_line_item"),
              inArray(assetLinks.parentId, lineItemIds),
              inArray(assetLinks.role, ["primary", "attachment"]),
            ))
            .orderBy(desc(assetLinks.createdAt))
          : Promise.resolve([]),
        materialIds.length > 0
          ? db.select({ id: materials.id, name: materials.name }).from(materials)
            .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)))
          : Promise.resolve([]),
        productIds.length > 0
          ? db.select({ id: products.id, name: products.name }).from(products)
            .where(and(eq(products.organizationId, organizationId), inArray(products.id, productIds)))
          : Promise.resolve([]),
      ]);

      const finalFileRecordIdsByLineItem = new Map<string, Set<string>>();
      for (const file of finalFileRows) {
        if (!file.fileRecordId) continue;
        const ids = finalFileRecordIdsByLineItem.get(file.lineItemId) ?? new Set<string>();
        ids.add(file.fileRecordId);
        finalFileRecordIdsByLineItem.set(file.lineItemId, ids);
      }

      const attachmentUrls = await Promise.all(artworkAttachmentRows.map(async (attachment) => {
        const [thumb, preview] = await Promise.all([
          resolveDerivativeFileAccess(attachment, "thumbnail"),
          resolveDerivativeFileAccess(attachment, "preview"),
        ]);
        return {
          lineItemId: attachment.orderLineItemId,
          id: attachment.id,
          fileRecordId: attachment.fileRecordId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          thumbnailUrl: thumb.url ?? null,
          previewUrl: preview.url ?? null,
          previewStatus: thumb.url || preview.url ? "available" : attachment.thumbStatus === "thumb_failed" ? "failed" : attachment.thumbStatus === "thumb_pending" ? "pending" : "missing",
          previewReason: thumb.url || preview.url ? null : attachment.thumbError || (attachment.thumbStatus === "thumb_pending" ? "Preview has not been generated yet." : "Production artwork preview is unavailable."),
          side: attachment.side ?? "na",
          isPrimary: !!attachment.isPrimary,
          sourceKind: "line_item_artwork" as const,
          productionQuantity: attachment.productionQuantity,
          productionGroupId: attachment.productionGroupId,
        };
      }));
      const assetUrls = await Promise.all(artworkAssetRows.map(async (linked) => {
        const [thumb, preview] = await Promise.all([
          resolveDerivativeFileAccess(linked.asset, "thumbnail"),
          resolveDerivativeFileAccess(linked.asset, "preview"),
        ]);
        return {
          lineItemId: linked.lineItemId,
          id: linked.asset.id,
          fileRecordId: linked.asset.fileRecordId,
          fileName: linked.asset.fileName,
          mimeType: linked.asset.mimeType,
          thumbnailUrl: thumb.url ?? null,
          previewUrl: preview.url ?? null,
          previewStatus: thumb.url || preview.url ? "available" : linked.asset.previewStatus === "failed" ? "failed" : linked.asset.previewStatus === "pending" ? "pending" : "missing",
          previewReason: thumb.url || preview.url ? null : linked.asset.previewError || (linked.asset.previewStatus === "pending" ? "Preview has not been generated yet." : "Production artwork preview is unavailable."),
          side: "na",
          isPrimary: linked.linkRole === "primary",
          sourceKind: "line_item_asset" as const,
          productionQuantity: null,
          productionGroupId: null,
        };
      }));
      const artworkByLineItem = new Map<string, Array<(typeof attachmentUrls)[number] | (typeof assetUrls)[number]>>();
      for (const artwork of [...attachmentUrls, ...assetUrls]) {
        if (!artwork.lineItemId) continue;
        const list = artworkByLineItem.get(artwork.lineItemId) ?? [];
        list.push(artwork);
        artworkByLineItem.set(artwork.lineItemId, list);
      }
      const materialNameById = new Map(materialRows.map((row) => [row.id, row.name]));
      const productNameById = new Map(productRows.map((row) => [row.id, row.name]));

      const completed = authoritativeRows.map((row) => {
          const combinedRun = completedRunByJobId.get(row.id) ?? null;
          const candidates = row.lineItemId ? artworkByLineItem.get(row.lineItemId) ?? [] : [];
          const finalIds = row.lineItemId ? finalFileRecordIdsByLineItem.get(row.lineItemId) : null;
          const productionArtwork = finalIds && finalIds.size > 0
            ? candidates.filter((artwork) => !!artwork.fileRecordId && finalIds.has(artwork.fileRecordId))
            : candidates;
          const artwork = productionArtwork.length > 0 ? productionArtwork : candidates;
          const quantity = Number(row.lineItemQuantity);
          const totalQuantity = Number.isFinite(quantity) ? quantity : null;
          const quantityMode = resolveCompletedArtworkQuantityMode(row.lineItemSpecsJson);
          const allocation = buildArtworkAllocationStatus({
            lineQuantity: totalQuantity,
            members: artwork.map((file) => ({
              id: file.id,
              role: "artwork",
              side: file.side,
              productionQuantity: file.productionQuantity ?? null,
              productionGroupId: file.productionGroupId ?? null,
            })),
          });
          const restoreUntilMs = row.restoreUntil ? new Date(row.restoreUntil as any).getTime() : Number.NaN;
          const undoAllowed = !!row.completedAt && Number.isFinite(restoreUntilMs) && restoreUntilMs > nowMs;
          const dimensions = row.lineItemWidth && row.lineItemHeight ? `${row.lineItemWidth} × ${row.lineItemHeight}` : null;
          const itemName = String(row.itemDescription || productNameById.get(row.lineItemProductId ?? "") || row.productType || `Job ${String(row.id).slice(-6)}`).trim();
          const completedArtwork = artwork.map((file) => ({
            ...file,
            allocatedQuantity: file.productionQuantity ?? null,
          }));
          return {
            id: row.id,
            orderId: row.orderId,
            lineItemId: row.lineItemId ?? null,
            orderNumber: row.displayNumber || row.orderNumber,
            customerName: row.customerName || "Unknown Customer",
            itemName,
            productName: productNameById.get(row.lineItemProductId ?? "") ?? null,
            lineItemSequence: row.lineItemSortOrder == null ? null : Number(row.lineItemSortOrder) + 1,
            dimensions,
            mediaName: materialNameById.get(row.lineItemMaterialId ?? "") ?? null,
            totalQuantity,
            artworkCount: completedArtwork.length,
            artworkQuantityMode: quantityMode,
            artworkSummary: describeCompletedArtworkSummary({ totalQuantity, artworkCount: completedArtwork.length, quantityMode, sides: completedArtwork.map((file) => file.side) }),
            allocationIssue: artwork.length > 1 ? allocation.issue : null,
            artwork: completedArtwork,
            stationKey: row.stationKey,
            stationLabel: stationLabel(row.stationKey),
            previousStatus: row.previousStatus ?? null,
            previousStation: row.previousStation ?? null,
            previousStationLabel: stationLabel(row.previousStation ?? row.stationKey),
            restoreStatusLabel: `${stationLabel(row.previousStation ?? row.stationKey)} · ${stationLabel(row.previousStatus ?? "in_progress")}`,
            completedAt: toIso(row.completedAt),
            completedByUserId: row.completedByUserId ?? null,
            completedBy: userDisplayName({
              firstName: row.completedByFirstName,
              lastName: row.completedByLastName,
              email: row.completedByEmail,
            }),
            restoreUntil: toIso(row.restoreUntil),
            restoredAt: toIso(row.restoredAt),
            restoreReason: row.restoreReason ?? null,
            productionRunId: combinedRun?.runId ?? null,
            productionRunDisplayNumber: combinedRun ? `PR-${String(combinedRun.runNumber).padStart(4, "0")}` : null,
            productionRunStatus: combinedRun?.runStatus ?? null,
            legacyRecoveryAction: !undoAllowed
              ? combinedRun?.runStatus === "completed"
                ? "reopen_combined_run"
                : !combinedRun
                  ? "reopen_production"
                  : "unavailable"
              : null,
            undoAllowed,
            undoUnavailableReason: undoAllowed
              ? null
              : !row.restoreUntil
                ? "Undo is unavailable because this completion has no recovery window."
                : "Undo is no longer available for this completed job.",
          };
        });
      const filtered = search
        ? completed.filter((job) => completedProductionSearchText(job).includes(search))
        : completed;
      return res.json({
        success: true,
        data: filtered,
        range,
        message: "Completed production jobs fetched",
      });
    } catch (error: any) {
      console.error("Error fetching recently completed production jobs:", error);
      return res.status(500).json({ success: false, message: error?.message || "Failed to fetch recently completed jobs" });
    }
  });

  // Extra (needed for detail UI): GET /api/production/jobs/:jobId
  app.get("/api/production/jobs/:jobId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const jobId = String(req.params.jobId || "");
      if (!jobId.trim()) return res.status(400).json({ error: "jobId required" });

      // Fetch production job ONLY (org-scoped). Related entities are fetched separately to avoid brittle joins.
      const jobRows = await db
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          assignedPrinterId: productionJobs.assignedPrinterId,
          assignedPrinterName: productionJobs.assignedPrinterName,
          assignedPrinterByUserId: productionJobs.assignedPrinterByUserId,
          assignedPrinterAt: productionJobs.assignedPrinterAt,
          startedAt: productionJobs.startedAt,
          completedAt: productionJobs.completedAt,
          completedByUserId: productionJobs.completedByUserId,
          previousStatus: productionJobs.previousStatus,
          previousStation: productionJobs.previousStation,
          restoreUntil: productionJobs.restoreUntil,
          restoredAt: productionJobs.restoredAt,
          restoredByUserId: productionJobs.restoredByUserId,
          restoreReason: productionJobs.restoreReason,
          totalSeconds: productionJobs.totalSeconds,
          createdAt: productionJobs.createdAt,
          updatedAt: productionJobs.updatedAt,
        })
        .from(productionJobs)
        .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
        .limit(1);

      const job = jobRows[0];
      if (!job) return res.status(404).json({ error: "Production job not found" });

      const orderId = String(job.orderId || "");
      const lineItemId = String(job.lineItemId || "");
      if (!orderId) return res.status(404).json({ error: "Order not found for production job" });
      if (!lineItemId) return res.status(404).json({ error: "Line item not found for production job" });

      const orderRows = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          displayNumber: orders.displayNumber,
          numberCore: orders.numberCore,
          dueDate: orders.dueDate,
          priority: orders.priority,
          fulfillmentStatus: orders.fulfillmentStatus,
          routingTarget: orders.routingTarget,
          customerName: customers.companyName,
          contactId: orders.contactId,
          notesInternal: orders.notesInternal,
          poNumber: orders.poNumber,
          shippingMethod: orders.shippingMethod,
        })
        .from(orders)
        .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, organizationId)))
        .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
        .limit(1);

      const order = orderRows[0];
      if (!order) return res.status(404).json({ error: "Order not found for production job" });

      // Contact name (for production ticket). Fail-soft: never block job detail.
      let contactName: string | null = null;
      if (order.contactId) {
        try {
          const contactRows = await db
            .select({ firstName: customerContacts.firstName, lastName: customerContacts.lastName })
            .from(customerContacts)
            .where(eq(customerContacts.id, order.contactId))
            .limit(1);
          const c = contactRows[0];
          if (c) {
            const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
            contactName = name || null;
          }
        } catch {
          contactName = null;
        }
      }

      const events = await db
        .select({
          id: productionEvents.id,
          type: productionEvents.type,
          payload: productionEvents.payload,
          actorUserId: productionEvents.actorUserId,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.productionJobId, jobId)))
        .orderBy(desc(productionEvents.createdAt))
        .limit(250);

      // "Who's job it is" — production jobs have no explicit assignee, so we
      // derive it from the most recent operator action on the job (timer
      // start/stop, note, reprint). Best-effort; null when no actor is known.
      let assignedTo: string | null = null;
      const latestActorId = events.find(
        (e) => typeof e.actorUserId === "string" && e.actorUserId,
      )?.actorUserId;
      if (latestActorId) {
        try {
          const userRows = await db
            .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
            .from(users)
            .where(eq(users.id, latestActorId))
            .limit(1);
          const u = userRows[0];
          if (u) {
            const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
            assignedTo = name || u.email || null;
          }
        } catch {
          assignedTo = null;
        }
      }

      const latestRoutingEvent = events.find((event) => event.type === "routing_override" || event.type === "intake") ?? null;
      const latestRoutingPayload = (latestRoutingEvent?.payload as any) ?? {};
      const routingReason =
        typeof latestRoutingPayload?.routingReason === "string" && latestRoutingPayload.routingReason.trim()
          ? String(latestRoutingPayload.routingReason)
          : null;
      const routingSource =
        typeof latestRoutingPayload?.source === "string" && latestRoutingPayload.source.trim()
          ? String(latestRoutingPayload.source)
          : typeof latestRoutingPayload?.trigger === "string" && latestRoutingPayload.trigger.trim()
            ? String(latestRoutingPayload.trigger)
            : latestRoutingEvent?.type ?? null;
      const idempotencyNote =
        typeof latestRoutingPayload?.idempotencyNote === "string" && latestRoutingPayload.idempotencyNote.trim()
          ? String(latestRoutingPayload.idempotencyNote)
          : null;

      const timerState = await getTimerStateForJob(organizationId, jobId);
      const now = Date.now();
      const currentSeconds =
        Number(job.totalSeconds) +
        (timerState.isRunning && timerState.runningSince
          ? toSeconds(now - new Date(timerState.runningSince as any).getTime())
          : 0);

      const lineItemRows = await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          description: orderLineItems.description,
          quantity: orderLineItems.quantity,
          width: orderLineItems.width,
          height: orderLineItems.height,
          productId: orderLineItems.productId,
          materialId: orderLineItems.materialId,
          productType: orderLineItems.productType,
          status: orderLineItems.status,
          sortOrder: orderLineItems.sortOrder,
          selectedOptions: orderLineItems.selectedOptions,
          optionSelectionsJson: orderLineItems.optionSelectionsJson,
          pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
          specsJson: orderLineItems.specsJson,
          productionNotes: orderLineItems.productionNotes,
          createdAt: orderLineItems.createdAt,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orders.organizationId, organizationId), eq(orderLineItems.orderId, orderId)))
        .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

      const materialIds = Array.from(
        new Set(lineItemRows.map((li) => li.materialId).filter((v): v is string => typeof v === "string" && !!v.trim())),
      );

      const materialNameById = new Map<string, string>();
      if (materialIds.length > 0) {
        const materialRows = await db
          .select({ id: materials.id, name: materials.name })
          .from(materials)
          .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)));
        for (const m of materialRows) materialNameById.set(m.id, m.name);
      }

      const productIds = Array.from(new Set(
        lineItemRows.map((li) => li.productId).filter((value): value is string => typeof value === "string" && !!value.trim()),
      ));
      const productById = new Map<string, { name: string; shopName: string | null; pricingProfileConfig: unknown; sheetWidth: unknown; sheetHeight: unknown; materialType: unknown }>();
      if (productIds.length > 0) {
        const productRows = await db
          .select({
            id: products.id,
            name: products.name,
            shopName: products.shopName,
            pricingProfileConfig: products.pricingProfileConfig,
            sheetWidth: products.sheetWidth,
            sheetHeight: products.sheetHeight,
            materialType: products.materialType,
          })
          .from(products)
          .where(and(eq(products.organizationId, organizationId), inArray(products.id, productIds)));
        for (const product of productRows) productById.set(product.id, product);
      }

      const lineItems = lineItemRows.map((li) => ({
        id: li.id,
        description: li.description,
        quantity: Number(li.quantity) || 0,
        width: li.width,
        height: li.height,
        productId: li.productId ?? null,
        productFormalName: li.productId ? productById.get(li.productId)?.name ?? null : null,
        productShopName: li.productId ? productById.get(li.productId)?.shopName ?? null : null,
        pricingProfileConfig: li.productId ? productById.get(li.productId)?.pricingProfileConfig ?? null : null,
        sheetWidth: li.productId ? productById.get(li.productId)?.sheetWidth ?? null : null,
        sheetHeight: li.productId ? productById.get(li.productId)?.sheetHeight ?? null : null,
        materialType: li.productId ? productById.get(li.productId)?.materialType ?? null : null,
        materialId: li.materialId ?? null,
        materialName: li.materialId ? materialNameById.get(li.materialId) ?? null : null,
        productType: li.productType,
        status: li.status,
        sortOrder: Number(li.sortOrder) || 0,
        selectedOptions: li.selectedOptions ?? [],
        optionSelectionsJson: li.optionSelectionsJson ?? null,
        pbv2SnapshotJson: li.pbv2SnapshotJson ?? null,
        specsJson: li.specsJson ?? null,
        productionNotes: li.productionNotes ?? null,
        createdAt: li.createdAt,
      }));

      const primaryLineItem = lineItems.find((li) => li.id === lineItemId) ?? null;
      if (!primaryLineItem) return res.status(404).json({ error: "Line item not found for production job" });
      const primaryLineNumber = lineItems.findIndex((li) => li.id === lineItemId) + 1;
      (primaryLineItem as any).lineNumber = primaryLineNumber;

      const attachmentRows = await db
        .select({
          id: orderAttachments.id,
          orderId: orderAttachments.orderId,
          orderLineItemId: orderAttachments.orderLineItemId,
          fileRecordId: orderAttachments.fileRecordId,
          fileName: orderAttachments.fileName,
          mimeType: orderAttachments.mimeType,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
          role: orderAttachments.role,
          side: orderAttachments.side,
          isPrimary: orderAttachments.isPrimary,
          thumbStatus: orderAttachments.thumbStatus,
          createdAt: orderAttachments.createdAt,
        })
        .from(orderAttachments)
        .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orderAttachments.orderId, orderId),
            eq(orderAttachments.role, "artwork"),
          ),
        )
        .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.side), desc(orderAttachments.createdAt))
        .limit(50);

      const byOrder: Array<any> = [];
      const byLineItem = new Map<string, Array<any>>();
      const orderAttachmentLogOnce = createRequestLogOnce();
      const enrichedOrderAttachments = await Promise.all(
        attachmentRows.map((row) => enrichAttachmentWithUrls(row, { logOnce: orderAttachmentLogOnce })),
      );

      for (const a of enrichedOrderAttachments) {
        const mapped = {
          id: a.id,
          orderLineItemId: a.orderLineItemId ?? null,
          fileRecordId: a.fileRecordId ?? null,
          fileName: a.fileName,
          mimeType: a.mimeType ?? null,
          fileUrl: a.originalUrl ?? null,
          availabilityStatus: a.availabilityStatus,
          thumbKey: a.thumbKey ?? null,
          previewKey: a.previewKey ?? null,
          thumbUrl: a.thumbUrl ?? null,
          previewUrl: a.previewUrl ?? null,
          thumbnailUrl: a.thumbnailUrl ?? null,
          side: a.side ?? "unassigned",
          isPrimary: !!a.isPrimary,
          thumbStatus: a.thumbStatus ?? null,
        };
        if (byOrder.length < 12) byOrder.push(mapped);
        if (a.orderLineItemId) {
          const list = byLineItem.get(a.orderLineItemId) ?? [];
          if (list.length < 12) {
            list.push(mapped);
            byLineItem.set(a.orderLineItemId, list);
          }
        }
      }

      // ALSO fetch artwork from new assets + assetLinks system (newer uploads may use this)
      // Fail-soft: if this optional query fails, do not 500 job detail.
      try {
        const assetLinkRows = await db
          .select({
            id: assets.id,
            parentType: assetLinks.parentType,
            parentId: assetLinks.parentId,
            fileName: assets.fileName,
            fileRecordId: assets.fileRecordId,
            thumbKey: assets.thumbKey,
            previewKey: assets.previewKey,
            previewStatus: assets.previewStatus,
            mimeType: assets.mimeType,
            sizeBytes: assets.sizeBytes,
            createdAt: assetLinks.createdAt,
          })
          .from(assetLinks)
          .innerJoin(assets, eq(assetLinks.assetId, assets.id))
          .where(
            and(
              eq(assetLinks.organizationId, organizationId),
              or(
                and(eq(assetLinks.parentType, "order"), eq(assetLinks.parentId, orderId)),
                and(eq(assetLinks.parentType, "order_line_item"), eq(assetLinks.parentId, lineItemId)),
              ),
            ),
          )
          .orderBy(desc(assetLinks.createdAt));

        const assetLogOnce = createRequestLogOnce();
        const { enrichAssetPreviewUrls } = await import('../services/assets/enrichAssetWithUrls');
        for (const link of assetLinkRows) {
          const [originalAccess, enrichedAsset] = await Promise.all([
            resolveOriginalFileAccess(link, { logOnce: assetLogOnce }),
            enrichAssetPreviewUrls(link as any),
          ]);
          const mapped = {
            id: link.id,
            orderLineItemId: link.parentType === "order_line_item" ? link.parentId : null,
            fileRecordId: link.fileRecordId ?? null,
            fileName: link.fileName,
            fileUrl: originalAccess.originalUrl,
            availabilityStatus: originalAccess.availabilityStatus,
            thumbKey: link.thumbKey ?? null,
            previewKey: link.previewKey ?? null,
            thumbUrl: (enrichedAsset as any).thumbUrl ?? null,
            previewUrl: (enrichedAsset as any).previewUrl ?? null,
            thumbnailUrl:
              (enrichedAsset as any).previewThumbnailUrl ??
              (enrichedAsset as any).thumbnailUrl ??
              (enrichedAsset as any).thumbUrl ??
              null,
            side: "unassigned",
            isPrimary: false,
            thumbStatus: link.previewStatus ?? null,
            mimeType: link.mimeType ?? null,
            sizeBytes: link.sizeBytes ?? null,
          };

          if (byOrder.length < 12 && link.parentType === "order") {
            byOrder.push(mapped);
          }

          if (link.parentType === "order_line_item" && link.parentId) {
            const list = byLineItem.get(link.parentId) ?? [];
            if (list.length < 12) {
              list.push(mapped);
              byLineItem.set(link.parentId, list);
            }
          }
        }
      } catch (e: any) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[DEV][GET /api/production/jobs/:jobId] asset artwork query failed (ignored)", {
            jobId,
            organizationId,
            message: String(e?.message || e),
          });
        }
      }

      const artworkResolution = await lineItemArtworkReadResolver.resolveForLineItem({
        organizationId,
        lineItemId,
        purpose: "production",
      });
      const lineItemArtwork = artworkResolution.artwork.map((artwork) => ({
        id: artwork.id,
        orderLineItemId: artwork.lineItemId,
        fileRecordId: artwork.fileRecordId,
        fileName: artwork.file.originalFilename ?? "Artwork",
        mimeType: artwork.file.mimeType,
        fileUrl: artwork.file.contentPath,
        availabilityStatus: artwork.fileRecordId ? "available" as const : "missing" as const,
        thumbKey: null,
        previewKey: null,
        thumbUrl: artwork.fileRecordId ? `${artwork.file.contentPath}?variant=thumbnail` : null,
        previewUrl: artwork.fileRecordId ? `${artwork.file.contentPath}?variant=preview` : null,
        thumbnailUrl: artwork.fileRecordId ? `${artwork.file.contentPath}?variant=thumbnail` : null,
        side: artwork.side,
        isPrimary: true,
        productionQuantity: artwork.allocationQuantity,
        productionGroupId: artwork.allocationGroupId,
        thumbStatus: null,
      }));
      const finalFileRows = await db
        .select({
          id: lineItemFiles.id,
          lineItemId: lineItemFiles.lineItemId,
          fileRecordId: lineItemFiles.fileRecordId,
          role: lineItemFiles.role,
          status: lineItemFiles.status,
          tag: lineItemFiles.tag,
          productionQuantity: lineItemFiles.productionQuantity,
          productionGroupId: lineItemFiles.productionGroupId,
          originalFilename: lineItemFiles.originalFilename,
          mimeType: lineItemFiles.mimeType,
          sizeBytes: lineItemFiles.sizeBytes,
          createdAt: lineItemFiles.createdAt,
        })
        .from(lineItemFiles)
        .where(
          and(
            eq(lineItemFiles.organizationId, organizationId),
            eq(lineItemFiles.lineItemId, lineItemId),
            eq(lineItemFiles.role, "final"),
            eq(lineItemFiles.status, "active"),
          ),
        )
        .orderBy(desc(lineItemFiles.createdAt));

      const productionFileLogOnce = createRequestLogOnce();
      const productionFiles = await Promise.all(
        sortFinalProductionFiles(finalFileRows).map(async (file) => {
          const [thumbnailAccess, previewAccess] = file.fileRecordId
            ? await Promise.all([
                resolveDerivativeFileAccess(file, "thumbnail", { logOnce: productionFileLogOnce }),
                resolveDerivativeFileAccess(file, "preview", { logOnce: productionFileLogOnce }),
              ])
            : [{ url: null, availabilityStatus: "missing" }, { url: null, availabilityStatus: "missing" }];
          const previewAvailabilityStatus = thumbnailAccess.url || previewAccess.url
            ? "available"
            : thumbnailAccess.availabilityStatus === "pending" || previewAccess.availabilityStatus === "pending"
              ? "pending"
              : thumbnailAccess.availabilityStatus === "failed" || previewAccess.availabilityStatus === "failed"
                ? "failed"
                : "missing";

          return {
            id: file.id,
            lineItemId: file.lineItemId,
            fileRecordId: file.fileRecordId ?? null,
            fileName: file.originalFilename,
            role: "final" as const,
            tag: file.tag ?? null,
            productionQuantity: file.productionQuantity ?? null,
            productionGroupId: file.productionGroupId ?? null,
            allocatedQuantity: file.productionQuantity ?? null,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            thumbnailUrl: thumbnailAccess.url ?? null,
            previewUrl: previewAccess.url ?? null,
            downloadUrl: `/api/production/jobs/${jobId}/files/${file.id}/download`,
            openUrl: `/api/production/jobs/${jobId}/files/${file.id}/download?inline=1`,
            previewAvailabilityStatus,
            createdAt: file.createdAt,
          };
        }),
      );
      const finalAllocationByFileRecordId = new Map(
        finalFileRows
          .filter((file) => file.fileRecordId)
          .map((file) => [file.fileRecordId, {
            productionQuantity: file.productionQuantity ?? null,
            productionGroupId: file.productionGroupId ?? null,
          }]),
      );
      const artwork = resolveLineItemProductionArtwork({
        lineItemArtwork,
        orderArtwork: [],
        productionFileRecordIds: finalFileRows.map((file) => file.fileRecordId),
      }).map((file) => {
        const allocation = file.fileRecordId ? finalAllocationByFileRecordId.get(file.fileRecordId) : null;
        return {
          ...file,
          productionQuantity: allocation?.productionQuantity ?? null,
          productionGroupId: allocation?.productionGroupId ?? null,
          allocatedQuantity: allocation?.productionQuantity ?? null,
        };
      });

      const sidesSet = new Set<string>();
      for (const a of artwork) {
        const s = (a.side || "").toLowerCase();
        if (s === "front" || s === "back") sidesSet.add(s);
      }
      const artworkBasedSides = sidesSet.size > 0 ? sidesSet.size : null;

      // DERIVE LIVE DISPLAY FIELDS (match overview endpoint logic)
      // 1) Media
      let media = String(primaryLineItem?.materialName || "").trim();
      if (!media) {
        media = String(primaryLineItem?.description || "").trim();
      }
      if (!media) media = "—";

      // 2) Size
      const width = primaryLineItem?.width;
      const height = primaryLineItem?.height;
      const size = width && height ? `${width} × ${height}` : "—";

      const qty = Number(primaryLineItem?.quantity ?? 0) || 0;
      const resolvedPrintSides = resolveProductionSides(primaryLineItem);
      const sheetConfiguration = resolveSheetConfiguration(primaryLineItem);
      const productionLayout = calculateSheetProductionLayout({
        stationKey: job.stationKey,
        materialType: sheetConfiguration.materialType,
        widthIn: width,
        heightIn: height,
        quantity: qty,
        sheetWidthIn: sheetConfiguration.sheetWidthIn,
        sheetHeightIn: sheetConfiguration.sheetHeightIn,
        allowRotation: sheetConfiguration.allowRotation,
        sides: resolvedPrintSides,
      });
      const jobDescription = String(primaryLineItem?.description || "").trim() || `Job #${job.id.slice(-8)}`;
      const config = await getProductionConfigForOrganization(organizationId);
      const lineItemDisplay = buildLineItemProductionDisplay(primaryLineItem);
      if (primaryLineItem.productShopName) {
        media = resolvePrepressJobSpecificationsDisplay({
          productName: primaryLineItem.productFormalName ?? primaryLineItem.description,
          productShopName: primaryLineItem.productShopName,
          optionRows: lineItemDisplay.optionRows,
        }).productLabel;
      }
      (primaryLineItem as any).optionSelectionsJson = {
        ...((primaryLineItem as any).optionSelectionsJson ?? {}),
        lamination: lineItemDisplay.lamination.label,
      };
      (primaryLineItem as any).optionRows = lineItemDisplay.optionRows;
      const printerOptions = resolvePrinterOptionsForStation(config, job.stationKey);
      const productionAlertRows = await db
        .select()
        .from(productionAlerts)
        .where(
          and(
            eq(productionAlerts.organizationId, organizationId),
            inArray(productionAlerts.status, ["active", "acknowledged", "resolved"]),
            or(
              eq(productionAlerts.productionJobId, jobId),
              eq(productionAlerts.orderLineItemId, lineItemId),
              eq(productionAlerts.orderId, orderId),
            ),
          ),
        )
        .orderBy(desc(productionAlerts.createdAt));
      const productionAlertList = productionAlertRows
        .filter((alert) => {
          const directJobMatch = alert.productionJobId && alert.productionJobId === jobId;
          const lineItemMatch = alert.orderLineItemId && alert.orderLineItemId === lineItemId;
          const orderMatch = !alert.orderLineItemId && !alert.productionJobId && alert.orderId === orderId;
          return (directJobMatch || lineItemMatch || orderMatch) && productionAlertVisibleForStation(alert, job.stationKey);
        })
        .map((alert) => serializeProductionAlert(alert));

      // Sibling jobs list for operator workflow
      const otherJobsRows = await db
        .select({
          id: productionJobs.id,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          createdAt: productionJobs.createdAt,
        })
        .from(productionJobs)
        .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId)))
        .orderBy(asc(productionJobs.createdAt));

      const lineItemById = new Map(lineItems.map((li) => [li.id, li] as const));
      const otherJobsInOrder = otherJobsRows.map((r) => {
        const li = r.lineItemId ? lineItemById.get(r.lineItemId) ?? null : null;
        const artworkForRow = r.lineItemId ? byLineItem.get(r.lineItemId) ?? byOrder : byOrder;

        const rowSidesSet = new Set<string>();
        for (const a of artworkForRow ?? []) {
          const s = String((a as any).side || "").toLowerCase();
          if (s === "front" || s === "back") rowSidesSet.add(s);
        }
        const rowArtworkSides = rowSidesSet.size > 0 ? rowSidesSet.size : null;

        let rowMedia = String(li?.materialName || "").trim();
        if (!rowMedia) rowMedia = String(li?.description || "").trim();
        if (!rowMedia) rowMedia = "—";
        if (li?.productShopName) {
          rowMedia = resolvePrepressJobSpecificationsDisplay({
            productName: li.productFormalName ?? li.description,
            productShopName: li.productShopName,
            optionRows: buildLineItemProductionDisplay(li).optionRows,
          }).productLabel;
        }

        const rowWidth = li?.width;
        const rowHeight = li?.height;
        const rowSize = rowWidth && rowHeight ? `${rowWidth} × ${rowHeight}` : "—";

        let rowSides: string = "—";
        if (li?.selectedOptions && Array.isArray(li.selectedOptions)) {
          const sidesOption = li.selectedOptions.find((opt: any) => {
            const optName = String(opt.optionName || "").toLowerCase();
            return optName.includes("side") || optName.includes("print");
          });
          if (sidesOption) {
            const val = String((sidesOption as any).value || "").toLowerCase();
            if (val.includes("single") || val === "1") {
              rowSides = "Single";
            } else if (val.includes("double") || val === "2") {
              rowSides = "Double";
            }
          }
        }
        if (rowSides === "—" && rowArtworkSides) {
          rowSides = rowArtworkSides === 1 ? "Single" : "Double";
        }

        const rowQty = Number(li?.quantity ?? 0) || 0;
        const rowDesc = String(li?.description || "").trim() || `Job #${String(r.id).slice(-8)}`;

        return {
          id: r.id,
          jobId: r.id,
          lineItemId: r.lineItemId,
          stationKey: r.stationKey,
          stepKey: r.stepKey,
          status: r.status,
          qty: rowQty,
          size: rowSize,
          sides: rowSides,
          media: rowMedia,
          jobDescription: rowDesc,
          dueDate: order.dueDate ?? null,
          createdAt: r.createdAt,
        };
      });

      const reprintCountRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            eq(productionEvents.productionJobId, jobId),
            eq(productionEvents.type, "reprint_incremented"),
          ),
        );

      res.json({
        success: true,
        data: {
          id: job.id,
          stationKey: job.stationKey,
          stepKey: job.stepKey,
          routingReason,
          routingSource,
          idempotencyNote,
          lineItemId: job.lineItemId,
          lineNumber: primaryLineNumber,
          orderId,
          status: job.status,
          startedAt: toIso(job.startedAt),
          completedAt: toIso(job.completedAt),
          completedByUserId: job.completedByUserId ?? null,
          previousStatus: job.previousStatus ?? null,
          previousStation: job.previousStation ?? null,
          previousStationLabel: stationLabel(job.previousStation),
          restoreUntil: toIso(job.restoreUntil),
          restoredAt: toIso(job.restoredAt),
          restoredByUserId: job.restoredByUserId ?? null,
          restoreReason: job.restoreReason ?? null,
          undoAllowed: !!job.completedAt && !!job.restoreUntil && new Date(job.restoreUntil as any).getTime() > Date.now(),
          totalSeconds: Number(job.totalSeconds) || 0,
          timer: {
            isRunning: timerState.isRunning,
            runningSince: timerState.runningSince ? new Date(timerState.runningSince as any).toISOString() : null,
            currentSeconds,
          },
          reprintCount: Number(reprintCountRows[0]?.count) || 0,
          // LIVE LINE ITEM FIELDS (top-level for operator UI)
          qty,
          jobDescription,
          size,
          sides: resolvedPrintSides,
          media,
          mediaLabel: media,
          optionRows: lineItemDisplay.optionRows,
          finishingRequirements: lineItemDisplay.finishingRequirements,
          lamination: lineItemDisplay.lamination,
          productionSpecs: {
            orderedQuantity: qty,
            widthIn: Number(width) || null,
            heightIn: Number(height) || null,
            printSides: resolvedPrintSides,
            material: media,
            optionRows: lineItemDisplay.optionRows,
            finishingRequirements: lineItemDisplay.finishingRequirements,
          },
          productionLayout,
          finishingMode: config.finishingMode,
          productionAlerts: productionAlertList,
          printerOptions,
          assignedPrinterId: job.assignedPrinterId ?? null,
          assignedPrinterName: job.assignedPrinterName ?? null,
          assignedPrinterByUserId: job.assignedPrinterByUserId ?? null,
          assignedPrinterAt: job.assignedPrinterAt ? new Date(job.assignedPrinterAt as any).toISOString() : null,
          // Convenience top-level order context
          orderNumber: order.orderNumber,
          displayNumber: order.displayNumber,
          numberCore: order.numberCore,
          customerName: String(order.customerName || "—"),
          dueDate: order.dueDate ?? null,
          priority: order.priority ?? null,
          // Production ticket fields
          contactName,
          assignedTo,
          internalNotes: order.notesInternal ?? null,
          productionNotes: primaryLineItem?.productionNotes ?? null,
          poNumber: order.poNumber ?? null,
          fulfillment: mapFulfillmentLabel(order.shippingMethod),
          // Convenience top-level artwork (same list used in order.artwork)
          artwork,
          productionFiles,
          order: {
            id: orderId,
            orderNumber: order.orderNumber,
            displayNumber: order.displayNumber,
            numberCore: order.numberCore,
            customerName: String(order.customerName || "—"),
            contactName,
            poNumber: order.poNumber ?? null,
            fulfillment: mapFulfillmentLabel(order.shippingMethod),
            dueDate: order.dueDate,
            priority: order.priority,
            fulfillmentStatus: order.fulfillmentStatus,
            routingTarget: order.routingTarget,
            internalNotes: order.notesInternal ?? null,
            lineItems: {
              count: lineItems.length,
              totalQuantity: lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0),
              primary: primaryLineItem,
              items: lineItems.slice(0, 20),
            },
            artwork,
            productionFiles,
            sides: artworkBasedSides,
          },
          otherJobsInOrder,
          events,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });

      // DEV-only: Log once to verify payload counts (no secrets)
      if (process.env.NODE_ENV === "development") {
        const g: any = global as any;
        if (!g.__dev_logged_production_job_detail_payload) {
          g.__dev_logged_production_job_detail_payload = true;
          console.log("[DEV][GET /api/production/jobs/:jobId] OK", {
            jobId,
            organizationId,
            artworkCount: Array.isArray(artwork) ? artwork.length : 0,
            productionFileCount: productionFiles.length,
            otherJobsInOrderCount: Array.isArray(otherJobsInOrder) ? otherJobsInOrder.length : 0,
          });
        }
      }
    } catch (error: any) {
      if (process.env.NODE_ENV === "development") {
        console.error("[DEV] Error in GET /api/production/jobs/:jobId", {
          jobId: String(req?.params?.jobId || ""),
          organizationId: getRequestOrganizationId(req),
          message: String(error?.message || error),
          stack: String(error?.stack || ""),
        });
      } else {
        console.error("Error fetching production job:", String(error?.message || error));
      }
      res.status(500).json({ error: "Failed to fetch production job" });
    }
  });

  // 2) POST /api/production/jobs/from-order/:orderId
  // HARD DEPRECATED: Order-level production is no longer supported.
  app.post("/api/production/jobs/from-order/:orderId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const orderId = req.params.orderId;
      console.warn(
        `[ProductionDeprecated] Attempted order-level job creation for orderId=${orderId}. Order-level production is deprecated; use line-item status routing.`,
      );
      res.status(410).json({
        error: "Order-level production is deprecated. Production jobs are created per line item via status routing.",
      });
    } catch (error) {
      console.error("Error creating production job:", error);
      res.status(500).json({ error: "Failed to create production job" });
    }
  });

  // 2b) POST /api/production/jobs/:jobId/routing (explicit override)
  // This is the ONLY supported way to change station_key/step_key after a job exists.
  app.post(
    "/api/production/jobs/:jobId/routing",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const bodySchema = z
          .object({
            stationKey: z.string().min(1),
            stepKey: z.string().min(1),
            reason: z.string().optional(),
          })
          .strict();

        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid routing override" });

        const jobId = String(req.params.jobId);
        const nextStationKey = parsed.data.stationKey.trim();
        const nextStepKey = parsed.data.stepKey.trim();

        const result = await db.transaction(async (tx) => {
          const rows = await tx
            .select({
              id: productionJobs.id,
              orderId: productionJobs.orderId,
              lineItemId: productionJobs.lineItemId,
              stationKey: productionJobs.stationKey,
              stepKey: productionJobs.stepKey,
              status: productionJobs.status,
            })
            .from(productionJobs)
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
            .limit(1);

          const job = rows[0];
          if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });

          // If station is changing and line item is linked, use canonical close/create
          const stationChanging = job.stationKey !== nextStationKey;
          if (stationChanging && job.lineItemId) {
            const { transitionToStation } = await import("../services/productionOwnership");
            const transition = await transitionToStation(tx, {
              organizationId,
              orderId: job.orderId,
              lineItemId: job.lineItemId,
              targetStationKey: nextStationKey,
              targetStepKey: nextStepKey,
              reason: parsed.data.reason ?? "admin_routing_override",
              actorUserId: getUserId(req.user) ?? null,
            });

            // Return the newly created job
            const newRows = await tx
              .select({
                id: productionJobs.id,
                orderId: productionJobs.orderId,
                lineItemId: productionJobs.lineItemId,
                stationKey: productionJobs.stationKey,
                stepKey: productionJobs.stepKey,
                status: productionJobs.status,
                updatedAt: productionJobs.updatedAt,
              })
              .from(productionJobs)
              .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, transition.createdJobId)))
              .limit(1);

            return newRows[0];
          }

          // Same station, step change only — update in place
          await tx
            .update(productionJobs)
            .set({
              stationKey: nextStationKey,
              stepKey: nextStepKey,
              updatedAt: new Date(),
            })
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

          await appendEvent({
            tx,
            organizationId,
            productionJobId: jobId,
            type: "routing_override",
            actorUserId: getUserId(req.user) ?? null,
            payload: {
              from: { stationKey: job.stationKey, stepKey: job.stepKey },
              to: { stationKey: nextStationKey, stepKey: nextStepKey },
              reason: parsed.data.reason ?? null,
            },
          });

          const updatedRows = await tx
            .select({
              id: productionJobs.id,
              orderId: productionJobs.orderId,
              lineItemId: productionJobs.lineItemId,
              stationKey: productionJobs.stationKey,
              stepKey: productionJobs.stepKey,
              status: productionJobs.status,
              updatedAt: productionJobs.updatedAt,
            })
            .from(productionJobs)
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
            .limit(1);

          return updatedRows[0];
        });

        res.json({ success: true, data: result });
      } catch (error: any) {
        const status = error?.statusCode || 500;
        console.error("Error overriding production routing:", error);
        res.status(status).json({ error: error?.message || "Failed to override routing" });
      }
    },
  );

  // 2c) PATCH /api/production/jobs/:jobId/printer-assignment
  app.patch("/api/production/jobs/:jobId/printer-assignment", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const bodySchema = z
        .object({
          assignedPrinterId: z.string().trim().max(120).optional().nullable(),
          assignedPrinterName: z.string().trim().max(120).optional().nullable(),
        })
        .strict();

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const printerName = String(parsed.data.assignedPrinterName ?? "").trim();
      const printerId = String(parsed.data.assignedPrinterId ?? "").trim();
      if (!printerName && !printerId) {
        return res.status(400).json({ error: "Printer / Machine is required" });
      }

      const jobId = String(req.params.jobId || "");
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: productionJobs.id,
            orderId: productionJobs.orderId,
            lineItemId: productionJobs.lineItemId,
            assignedPrinterId: productionJobs.assignedPrinterId,
            assignedPrinterName: productionJobs.assignedPrinterName,
          })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);

        const job = rows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });

        await tx
          .update(productionJobs)
          .set({
            assignedPrinterId: printerId || null,
            assignedPrinterName: printerName || printerId,
            assignedPrinterByUserId: userId ?? null,
            assignedPrinterAt: now,
            updatedAt: now,
          })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "printer_assigned",
          actorUserId: userId ?? null,
          payload: {
            from: {
              assignedPrinterId: job.assignedPrinterId ?? null,
              assignedPrinterName: job.assignedPrinterName ?? null,
            },
            to: {
              assignedPrinterId: printerId || null,
              assignedPrinterName: printerName || printerId,
            },
          },
        });

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error assigning production printer:", error);
      res.status(status).json({ error: error?.message || "Failed to assign printer" });
    }
  });

  const bulkProductionSelectionSchema = z.object({
    station: z.enum(["flatbed", "roll"]),
    jobIds: z.array(z.string().trim().min(1)).min(1).max(100),
  });

  const bulkActiveStatusSchema = bulkProductionSelectionSchema.extend({
    status: z.enum(["queued", "in_progress", "done"]),
  });
  const returnToPrepressSchema = bulkProductionSelectionSchema.extend({
    reason: z.string().trim().min(1).max(2000).optional(),
  });
  const bulkPrinterAssignmentSchema = bulkProductionSelectionSchema.extend({
    assignedPrinterId: z.string().trim().max(120).optional().nullable(),
    assignedPrinterName: z.string().trim().max(120).optional().nullable(),
  });

  const loadAndValidateBulkJobs = async (
    tx: any,
    args: { organizationId: string; jobIds: string[]; station: "flatbed" | "roll"; allowedStatuses: string[]; action: string },
  ) => {
    const jobs = await tx
      .select()
      .from(productionJobs)
      .where(and(eq(productionJobs.organizationId, args.organizationId), inArray(productionJobs.id, args.jobIds)))
      .for("update");

    const validation = validateProductionBulkSelection({
      jobIds: args.jobIds,
      jobs,
      station: args.station,
      allowedStatuses: args.allowedStatuses,
    });
    if (!validation.ok) {
      throw Object.assign(new Error("One or more selected jobs are no longer eligible for this station."), {
        statusCode: 422,
        code: "invalid_bulk_selection",
      });
    }

    const activeRunMember = await tx
      .select({ productionJobId: productionRunMembers.productionJobId })
      .from(productionRunMembers)
      .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
      .where(and(
        eq(productionRunMembers.organizationId, args.organizationId),
        inArray(productionRunMembers.productionJobId, args.jobIds),
        inArray(productionRuns.status, [...ACTIVE_PRODUCTION_RUN_STATUSES]),
        sql`coalesce(${productionRunMembers.remainingQuantity}, 0) > 0`,
      ))
      .limit(1);
    if (activeRunMember.length > 0) {
      throw Object.assign(new Error("A selected job is owned by an active Combined Run."), {
        statusCode: 409,
        code: "bulk_selection_owned_by_active_run",
      });
    }

    for (const job of jobs) {
      await assertParentOrderInProductionForJob(tx, {
        organizationId: args.organizationId,
        job,
        action: args.action,
      });
    }
    return jobs;
  };

  // Starts independent queued jobs together; no run or nesting record is created.
  app.post("/api/production/jobs/return-to-prepress", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      if (!userId) return res.status(401).json({ error: "User ID not found" });
      const parsed = returnToPrepressSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });
      const jobIds = dedupeProductionJobIds(parsed.data.jobIds);
      if (jobIds.length > MAX_PRODUCTION_BULK_ITEMS) return res.status(400).json({ error: `A maximum of ${MAX_PRODUCTION_BULK_ITEMS} jobs can be returned to Prepress at once.` });
      const jobs = await canonicalPrepressOperations.returnProductionJobs({
        organizationId,
        actorUserId: userId,
        station: parsed.data.station,
        jobIds,
        reason: parsed.data.reason || "Return to Prepress requested from production board",
      });
      return res.json({ success: true, data: {
        requestedItemCount: parsed.data.jobIds.length,
        uniqueItemCount: jobIds.length,
        restoredItemCount: jobs.length,
        restoredJobIds: jobs.map((job) => job.prepressJobId),
        previousJobIds: jobs.map((job) => job.previousJobId),
      } });
    } catch (error: any) {
      const status = error instanceof ReturnToPrepressError ? error.statusCode : error?.statusCode || 500;
      return res.status(status).json({
        error: error?.message || "Failed to return selected jobs to Prepress",
        code: error instanceof ReturnToPrepressError ? error.code : error?.code,
      });
    }
  });

  app.post("/api/production/jobs/bulk-start", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const parsed = bulkProductionSelectionSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });
      const jobIds = dedupeProductionJobIds(parsed.data.jobIds);
      if (jobIds.length > MAX_PRODUCTION_BULK_ITEMS) return res.status(400).json({ error: `A maximum of ${MAX_PRODUCTION_BULK_ITEMS} jobs can be started at once.` });

      const updated = await db.transaction(async (tx) => {
        await loadAndValidateBulkJobs(tx, {
          organizationId,
          jobIds,
          station: parsed.data.station,
          allowedStatuses: ["queued"],
          action: "bulk start production jobs",
        });
        const results = [];
        for (const jobId of jobIds) {
          results.push(await canonicalProductionOperations.startJobInTransaction(tx, {
            organizationId,
            actorUserId: getUserId(req.user) ?? null,
            jobId,
          }));
        }
        return results;
      });

      return res.json({ success: true, data: {
        requestedItemCount: parsed.data.jobIds.length,
        uniqueItemCount: jobIds.length,
        updatedItemCount: updated.length,
        updatedJobIds: updated.map((job) => job.id),
        status: "in_progress",
        runId: null,
      } });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({
        error: error?.message || "Failed to start selected production jobs",
        code: error?.code,
      });
    }
  });

  app.patch("/api/production/jobs/bulk-status", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      const parsed = bulkActiveStatusSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });
      if (parsed.data.status === "done" && !userId) return res.status(401).json({ error: "User ID not found" });
      const jobIds = dedupeProductionJobIds(parsed.data.jobIds);
      if (jobIds.length > MAX_PRODUCTION_BULK_ITEMS) return res.status(400).json({ error: `A maximum of ${MAX_PRODUCTION_BULK_ITEMS} jobs can be updated at once.` });

      const updated = await db.transaction(async (tx) => {
        await loadAndValidateBulkJobs(tx, {
          organizationId,
          jobIds,
          station: parsed.data.station,
          allowedStatuses: ["in_progress", "paused"],
          action: "bulk update production job status",
        });
        const results = [];
        for (const jobId of jobIds) {
          results.push(await (parsed.data.status === "done"
            ? completeProductionJobWorkflow(tx, {
              organizationId,
              userId: userId!,
              jobId,
              skipProduction: "auto",
              auditUserName: req.user?.email || req.user?.name || null,
              ipAddress: req.ip || null,
              userAgent: req.headers["user-agent"] || null,
            })
            : updateProductionJobStatusWorkflow(tx, {
              organizationId,
              userId: userId ?? null,
              jobId,
              status: parsed.data.status,
              auditUserName: req.user?.email || req.user?.name || null,
              ipAddress: req.ip || null,
              userAgent: req.headers["user-agent"] || null,
            })));
        }
        return results;
      });

      return res.json({ success: true, data: {
        requestedItemCount: parsed.data.jobIds.length,
        uniqueItemCount: jobIds.length,
        updatedItemCount: updated.length,
        updatedJobIds: updated.map((job) => job.id),
        status: parsed.data.status,
        runId: null,
      } });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({
        error: error?.message || "Failed to update selected production jobs",
        code: error?.code,
      });
    }
  });

  // Assign one printer/machine to a validated batch in a single transaction.
  // This intentionally shares the same tenant, routing, and event guarantees as
  // the individual assignment endpoint rather than issuing client-side loops.
  app.patch("/api/production/jobs/bulk-printer-assignment", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const parsed = bulkPrinterAssignmentSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      const printerName = String(parsed.data.assignedPrinterName ?? "").trim();
      const printerId = String(parsed.data.assignedPrinterId ?? "").trim();
      if (!printerName && !printerId) return res.status(400).json({ error: "Printer / Machine is required" });

      const jobIds = dedupeProductionJobIds(parsed.data.jobIds);
      if (jobIds.length > MAX_PRODUCTION_BULK_ITEMS) return res.status(400).json({ error: `A maximum of ${MAX_PRODUCTION_BULK_ITEMS} jobs can be assigned at once.` });
      const userId = getUserId(req.user) ?? null;
      const assignedPrinterName = printerName || printerId;

      const updated = await db.transaction(async (tx) => {
        const jobs = await loadAndValidateBulkJobs(tx, {
          organizationId,
          jobIds,
          station: parsed.data.station,
          allowedStatuses: ["queued", "in_progress", "paused"],
          action: "bulk assign production printer",
        });
        const now = new Date();
        for (const job of jobs) {
          await tx
            .update(productionJobs)
            .set({
              assignedPrinterId: printerId || null,
              assignedPrinterName,
              assignedPrinterByUserId: userId,
              assignedPrinterAt: now,
              updatedAt: now,
            })
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, job.id)));
          await appendEvent({
            tx,
            organizationId,
            productionJobId: job.id,
            type: "printer_assigned",
            actorUserId: userId,
            payload: {
              from: {
                assignedPrinterId: job.assignedPrinterId ?? null,
                assignedPrinterName: job.assignedPrinterName ?? null,
              },
              to: { assignedPrinterId: printerId || null, assignedPrinterName },
            },
          });
        }
        return jobs;
      });

      return res.json({ success: true, data: {
        requestedItemCount: parsed.data.jobIds.length,
        uniqueItemCount: jobIds.length,
        updatedItemCount: updated.length,
        updatedJobIds: updated.map((job) => job.id),
        assignedPrinterId: printerId || null,
        assignedPrinterName,
      } });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({
        error: error?.message || "Failed to assign the selected printer / machine",
        code: error?.code,
      });
    }
  });

  // 3) POST /api/production/jobs/:jobId/start
  app.post("/api/production/jobs/:jobId/start", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const result = await canonicalProductionOperations.startJob({
        organizationId,
        actorUserId: userId ?? null,
        jobId,
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error starting production timer:", error);
      res.status(status).json({ error: error?.message || "Failed to start timer" });
    }
  });

  // 4) POST /api/production/jobs/:jobId/stop
  app.post("/api/production/jobs/:jobId/stop", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });

        const lastStartRows = await tx
          .select({ createdAt: productionEvents.createdAt, type: productionEvents.type })
          .from(productionEvents)
          .where(
            and(
              eq(productionEvents.organizationId, organizationId),
              eq(productionEvents.productionJobId, jobId),
              inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
            ),
          )
          .orderBy(desc(productionEvents.createdAt))
          .limit(1);

        const last = lastStartRows[0];
        if (!last || last.type !== "timer_started") {
          return job;
        }

        const startedAtMs = new Date(last.createdAt as any).getTime();
        const deltaSeconds = toSeconds(now.getTime() - startedAtMs);

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "timer_stopped",
          actorUserId: userId ?? null,
          payload: { seconds: deltaSeconds },
        });

        await tx
          .update(productionJobs)
          .set({
            totalSeconds: (Number(job.totalSeconds) || 0) + deltaSeconds,
            updatedAt: now,
          })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error stopping production timer:", error);
      res.status(status).json({ error: error?.message || "Failed to stop timer" });
    }
  });

  // 5) POST /api/production/jobs/:jobId/complete
  app.post("/api/production/jobs/:jobId/complete", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const jobId = req.params.jobId;
      const skipProduction = req.body?.skipProduction === true;

      const completedJob = await db.transaction((tx) => completeProductionJobWorkflow(tx, {
        organizationId,
        userId,
        jobId,
        skipProduction,
        auditUserName: req.user?.email || req.user?.name || null,
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      }));

      if (completedJob?.orderId && completedJob?.nextStationKey === FULFILLMENT_STATION_KEY) {
        const { applyWorkflowStatusPillFailSoft } = await import("../services/workflowStatusPillService");
        await applyWorkflowStatusPillFailSoft({
          organizationId,
          orderId: completedJob.orderId,
          triggerKey: "sent_to_fulfillment",
          actorUserId: userId,
          source: "system",
          reason: "Production completion routed work to fulfillment",
          metadata: {
            workflowEvent: "sent_to_fulfillment",
            productionJobId: completedJob.id,
            lineItemId: completedJob.lineItemId,
            previousStationKey: completedJob.stationKey,
          },
        });
      }
      if (completedJob?.orderId && String(completedJob?.stationKey ?? "").toLowerCase() === FULFILLMENT_STATION_KEY) {
        const [remaining] = await db
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(
            eq(productionJobs.organizationId, organizationId),
            eq(productionJobs.orderId, completedJob.orderId),
            sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`,
          ))
          .limit(1);
        if (!remaining) {
          const { applyWorkflowStatusPillFailSoft } = await import("../services/workflowStatusPillService");
          await applyWorkflowStatusPillFailSoft({
            organizationId,
            orderId: completedJob.orderId,
            triggerKey: "production_completed",
            actorUserId: userId,
            source: "system",
            reason: "All production and fulfillment work completed",
            metadata: {
              workflowEvent: "production_completed",
              productionJobId: completedJob.id,
              lineItemId: completedJob.lineItemId,
            },
          });
        }
      }

      return res.json({ success: true, data: completedJob, message: "Production job completed" });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error completing production job:", error);
      res.status(status).json({ error: error?.message || "Failed to complete job" });
    }
  });

  app.post(["/api/production-jobs/:jobId/undo-complete", "/api/production/jobs/:jobId/undo-complete"], isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, data: null, message: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, data: null, message: "User ID not found" });

      const jobId = String(req.params.jobId || "");
      const parsed = z.object({ reason: z.string().max(500).optional().nullable() }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, data: null, message: fromZodError(parsed.error).message });
      }

      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);

        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        if (!job.completedAt || job.status !== "done") {
          throw Object.assign(new Error("Only completed production jobs can be restored"), { statusCode: 409 });
        }
        if (!job.previousStatus) {
          throw Object.assign(new Error("Missing completion recovery metadata"), { statusCode: 409 });
        }

        const restoreUntilMs = job.restoreUntil ? new Date(job.restoreUntil as any).getTime() : Number.NaN;
        if (!Number.isFinite(restoreUntilMs) || restoreUntilMs <= now.getTime()) {
          throw Object.assign(new Error("The undo window for this production job has expired"), { statusCode: 409 });
        }

        const restoredStatus = String(job.previousStatus || "").trim() || "in_progress";
        const restoredStation = String(job.previousStation || "").trim() || job.stationKey;

        const fulfillmentRows = job.lineItemId
          ? await tx
            .select({
              id: productionJobs.id,
              status: productionJobs.status,
            })
            .from(productionJobs)
            .where(and(
              eq(productionJobs.organizationId, organizationId),
              eq(productionJobs.lineItemId, job.lineItemId),
              eq(productionJobs.stationKey, FULFILLMENT_STATION_KEY),
              inArray(productionJobs.status as any, ["queued", "in_progress", "paused"]),
            ))
          : [];

        const fulfillmentJobIds = fulfillmentRows.map((row) => row.id);
        const createdByCompletionRows = fulfillmentJobIds.length > 0
          ? await tx
            .select({ productionJobId: productionEvents.productionJobId })
            .from(productionEvents)
            .where(and(
              eq(productionEvents.organizationId, organizationId),
              inArray(productionEvents.productionJobId, fulfillmentJobIds),
              eq(productionEvents.type, "intake"),
              sql`${productionEvents.payload}->>'previousJobId' = ${jobId}`,
            ))
          : [];
        const fulfillmentJobsToCancel = new Set(createdByCompletionRows.map((row) => row.productionJobId));

        if (fulfillmentJobsToCancel.size > 0) {
          const ids = Array.from(fulfillmentJobsToCancel);
          await tx
            .update(productionJobs)
            .set({ status: "canceled", updatedAt: now })
            .where(and(eq(productionJobs.organizationId, organizationId), inArray(productionJobs.id, ids)));

          for (const canceledJobId of ids) {
            await appendEvent({
              tx,
              organizationId,
              productionJobId: canceledJobId,
              type: "note",
              actorUserId: userId,
              payload: {
                eventType: "fulfillment_successor_cancelled_by_undo",
                restoredProductionJobId: jobId,
              },
            });
          }
        }

        await tx
          .update(productionJobs)
          .set({
            status: restoredStatus,
            stationKey: restoredStation,
            completedAt: null,
            restoreUntil: null,
            restoredAt: now,
            restoredByUserId: userId,
            restoreReason: parsed.data.reason?.trim() || null,
            updatedAt: now,
          })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        if (job.orderId) {
          await restoreOrderProductionStateAfterUndo(tx, {
            organizationId,
            orderId: job.orderId,
            actorUserId: userId,
            productionJobId: jobId,
          });
        }

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "note",
          actorUserId: userId,
          payload: {
            eventType: "production_job_completion_restored",
            restoredStatus,
            restoredStation,
            canceledFulfillmentJobIds: Array.from(fulfillmentJobsToCancel),
            reason: parsed.data.reason?.trim() || null,
          },
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "production_job",
          entityId: jobId,
          entityName: jobId,
          description: "Production job completion undone",
          oldValues: { status: job.status, stationKey: job.stationKey, completedAt: toIso(job.completedAt) },
          newValues: { status: restoredStatus, stationKey: restoredStation, restoredAt: now.toISOString() },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const [updated] = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);

        return {
          job: updated,
          canceledFulfillmentJobIds: Array.from(fulfillmentJobsToCancel),
        };
      });

      return res.json({
        success: true,
        data: result,
        message: "Production job restored to its previous station",
      });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error undoing production completion:", error);
      return res.status(status).json({
        success: false,
        data: null,
        message: error?.message || "Failed to undo production completion",
      });
    }
  });

  app.post("/api/production/jobs/:jobId/recover-legacy-completion", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      if (!isAdminOrOwner(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      const userId = getUserId(req.user);
      if (!organizationId || !userId) return res.status(401).json({ success: false, message: "User is not authenticated" });
      const parsed = z.object({ reason: z.string().trim().min(1).max(2000) }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ success: false, message: fromZodError(parsed.error).message });
      const jobId = String(req.params.jobId || "");
      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select({ job: productionJobs, order: orders }).from(productionJobs)
          .innerJoin(orders, eq(orders.id, productionJobs.orderId))
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId))).limit(1);
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        if (job.job.status !== "done" || !job.job.completedAt) throw Object.assign(new Error("Only completed production jobs can use legacy recovery"), { statusCode: 409 });
        const [runMember] = await tx.select({ runId: productionRuns.id, runNumber: productionRuns.runNumber }).from(productionRunMembers)
          .innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
          .where(and(eq(productionRunMembers.organizationId, organizationId), eq(productionRunMembers.productionJobId, jobId))).limit(1);
        if (runMember) throw Object.assign(new Error(`Job belongs to Combined Run PR-${String(runMember.runNumber).padStart(4, "0")}; recover the complete run instead.`), { statusCode: 409, code: "COMBINED_RUN_RECOVERY_REQUIRED", runId: runMember.runId });
        if (["shipped", "delivered"].includes(String(job.order.fulfillmentStatus ?? "").toLowerCase())) throw Object.assign(new Error("Recovery is blocked because fulfillment has already been shipped or delivered."), { statusCode: 409 });
        if (job.job.lineItemId) {
          const [activeReprint] = await tx.select({ id: reprintRequests.id }).from(reprintRequests).where(and(eq(reprintRequests.organizationId, organizationId), eq(reprintRequests.lineItemId, job.job.lineItemId), inArray(reprintRequests.status, ["open", "acknowledged"]))).limit(1);
          if (activeReprint) throw Object.assign(new Error("Recovery is blocked by an active reprint request."), { statusCode: 409 });
          const [activeOwner] = await tx.select({ id: productionJobs.id }).from(productionJobs).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.lineItemId, job.job.lineItemId), sql`${productionJobs.id} <> ${jobId}`, sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`)).limit(1);
          if (activeOwner) throw Object.assign(new Error("Recovery is blocked because another active production workflow owns this line."), { statusCode: 409 });
        }
        const now = new Date();
        const restoredStatus = String(job.job.previousStatus || "in_progress");
        const restoredStation = String(job.job.previousStation || job.job.stationKey);
        await tx.update(productionJobs).set({ status: restoredStatus, stationKey: restoredStation, completedAt: null, completedByUserId: null, restoreUntil: null, restoredAt: now, restoredByUserId: userId, restoreReason: parsed.data.reason, updatedAt: now }).where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
        await restoreOrderProductionStateAfterUndo(tx, { organizationId, orderId: job.job.orderId, actorUserId: userId, productionJobId: jobId });
        await appendEvent({ tx, organizationId, productionJobId: jobId, type: "note", actorUserId: userId, payload: { eventType: "legacy_production_completion_recovered", reason: parsed.data.reason, restoredStatus, restoredStation } });
        await tx.insert(auditLogs).values({ organizationId, userId, userName: req.user?.email || req.user?.name || null, actionType: "UPDATE", entityType: "production_job", entityId: jobId, entityName: jobId, description: "Legacy production completion recovered", oldValues: { status: job.job.status, completedAt: toIso(job.job.completedAt) }, newValues: { status: restoredStatus, stationKey: restoredStation, reason: parsed.data.reason }, ipAddress: req.ip || null, userAgent: req.headers["user-agent"] || null } as any);
        return { restoredJobId: jobId, restoredStatus, restoredStation, duplicateSessionCheck: "no_active_line_owner_before_restore" };
      });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ success: false, code: error?.code || "LEGACY_RECOVERY_FAILED", message: error?.message || "Unable to recover legacy production completion" });
    }
  });

  // 6) POST /api/production/jobs/:jobId/reopen
  app.post("/api/production/jobs/:jobId/reopen", isAuthenticated, tenantContext, async (req: any, res) => {
    // The former implementation only changed this job row, leaving its line,
    // order, combined-run membership, and fulfillment successors unchanged.
    // Keep recovery on the guarded undo, legacy-recovery, or combined-run flows.
    return res.status(409).json({
      code: "RECOVERY_WORKFLOW_REQUIRED",
      error: "Direct production-job reopen is unavailable. Use the supported completion recovery workflow.",
    });
  });

  // 7) POST /api/production/jobs/:jobId/reprint
  app.post("/api/production/jobs/:jobId/reprint", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      const jobId = req.params.jobId;

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({
            id: productionJobs.id,
            status: productionJobs.status,
            orderId: productionJobs.orderId,
            lineItemId: productionJobs.lineItemId,
            orderState: orders.state,
            orderStatus: orders.status,
            orderCanceledAt: orders.canceledAt,
          })
          .from(productionJobs)
          .innerJoin(orders, eq(orders.id, productionJobs.orderId))
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const ticketJob = jobRows[0];
        if (!ticketJob) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        if (
          isTerminalProductionStatus(ticketJob.status) ||
          isCanceledOrder({ state: ticketJob.orderState, status: ticketJob.orderStatus, canceledAt: ticketJob.orderCanceledAt })
        ) {
          throw Object.assign(new Error("Cancelled or terminal production jobs cannot be printed as active tickets."), { statusCode: 409 });
        }
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "reprint_incremented",
          actorUserId: userId ?? null,
        });
        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error recording reprint:", error);
      res.status(status).json({ error: error?.message || "Failed to record reprint" });
    }
  });

  // 7b) POST /api/production/jobs/:jobId/ticket-print
  // Basic print-history logging for production tickets. Records a
  // `ticket_printed` production event so the timeline shows who printed a
  // ticket and why (initial print vs. reprint vs. completion ticket).
  // Best-effort: this should never block the operator from printing, so the
  // client treats failures as non-fatal.
  app.post("/api/production/jobs/:jobId/ticket-print", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      const jobId = String(req.params.jobId || "");

      // Snapshot metadata from the Print Options modal (all optional). The
      // fast "Print Ticket" path sends only `reason`.
      const metaSchema = z
        .object({
          reason: z.enum(["print", "standard", "reprint", "completion", "partial", "test"]).optional(),
          destination: z.string().max(120).optional(),
          quantityDisplay: z.string().max(60).optional(),
          fulfillment: z.string().max(60).optional(),
          route: z.string().max(60).optional(),
          note: z.string().max(500).optional(),
        })
        .safeParse(req.body ?? {});
      const meta = metaSchema.success ? metaSchema.data : {};
      const reason = meta.reason ?? "print";

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        if (!jobRows[0]) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "ticket_printed",
          actorUserId: userId ?? null,
          payload: {
            reason,
            destination: meta.destination ?? null,
            quantityDisplay: meta.quantityDisplay ?? null,
            fulfillment: meta.fulfillment ?? null,
            route: meta.route ?? null,
            note: meta.note ?? null,
            printedAt: new Date().toISOString(),
          },
        });
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error logging ticket print:", error);
      res.status(status).json({ error: error?.message || "Failed to log ticket print" });
    }
  });

  // PROMPT E: POST /api/production/line-item/:lineItemId/reprint
  // Creates a detailed reprint request record from the production board.
  app.post("/api/production/line-item/:lineItemId/reprint", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const { lineItemId } = req.params;

      const bodySchema = z.object({
        fileId: z.string().optional(),
        filename: z.string().trim().min(1, "Filename required").max(512),
        quantity: z.coerce.number().positive("Quantity must be greater than 0"),
        units: z.string().trim().min(1, "Units required").max(64),
        reason: z.string().trim().min(1, "Reason required").max(2000),
        noPrintsCompletedYet: z.boolean().optional().default(false),
      });
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      const { fileId, filename, quantity, units, reason, noPrintsCompletedYet } = parsed.data;

      // Verify line item belongs to this org
      const [lineItem] = await db
        .select({ id: orderLineItems.id, orderId: orderLineItems.orderId })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);
      if (!lineItem) return res.status(404).json({ error: "Line item not found" });

      // Insert reprint request
      const [reprintReq] = await db
        .insert(reprintRequests)
        .values({
          organizationId,
          lineItemId,
          fileId: fileId || null,
          filename,
          quantity: String(quantity),
          units,
          reason,
          noPrintsCompletedYet: noPrintsCompletedYet ?? false,
          createdByUserId: userId,
          status: 'open',
        })
        .returning({ id: reprintRequests.id });

      // Audit log
      await db.insert(auditLogs).values({
        organizationId,
        userId,
        userName: (req.user as any)?.email || (req.user as any)?.name || null,
        actionType: "CREATE",
        entityType: "reprint_request",
        entityId: reprintReq?.id || lineItemId,
        entityName: `Reprint – ${filename}`,
        description: "Reprint request created from production board",
        newValues: { filename, quantity, units, reason, noPrintsCompletedYet },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      } as any);

      res.json({ success: true, data: { id: reprintReq?.id } });
    } catch (error: any) {
      console.error("[Reprint Request] Error:", error);
      res.status(500).json({ error: error?.message || "Failed to create reprint request" });
    }
  });

  // 8) PUT /api/production/jobs/:jobId/media-used
  app.put("/api/production/jobs/:jobId/media-used", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const mediaSchema = z.object({
        text: z.string().trim().min(1).max(500),
        qty: z.coerce.number().optional(),
        unit: z.string().trim().max(32).optional(),
        comment: z.string().trim().min(1, "Reason is required").max(2000),
      });
      const parsed = mediaSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        if (!jobRows[0]) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "media_used_set",
          actorUserId: userId ?? null,
          payload: parsed.data,
        });
        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error setting media used:", error);
      res.status(status).json({ error: error?.message || "Failed to set media used" });
    }
  });

  // Extra (timeline): POST /api/production/jobs/:jobId/note
  app.post("/api/production/jobs/:jobId/note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const noteSchema = z.object({ text: z.string().trim().min(1).max(1000) });
      const parsed = noteSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        if (!jobRows[0]) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "note",
          actorUserId: userId ?? null,
          payload: { text: parsed.data.text, actorUserId: userId ?? null },
        });
        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error adding production note:", error);
      res.status(status).json({ error: error?.message || "Failed to add note" });
    }
  });

  // PATCH /api/production/notes/:noteId - Notes are append-only; add a new note instead.
  app.patch("/api/production/notes/:noteId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      return res.status(409).json({ error: "Production notes are append-only. Add a new note instead." });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error editing production note:", error);
      res.status(status).json({ error: error?.message || "Failed to edit note" });
    }
  });

  // DELETE /api/production/notes/:noteId - Notes are append-only and cannot be deleted.
  app.delete("/api/production/notes/:noteId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      return res.status(409).json({ error: "Production notes are append-only and cannot be deleted." });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error deleting production note:", error);
      res.status(status).json({ error: error?.message || "Failed to delete note" });
    }
  });

  // 9) PATCH /api/production/jobs/:jobId/status - Inline status update (queued/in_progress/done)
  app.patch("/api/production/jobs/:jobId/status", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const statusSchema = z.object({
        status: productionStatusSchema,
        stepKey: z.string().nullable().optional(),
      });
      const parsed = statusSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      const newStatus = parsed.data.status;
      const newStepKey = parsed.data.stepKey !== undefined ? parsed.data.stepKey : undefined;

      if (newStatus === "done") {
        if (!userId) return res.status(401).json({ error: "User ID not found" });
        const completedJob = await db.transaction((tx) => completeProductionJobWorkflow(tx, {
          organizationId,
          userId,
          jobId,
          skipProduction: "auto",
          auditUserName: req.user?.email || req.user?.name || null,
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        }));
        return res.json({ success: true, data: completedJob, message: "Production job completed" });
      }

      const result = await db.transaction((tx) => updateProductionJobStatusWorkflow(tx, {
        organizationId,
        userId: userId ?? null,
        jobId,
        status: newStatus,
        stepKey: newStepKey,
        auditUserName: req.user?.email || req.user?.name || null,
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      }));

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error updating production job status:", error);
      res.status(status).json({ error: error?.message || "Failed to update status" });
    }
  });
}
