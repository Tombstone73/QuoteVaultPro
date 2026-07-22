import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  invoices,
  materialProductLinks,
  materials,
  orderLineItems,
  orders,
  pbv2TreeVersions,
  productOptions,
  products,
  productionJobs,
} from "@shared/schema";

/**
 * Narrow, tenant-bound data access for assistant read tools.  This is kept
 * separate from legacy route/storage helpers because several of those helpers
 * predate tenant predicates on related entities.
 */
export class AssistantOrderProductRepository {
  async getOrder(organizationId: string, input: { orderId?: string; orderNumber?: string }) {
    const orderPredicate = input.orderId
      ? eq(orders.id, input.orderId)
      : eq(orders.orderNumber, input.orderNumber!);

    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        displayNumber: orders.displayNumber,
        status: orders.status,
        dueDate: orders.dueDate,
        updatedAt: orders.updatedAt,
        customerId: customers.id,
        customerName: customers.companyName,
      })
      .from(orders)
      .innerJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.organizationId, organizationId)))
      .where(and(eq(orders.organizationId, organizationId), orderPredicate))
      .limit(1);

    if (!order) return null;

    const [lineItems, production, invoiceRows] = await Promise.all([
      db
        .select({
          id: orderLineItems.id,
          description: orderLineItems.description,
          quantity: orderLineItems.quantity,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          requiresDesign: orderLineItems.requiresDesign,
          designStatus: orderLineItems.designStatus,
          requiresProofApproval: orderLineItems.requiresProofApproval,
          approvedProofVersionId: orderLineItems.approvedProofVersionId,
          requiresPrepress: orderLineItems.requiresPrepress,
          sortOrder: orderLineItems.sortOrder,
          productName: products.name,
        })
        .from(orderLineItems)
        .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.organizationId, organizationId)))
        .leftJoin(products, and(eq(products.id, orderLineItems.productId), eq(products.organizationId, organizationId)))
        .where(and(eq(orderLineItems.orderId, order.id), eq(orders.organizationId, organizationId)))
        .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.id))
        .limit(25),
      db
        .select({
          id: productionJobs.id,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          updatedAt: productionJobs.updatedAt,
        })
        .from(productionJobs)
        .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, order.id)))
        .orderBy(desc(productionJobs.updatedAt))
        .limit(25),
      db
        .select({
          id: invoices.id,
          displayNumber: invoices.displayNumber,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          updatedAt: invoices.updatedAt,
        })
        .from(invoices)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, order.id)))
        .orderBy(desc(invoices.updatedAt))
        .limit(5),
    ]);

    // Keep the assistant's core order read independent from newer workflow
    // columns. Those columns are optional enrichments in the application and
    // are not present in every safely supported DEV schema revision; selecting
    // one missing column made an otherwise valid tenant-scoped lookup fail.
    return { order, lineItems, production, invoices: invoiceRows };
  }

  async getProduct(organizationId: string, input: { productId?: string; query?: string }) {
    const productPredicate = input.productId
      ? eq(products.id, input.productId)
      : ilike(products.name, `%${escapeLike(input.query!)}%`);

    const [product] = await db
      .select({
        id: products.id,
        name: products.name,
        isActive: products.isActive,
        category: products.category,
        pricingMode: products.pricingMode,
        pricingEngine: products.pricingEngine,
        pricingProfileKey: products.pricingProfileKey,
        requiresProductionJob: products.requiresProductionJob,
        requiresProofApproval: products.requiresProofApproval,
        artworkPolicy: products.artworkPolicy,
        pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .where(and(eq(products.organizationId, organizationId), productPredicate))
      .orderBy(asc(products.name))
      .limit(1);

    if (!product) return null;

    const [versions, options, materialRows] = await Promise.all([
      db
        .select({
          id: pbv2TreeVersions.id,
          status: pbv2TreeVersions.status,
          schemaVersion: pbv2TreeVersions.schemaVersion,
          publishedAt: pbv2TreeVersions.publishedAt,
          updatedAt: pbv2TreeVersions.updatedAt,
        })
        .from(pbv2TreeVersions)
        .where(and(
          eq(pbv2TreeVersions.organizationId, organizationId),
          eq(pbv2TreeVersions.productId, product.id),
        ))
        .orderBy(desc(pbv2TreeVersions.updatedAt))
        .limit(5),
      db
        .select({
          id: productOptions.id,
          name: productOptions.name,
          type: productOptions.type,
          isActive: productOptions.isActive,
          displayOrder: productOptions.displayOrder,
        })
        .from(productOptions)
        .innerJoin(products, and(eq(products.id, productOptions.productId), eq(products.organizationId, organizationId)))
        .where(and(eq(productOptions.productId, product.id), eq(products.organizationId, organizationId)))
        .orderBy(asc(productOptions.displayOrder), asc(productOptions.id))
        .limit(25),
      db
        .select({ id: materials.id, name: materials.name, sku: materials.sku })
        .from(materialProductLinks)
        .innerJoin(materials, and(eq(materials.id, materialProductLinks.materialId), eq(materials.organizationId, organizationId)))
        .where(and(
          eq(materialProductLinks.organizationId, organizationId),
          eq(materialProductLinks.productId, product.id),
          sql`${materialProductLinks.removedAt} is null`,
        ))
        .orderBy(asc(materials.name))
        .limit(20),
    ]);

    return { product, versions, options, materials: materialRows };
  }
}

export function escapeLike(value: string): string {
  // Treat all wildcard characters as text. The value is still passed as a
  // parameter by Drizzle; this only controls LIKE semantics.
  return value.replace(/[\\%_]/g, "\\$&");
}
