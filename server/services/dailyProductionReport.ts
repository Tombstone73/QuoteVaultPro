import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  orderLineItems,
  orders,
  organizations,
  products,
  productTypes,
  productionJobs,
} from "@shared/schema";
import type { DailyProductionReport } from "@shared/dailyProductionReport";
import { buildDailyProductionReport } from "@shared/dailyProductionReportProjection";
export { buildDailyProductionReport, getDailyProductionDueState, sortDailyProductionRows } from "@shared/dailyProductionReportProjection";
import { getOrganizationTimezone } from "./orderDueDateService";

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


export async function getDailyProductionReport(organizationId: string): Promise<DailyProductionReport> {
  const [organization, timezone, rows, activeOrderStatuses] = await Promise.all([
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
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(orderLineItems, eq(orderLineItems.orderId, orders.id))
      .leftJoin(products, eq(products.id, orderLineItems.productId))
      .leftJoin(productTypes, eq(productTypes.id, products.productTypeId))
      .leftJoin(productionJobs, and(eq(productionJobs.lineItemId, orderLineItems.id), eq(productionJobs.organizationId, organizationId)))
      .where(and(
        eq(orders.organizationId, organizationId),
        eq(orders.state, "open"),
        inArray(orders.status, ["new", "in_production"]),
        isNull(orders.canceledAt),
      )),
    db.select({ status: orders.status }).from(orders).where(and(
      eq(orders.organizationId, organizationId),
      eq(orders.state, "open"),
      isNull(orders.canceledAt),
    )),
  ]);

  const asOf = calendarDateInTimezone(new Date(), timezone);
  const report = buildDailyProductionReport({
    organizationName: organization[0]?.name || "PrintersHero",
    asOf,
    timezone,
    rows,
  });
  return {
    ...report,
    diagnostics: {
      ...report.diagnostics,
      activeOrdersOutsideReportStatus: activeOrderStatuses.filter((row) => !["new", "in_production"].includes(String(row.status || "").toLowerCase())).length,
    },
  };
}
