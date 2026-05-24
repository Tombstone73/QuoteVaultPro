import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  portalFollowUpItems,
  type PortalFollowUpEventType,
  type PortalFollowUpItem,
  type PortalFollowUpStatus,
} from "@shared/schema";

export type PortalFollowUpEntityType = "quote" | "order" | "proof" | "invoice";

export type PortalFollowUpDto = {
  id: string;
  eventType: PortalFollowUpEventType;
  status: PortalFollowUpStatus;
  title: string;
  description: string | null;
  customerName: string | null;
  entityType: PortalFollowUpEntityType | string;
  entityId: string;
  followUpArea: string | null;
  actionUrl: string | null;
  createdAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

export type PortalFollowUpSummaryDto = {
  unresolvedCount: number;
  items: PortalFollowUpDto[];
};

export type RecordPortalFollowUpInput = {
  organizationId: string;
  eventType: PortalFollowUpEventType;
  customerId?: string | null;
  customerName?: string | null;
  entityType: PortalFollowUpEntityType;
  entityId: string;
  relatedOrderId?: string | null;
  relatedQuoteId?: string | null;
  relatedProofId?: string | null;
  title: string;
  description?: string | null;
  followUpArea?: string | null;
  actionUrl?: string | null;
  idempotencyKey?: string;
  sourceAuditLogId?: string | null;
  metadata?: Record<string, unknown>;
};

export const PORTAL_FOLLOW_UP_EVENT_LABELS: Record<PortalFollowUpEventType, string> = {
  QUOTE_APPROVED: "Quote Approved",
  QUOTE_DECLINED: "Quote Declined",
  QUOTE_REVISION_REQUESTED: "Quote Revision Requested",
  PROOF_APPROVED: "Proof Approved",
  PROOF_REJECTED: "Proof Rejected",
  PROOF_REVISION_REQUESTED: "Proof Revision Requested",
  INVOICE_PAYMENT_SUCCEEDED: "Invoice Payment Received",
};

export function buildPortalFollowUpIdempotencyKey(
  eventType: PortalFollowUpEventType,
  entityType: PortalFollowUpEntityType,
  entityId: string,
): string {
  return `portal:${eventType}:${entityType}:${entityId}`;
}

export function defaultPortalFollowUpArea(eventType: PortalFollowUpEventType): string {
  if (eventType === "QUOTE_REVISION_REQUESTED") return "Estimating";
  if (eventType === "QUOTE_APPROVED") return "Order Review";
  if (eventType === "QUOTE_DECLINED") return "Sales";
  if (eventType === "PROOF_REJECTED" || eventType === "PROOF_REVISION_REQUESTED") return "Design";
  if (eventType === "PROOF_APPROVED") return "Production";
  if (eventType === "INVOICE_PAYMENT_SUCCEEDED") return "Accounting";
  return "Operations";
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapPortalFollowUpItem(row: PortalFollowUpItem): PortalFollowUpDto {
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    title: row.title,
    description: row.description ?? null,
    customerName: row.customerName ?? null,
    entityType: row.entityType,
    entityId: row.entityId,
    followUpArea: row.followUpArea ?? null,
    actionUrl: row.actionUrl ?? null,
    createdAt: toIso(row.createdAt),
    acknowledgedAt: toIso(row.acknowledgedAt),
    resolvedAt: toIso(row.resolvedAt),
  };
}

export async function recordPortalFollowUpItem(
  tx: any,
  input: RecordPortalFollowUpInput,
): Promise<void> {
  const idempotencyKey = input.idempotencyKey || buildPortalFollowUpIdempotencyKey(input.eventType, input.entityType, input.entityId);
  const now = new Date();

  await tx
    .insert(portalFollowUpItems)
    .values({
      organizationId: input.organizationId,
      idempotencyKey,
      eventType: input.eventType,
      status: "new",
      customerId: input.customerId ?? null,
      customerName: input.customerName ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      relatedOrderId: input.relatedOrderId ?? null,
      relatedQuoteId: input.relatedQuoteId ?? null,
      relatedProofId: input.relatedProofId ?? null,
      title: input.title,
      description: input.description ?? null,
      followUpArea: input.followUpArea ?? defaultPortalFollowUpArea(input.eventType),
      actionUrl: input.actionUrl ?? null,
      source: "customer_portal",
      sourceAuditLogId: input.sourceAuditLogId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [portalFollowUpItems.organizationId, portalFollowUpItems.idempotencyKey],
    });
}

export async function listPortalFollowUpItems(
  organizationId: string,
  status: "open" | "all" | PortalFollowUpStatus = "open",
  limit = 10,
): Promise<PortalFollowUpSummaryDto> {
  const statuses = status === "open" ? ["new", "pending"] : status === "all" ? ["new", "pending", "completed"] : [status];
  const boundedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const [items, counts] = await Promise.all([
    db
      .select()
      .from(portalFollowUpItems)
      .where(and(eq(portalFollowUpItems.organizationId, organizationId), inArray(portalFollowUpItems.status, statuses as PortalFollowUpStatus[])))
      .orderBy(desc(portalFollowUpItems.createdAt))
      .limit(boundedLimit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(portalFollowUpItems)
      .where(and(eq(portalFollowUpItems.organizationId, organizationId), inArray(portalFollowUpItems.status, ["new", "pending"]))),
  ]);

  return {
    unresolvedCount: Number(counts[0]?.count || 0),
    items: items.map(mapPortalFollowUpItem),
  };
}

export async function updatePortalFollowUpStatus(
  organizationId: string,
  id: string,
  status: PortalFollowUpStatus,
  updatedByUserId: string | null,
): Promise<PortalFollowUpDto | null> {
  const now = new Date();
  const values: Partial<typeof portalFollowUpItems.$inferInsert> = {
    status,
    updatedByUserId,
    updatedAt: now,
  };
  if (status === "pending") values.acknowledgedAt = now;
  if (status === "completed") values.resolvedAt = now;
  if (status === "new") values.resolvedAt = null;

  const [updated] = await db
    .update(portalFollowUpItems)
    .set(values as any)
    .where(and(eq(portalFollowUpItems.organizationId, organizationId), eq(portalFollowUpItems.id, id)))
    .returning();

  return updated ? mapPortalFollowUpItem(updated) : null;
}
