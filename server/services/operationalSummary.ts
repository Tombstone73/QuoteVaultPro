/**
 * operationalSummary.ts
 *
 * Canonical operational counts aggregation for the TitanOS sidebar badges.
 * One function, parallel count queries, one response shape.
 *
 * Counts are derived from existing canonical workflow states only.
 * No new states are introduced, no counts are persisted.
 */

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  inboundOrderRecords,
  invoices,
  orderLineItems,
  orders,
  productionJobs,
} from "../../shared/schema";
import { getProductionConfigForOrganization } from "../routes/production.shared";
import { isPrepressOwnershipJob, resolveActiveProductionOwners } from "./productionOwnership";
import { stationResolver } from "./stations/stationResolver";

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
    pendingSend: number;
    unpaid: number;
  };
}

const CLOSED_ORDER_STATES = ["closed", "canceled", "production_complete"];

function count(rows: { count: number }[]): number {
  return rows[0]?.count ?? 0;
}

async function countVisibleProductionJobs(
  organizationId: string,
  stationKey?: "flatbed" | "roll",
  visibleStatuses: Array<"queued" | "in_progress"> = ["queued", "in_progress"],
): Promise<number> {
  if (stationKey) {
    const config = await getProductionConfigForOrganization(organizationId);
    if (!config.enabledViews.includes(stationKey)) return 0;
  }

  const resolvedStationId = stationKey
    ? await stationResolver.resolveStationId({ organizationId, stationKey })
    : null;

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
              ? sql`production_jobs.station_id = ${resolvedStationId}`
              : eq(productionJobs.stationKey, stationKey))
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

    return true;
  }).length;
}

export async function computeOperationalSummary(organizationId: string): Promise<OperationalSummary> {
  const [
    inboundResult,
    designResult,
    proofingResult,
    prepressResult,
    overviewCount,
    flatbedCount,
    rollCount,
    fulfillmentResult,
    invoiceDraftResult,
    invoiceUnpaidResult,
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

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orderLineItems.workflowState as any, "awaiting_proof_approval"),
          notInArray(orders.state as any, CLOSED_ORDER_STATES),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          inArray(orderLineItems.workflowState as any, ["ready_for_prepress", "in_prepress"]),
          notInArray(orders.state as any, CLOSED_ORDER_STATES),
        ),
      ),

    countVisibleProductionJobs(organizationId),
    countVisibleProductionJobs(organizationId, "flatbed", ["in_progress"]),
    countVisibleProductionJobs(organizationId, "roll", ["in_progress"]),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.state as any, "production_complete"),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.status, "draft"),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          inArray(invoices.status as any, ["billed", "sent", "partially_paid", "overdue"]),
        ),
      ),
  ]);

  return {
    inboundOrders: count(inboundResult),
    overview: overviewCount,
    design: count(designResult),
    proofing: count(proofingResult),
    prepress: count(prepressResult),
    flatbed: flatbedCount,
    roll: rollCount,
    fulfillment: count(fulfillmentResult),
    invoices: {
      pendingSend: count(invoiceDraftResult),
      unpaid: count(invoiceUnpaidResult),
    },
  };
}
