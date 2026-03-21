import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  orderInternalNotes,
  orderLineItemNotes,
  orders,
  orderLineItems,
  users,
  type CreateOrderInternalNote,
  type CreateOrderLineItemNote,
  type OrderInternalNote,
  type OrderLineItemNote,
  type OrderLineItemNoteCategory,
} from "@shared/schema";

export type StructuredOrderNoteRow = OrderInternalNote & {
  createdByUserName: string | null;
};

export type StructuredOrderLineItemNoteRow = OrderLineItemNote & {
  createdByUserName: string | null;
};

export type OrderLineItemOwnershipRow = {
  orderId: string;
  lineItemId: string;
};

export class StructuredOrderNotesRepository {
  constructor(private readonly dbInstance = db) {}

  async getOrderOwnership(
    organizationId: string,
    orderId: string,
    executor: any = this.dbInstance,
  ): Promise<{ orderId: string } | null> {
    const [row] = await executor
      .select({ orderId: orders.id })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
      .limit(1);

    return row ?? null;
  }

  async getLineItemOwnership(
    organizationId: string,
    orderId: string,
    lineItemId: string,
    executor: any = this.dbInstance,
  ): Promise<OrderLineItemOwnershipRow | null> {
    const [row] = await executor
      .select({
        orderId: orderLineItems.orderId,
        lineItemId: orderLineItems.id,
      })
      .from(orderLineItems)
      .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orderLineItems.orderId, orderId),
          eq(orderLineItems.id, lineItemId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async listOrderInternalNotes(
    organizationId: string,
    orderId: string,
    executor: any = this.dbInstance,
  ): Promise<StructuredOrderNoteRow[]> {
    return executor
      .select({
        id: orderInternalNotes.id,
        organizationId: orderInternalNotes.organizationId,
        orderId: orderInternalNotes.orderId,
        noteText: orderInternalNotes.noteText,
        audienceTags: orderInternalNotes.audienceTags,
        createdByUserId: orderInternalNotes.createdByUserId,
        createdAt: orderInternalNotes.createdAt,
        createdByUserName: users.email,
      })
      .from(orderInternalNotes)
      .leftJoin(users, eq(orderInternalNotes.createdByUserId, users.id))
      .where(
        and(
          eq(orderInternalNotes.organizationId, organizationId),
          eq(orderInternalNotes.orderId, orderId),
        ),
      )
      .orderBy(asc(orderInternalNotes.createdAt));
  }

  async addOrderInternalNote(
    organizationId: string,
    orderId: string,
    userId: string | null,
    values: CreateOrderInternalNote,
    executor: any = this.dbInstance,
  ): Promise<OrderInternalNote> {
    const [created] = await executor
      .insert(orderInternalNotes)
      .values({
        organizationId,
        orderId,
        noteText: values.noteText,
        audienceTags: values.audienceTags ?? null,
        createdByUserId: userId,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create order internal note");
    }

    return created;
  }

  async listLineItemNotes(
    organizationId: string,
    orderId: string,
    lineItemId: string,
    category: OrderLineItemNoteCategory | null,
    executor: any = this.dbInstance,
  ): Promise<StructuredOrderLineItemNoteRow[]> {
    const predicates = [
      eq(orderLineItemNotes.organizationId, organizationId),
      eq(orderLineItemNotes.orderId, orderId),
      eq(orderLineItemNotes.lineItemId, lineItemId),
    ];

    if (category) {
      predicates.push(eq(orderLineItemNotes.category, category));
    }

    return executor
      .select({
        id: orderLineItemNotes.id,
        organizationId: orderLineItemNotes.organizationId,
        orderId: orderLineItemNotes.orderId,
        lineItemId: orderLineItemNotes.lineItemId,
        category: orderLineItemNotes.category,
        noteText: orderLineItemNotes.noteText,
        createdByUserId: orderLineItemNotes.createdByUserId,
        createdAt: orderLineItemNotes.createdAt,
        createdByUserName: users.email,
      })
      .from(orderLineItemNotes)
      .leftJoin(users, eq(orderLineItemNotes.createdByUserId, users.id))
      .where(
        and(...predicates),
      )
      .orderBy(asc(orderLineItemNotes.createdAt));
  }

  async addLineItemNote(
    organizationId: string,
    orderId: string,
    lineItemId: string,
    userId: string | null,
    values: CreateOrderLineItemNote,
    executor: any = this.dbInstance,
  ): Promise<OrderLineItemNote> {
    const [created] = await executor
      .insert(orderLineItemNotes)
      .values({
        organizationId,
        orderId,
        lineItemId,
        category: values.category,
        noteText: values.noteText,
        createdByUserId: userId,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create order line item note");
    }

    return created;
  }
}

export const structuredOrderNotesRepository = new StructuredOrderNotesRepository();