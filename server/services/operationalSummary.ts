/**
 * operationalSummary.ts
 *
 * Canonical operational counts aggregation for the TitanOS sidebar badges.
 * One function, parallel count queries, one response shape.
 *
 * Counts are derived from existing canonical workflow states only.
 * No new states are introduced, no counts are persisted.
 */

import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  inboundOrderRecords,
  invoiceEmailLogs,
  invoices,
  orderLineItems,
  orders,
  productionJobs,
} from "../../shared/schema";
import { getProductionConfigForOrganization } from "../routes/production.shared";
import { isPrepressOwnershipJob, resolveActiveProductionOwners } from "./productionOwnership";
import { stationResolver } from "./stations/stationResolver";
import { normalizeProductionStationKey } from "@shared/productionStations";
import { listProofingQueue } from "./proofingService";
import type { ProofingQueueRow } from "@shared/proofing";
import { FulfillmentDashboardRepo } from "./fulfillment/repository";
import { resolvePrepressQueueEligibility } from "./prepressQueueEligibility";
import { countDistinctActiveProductionOverviewWork, filterActiveProductionOverviewRows } from "./productionOverviewPopulation";
import { TERMINAL_PRODUCTION_STATUSES } from "@shared/operationalState";

export interface OperationalSummary {
  inboundOrders: number;
  overview: number;
  design: number;
  proofing: number;
  prepress: number;
  flatbed: number;
  roll: number;
  fulfillment: number;
  invoices: {
    /** Same server-side working set as Invoices → Ready to Finalize + Never Sent. */
    readyToFinalizeNeverSent?: number;
    pendingSend: number;
    unpaid: number;
  };
}

const CLOSED_ORDER_STATES = ["closed", "canceled", "production_complete"];

function count(rows: { count: number }[]): number {
  return rows[0]?.count ?? 0;
}

export function countAwaitingProofQueueRows(rows: Array<Pick<ProofingQueueRow, "currentQueueStatus">>): number {
  return rows.filter((row) =>
    row.currentQueueStatus === "awaiting_send" ||
    row.currentQueueStatus === "revision_requested" ||
    row.currentQueueStatus === "no_active_proof"
  ).length;
}

