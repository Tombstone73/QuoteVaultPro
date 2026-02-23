import { db } from "../db";
import { lineItemFiles, orderLineItems, orders } from "@shared/schema";
import { and, eq } from "drizzle-orm";

type CreateLineItemFileRecordInput = {
  organizationId: string;
  lineItemId: string;
  role: "original" | "final" | "reference";
  storagePath: string;
  originalFilename: string;
  uploadedByUserId: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  orderId?: string | null;
  storageBucket?: string | null;
  storageKey?: string | null;
  tag?: string | null;
};

export async function createLineItemFileRecord(input: CreateLineItemFileRecordInput) {
  const {
    organizationId,
    lineItemId,
    role,
    storagePath,
    originalFilename,
    uploadedByUserId,
    mimeType,
    sizeBytes,
    orderId,
    storageBucket,
    storageKey,
    tag,
  } = input;

  const conditions = [
    eq(orderLineItems.id, lineItemId),
    eq(orders.organizationId, organizationId),
  ];

  if (orderId) {
    conditions.push(eq(orderLineItems.orderId, orderId));
  }

  const [lineItemRow] = await db
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(...conditions))
    .limit(1);

  if (!lineItemRow) {
    throw new Error("Line item not found for organization");
  }

  const [created] = await db
    .insert(lineItemFiles)
    .values({
      organizationId,
      orderId: lineItemRow.orderId,
      lineItemId: lineItemRow.lineItemId,
      prepressSessionId: null,
      role,
      status: "active",
      tag: tag ?? null,
      storageBucket: storageBucket ?? null,
      storagePath,
      storageKey: storageKey ?? null,
      originalFilename,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: Math.max(0, Number(sizeBytes || 0)),
      supersedesFileId: null,
      createdByUserId: uploadedByUserId,
    })
    .returning();

  return created;
}
