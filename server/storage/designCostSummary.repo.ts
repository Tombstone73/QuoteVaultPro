import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  auditLogs,
  lineItemDesignCostSummaries,
  orderLineItems,
  orders,
  products,
  quoteLineItems,
  type InsertLineItemDesignCostSummary,
} from "@shared/schema";
import type { DesignWorkspaceAuditRow } from "../services/designWorkspaceState";

export type DesignCostSummaryLineItemContext = {
  lineItemId: string;
  orderId: string;
  workflowState: string | null;
  designStatus: string | null;
  requiresDesignSnapshot: boolean;
  designPricingModeSnapshot: string;
  includedDesignMinutesSnapshot: number | null;
  flatFeeAmountSnapshot: string | null;
  hourlyRateSnapshot: string | null;
  overageRateSnapshot: string | null;
  internalLaborRateSnapshot: string | null;
  needsDesignOverride: boolean | null;
  quoteLineItemId: string | null;
  quotedDesignPricingModeSnapshot: string | null;
  quotedFlatFeeAmountSnapshot: string | null;
};

export type OrderDesignBillingVisibilityRow = {
  lineItemId: string;
  orderId: string;
  description: string | null;
  quantity: number;
  productName: string | null;
  workflowIntent: string | null;
  requiresDesignSnapshot: boolean;
  needsDesignOverride: boolean | null;
  designPricingModeSnapshot: string | null;
  designCostState: string | null;
  correctedTrackedMinutes: string | null;
  soldDesignAmount: string | null;
  billableDesignMinutes: string | null;
  billableDesignAmount: string | null;
  billingStatus: string | null;
  lastSyncedAt: Date | null;
};

export class DesignCostSummaryRepository {
  constructor(private readonly dbInstance = db) {}

  async getLineItemContext(
    organizationId: string,
    lineItemId: string,
    executor: any = this.dbInstance,
  ): Promise<DesignCostSummaryLineItemContext | null> {
    const [row] = await executor
      .select({
        lineItemId: orderLineItems.id,
        orderId: orderLineItems.orderId,
        workflowState: orderLineItems.workflowState,
        designStatus: orderLineItems.designStatus,
        requiresDesignSnapshot: orderLineItems.requiresDesignSnapshot,
        designPricingModeSnapshot: orderLineItems.designPricingModeSnapshot,
        includedDesignMinutesSnapshot: orderLineItems.includedDesignMinutesSnapshot,
        flatFeeAmountSnapshot: orderLineItems.flatFeeAmountSnapshot,
        hourlyRateSnapshot: orderLineItems.hourlyRateSnapshot,
        overageRateSnapshot: orderLineItems.overageRateSnapshot,
        internalLaborRateSnapshot: orderLineItems.internalLaborRateSnapshot,
        needsDesignOverride: orderLineItems.needsDesignOverride,
        quoteLineItemId: orderLineItems.quoteLineItemId,
        quotedDesignPricingModeSnapshot: quoteLineItems.designPricingModeSnapshot,
        quotedFlatFeeAmountSnapshot: quoteLineItems.flatFeeAmountSnapshot,
      })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .leftJoin(quoteLineItems, eq(orderLineItems.quoteLineItemId, quoteLineItems.id))
      .where(and(eq(orders.organizationId, organizationId), eq(orderLineItems.id, lineItemId)))
      .limit(1);

    return row ?? null;
  }

  async listDesignAuditRows(
    organizationId: string,
    lineItemId: string,
    executor: any = this.dbInstance,
  ): Promise<DesignWorkspaceAuditRow[]> {
    return executor
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
      .orderBy(auditLogs.createdAt);
  }

  async getPersistedByLineItemId(
    organizationId: string,
    lineItemId: string,
    executor: any = this.dbInstance,
  ) {
    const [row] = await executor
      .select()
      .from(lineItemDesignCostSummaries)
      .where(
        and(
          eq(lineItemDesignCostSummaries.organizationId, organizationId),
          eq(lineItemDesignCostSummaries.lineItemId, lineItemId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async listOrderVisibilityRows(
    organizationId: string,
    orderId: string,
    executor: any = this.dbInstance,
  ): Promise<OrderDesignBillingVisibilityRow[]> {
    return executor
      .select({
        lineItemId: orderLineItems.id,
        orderId: orderLineItems.orderId,
        description: orderLineItems.description,
        quantity: orderLineItems.quantity,
        productName: products.name,
        workflowIntent: products.workflowIntent,
        requiresDesignSnapshot: orderLineItems.requiresDesignSnapshot,
        needsDesignOverride: orderLineItems.needsDesignOverride,
        designPricingModeSnapshot: orderLineItems.designPricingModeSnapshot,
        designCostState: lineItemDesignCostSummaries.designCostState,
        correctedTrackedMinutes: lineItemDesignCostSummaries.correctedTrackedMinutes,
        soldDesignAmount: lineItemDesignCostSummaries.soldDesignAmount,
        billableDesignMinutes: lineItemDesignCostSummaries.billableDesignMinutes,
        billableDesignAmount: lineItemDesignCostSummaries.billableDesignAmount,
        billingStatus: lineItemDesignCostSummaries.billingStatus,
        lastSyncedAt: lineItemDesignCostSummaries.lastSyncedAt,
      })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .leftJoin(products, eq(orderLineItems.productId, products.id))
      .leftJoin(
        lineItemDesignCostSummaries,
        and(
          eq(lineItemDesignCostSummaries.organizationId, orders.organizationId),
          eq(lineItemDesignCostSummaries.lineItemId, orderLineItems.id),
        ),
      )
      .where(and(eq(orders.organizationId, organizationId), eq(orderLineItems.orderId, orderId)))
      .orderBy(orderLineItems.createdAt, orderLineItems.id);
  }

  async upsertSummary(
    values: InsertLineItemDesignCostSummary,
    executor: any = this.dbInstance,
  ) {
    const [row] = await executor
      .insert(lineItemDesignCostSummaries)
      .values(values)
      .onConflictDoUpdate({
        target: lineItemDesignCostSummaries.lineItemId,
        set: {
          designCostState: values.designCostState,
          actualTrackedMinutes: values.actualTrackedMinutes,
          correctedTrackedMinutes: values.correctedTrackedMinutes,
          internalDesignCostCalculated: values.internalDesignCostCalculated,
          quotedDesignAmount: values.quotedDesignAmount,
          soldDesignAmount: values.soldDesignAmount,
          billableDesignMinutes: values.billableDesignMinutes,
          billableDesignAmount: values.billableDesignAmount,
          billingStatus: values.billingStatus,
          lastSyncedAt: values.lastSyncedAt,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to upsert line item design cost summary");
    }

    return row;
  }
}

export const designCostSummaryRepository = new DesignCostSummaryRepository();
