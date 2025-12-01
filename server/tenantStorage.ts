/**
 * Tenant-Scoped Storage Helpers
 * 
 * This module provides helper functions for tenant-scoped database operations.
 * All queries filter by organizationId, and all inserts inject organizationId.
 * 
 * Usage pattern:
 *   - Pass organizationId from req.organizationId to storage methods
 *   - Use these helpers for consistent tenant scoping
 */

import { db } from "./db";
import { sql, eq, and, or, SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Creates a tenant-scoped WHERE condition for a table that has organizationId
 */
export function tenantScope(
  organizationIdColumn: PgColumn,
  organizationId: string
): SQL {
  return eq(organizationIdColumn, organizationId);
}

/**
 * Combines tenant scope with additional conditions using AND
 */
export function withTenantScope(
  organizationIdColumn: PgColumn,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  const validConditions = conditions.filter((c): c is SQL => c !== undefined);
  if (validConditions.length === 0) {
    return tenantScope(organizationIdColumn, organizationId);
  }
  return and(tenantScope(organizationIdColumn, organizationId), ...validConditions)!;
}

/**
 * Helper type for tenant-scoped insert data
 */
export type WithOrganizationId<T> = T & { organizationId: string };

/**
 * Injects organizationId into insert data
 */
export function injectTenantId<T extends object>(
  data: T,
  organizationId: string
): WithOrganizationId<T> {
  return { ...data, organizationId };
}

/**
 * Example of how to refactor a storage method:
 * 
 * BEFORE (not tenant-scoped):
 *   async getAllProducts(): Promise<Product[]> {
 *     return await db.select().from(products).orderBy(products.name);
 *   }
 * 
 * AFTER (tenant-scoped):
 *   async getAllProducts(organizationId: string): Promise<Product[]> {
 *     return await db
 *       .select()
 *       .from(products)
 *       .where(tenantScope(products, organizationId))
 *       .orderBy(products.name);
 *   }
 * 
 * For creates:
 * 
 * BEFORE:
 *   async createProduct(product: InsertProduct): Promise<Product> {
 *     const [newProduct] = await db.insert(products).values(product).returning();
 *     return newProduct;
 *   }
 * 
 * AFTER:
 *   async createProduct(product: InsertProduct, organizationId: string): Promise<Product> {
 *     const [newProduct] = await db
 *       .insert(products)
 *       .values(injectTenantId(product, organizationId))
 *       .returning();
 *     return newProduct;
 *   }
 */

/**
 * For child entities that inherit tenant scope from parent (e.g., quote line items inherit from quote):
 * We don't add organizationId to these tables, instead we validate via parent.
 * 
 * Tables that inherit via parent (NO direct organizationId):
 *   - quoteLineItems (parent: quotes)
 *   - orderLineItems (parent: orders)
 *   - orderAttachments (parent: orders)
 *   - jobs (parent: orders)
 *   - jobNotes (parent: jobs)
 *   - jobStatusLog (parent: jobs)
 *   - jobFiles (parent: jobs)
 *   - customerContacts (parent: customers)
 *   - customerNotes (parent: customers)
 *   - customerCreditTransactions (parent: customers)
 *   - productVariants (parent: products)
 *   - productOptions (parent: products)
 *   - invoiceLineItems (parent: invoices)
 *   - payments (parent: invoices)
 *   - shipments (parent: orders)
 *   - inventoryAdjustments (parent: materials)
 *   - orderMaterialUsage (parent: orders)
 *   - purchaseOrderLineItems (parent: purchaseOrders)
 *   - quoteWorkflowStates (parent: quotes)
 *   - orderAuditLog (parent: orders)
 * 
 * Tables with direct organizationId:
 *   - organizations (root)
 *   - userOrganizations (join table)
 *   - customers
 *   - products
 *   - productTypes
 *   - quotes
 *   - orders
 *   - invoices
 *   - materials
 *   - vendors
 *   - purchaseOrders
 *   - globalVariables
 *   - pricingRules
 *   - formulaTemplates
 *   - emailSettings
 *   - companySettings
 *   - mediaAssets
 *   - auditLogs
 *   - jobStatuses
 *   - oauthConnections
 *   - accountingSyncJobs
 */
