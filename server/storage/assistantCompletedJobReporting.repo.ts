import { and, asc, count, eq, exists, gte, isNotNull, lt, sql } from "drizzle-orm";
import { customers, invoices, orderLineItems, orders, productionJobs } from "@shared/schema";
import { db } from "../db";

export interface AssistantCompletedJobDateWindow {
  rangeStart: Date;
  rangeEnd: Date;
}

export interface AssistantCompletedJobFilters {
  customerId: string;
  limit: number;
}

export interface AssistantCompletedJobRecord {
  productionJobId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  productOrLineItemDescription: string | null;
  quantity: string | number | null;
  productionStatus: string;
  completedAt: Date | string;
  invoiceState: string;
}

function completionConditions(organizationId: string, dates: AssistantCompletedJobDateWindow, filters: AssistantCompletedJobFilters) {
  return and(
    eq(productionJobs.organizationId, organizationId),
    eq(productionJobs.status, "done"),
    isNotNull(productionJobs.completedAt),
    gte(productionJobs.completedAt, dates.rangeStart),
    lt(productionJobs.completedAt, dates.rangeEnd),
    eq(orders.organizationId, organizationId),
    eq(orders.customerId, filters.customerId),
  );
}

/** Tenant-scoped completed-production history. This deliberately starts at
 * production_jobs and uses completed_at; it never infers completion from an
 * order, fulfillment, or billing state. */
export class AssistantCompletedJobReportingRepository {
  async countCompletedJobs(organizationId: string, dates: AssistantCompletedJobDateWindow, filters: AssistantCompletedJobFilters): Promise<number> {
    const [row] = await db.select({ total: count() })
      .from(productionJobs)
      .innerJoin(orders, eq(orders.id, productionJobs.orderId))
      .where(completionConditions(organizationId, dates, filters));
    return Number(row?.total ?? 0);
  }

  async listCompletedJobs(organizationId: string, dates: AssistantCompletedJobDateWindow, filters: AssistantCompletedJobFilters): Promise<AssistantCompletedJobRecord[]> {
    return db.select({
      productionJobId: productionJobs.id,
      orderId: orders.id,
      orderNumber: sql<string>`coalesce(${orders.displayNumber}, ${orders.orderNumber})`,
      customerName: customers.companyName,
      productOrLineItemDescription: sql<string | null>`coalesce(nullif(${orderLineItems.description}, ''), nullif(${orderLineItems.productType}, ''), 'Production job')`,
      quantity: orderLineItems.quantity,
      productionStatus: productionJobs.status,
      completedAt: productionJobs.completedAt,
      invoiceState: sql<string>`case when exists (select 1 from ${invoices} where ${invoices.organizationId} = ${organizationId} and ${invoices.orderId} = ${orders.id} and ${invoices.status} <> 'void') then 'invoiced' else 'not_invoiced' end`,
    }).from(productionJobs)
      .innerJoin(orders, eq(orders.id, productionJobs.orderId))
      .innerJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
      .where(completionConditions(organizationId, dates, filters))
      .orderBy(asc(productionJobs.completedAt), asc(orders.orderNumber), asc(productionJobs.id))
      .limit(filters.limit)
      .then((rows): AssistantCompletedJobRecord[] => rows.flatMap((row): AssistantCompletedJobRecord[] => (
        row.completedAt ? [{ ...row, completedAt: row.completedAt }] : []
      )));
  }
}
