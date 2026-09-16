import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

import { invoices, orderLineItems, orders, payments, products } from "@shared/schema";
import { buildCustomerCreditExposure, parseMoneyToCents, type CustomerCreditExposure, type CustomerExposureInvoice } from "@shared/customerCreditExposure";
import { normalizeInvoiceAccountingDisplay } from "@shared/invoiceAccountingDisplay";
import { db } from "../db";
import { isInvoiceApprovedForAccounting } from "../lib/invoiceAccountingApproval";
import { canonicalInvoiceCustomerId } from "./invoiceCustomerProjection";

type CreditCustomer = { id: string; creditLimit?: unknown; creditLimitConfiguredAt?: unknown };

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

async function paymentRowsByInvoice(organizationId: string, invoiceIds: string[]) {
  const result = new Map<string, any[]>();
  for (let index = 0; index < invoiceIds.length; index += 500) {
    const batch = invoiceIds.slice(index, index + 500);
    const rows = await db.select().from(payments).where(and(
      eq(payments.organizationId, organizationId),
      inArray(payments.invoiceId, batch),
    ));
    for (const payment of rows) result.set(payment.invoiceId, [...(result.get(payment.invoiceId) ?? []), payment]);
  }
  return result;
}

/**
 * Tenant-scoped financial position read model. Invoice classification uses the
 * canonical approval state and payment rollup. Active orders without an active
 * invoice are the only legacy pending-billing fallback; Open Work is separate.
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
    db.select({ invoice: invoices, canonicalCustomerId: canonicalInvoiceCustomerId })
      .from(invoices)
      .leftJoin(orders, and(eq(orders.id, invoices.orderId), eq(orders.organizationId, organizationId)))
      .where(eq(invoices.organizationId, organizationId)),
    db.select({ id: orders.id, customerId: orders.customerId, total: orders.total })
      .from(orders).where(and(
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

  const paymentsByInvoice = await paymentRowsByInvoice(organizationId, invoiceRows.map((row) => row.invoice.id));
  const activeInvoiceOrderIds = new Set<string>();
  const invoiceRowsByCustomer = new Map<string, CustomerExposureInvoice[]>();
  for (const row of invoiceRows) {
    const invoice = row.invoice;
    const status = String(invoice.status || "").toLowerCase();
    if (!inactiveInvoiceStatuses.includes(status) && invoice.orderId) activeInvoiceOrderIds.add(invoice.orderId);
    const customerId = row.canonicalCustomerId;
    if (!customerId || !customerIds.includes(customerId)) continue;
    const display = normalizeInvoiceAccountingDisplay({ ...invoice, payments: paymentsByInvoice.get(invoice.id) ?? [] });
    const customerInvoices = invoiceRowsByCustomer.get(customerId) ?? [];
    customerInvoices.push({
      status: invoice.status,
      approvedForAccounting: isInvoiceApprovedForAccounting(invoice),
      remainingCents: display.remainingCents,
      creditCents: display.creditCents,
      displayStatus: display.displayStatus,
    });
    invoiceRowsByCustomer.set(customerId, customerInvoices);
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
