import type { Pool, PoolClient } from "pg";
import type { QuoteCheckpoint } from "../../src/modules/sales/contracts.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { parsePreparedQuoteDeliveryEvidence } from "./preparedQuoteDeliveryEvidence.js";
import type { PostgresCustomerDocumentService } from "./postgresCustomerDocuments.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { preparedEvidenceMatchesCheckpoint, publishedQuoteProjection, type QuotePublicationReadPort, type PublishedQuoteSummary } from "../../src/modules/sales/quotePublication.js";

type Row = { id: string; organization_id: string; quote_document_id: string; payload: QuoteCheckpoint; occurred_at: Date; checkpoint_sequence: number; prepared_evidence_json: unknown;
  attempt_id: string | null; recipient_email: string | null; document_sha256: string | null; provider_message_id: string | null;
  order_document_id: string | null; acceptance_state: string; lifecycle_state: string };

/** Resend is unavailable before the coordinator's forward index migration.
 * Check before provider invocation, not after an irreversible delivery. */
export const assertQuoteResendSchema = async (db: Pick<PoolClient, "query">): Promise<void> => {
  const result = await db.query<{ indexname: string; indexdef: string }>("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='v2_sales_quote_delivery_attempts' AND indexname IN ('v2_sales_quote_delivery_attempts_one_success_uidx','v2_sales_quote_delivery_attempts_checkpoint_success_uidx')");
  const modern = result.rows.find(row => row.indexname === "v2_sales_quote_delivery_attempts_checkpoint_success_uidx");
  if (result.rows.some(row => row.indexname === "v2_sales_quote_delivery_attempts_one_success_uidx") || !modern
    || !/CREATE UNIQUE INDEX/u.test(modern.indexdef) || !/\(organization_id, quote_document_id, quote_checkpoint_id\)/u.test(modern.indexdef)
    || !/WHERE.*delivery_state.*succeeded/u.test(modern.indexdef))
    throw new V2ApplicationError("RETRYABLE_FAILURE", "Quote resend schema is unavailable. No customer delivery was attempted.");
};
/** One qualification for every publication consumer. Provider/attempt success
 * alone is not publication: the exact delivery M0 receipt must have committed.
 * Never bind audience to the mutable header Customer or a receipt actor ID. */
export const publishedQuoteCheckpointSql = `SELECT cp.id,cp.payload,cp.occurred_at,cp.checkpoint_sequence,cp.organization_id,cp.quote_document_id,a.prepared_evidence_json,a.id AS attempt_id,a.recipient_email,a.document_sha256,a.provider_message_id
  FROM v2_sales_quote_checkpoints cp
  JOIN v2_sales_quote_delivery_attempts a ON a.organization_id=cp.organization_id AND a.quote_document_id=cp.quote_document_id AND a.quote_checkpoint_id=cp.id
  JOIN v2_operation_requests r ON r.organization_id=a.organization_id AND r.id=a.operation_request_id
  WHERE cp.organization_id=$1 AND ($2::varchar IS NULL OR cp.quote_document_id=$2) AND cp.checkpoint_kind='quote_sent'
    AND a.delivery_state='succeeded'
    AND r.operation='sales.quote.delivery.v1' AND r.status='succeeded' AND r.completed_at IS NOT NULL
    AND r.result_resource_type='quote' AND r.result_resource_id=cp.quote_document_id
    AND jsonb_typeof(r.result_json)='object' AND r.result_json->>'checkpointId'=cp.id
    AND r.result_json#>>'{quote,quote,organizationId}'=cp.organization_id
    AND r.result_json#>>'{quote,quote,quoteId}'=cp.quote_document_id
    AND (NOT (r.result_json->'quote' ? 'publishedCheckpointId') OR r.result_json#>>'{quote,publishedCheckpointId}'=cp.id)
  ORDER BY cp.checkpoint_sequence DESC`;

export const readPublishedQuoteCheckpoints = async (db: Pool | PoolClient, organizationId: string, quoteId: string) =>
  (await db.query<Row>(publishedQuoteCheckpointSql, [organizationId, quoteId])).rows;

export const publicationEvidenceStatus = (row: Pick<Row, "id" | "organization_id" | "quote_document_id" | "payload" | "prepared_evidence_json" | "attempt_id" | "recipient_email" | "document_sha256" | "provider_message_id">): "modern" | "historical" | null => {
  if (row.payload.kind !== "quote_sent" || row.payload.checkpointId !== row.id || row.payload.organizationId !== row.organization_id
    || row.payload.sourceDocument?.quoteId !== row.quote_document_id) return null;
  const sent = row.payload.sentEvidence;
  if (sent && (sent.deliveryAttemptId && sent.deliveryAttemptId !== row.attempt_id
    || sent.recipientEmail && sent.recipientEmail !== row.recipient_email
    || sent.documentSha256 && sent.documentSha256 !== row.document_sha256
    || sent.providerMessageId && sent.providerMessageId !== row.provider_message_id)) return null;
  if (row.prepared_evidence_json == null) return "historical";
  const prepared = parsePreparedQuoteDeliveryEvidence(row.prepared_evidence_json);
  return prepared && prepared.commercial.taxComposition?.status === "resolved" && preparedEvidenceMatchesCheckpoint(row.payload, prepared) && sent?.deliveryAttemptId === row.attempt_id
    && sent.recipientEmail === row.recipient_email && sent.documentSha256 === row.document_sha256
    && sent.providerMessageId === row.provider_message_id ? "modern" : null;
};

