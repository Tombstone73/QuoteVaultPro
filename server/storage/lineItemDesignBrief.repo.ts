import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  lineItemDesignBriefs,
  type InsertLineItemDesignBrief,
  type LineItemDesignBrief,
} from "@shared/schema";

type LineItemDesignBriefUpsertValues = Omit<
  InsertLineItemDesignBrief,
  | "id"
  | "organizationId"
  | "orderId"
  | "orderLineItemId"
  | "createdByUserId"
  | "updatedByUserId"
  | "createdAt"
  | "updatedAt"
>;

export class LineItemDesignBriefRepository {
  constructor(private readonly dbInstance = db) {}

  async getByLineItemId(
    organizationId: string,
    orderId: string,
    orderLineItemId: string,
    executor: any = this.dbInstance,
  ): Promise<LineItemDesignBrief | null> {
    const [brief] = await executor
      .select()
      .from(lineItemDesignBriefs)
      .where(
        and(
          eq(lineItemDesignBriefs.organizationId, organizationId),
          eq(lineItemDesignBriefs.orderId, orderId),
          eq(lineItemDesignBriefs.orderLineItemId, orderLineItemId),
        ),
      )
      .limit(1);

    return brief ?? null;
  }

  async upsertForLineItem(
    organizationId: string,
    orderId: string,
    orderLineItemId: string,
    userId: string | null,
    values: LineItemDesignBriefUpsertValues,
    executor: any = this.dbInstance,
  ): Promise<LineItemDesignBrief> {
    const [brief] = await executor
      .insert(lineItemDesignBriefs)
      .values({
        organizationId,
        orderId,
        orderLineItemId,
        ...values,
        createdByUserId: userId,
        updatedByUserId: userId,
      })
      .onConflictDoUpdate({
        target: lineItemDesignBriefs.orderLineItemId,
        set: {
          ...values,
          updatedByUserId: userId,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!brief) {
      throw new Error("Failed to save line item design brief");
    }

    return brief;
  }
}

export const lineItemDesignBriefRepository = new LineItemDesignBriefRepository();