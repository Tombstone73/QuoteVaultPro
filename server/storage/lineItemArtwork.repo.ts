import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  fileRecords,
  lineItemArtwork,
  orderLineItems,
  orders,
  type InsertLineItemArtwork,
  type LineItemArtwork,
} from "@shared/schema";

export type TenantLineItem = { id: string; orderId: string };

export class LineItemArtworkRepository {
  constructor(private readonly dbInstance = db) {}

  async transaction<T>(callback: (tx: any, repository: LineItemArtworkRepository) => Promise<T>): Promise<T> {
    return this.dbInstance.transaction(async (tx: any) => callback(tx, new LineItemArtworkRepository(tx)));
  }

  async getLineItemForOrganization(organizationId: string, lineItemId: string, executor: any = this.dbInstance): Promise<TenantLineItem | null> {
    const [row] = await executor
      .select({ id: orderLineItems.id, orderId: orderLineItems.orderId })
      .from(orderLineItems)
      .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
      .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  async hasFileRecordForOrganization(organizationId: string, fileRecordId: string, executor: any = this.dbInstance): Promise<boolean> {
    const [row] = await executor
      .select({ id: fileRecords.id })
      .from(fileRecords)
      .where(and(eq(fileRecords.id, fileRecordId), eq(fileRecords.organizationId, organizationId)))
      .limit(1);
    return !!row;
  }

  async getByIdForOrganization(organizationId: string, artworkId: string, executor: any = this.dbInstance): Promise<LineItemArtwork | null> {
    const [row] = await executor
      .select()
      .from(lineItemArtwork)
      .where(and(eq(lineItemArtwork.id, artworkId), eq(lineItemArtwork.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  async listByLineItem(organizationId: string, lineItemId: string, options: { currentOnly?: boolean } = {}, executor: any = this.dbInstance): Promise<LineItemArtwork[]> {
    const predicates = [
      eq(lineItemArtwork.organizationId, organizationId),
      eq(lineItemArtwork.lineItemId, lineItemId),
    ];
    if (options.currentOnly) predicates.push(eq(lineItemArtwork.status, "current"));
    return executor
      .select()
      .from(lineItemArtwork)
      .where(and(...predicates))
      .orderBy(asc(lineItemArtwork.createdAt), asc(lineItemArtwork.id));
  }

  async create(values: InsertLineItemArtwork, executor: any = this.dbInstance): Promise<LineItemArtwork> {
    const [created] = await executor.insert(lineItemArtwork).values(values).returning();
    if (!created) throw new Error("Failed to create line-item artwork relationship");
    return created;
  }

  async markSuperseded(organizationId: string, artworkId: string, actorUserId: string | null, executor: any = this.dbInstance): Promise<LineItemArtwork | null> {
    const [updated] = await executor
      .update(lineItemArtwork)
      .set({ status: "superseded", supersededAt: new Date(), supersededByUserId: actorUserId })
      .where(and(
        eq(lineItemArtwork.organizationId, organizationId),
        eq(lineItemArtwork.id, artworkId),
        eq(lineItemArtwork.status, "current"),
      ))
      .returning();
    return updated ?? null;
  }
}

export const lineItemArtworkRepository = new LineItemArtworkRepository();
