import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

import { invoices, orderLineItems, orders, products } from "@shared/schema";
import { buildCustomerCreditExposure, parseMoneyToCents, type CustomerCreditExposure } from "@shared/customerCreditExposure";
import { db } from "../db";

type CreditCustomer = { id: string; creditLimit?: unknown; creditLimitConfiguredAt?: unknown };
type CreditInvoice = { customerId: string | null; orderId: string | null; status: string | null; balanceDue: unknown };

const inactiveInvoiceStatuses = ["void", "voided", "cancelled", "canceled"];
const activeOrderStates = ["open", "production_complete"];
const inactiveOrderStatuses = ["cancelled", "canceled"];

function isCreditLimitConfigured(customer: CreditCustomer): boolean {
  return customer.creditLimitConfiguredAt != null;
}

function emptyExposure(customer: CreditCustomer): CustomerCreditExposure {
  return buildCustomerCreditExposure(customer.creditLimit, [], {
    creditLimitConfigured: isCreditLimitConfigured(customer),
  });
}

/**
 * Tenant-scoped financial position read model. Invoice balances define A/R and
 * pending billing; orders without any active linked invoice are the legacy
 * safety-net. Open Work is intentionally operational-only.
 */
export async function getCustomerCreditExposures(
  organizationId: string,
  customers: CreditCustomer[],
): Promise<Map<string, CustomerCreditExposure>> {
  const result = new Map<string, CustomerCreditExposure>();
  if (customers.length === 0) return result;

  const customerIds = Array.from(new Set(customers.map((customer) => customer.id))).filter(Boolean);
  if (customerIds.length === 0) return result;

  const [invoiceRows, activeOrders, physicalOrderRows] = await Promise.all([
    db.select({
      customerId: invoices.customerId,
      orderId: invoices.orderId,
      status: invoices.status,
      balanceDue: invoices.balanceDue,
    }).from(invoices).where(and(
      eq(invoices.organizationId, organizationId),
      inArray(invoices.customerId, customerIds),
    )),
    db.select({
      id: orders.id,
      customerId: orders.customerId,
      total: orders.total,
    }).from(orders).where(and(
      eq(orders.organizationId, organizationId),
      inArray(orders.customerId, customerIds),
      inArray(orders.state, activeOrderStates as any),
      isNull(orders.canceledAt),
      notInArray(orders.status, inactiveOrderStatuses as any),
    )),
    db.select({ orderId: orderLineItems.orderId })
      .from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .innerJoin(products, eq(products.id, orderLineItems.productId))
      .where(and(
        eq(orders.organizationId, organizationId),
        eq(products.organizationId, organizationId),
        inArray(orders.customerId, customerIds),
        inArray(orders.state, activeOrderStates as any),
        isNull(orders.canceledAt),
        notInArray(orders.status, inactiveOrderStatuses as any),
        notInArray(products.workflowIntent, ["service_fee"] as any),
        notInArray(orderLineItems.lineItemRole, ["parent"] as any),
      )),
  ]);

  const activeInvoiceOrderIds = new Set<string>();
  const invoiceRowsByCustomer = new Map<string, CreditInvoice[]>();
  for (const invoice of invoiceRows) {
    const status = String(invoice.status || "").toLowerCase();
    if (!inactiveInvoiceStatuses.includes(status) && invoice.orderId) activeInvoiceOrderIds.add(invoice.orderId);
    if (!invoice.customerId) continue;
    const rows = invoiceRowsByCustomer.get(invoice.customerId) ?? [];
    rows.push(invoice);
    invoiceRowsByCustomer.set(invoice.customerId, rows);
  }

  const physicalOrderIds = new Set(physicalOrderRows.map((row) => row.orderId));
  const unbilledByCustomer = new Map<string, number>();
  const openWorkByCustomer = new Map<string, number>();
  for (const order of activeOrders) {
    if (!order.customerId) continue;
    const totalCents = Math.max(0, parseMoneyToCents(order.total));
    if (!activeInvoiceOrderIds.has(order.id)) {
      unbilledByCustomer.set(order.customerId, (unbilledByCustomer.get(order.customerId) ?? 0) + totalCents);
    }
    if (physicalOrderIds.has(order.id)) {
      openWorkByCustomer.set(order.customerId, (openWorkByCustomer.get(order.customerId) ?? 0) + totalCents);
    }
  }

  for (const customer of customers) {
    result.set(customer.id, buildCustomerCreditExposure(customer.creditLimit, invoiceRowsByCustomer.get(customer.id) ?? [], {
      creditLimitConfigured: isCreditLimitConfigured(customer),
      unbilledOpenOrdersCents: unbilledByCustomer.get(customer.id) ?? 0,
      openWorkCents: openWorkByCustomer.get(customer.id) ?? 0,
    }));
  }
  return result;
}

export async function getCustomerCreditExposure(organizationId: string, customer: CreditCustomer) {
  return (await getCustomerCreditExposures(organizationId, [customer])).get(customer.id) ?? emptyExposure(customer);
}
