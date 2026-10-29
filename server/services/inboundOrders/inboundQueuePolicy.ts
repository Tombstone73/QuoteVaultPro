import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { inboundOrderRecords as record, orders } from "@shared/schema";
import type { InboundQueueBucket } from "@shared/inboundAccountability";

/** A merged source's later evidence must retain the parent's actual job context.
 * This is a read projection, never another Order or a resolution of that source. */
export function inboundParentOrderIdSql() {
  const parent = alias(record, "inbound_parent");
  const order = alias(orders, "inbound_parent_order");
  return sql<string | null>`(select ${order.id} from ${record} as "inbound_parent" inner join ${orders} as "inbound_parent_order"
    on ${order.id} = coalesce(${parent.createdOrderId}, nullif(${parent.normalizedPayloadJson}->>'attachedOrderId', ''))
    and ${order.organizationId} = ${record.organizationId}
    where ${parent.organizationId} = ${record.organizationId}
      and ${parent.id} = ${record.normalizedPayloadJson}->>'combinedParentRecordId' limit 1)`;
}

/** One projection shared by list filters and summary counts. Keep in agreement
 * with shared/inboundAccountability (also exercised against the generated SQL). */
export function inboundQueueBucketSql() {
  return sql<InboundQueueBucket>`case
    when nullif(${record.normalizedPayloadJson}->>'unresolvedEvidenceFingerprint', '') is not null
      or (nullif(${record.normalizedPayloadJson}#>>'{evidenceResolution,fingerprint}', '') is not null
        and nullif(${record.normalizedPayloadJson}->>'evidenceFingerprint', '') is not null
        and ${record.normalizedPayloadJson}#>>'{evidenceResolution,fingerprint}' <> ${record.normalizedPayloadJson}->>'evidenceFingerprint') then 'needs_review'
    when ${record.reviewOutcome} = 'deleted' then 'deleted'
    when (${record.status} = 'ignored' and coalesce(${record.reviewOutcome}, '') <> 'attached_to_order') or ${record.reviewOutcome} = 'ignored' then 'ignored'
    when ${record.status} = 'terminal' or ${record.reviewOutcome} = 'rejected' then 'rejected'
    when exists (select 1 from ${orders} where ${orders.organizationId} = ${record.organizationId}
      and ${orders.id} = coalesce(${record.createdOrderId}, nullif(${record.normalizedPayloadJson}->>'attachedOrderId', ''))) then 'converted'
    when ${record.createdQuoteId} is not null or ${record.status} = 'waiting_on_customer' then 'waiting'
    when ${record.status} = 'ready' then 'ready'
    else 'needs_review' end`;
}
