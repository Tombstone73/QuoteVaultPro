import { sql } from "drizzle-orm";
import { inboundOrderRecords as record } from "@shared/schema";
import type { InboundQueueBucket } from "@shared/inboundAccountability";

/** A merged source's later evidence must retain the parent's actual job context.
 * This is a read projection, never another Order or a resolution of that source. */
export function inboundParentOrderIdSql() {
  // Drizzle strips Column qualifiers from a single-table SELECT projection,
  // including nested SQL fragments. Explicit identifiers keep correlated
  // subqueries bound to the outer record and retain their tenant predicates.
  return sql<string | null>`(select "inbound_parent_order"."id"
    from "inbound_order_records" as "inbound_parent" inner join "orders" as "inbound_parent_order"
    on "inbound_parent_order"."id" = coalesce("inbound_parent"."created_order_id", nullif("inbound_parent"."normalized_payload_json"->>'attachedOrderId', ''))
    and "inbound_parent_order"."organization_id" = "inbound_order_records"."organization_id"
    where "inbound_parent"."organization_id" = "inbound_order_records"."organization_id"
      and "inbound_parent"."id" = "inbound_order_records"."normalized_payload_json"->>'combinedParentRecordId' limit 1)`;
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
    when exists (select 1 from "orders" as "inbound_linked_order"
      where "inbound_linked_order"."organization_id" = "inbound_order_records"."organization_id"
      and "inbound_linked_order"."id" = coalesce("inbound_order_records"."created_order_id", nullif("inbound_order_records"."normalized_payload_json"->>'attachedOrderId', ''))) then 'converted'
    when ${record.createdQuoteId} is not null or ${record.status} = 'waiting_on_customer' then 'waiting'
    when ${record.status} = 'ready' then 'ready'
    else 'needs_review' end`;
}
