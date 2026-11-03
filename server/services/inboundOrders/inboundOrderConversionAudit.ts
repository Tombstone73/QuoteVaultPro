import { and, eq, inArray, sql } from 'drizzle-orm';
import { inboundOrderRecords, inboundOrderEvents, orders, orderAuditLog, orderLineItems } from '@shared/schema';
import { inboundEmailMessageManifest } from '@shared/inboundEmailMessageManifest';
import { inboundLinkedOrderId } from '@shared/inboundAccountability';
import type { db } from '../../db';

/** Read-only diagnostics. Candidates are evidence of association, not authority
 * to merge, cancel, delete, or renumber Orders. Caller bounds the tenant/records. */
export async function auditInboundOrderConversions(database: Pick<typeof db, 'select'>, organizationId: string, recordIds: string[]) {
  if (!organizationId.trim() || !recordIds.length || recordIds.length > 50) throw new Error('Specify one organization and 1–50 inbound request IDs.');
  const records = await database.select().from(inboundOrderRecords).where(and(
    eq(inboundOrderRecords.organizationId, organizationId), inArray(inboundOrderRecords.id, recordIds),
  ));
  return Promise.all(records.map(async record => {
    const attempts = await database.select({ id: inboundOrderEvents.id, type: inboundOrderEvents.eventType,
      createdAt: inboundOrderEvents.createdAt, metadata: inboundOrderEvents.metadataJson }).from(inboundOrderEvents).where(and(
      eq(inboundOrderEvents.organizationId, organizationId), eq(inboundOrderEvents.inboundRecordId, record.id),
      inArray(inboundOrderEvents.eventType, ['convert.requested', 'convert.completed', 'convert.failed', 'order.attached']),
    ));
    const audit = await database.select({ orderId: orders.id }).from(orderAuditLog).innerJoin(orders, eq(orders.id, orderAuditLog.orderId)).where(and(
      eq(orders.organizationId, organizationId), sql`${orderAuditLog.metadata}->>'inboundRecordId' = ${record.id}`,
    ));
    const lines = await database.select({ orderId: orders.id }).from(orderLineItems).innerJoin(orders, eq(orders.id, orderLineItems.orderId)).where(and(
      eq(orders.organizationId, organizationId), sql`${orderLineItems.specsJson}#>>'{inbound,recordId}' = ${record.id}`,
    ));
    const candidateIds = [...new Set([inboundLinkedOrderId(record), ...audit.map(row => row.orderId), ...lines.map(row => row.orderId),
      ...attempts.map(event => typeof event.metadata?.orderId === 'string' ? event.metadata.orderId : null)].filter((id): id is string => Boolean(id)))];
    const candidates = candidateIds.length ? await database.select({ id: orders.id, number: orders.orderNumber, createdAt: orders.createdAt })
      .from(orders).where(and(eq(orders.organizationId, organizationId), inArray(orders.id, candidateIds))) : [];
    return { inboundRecordId: record.id, sourceId: record.sourceId, sourceMessageId: record.sourceMessageId,
      coveredMessageIds: inboundEmailMessageManifest(record)?.messageIds ?? [],
      createdAt: record.createdAt, linkedOrderId: inboundLinkedOrderId(record),
      candidateOrders: candidates, suspectedDuplicate: candidates.length > 1,
      conversionAttempts: attempts.map(event => ({ id: event.id, type: event.type, createdAt: event.createdAt,
        orderId: typeof event.metadata?.orderId === 'string' ? event.metadata.orderId : null })) };
  }));
}
