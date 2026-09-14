import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { getOrganizationTimezone } from "./orderDueDateService";
import {
  customers,
  orderLineItems,
  orders,
  orderStatusPills,
  organizations,
  products,
  productTypes,
  productionJobs,
} from "@shared/schema";
import type { DailyProductionReport } from "@shared/dailyProductionReport";
import { buildDailyProductionReport } from "@shared/dailyProductionReportProjection";
import { DAILY_PRODUCTION_STATUS_KEYS } from "./dailyProductionReportStatus";

export { buildDailyProductionReport, getDailyProductionDueState, sortDailyProductionRows } from "@shared/dailyProductionReportProjection";

function calendarDateInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Reads report data only after the authenticated endpoint is requested. */
export async function getDailyProductionReport(organizationId: string): Promise<DailyProductionReport> {
  const normalizedPillValue = sql<string>`lower(regexp_replace(regexp_replace(trim(coalesce(${orders.statusPillValue}, '')), '[_-]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
  const hasNoPillValue = sql<boolean>`${normalizedPillValue} = ''`;
  const reportStatusKeys = [...DAILY_PRODUCTION_STATUS_KEYS];
  const reportStatusValues = ["new", "in production"];
  const isQualifiedCurrentStatus = or(
    and(
      isNotNull(orders.statusPillId),
      inArray(orderStatusPills.key, reportStatusKeys),
    ),
    and(
      isNull(orders.statusPillId),
      inArray(normalizedPillValue, reportStatusValues),
    ),
    and(
      isNull(orders.statusPillId),
      hasNoPillValue,
      inArray(orders.status, reportStatusKeys),
    ),
  );

  const [organization, timezone, rows] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    getOrganizationTimezone(organizationId),
    db
      .select({
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        displayNumber: orders.displayNumber,
        jobNumber: orders.jobNumber,
        label: orders.label,
        poNumber: orders.poNumber,
        customerName: customers.companyName,
        dueDate: orders.dueDate,
        shippingMethod: orders.shippingMethod,
        lineItemId: orderLineItems.id,
        quantity: orderLineItems.quantity,
        productionBypassed: orderLineItems.productionBypassed,
        isService: products.isService,
        workflowIntent: products.workflowIntent,
        defaultStationKey: productTypes.defaultStationKey,
        jobStationKey: productionJobs.stationKey,
      })
      .from(orders)
      .leftJoin(orderStatusPills, and(
        eq(orderStatusPills.id, orders.statusPillId),
        eq(orderStatusPills.organizationId, orders.organizationId),
      ))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(orderLineItems, eq(orderLineItems.orderId, orders.id))
      .leftJoin(products, eq(products.id, orderLineItems.productId))
      .leftJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .leftJoin(productionJobs, and(
        eq(productionJobs.lineItemId, orderLineItems.id),
        eq(productionJobs.organizationId, organizationId),
      ))
      .where(and(
        eq(orders.organizationId, organizationId),
        isQualifiedCurrentStatus,
        isNull(orders.canceledAt),
      )),
  ]);

  const report = buildDailyProductionReport({
    organizationName: organization[0]?.name || "PrintersHero",
    asOf: calendarDateInTimezone(new Date(), timezone),
    timezone,
    rows,
  });

  return {
    ...report,
    diagnostics: {
      ...report.diagnostics,
      activeOrdersOutsideReportStatus: 0,
    },
  };
}
