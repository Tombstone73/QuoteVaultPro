/**
 * operationalSummary.ts
 *
 * Canonical operational counts aggregation for the TitanOS sidebar badges.
 * One function, parallel count queries, one response shape.
 *
 * Counts are derived from existing canonical workflow states only —
 * no new states are introduced, no counts are persisted.
 *
 * Placement: server/services/operationalSummary.ts
 */

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  inboundOrderRecords,
  invoices,
  orderLineItems,
  orders,
  productionJobs,
} from "../../shared/schema";

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

// Orders in these states are excluded from workflow queues.
const CLOSED_ORDER_STATES = ["closed", "canceled", "production_complete"];

function count(rows: { count: number }[]): number {
  return rows[0]?.count ?? 0;
}

export async function computeOperationalSummary(organizationId: string): Promise<OperationalSummary> {
  const [
    inboundResult,
    overviewResult,
    designResult,
    proofingResult,
    prepressResult,
    flatbedResult,
    rollResult,
    fulfillmentResult,
    invoiceDraftResult,
    invoiceUnpaidResult,
  ] = await Promise.all([
    // Inbound Orders — records awaiting staff review
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboundOrderRecords)
      .where(
        and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.status, "needs_review"),
        ),
      ),

    // Overview — total active production jobs across all stations
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(productionJobs)
      .innerJoin(orders, eq(productionJobs.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          inArray(productionJobs.status as any, ["queued", "in_progress"]),
        ),
      ),

    // Design — line items in design workflow
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

    // Proofing — line items awaiting customer proof approval
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

    // Prepress — line items in prepress workflow states
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

    // Flatbed — active jobs at the flatbed station
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(productionJobs)
      .innerJoin(orders, eq(productionJobs.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(productionJobs.stationKey, "flatbed"),
          inArray(productionJobs.status as any, ["queued", "in_progress"]),
        ),
      ),

    // Roll — active jobs at the roll station
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(productionJobs)
      .innerJoin(orders, eq(productionJobs.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(productionJobs.stationKey, "roll"),
          inArray(productionJobs.status as any, ["queued", "in_progress"]),
        ),
      ),

    // Fulfillment — orders that have completed production and are pending fulfillment
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.state as any, "production_complete"),
        ),
      ),

    // Invoices: pending send (draft)
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.status, "draft"),
        ),
      ),

    // Invoices: unpaid (sent but not collected)
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
    overview: count(overviewResult),
    design: count(designResult),
    proofing: count(proofingResult),
    prepress: count(prepressResult),
    flatbed: count(flatbedResult),
    roll: count(rollResult),
    fulfillment: count(fulfillmentResult),
    invoices: {
      pendingSend: count(invoiceDraftResult),
      unpaid: count(invoiceUnpaidResult),
    },
  };
}
