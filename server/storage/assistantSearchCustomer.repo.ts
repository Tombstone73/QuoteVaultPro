import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  customerContactLinks,
  customerContacts,
  customers,
  invoices,
  orders,
  products,
  productionJobs,
  quotes,
} from "@shared/schema";

export const ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY = 5;

export type AssistantSearchEntityType =
  | "customer"
  | "contact"
  | "order"
  | "quote"
  | "invoice"
  | "production_job"
  | "product";

/**
 * Exact assistant lookups deliberately use a reduced query surface.  This
 * prevents a customer or product lookup from depending on unrelated legacy
 * joins in the wider global-search fan-out.
 */
export type AssistantDirectSearchEntityType = "customer" | "product";

export interface AssistantSearchRecord {
  entityType: AssistantSearchEntityType;
  recordId: string;
  displayLabel: string;
  secondaryDescription: string | null;
  status: string | null;
  route: string;
  freshness: Date | string;
}

export interface AssistantCustomerContactSummary {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  route: string;
  freshness: Date | string;
}

export interface AssistantCustomerActivitySummary {
  kind: "order" | "quote";
  id: string;
  displayNumber: string;
  status: string;
  route: string;
  freshness: Date | string;
}

export interface AssistantCustomerSummaryRecord {
  id: string;
  companyName: string;
  isActive: boolean | null;
  status: string | null;
  route: string;
  freshness: Date | string;
  contacts: AssistantCustomerContactSummary[];
  recentActivity: AssistantCustomerActivitySummary[];
}

export interface AssistantSearchCustomerRepository {
  search(organizationId: string, query: string, limit: number): Promise<AssistantSearchRecord[]>;
  searchByEntity(organizationId: string, query: string, limit: number, entityType: AssistantDirectSearchEntityType): Promise<AssistantSearchRecord[]>;
  getCustomerSummary(organizationId: string, customerId: string, activityLimit: number): Promise<AssistantCustomerSummaryRecord | null>;
}

/**
 * Escapes LIKE metacharacters before placing a user/model-provided term inside
 * an ILIKE pattern. The value remains a bound Drizzle parameter; this only
 * prevents wildcard expansion from turning a narrow lookup into a broad scan.
 */
