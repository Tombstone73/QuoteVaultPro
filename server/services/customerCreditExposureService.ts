import { and, eq, inArray } from "drizzle-orm";

import { invoices } from "@shared/schema";
import { buildCustomerCreditExposure, type CustomerCreditExposure } from "@shared/customerCreditExposure";
import { db } from "../db";

function emptyExposure(creditLimit: unknown): CustomerCreditExposure {
  return buildCustomerCreditExposure(creditLimit, []);
}

/**
 * Read-model owner for customer credit exposure.  It intentionally derives
 * financial exposure from invoice balances instead of mutating the legacy
 * customer.currentBalance import/accounting field.
 */
export async function getCustomerCreditExposures(
  organizationId: string,
  customers: Array<{ id: string; creditLimit?: unknown }>,
): Promise<Map<string, CustomerCreditExposure>> {
  const result = new Map<string, CustomerCreditExposure>();
  if (customers.length === 0) return result;

  const customerIds = Array.from(new Set(customers.map((customer) => customer.id)));
  const invoiceRows = await db.select({
    customerId: invoices.customerId,
    status: invoices.status,
    balanceDue: invoices.balanceDue,
  }).from(invoices).where(and(
    eq(invoices.organizationId, organizationId),
    inArray(invoices.customerId, customerIds),
  ));

  const invoiceRowsByCustomer = new Map<string, Array<{ status: string | null; balanceDue: unknown }>>();
  for (const invoice of invoiceRows) {
    if (!invoice.customerId) continue;
    const current = invoiceRowsByCustomer.get(invoice.customerId) ?? [];
    current.push(invoice);
    invoiceRowsByCustomer.set(invoice.customerId, current);
  }

  for (const customer of customers) {
    result.set(customer.id, buildCustomerCreditExposure(customer.creditLimit, invoiceRowsByCustomer.get(customer.id) ?? []));
  }
  return result;
}

export async function getCustomerCreditExposure(
  organizationId: string,
  customer: { id: string; creditLimit?: unknown },
) {
  return (await getCustomerCreditExposures(organizationId, [customer])).get(customer.id) ?? emptyExposure(customer.creditLimit);
}