export class PostgresQuotePublicationRead implements QuotePublicationReadPort {
  constructor(private readonly db: Pool | PoolClient,
    private readonly documents?: Pick<PostgresCustomerDocumentService, "quoteCheckpointPdf" | "quoteCheckpointPdfEvidence">) {}
  async pdf(organizationId: string, customerId: string, quoteId: string, checkpointId?: string) {
    const published = await this.get(organizationId, customerId, quoteId, checkpointId);
    if (!published) return null;
    if (!this.documents) throw new V2ApplicationError("RETRYABLE_FAILURE", "Sales publication documents are unavailable.");
    const organization = brandedId<"OrganizationId">(organizationId), quote = brandedId<"QuoteId">(quoteId);
    const bytes = await this.documents.quoteCheckpointPdf(organization, quote, published.checkpointId);
    const evidence = await this.documents.quoteCheckpointPdfEvidence(organization, quote, published.checkpointId);
    return { bytes, number: published.number, evidence };
  }
  async get(organizationId: string, customerId: string, quoteId: string, checkpointId?: string) {
    const result = await this.db.query<Row>(`SELECT p.*,q.acceptance_state,q.lifecycle_state,c.order_document_id
      FROM (${publishedQuoteCheckpointSql}) p
      JOIN v2_sales_quote_details q ON q.organization_id=$1 AND q.document_id=$2
      LEFT JOIN v2_sales_quote_conversions c ON c.organization_id=$1 AND c.quote_document_id=$2 ORDER BY p.checkpoint_sequence DESC`, [organizationId, quoteId]);
    const latest = result.rows[0];
    if (!latest) return null;
    const evidenceStatus = publicationEvidenceStatus(latest);
    const status = latest.order_document_id ? "converted" : latest.lifecycle_state !== "open" ? latest.lifecycle_state : latest.acceptance_state === "accepted" ? "accepted" : "sent";
    const latestProjection = evidenceStatus && publishedQuoteProjection(latest.payload, organizationId, customerId, evidenceStatus, status, latest.order_document_id ?? undefined);
    if (!latestProjection) return null;
    const selected = checkpointId ? result.rows.find(row => row.id === checkpointId) : latest;
    const selectedEvidence = selected && publicationEvidenceStatus(selected);
    const projection = selected && selectedEvidence && publishedQuoteProjection(selected.payload, organizationId, customerId, selectedEvidence,
      selected.id === latest.id ? status : "sent", selected.id === latest.id ? latest.order_document_id ?? undefined : undefined);
    if (!projection) return null;
    const history = result.rows.flatMap(row => {
      const evidence = publicationEvidenceStatus(row);
      const item = evidence && publishedQuoteProjection(row.payload, organizationId, customerId, evidence);
      if (!item) return [];
      const { lines: _lines, ...summary } = item;
      return [summary];
    });
    return { ...projection, history };
  }
  async list(organizationId: string, customerId: string, cursor?: string) {
    let after: { occurredAt: string; id: string } | undefined;
    if (cursor) {
      try { after = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (!after || typeof after.occurredAt !== "string" || !Number.isFinite(Date.parse(after.occurredAt)) || typeof after.id !== "string") throw new Error();
      } catch { throw new V2ApplicationError("VALIDATION_ERROR", "The page cursor is invalid."); }
    }
    // Frozen publication time, not draft updated_at or per-Quote revision count,
    // controls ordering across different Quotes.
    const candidates = await this.db.query<{ quote_document_id: string; occurred_at: Date }>(`SELECT quote_document_id,occurred_at FROM (SELECT DISTINCT ON (p.quote_document_id) p.quote_document_id,p.occurred_at,p.payload
      FROM (${publishedQuoteCheckpointSql}) p
      ORDER BY p.quote_document_id,p.checkpoint_sequence DESC) latest
      WHERE payload#>>'{sentEvidence,customerContact,organizationId}'=$1 AND payload#>>'{sentEvidence,customerContact,customerId}'=$3`, [organizationId, null, customerId]);
    const ordered = candidates.rows.sort((a,b) => b.occurred_at.getTime()-a.occurred_at.getTime()
      || (a.quote_document_id < b.quote_document_id ? 1 : a.quote_document_id > b.quote_document_id ? -1 : 0))
      .filter(row => !after || row.occurred_at.getTime() < Date.parse(after.occurredAt) || row.occurred_at.getTime() === Date.parse(after.occurredAt) && row.quote_document_id < after.id);
    const items: PublishedQuoteSummary[] = [];
    let last: typeof ordered[number] | undefined;
    for (const row of ordered) {
      const value = await this.get(organizationId, customerId, row.quote_document_id);
      if (!value) continue;
      if (items.length === 30) return { items, nextCursor: Buffer.from(JSON.stringify({ occurredAt: last!.occurred_at.toISOString(), id: last!.quote_document_id })).toString("base64url") };
      const { lines: _lines, history: _history, ...summary } = value;
      items.push(summary); last = row;
    }
    return { items };
  }
}
