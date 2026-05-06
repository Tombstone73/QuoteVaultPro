import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  inboundOrderDecisionFlags,
  inboundOrderEvents,
  inboundOrderFiles,
  inboundOrderLineItems,
  inboundOrderRecords,
  inboundOrderReviewSnapshots,
  inboundOrderWarnings,
  type InboundOrderDecisionFlag,
  type InboundOrderEvent,
  type InboundOrderFile,
  type InboundOrderLineItem,
  type InboundOrderRecord,
  type InboundOrderRecordStatus,
  type InboundOrderReviewSnapshot,
  type InboundOrderSourceType,
  type InboundOrderWarning,
} from "@shared/schema";

export type InboundOrderListFilters = {
  status?: InboundOrderRecordStatus;
  sourceType?: InboundOrderSourceType;
  assignedToUserId?: string;
  limit: number;
  offset: number;
};

export type CreateInboundOrderRecordValues = Omit<
  typeof inboundOrderRecords.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export type CreateInboundOrderEventValues = Omit<
  typeof inboundOrderEvents.$inferInsert,
  "id" | "createdAt"
>;

export class InboundOrdersRepository {
  constructor(private readonly dbInstance = db) {}

  async listRecords(
    organizationId: string,
    filters: InboundOrderListFilters,
  ): Promise<InboundOrderRecord[]> {
    const predicates = [eq(inboundOrderRecords.organizationId, organizationId)];

    if (filters.status) {
      predicates.push(eq(inboundOrderRecords.status, filters.status));
    }

    if (filters.sourceType) {
      predicates.push(eq(inboundOrderRecords.sourceType, filters.sourceType));
    }

    if (filters.assignedToUserId) {
      predicates.push(eq(inboundOrderRecords.assignedToUserId, filters.assignedToUserId));
    }

    return this.dbInstance
      .select()
      .from(inboundOrderRecords)
      .where(and(...predicates))
      .orderBy(desc(inboundOrderRecords.receivedAt), desc(inboundOrderRecords.createdAt))
      .limit(filters.limit)
      .offset(filters.offset);
  }

  async getRecord(organizationId: string, inboundRecordId: string): Promise<InboundOrderRecord | null> {
    const [record] = await this.dbInstance
      .select()
      .from(inboundOrderRecords)
      .where(
        and(
          eq(inboundOrderRecords.organizationId, organizationId),
          eq(inboundOrderRecords.id, inboundRecordId),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  async listLineItems(organizationId: string, inboundRecordId: string): Promise<InboundOrderLineItem[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderLineItems)
      .where(
        and(
          eq(inboundOrderLineItems.organizationId, organizationId),
          eq(inboundOrderLineItems.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderLineItems.sortOrder), asc(inboundOrderLineItems.createdAt));
  }

  async listFiles(organizationId: string, inboundRecordId: string): Promise<InboundOrderFile[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderFiles)
      .where(
        and(
          eq(inboundOrderFiles.organizationId, organizationId),
          eq(inboundOrderFiles.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderFiles.createdAt));
  }

  async listWarnings(organizationId: string, inboundRecordId: string): Promise<InboundOrderWarning[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderWarnings)
      .where(
        and(
          eq(inboundOrderWarnings.organizationId, organizationId),
          eq(inboundOrderWarnings.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderWarnings.createdAt));
  }

  async listDecisionFlags(organizationId: string, inboundRecordId: string): Promise<InboundOrderDecisionFlag[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderDecisionFlags)
      .where(
        and(
          eq(inboundOrderDecisionFlags.organizationId, organizationId),
          eq(inboundOrderDecisionFlags.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderDecisionFlags.createdAt));
  }

  async listEvents(organizationId: string, inboundRecordId: string): Promise<InboundOrderEvent[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderEvents)
      .where(
        and(
          eq(inboundOrderEvents.organizationId, organizationId),
          eq(inboundOrderEvents.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderEvents.createdAt));
  }

  async listReviewSnapshots(
    organizationId: string,
    inboundRecordId: string,
  ): Promise<InboundOrderReviewSnapshot[]> {
    return this.dbInstance
      .select()
      .from(inboundOrderReviewSnapshots)
      .where(
        and(
          eq(inboundOrderReviewSnapshots.organizationId, organizationId),
          eq(inboundOrderReviewSnapshots.inboundRecordId, inboundRecordId),
        ),
      )
      .orderBy(asc(inboundOrderReviewSnapshots.createdAt));
  }

  async createManualRecordWithEvent(args: {
    record: CreateInboundOrderRecordValues;
    event: Omit<CreateInboundOrderEventValues, "inboundRecordId">;
  }): Promise<{ record: InboundOrderRecord; event: InboundOrderEvent }> {
    return this.dbInstance.transaction(async (tx) => {
      const [record] = await tx
        .insert(inboundOrderRecords)
        .values(args.record)
        .returning();

      if (!record) {
        throw new Error("Failed to create inbound order record");
      }

      const [event] = await tx
        .insert(inboundOrderEvents)
        .values({
          ...args.event,
          inboundRecordId: record.id,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create inbound order event");
      }

      return { record, event };
    });
  }
}

export const inboundOrdersRepository = new InboundOrdersRepository();
