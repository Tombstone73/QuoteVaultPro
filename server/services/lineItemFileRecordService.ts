import { db } from "../db";
import { lineItemFiles, orderLineItems, orders } from "@shared/schema";
import { and, eq } from "drizzle-orm";

type CreateLineItemFileRecordInput = {
  organizationId: string;
  lineItemId: string;
  role: "original" | "final" | "reference";
  fileRecordId?: string | null;
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
    fileRecordId,
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

  const existingConditions = [
    eq(lineItemFiles.organizationId, organizationId),
    eq(lineItemFiles.orderId, lineItemRow.orderId),
    eq(lineItemFiles.lineItemId, lineItemRow.lineItemId),
    eq(lineItemFiles.role, role),
    eq(lineItemFiles.status, "active"),
  ];

  if (fileRecordId) {
    existingConditions.push(eq(lineItemFiles.fileRecordId, fileRecordId));
  } else {
    existingConditions.push(eq(lineItemFiles.storagePath, storagePath));
  }

  const [existing] = await db
    .select()
    .from(lineItemFiles)
    .where(and(...existingConditions))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(lineItemFiles)
    .values({
      organizationId,
      orderId: lineItemRow.orderId,
      lineItemId: lineItemRow.lineItemId,
      prepressSessionId: null,
      fileRecordId: fileRecordId ?? null,
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