async function countVisibleProductionJobs(
  organizationId: string,
  stationKey?: "flatbed" | "roll",
  visibleStatuses: Array<"queued" | "in_progress" | "paused"> = ["queued", "in_progress", "paused"],
): Promise<number> {
  if (stationKey) {
    const config = await getProductionConfigForOrganization(organizationId);
    if (!config.enabledViews.includes(stationKey)) return 0;
  }

  const resolvedStationId = stationKey
    ? await stationResolver.resolveStationId({ organizationId, stationKey })
    : null;
  const stationAliases = stationKey === "roll"
    ? ["roll", "wide_roll"]
    : stationKey === "flatbed"
      ? ["flatbed"]
      : [];

  const baseRows = await db
    .select({
      id: productionJobs.id,
      lineItemId: productionJobs.lineItemId,
      status: productionJobs.status,
    })
    .from(productionJobs)
    .innerJoin(orders, eq(productionJobs.orderId, orders.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(orderLineItems, eq(productionJobs.lineItemId, orderLineItems.id))
    .where(
      and(
        eq(productionJobs.organizationId, organizationId),
        stationKey
          ? (resolvedStationId
              ? or(sql`production_jobs.station_id = ${resolvedStationId}`, inArray(productionJobs.stationKey as any, stationAliases))
              : inArray(productionJobs.stationKey as any, stationAliases))
          : undefined,
        inArray(productionJobs.status as any, visibleStatuses),
      ),
    );

  const lineItemIds = Array.from(
    new Set(
      baseRows
        .map((row) => row.lineItemId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const activeOwnerByLineItem = lineItemIds.length > 0
    ? await resolveActiveProductionOwners(db, {
        organizationId,
        lineItemIds,
        debugLabel: "operational-summary",
      })
    : new Map<string, any>();

  return baseRows.filter((row) => {
    if (!row.lineItemId) return true;

    const activeOwner = activeOwnerByLineItem.get(row.lineItemId);
    if (!activeOwner || activeOwner.id !== row.id) return false;

    if (stationKey && (stationKey === "flatbed" || stationKey === "roll") && isPrepressOwnershipJob(activeOwner)) {
      return false;
    }

    if (stationKey && normalizeProductionStationKey(activeOwner.stationKey) !== stationKey) {
      return false;
    }

    return true;
  }).length;
}

async function countCanonicalProductionOverviewJobs(organizationId: string): Promise<number> {
  // Match the Overview route's base population, then run its shared active
  // owner, grouped-run and canonical Fulfillment gates. The sidebar follows
  // the board's default "Only production" scope.
  const candidates = await db.select({
    id: productionJobs.id,
    lineItemId: productionJobs.lineItemId,
    stationKey: productionJobs.stationKey,
    status: productionJobs.status,
  }).from(productionJobs)
    .innerJoin(orders, eq(productionJobs.orderId, orders.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(and(
      eq(productionJobs.organizationId, organizationId),
      notInArray(productionJobs.status, [...TERMINAL_PRODUCTION_STATUSES]),
      sql`lower(coalesce(${productionJobs.stationKey}, '')) <> 'fulfillment'`,
    ));
  const active = await filterActiveProductionOverviewRows(organizationId, candidates);
  return countDistinctActiveProductionOverviewWork(active, true);
}

export async function computeOperationalSummary(organizationId: string): Promise<OperationalSummary> {
  // Keep this dependency lazy so the lightweight badge mapping helpers remain
  // usable in DB-free tests; the authoritative list query is needed only when
  // a live operational summary is actually computed.
  const { listInvoicesPageForOrganization } = await import("../invoicesService");
  const [
    inboundResult,
    designResult,
    proofingQueue,
    prepressEligibility,
    overviewCount,
    flatbedCount,
    rollCount,
    fulfillmentResult,
    invoiceDraftResult,
    invoiceUnpaidResult,
    readyToFinalizeNeverSentPage,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboundOrderRecords)
      .where(
        and(
          eq(inboundOrderRecords.organizationId, organizationId),
          inArray(inboundOrderRecords.status as any, ["received", "processing", "needs_review"]),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          inArray(orderLineItems.workflowState as any, ["needs_design", "in_design"]),
          notInArray(orders.state as any, CLOSED_ORDER_STATES),
        ),
      ),

    listProofingQueue(db, {
      organizationId,
      slice: "all",
    }),

    resolvePrepressQueueEligibility(db, {
      organizationId,
      debugLabel: "operational-summary-prepress",
    }),

    countCanonicalProductionOverviewJobs(organizationId),
    countVisibleProductionJobs(organizationId, "flatbed"),
    countVisibleProductionJobs(organizationId, "roll"),

    new FulfillmentDashboardRepo(db).countFulfillmentQueue(organizationId),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.isHistorical, false),
          notInArray(invoices.status as any, ["paid", "void"]),
          or(
            inArray(invoices.status as any, ["draft"]),
            and(
              inArray(invoices.status as any, ["finalized", "billed", "sent", "partially_paid", "overdue"]),
              sql`not exists (
                select 1
                from ${invoiceEmailLogs}
                where ${invoiceEmailLogs.organizationId} = ${organizationId}
                  and ${invoiceEmailLogs.invoiceId} = ${invoices.id}
                  and ${invoiceEmailLogs.type} = 'invoice_send'
                  and ${invoiceEmailLogs.status} = 'sent'
                  and ${invoiceEmailLogs.sentAt} >= ${invoices.updatedAt}
              )`,
            ),
            sql`exists (
              select 1
              from ${invoiceEmailLogs}
              where ${invoiceEmailLogs.organizationId} = ${organizationId}
                and ${invoiceEmailLogs.invoiceId} = ${invoices.id}
                and ${invoiceEmailLogs.type} = 'invoice_send'
                and ${invoiceEmailLogs.status} = 'failed'
                and (${invoices.lastSentAt} is null or ${invoiceEmailLogs.sentAt} > ${invoices.lastSentAt})
            )`,
          ),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          inArray(invoices.status as any, ["finalized", "billed", "sent", "partially_paid", "overdue"]),
        ),
      ),

    // Reuse the exact canonical invoice-list query and count authority used by
    // the staff working set. This deliberately does not infer readiness from
    // a parent state or from a bounded browser page.
    listInvoicesPageForOrganization({
      organizationId,
      limit: 1,
      offset: 0,
      includePaidHistorical: false,
      includeCanceled: false,
      columnFilters: {
        jobStatus: ["job_complete", "fulfillment_complete"],
        sendStatus: "never_sent",
      },
    }),
  ]);

  return {
    inboundOrders: count(inboundResult),
    overview: overviewCount,
    design: count(designResult),
    proofing: countAwaitingProofQueueRows(proofingQueue.rows),
    // Total eligible jobs in the default Prepress view; user filters do not affect the badge.
    prepress: prepressEligibility.lineItemIds.length,
    flatbed: flatbedCount,
    roll: rollCount,
    fulfillment: fulfillmentResult,
    invoices: {
      readyToFinalizeNeverSent: readyToFinalizeNeverSentPage.totalCount,
      pendingSend: count(invoiceDraftResult),
      unpaid: count(invoiceUnpaidResult),
    },
  };
}
