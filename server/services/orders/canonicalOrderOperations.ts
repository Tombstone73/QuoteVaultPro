import { and, eq } from "drizzle-orm";

import { auditLogs, orders } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { resolveOrderCustomerContactIds } from "../orderCustomerResolutionService";

type CreateOrderPayload = Parameters<typeof storage.createOrder>[1];
type UpdateOrderPayload = Parameters<typeof storage.updateOrder>[2];
export type CanonicalQuoteConversionOptions = Parameters<typeof storage.convertQuoteToOrder>[3];

export class CanonicalOrderOperationError extends Error {
  constructor(readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_EDITABLE" | "ORDER_STALE", message: string) { super(message); }
}

/** Shared boundary for Order header/create/conversion writes. */
class CanonicalOrderOperations {
  async normalizeOwnerIdentity(input: { organizationId: string; customerId?: string | null; contactId?: string | null }) { return resolveOrderCustomerContactIds(input); }

  async create(input: { organizationId: string; actorUserId: string; payload: CreateOrderPayload; auditDescription?: string }) {
    const identity = await this.normalizeOwnerIdentity({ organizationId: input.organizationId, customerId: input.payload.customerId, contactId: input.payload.contactId });
    const order = await storage.createOrder(input.organizationId, { ...input.payload, createdByUserId: input.actorUserId, customerId: identity.customerId, contactId: identity.contactId });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "CREATE", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: input.auditDescription ?? `Created order ${order.displayNumber || order.orderNumber}.` });
    return order;
  }

  async updateEditableHeader(input: { organizationId: string; actorUserId: string; orderId: string; changes: UpdateOrderPayload; expectedUpdatedAt?: Date | string | null; allowNonNew?: boolean; auditDescription?: string }) {
    const [existing] = await db.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId))).limit(1);
    if (!existing) throw new CanonicalOrderOperationError("ORDER_NOT_FOUND", "Order not found.");
    if (!input.allowNonNew && existing.status !== "new") throw new CanonicalOrderOperationError("ORDER_NOT_EDITABLE", "Only new orders can be changed by this operation.");
    if (input.expectedUpdatedAt && String(existing.updatedAt) !== String(input.expectedUpdatedAt)) throw new CanonicalOrderOperationError("ORDER_STALE", "The order changed after this proposal was prepared.");
    const ownerTouched = input.changes.customerId !== undefined || input.changes.contactId !== undefined;
    const identity = ownerTouched ? await this.normalizeOwnerIdentity({ organizationId: input.organizationId, customerId: input.changes.customerId !== undefined ? input.changes.customerId as string | null : existing.customerId, contactId: input.changes.contactId !== undefined ? input.changes.contactId as string | null : existing.contactId }) : null;
    const order = await storage.updateOrder(input.organizationId, input.orderId, { ...input.changes, ...(identity ? { customerId: identity.customerId, contactId: identity.contactId } : {}) });
    await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "UPDATE", entityType: "order", entityId: order.id, entityName: order.displayNumber || order.orderNumber, description: input.auditDescription ?? `Updated order ${order.displayNumber || order.orderNumber}.` });
    return order;
  }

  async convertQuoteToOrder(input: { organizationId: string; actorUserId: string; quoteId: string; options?: CanonicalQuoteConversionOptions }) {
    return storage.convertQuoteToOrder(input.organizationId, input.quoteId, input.actorUserId, input.options);
  }
}

export const canonicalOrderOperations = new CanonicalOrderOperations();
