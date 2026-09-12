import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  customerContacts,
  customers,
  materials,
  orderLineItems,
  orders,
  products,
} from "@shared/schema";
import {
  collectLineItemProductionMaterialIds,
  resolveLineItemMaterialDisplayLabel,
} from "../routes/flatStockNesting.shared";
import type { OrderTravelerSource } from "@shared/productionTicket";

/**
 * The single server-side projection used by both an authenticated browser and
 * a claimed local print job. Rendering remains in the existing Traveler page;
 * this only provides its canonical source data.
 */
export async function getOrderTravelerSource(
  organizationId: string,
  orderId: string,
): Promise<OrderTravelerSource | null> {
  const orderRows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      poNumber: orders.poNumber,
      jobLabel: orders.label,
      dueDate: orders.dueDate,
      priority: orders.priority,
      notesInternal: orders.notesInternal,
      contactId: orders.contactId,
      customerName: customers.companyName,
    })
    .from(orders)
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, organizationId)))
    .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
    .limit(1);
  const order = orderRows[0];
  if (!order) return null;

  let contactName: string | null = null;
  if (order.contactId) {
    const [contact] = await db
      .select({ firstName: customerContacts.firstName, lastName: customerContacts.lastName })
      .from(customerContacts)
      .where(eq(customerContacts.id, order.contactId))
      .limit(1);
    if (contact) contactName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || null;
  }

  const lineItemRows = await db
    .select({
      id: orderLineItems.id,
      description: orderLineItems.description,
      quantity: orderLineItems.quantity,
      width: orderLineItems.width,
      height: orderLineItems.height,
      materialId: orderLineItems.materialId,
      productPrimaryMaterialId: products.primaryMaterialId,
      pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
      materialUsageJson: orderLineItems.materialUsageJson,
      materialUsages: orderLineItems.materialUsages,
      specsJson: orderLineItems.specsJson,
      optionSelectionsJson: orderLineItems.optionSelectionsJson,
      selectedOptions: orderLineItems.selectedOptions,
      productionNotes: orderLineItems.productionNotes,
      sortOrder: orderLineItems.sortOrder,
      createdAt: orderLineItems.createdAt,
    })
    .from(orderLineItems)
    .leftJoin(products, and(eq(orderLineItems.productId, products.id), eq(products.organizationId, organizationId)))
    .where(eq(orderLineItems.orderId, orderId))
    .orderBy(orderLineItems.sortOrder, orderLineItems.createdAt);

  const materialIds = Array.from(new Set(lineItemRows.flatMap((lineItem) =>
    collectLineItemProductionMaterialIds({
      lineItem,
      productPrimaryMaterialId: lineItem.productPrimaryMaterialId ?? null,
    }),
  )));
  const materialNameById = new Map<string, string>();
  if (materialIds.length) {
    const materialRows = await db
      .select({ id: materials.id, name: materials.name })
      .from(materials)
      .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)));
    for (const material of materialRows) materialNameById.set(material.id, material.name);
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    poNumber: order.poNumber ?? null,
    jobLabel: order.jobLabel ?? null,
    customerName: String(order.customerName || "—"),
    contactName,
    dueDate: order.dueDate ?? null,
    priority: order.priority ?? null,
    internalNotes: order.notesInternal ?? null,
    lineItems: lineItemRows.map((lineItem) => ({
      description: lineItem.description ?? "",
      quantity: Number(lineItem.quantity) || 0,
      size: lineItem.width && lineItem.height ? `${lineItem.width} × ${lineItem.height}` : null,
      material: resolveLineItemMaterialDisplayLabel({
        lineItem,
        materialName: lineItem.materialId ? materialNameById.get(lineItem.materialId) ?? null : null,
        materialById: materialNameById,
        productPrimaryMaterialId: lineItem.productPrimaryMaterialId ?? null,
        primaryMaterialName: lineItem.productPrimaryMaterialId ? materialNameById.get(lineItem.productPrimaryMaterialId) ?? null : null,
      }),
      productionNotes: lineItem.productionNotes ?? null,
    })),
  };
}