export function escapeAssistantSearchTerm(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function searchPattern(query: string): string {
  return `%${escapeAssistantSearchTerm(query)}%`;
}

function orderLabel(displayNumber: string | null, orderNumber: string): string {
  return `Order ${displayNumber ?? orderNumber}`;
}

function quoteLabel(displayNumber: string | null, quoteNumber: number | null): string {
  return `Quote ${displayNumber ?? quoteNumber ?? ""}`.trim();
}

function invoiceLabel(displayNumber: string | null, invoiceNumber: number): string {
  return `Invoice ${displayNumber ?? invoiceNumber}`;
}

export class DrizzleAssistantSearchCustomerRepository implements AssistantSearchCustomerRepository {
  constructor(private readonly dbInstance = db) {}

  async search(organizationId: string, query: string, limit: number): Promise<AssistantSearchRecord[]> {
    const pattern = searchPattern(query);
    const parsedDocumentNumber = /^\d{1,10}$/.test(query) ? Number(query) : null;
    const exactDocumentNumber = parsedDocumentNumber !== null && Number.isSafeInteger(parsedDocumentNumber)
      ? parsedDocumentNumber
      : null;
    const tenant = (column: PgColumn) => eq(column, organizationId);

    const [customerRows, contactRows, orderRows, quoteRows, invoiceRows, jobRows, productRows] = await Promise.all([
      this.dbInstance
        .select({ id: customers.id, companyName: customers.companyName, email: customers.email, phone: customers.phone, status: customers.status, updatedAt: customers.updatedAt })
        .from(customers)
        .where(and(tenant(customers.organizationId), or(ilike(customers.companyName, pattern), ilike(customers.email, pattern), ilike(customers.phone, pattern))))
        .orderBy(desc(customers.updatedAt))
        .limit(limit),
      this.dbInstance
        .select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName, email: customerContacts.email, phone: customerContacts.phone, companyName: customers.companyName, updatedAt: customerContacts.updatedAt })
        .from(customerContactLinks)
        .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
        .innerJoin(customers, eq(customerContactLinks.customerId, customers.id))
        .where(and(
          tenant(customerContactLinks.organizationId),
          tenant(customerContacts.organizationId),
          tenant(customers.organizationId),
          eq(customerContactLinks.status, "active"),
          eq(customerContacts.status, "active"),
          or(ilike(customerContacts.firstName, pattern), ilike(customerContacts.lastName, pattern), ilike(customerContacts.email, pattern), ilike(customerContacts.phone, pattern)),
        ))
        .orderBy(desc(customerContacts.updatedAt))
        .limit(limit),
      this.dbInstance
        .select({ id: orders.id, displayNumber: orders.displayNumber, orderNumber: orders.orderNumber, customerName: customers.companyName, status: orders.status, updatedAt: orders.updatedAt })
        .from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(and(tenant(orders.organizationId), tenant(customers.organizationId), or(ilike(orders.orderNumber, pattern), ilike(orders.displayNumber, pattern), ilike(orders.poNumber, pattern), ilike(customers.companyName, pattern))))
        .orderBy(desc(orders.updatedAt))
        .limit(limit),
      this.dbInstance
        .select({ id: quotes.id, displayNumber: quotes.displayNumber, quoteNumber: quotes.quoteNumber, customerName: quotes.customerName, status: quotes.status, createdAt: quotes.createdAt })
        .from(quotes)
        .where(and(tenant(quotes.organizationId), or(ilike(quotes.displayNumber, pattern), ilike(quotes.customerName, pattern), ilike(quotes.label, pattern), ...(exactDocumentNumber === null ? [] : [eq(quotes.quoteNumber, exactDocumentNumber)]))))
        .orderBy(desc(quotes.createdAt))
        .limit(limit),
      this.dbInstance
        .select({ id: invoices.id, displayNumber: invoices.displayNumber, invoiceNumber: invoices.invoiceNumber, customerName: customers.companyName, status: invoices.status, updatedAt: invoices.updatedAt })
        .from(invoices)
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .where(and(tenant(invoices.organizationId), tenant(customers.organizationId), or(ilike(invoices.displayNumber, pattern), ilike(customers.companyName, pattern), ilike(invoices.customerPoNumber, pattern), ...(exactDocumentNumber === null ? [] : [eq(invoices.invoiceNumber, exactDocumentNumber)]))))
        .orderBy(desc(invoices.updatedAt))
        .limit(limit),
      this.dbInstance
        .select({ id: productionJobs.id, orderId: productionJobs.orderId, orderNumber: orders.orderNumber, displayNumber: orders.displayNumber, customerName: customers.companyName, status: productionJobs.status, updatedAt: productionJobs.updatedAt })
        .from(productionJobs)
        .innerJoin(orders, eq(productionJobs.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .where(and(tenant(productionJobs.organizationId), tenant(orders.organizationId), tenant(customers.organizationId), or(ilike(orders.orderNumber, pattern), ilike(orders.displayNumber, pattern), ilike(customers.companyName, pattern))))
        .orderBy(desc(productionJobs.updatedAt))
        .limit(limit),
      this.dbInstance
        .select({ id: products.id, name: products.name, category: products.category, isActive: products.isActive, updatedAt: products.updatedAt })
        .from(products)
        .where(and(tenant(products.organizationId), or(ilike(products.name, pattern), ilike(products.category, pattern))))
        .orderBy(desc(products.updatedAt))
        .limit(limit),
    ]);

    return [
      ...customerRows.map((row): AssistantSearchRecord => ({ entityType: "customer", recordId: row.id, displayLabel: row.companyName, secondaryDescription: row.email ?? row.phone, status: row.status, route: `/customers/${row.id}`, freshness: row.updatedAt })),
      ...contactRows.map((row): AssistantSearchRecord => ({ entityType: "contact", recordId: row.id, displayLabel: `${row.firstName} ${row.lastName}`.trim(), secondaryDescription: row.email ?? row.phone ?? row.companyName, status: "active", route: `/contacts/${row.id}`, freshness: row.updatedAt })),
      ...orderRows.map((row): AssistantSearchRecord => ({ entityType: "order", recordId: row.id, displayLabel: orderLabel(row.displayNumber, row.orderNumber), secondaryDescription: row.customerName, status: row.status, route: `/orders/${row.id}`, freshness: row.updatedAt })),
      ...quoteRows.map((row): AssistantSearchRecord => ({ entityType: "quote", recordId: row.id, displayLabel: quoteLabel(row.displayNumber, row.quoteNumber), secondaryDescription: row.customerName, status: row.status, route: `/quotes/${row.id}`, freshness: row.createdAt })),
      ...invoiceRows.map((row): AssistantSearchRecord => ({ entityType: "invoice", recordId: row.id, displayLabel: invoiceLabel(row.displayNumber, row.invoiceNumber), secondaryDescription: row.customerName, status: row.status, route: `/invoices/${row.id}`, freshness: row.updatedAt })),
      ...jobRows.map((row): AssistantSearchRecord => ({ entityType: "production_job", recordId: row.id, displayLabel: `Production job for ${orderLabel(row.displayNumber, row.orderNumber)}`, secondaryDescription: row.customerName, status: row.status, route: `/production/jobs/${row.id}`, freshness: row.updatedAt })),
      ...productRows.map((row): AssistantSearchRecord => ({ entityType: "product", recordId: row.id, displayLabel: row.name, secondaryDescription: row.category, status: row.isActive ? "active" : "inactive", route: `/products/${row.id}/edit`, freshness: row.updatedAt })),
    ];
  }

  /**
   * Bounded, tenant-scoped direct lookups used only when deterministic routing
   * has already established the requested record kind.  Keep these queries
   * independent of broad global-search joins so an unrelated category cannot
   * turn a valid customer/product lookup into a tool failure.
   */
  async searchByEntity(
    organizationId: string,
    query: string,
    limit: number,
    entityType: AssistantDirectSearchEntityType,
  ): Promise<AssistantSearchRecord[]> {
    const pattern = searchPattern(query);
    if (entityType === "customer") {
      const rows = await this.dbInstance
        .select({ id: customers.id, companyName: customers.companyName, email: customers.email, phone: customers.phone, status: customers.status, updatedAt: customers.updatedAt })
        .from(customers)
        .where(and(
          eq(customers.organizationId, organizationId),
          or(ilike(customers.companyName, pattern), ilike(customers.email, pattern), ilike(customers.phone, pattern)),
        ))
        .orderBy(desc(customers.updatedAt))
        .limit(limit);
      return rows.map((row): AssistantSearchRecord => ({
        entityType: "customer",
        recordId: row.id,
        displayLabel: row.companyName,
        secondaryDescription: row.email ?? row.phone,
        status: row.status,
        route: `/customers/${row.id}`,
        freshness: row.updatedAt,
      }));
    }

    const rows = await this.dbInstance
      .select({ id: products.id, name: products.name, category: products.category, isActive: products.isActive, updatedAt: products.updatedAt })
      .from(products)
      .where(and(
        eq(products.organizationId, organizationId),
        or(ilike(products.name, pattern), ilike(products.category, pattern)),
      ))
      .orderBy(desc(products.updatedAt))
      .limit(limit);
    return rows.map((row): AssistantSearchRecord => ({
      entityType: "product",
      recordId: row.id,
      displayLabel: row.name,
      secondaryDescription: row.category,
      status: row.isActive ? "active" : "inactive",
      route: `/products/${row.id}/edit`,
      freshness: row.updatedAt,
    }));
  }

  async getCustomerSummary(organizationId: string, customerId: string, activityLimit: number): Promise<AssistantCustomerSummaryRecord | null> {
    const [customer] = await this.dbInstance
      .select({ id: customers.id, companyName: customers.companyName, isActive: customers.isActive, status: customers.status, updatedAt: customers.updatedAt })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
      .limit(1);
    if (!customer) return null;

    const [contactRows, orderRows, quoteRows] = await Promise.all([
      this.dbInstance
        .select({ id: customerContacts.id, firstName: customerContacts.firstName, lastName: customerContacts.lastName, title: customerContacts.title, email: customerContacts.email, phone: customerContacts.phone, isPrimary: customerContactLinks.isPrimary, updatedAt: customerContacts.updatedAt })
        .from(customerContactLinks)
        .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
        .where(and(eq(customerContactLinks.organizationId, organizationId), eq(customerContacts.organizationId, organizationId), eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active"), eq(customerContacts.status, "active")))
        .orderBy(desc(customerContactLinks.isPrimary), desc(customerContacts.updatedAt))
        .limit(activityLimit),
      this.dbInstance
        .select({ id: orders.id, displayNumber: orders.displayNumber, orderNumber: orders.orderNumber, status: orders.status, updatedAt: orders.updatedAt })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), eq(orders.customerId, customerId)))
        .orderBy(desc(orders.updatedAt))
        .limit(activityLimit),
      this.dbInstance
        .select({ id: quotes.id, displayNumber: quotes.displayNumber, quoteNumber: quotes.quoteNumber, status: quotes.status, createdAt: quotes.createdAt })
        .from(quotes)
        .where(and(eq(quotes.organizationId, organizationId), eq(quotes.customerId, customerId)))
        .orderBy(desc(quotes.createdAt))
        .limit(activityLimit),
    ]);

    return {
      id: customer.id,
      companyName: customer.companyName,
      isActive: customer.isActive,
      status: customer.status,
      route: `/customers/${customer.id}`,
      freshness: customer.updatedAt,
      contacts: contactRows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), title: row.title, email: row.email, phone: row.phone, isPrimary: row.isPrimary, route: `/contacts/${row.id}`, freshness: row.updatedAt })),
      recentActivity: [
        ...orderRows.map((row): AssistantCustomerActivitySummary => ({ kind: "order", id: row.id, displayNumber: orderLabel(row.displayNumber, row.orderNumber), status: row.status, route: `/orders/${row.id}`, freshness: row.updatedAt })),
        ...quoteRows.map((row): AssistantCustomerActivitySummary => ({ kind: "quote", id: row.id, displayNumber: quoteLabel(row.displayNumber, row.quoteNumber), status: row.status, route: `/quotes/${row.id}`, freshness: row.createdAt })),
      ].sort((left, right) => new Date(right.freshness).getTime() - new Date(left.freshness).getTime()).slice(0, activityLimit),
    };
  }
}
