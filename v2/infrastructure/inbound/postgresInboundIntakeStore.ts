import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  InboundIntakeStore,
  InboundIntakeTransaction,
} from "../../src/modules/inbound/inboundIntakeApplication.js";
import type {
  InboundIntake,
  InboundIntakeAttachment,
  InboundIntakeDetail,
  InboundIntakeEvent,
  InboundIntakePage,
  InboundIntakeQuery,
  InboundIntakeState,
  IngestInboundIntake,
  ReviewInboundIntake,
} from "../../src/modules/inbound/contracts.js";
import { brandedId, type InboundIntakeId, type OrderId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";

type Actor = Readonly<{ principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>;
type IntakeRow = Record<string, unknown>;
const text = (value: unknown): string | undefined => typeof value === "string" && value.length ? value : undefined;
const timestamp = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);
const object = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
const intake = (row: IntakeRow): InboundIntake => ({
  id: brandedId<"InboundIntakeId">(String(row.id)),
  organizationId: brandedId<"OrganizationId">(String(row.organization_id)),
  sourceProvider: String(row.source_provider) as InboundIntake["sourceProvider"],
  ...(text(row.source_message_id) ? { sourceMessageId: text(row.source_message_id) } : {}),
  ...(text(row.source_mailbox) ? { sourceMailbox: text(row.source_mailbox) } : {}),
  ...(text(row.sender_name) ? { senderName: text(row.sender_name) } : {}),
  ...(text(row.sender_email) ? { senderEmail: text(row.sender_email) } : {}),
  ...(text(row.recipient_email) ? { recipientEmail: text(row.recipient_email) } : {}),
  ...(text(row.subject) ? { subject: text(row.subject) } : {}),
  receivedAt: timestamp(row.received_at),
  rawSource: object(row.raw_source),
  ...(text(row.normalized_body) ? { normalizedBody: text(row.normalized_body) } : {}),
  extractedDraft: object(row.extracted_draft),
  reviewDraft: object(row.review_draft) as InboundIntake["reviewDraft"],
  state: String(row.intake_state) as InboundIntakeState,
  ...(text(row.matched_customer_id) ? { matchedCustomerId: brandedId<"CustomerId">(text(row.matched_customer_id)!) } : {}),
  ...(text(row.matched_contact_id) ? { matchedContactId: brandedId<"ContactId">(text(row.matched_contact_id)!) } : {}),
  ...(text(row.converted_order_id) ? { convertedOrderId: brandedId<"OrderId">(text(row.converted_order_id)!) } : {}),
  ...(text(row.conversion_request_id) ? { conversionRequestId: text(row.conversion_request_id) } : {}),
  ...(text(row.decision_reason) ? { decisionReason: text(row.decision_reason) } : {}),
  ...(text(row.failure_code) ? { failureCode: text(row.failure_code) } : {}),
  ...(text(row.failure_message) ? { failureMessage: text(row.failure_message) } : {}),
  createdAt: timestamp(row.created_at),
  updatedAt: timestamp(row.updated_at),
  ...(row.converted_at ? { convertedAt: timestamp(row.converted_at) } : {}),
});
const attachment = (row: IntakeRow): InboundIntakeAttachment => ({
  id: brandedId<"InboundAttachmentId">(String(row.id)),
  intakeId: brandedId<"InboundIntakeId">(String(row.intake_id)),
  sourceAttachmentId: String(row.source_attachment_id),
  filename: String(row.filename),
  ...(text(row.content_type) ? { contentType: text(row.content_type) } : {}),
  ...(typeof row.byte_size === "number" ? { byteSize: row.byte_size } : typeof row.byte_size === "string" ? { byteSize: Number(row.byte_size) } : {}),
  sourceReference: object(row.source_reference),
  ...(text(row.canonical_artwork_file_id) ? { canonicalArtworkFileId: brandedId<"ArtworkFileId">(text(row.canonical_artwork_file_id)!) } : {}),
  createdAt: timestamp(row.created_at),
});
const event = (row: IntakeRow): InboundIntakeEvent => ({
  id: String(row.id),
  intakeId: brandedId<"InboundIntakeId">(String(row.intake_id)),
  type: String(row.event_type),
  ...(text(row.business_request_id) ? { businessRequestId: text(row.business_request_id) } : {}),
  detail: object(row.event_detail),
  actor: { principalKind: String(row.principal_kind), principalSubject: String(row.principal_subject), ...(text(row.staff_actor_user_id) ? { staffActorUserId: text(row.staff_actor_user_id) } : {}) },
  createdAt: timestamp(row.created_at),
});

class PostgresInboundIntakeTransaction implements InboundIntakeTransaction {
  constructor(readonly client: PoolClient) {}

  async detail(organizationId: OrganizationId, intakeId: InboundIntakeId, lock = false): Promise<InboundIntakeDetail | null> {
    const header = await this.client.query<IntakeRow>(
      "SELECT * FROM v2_inbound_intakes WHERE organization_id=$1 AND id=$2" + (lock ? " FOR UPDATE" : ""),
      [organizationId, intakeId],
    );
    if (!header.rows[0]) return null;
    const [attachments, events] = await Promise.all([
      this.client.query<IntakeRow>("SELECT * FROM v2_inbound_intake_attachments WHERE organization_id=$1 AND intake_id=$2 ORDER BY created_at,id", [organizationId, intakeId]),
      this.client.query<IntakeRow>("SELECT * FROM v2_inbound_intake_events WHERE organization_id=$1 AND intake_id=$2 ORDER BY created_at,id", [organizationId, intakeId]),
    ]);
    return { intake: intake(header.rows[0]), attachments: attachments.rows.map(attachment), events: events.rows.map(event) };
  }

  async hasEvent(organizationId: OrganizationId, intakeId: InboundIntakeId, eventType: string, businessRequestId: string): Promise<boolean> {
    const result = await this.client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM v2_inbound_intake_events WHERE organization_id=$1 AND intake_id=$2 AND event_type=$3 AND business_request_id=$4) AS exists",
      [organizationId, intakeId, eventType, businessRequestId],
    );
    return result.rows[0]?.exists === true;
  }

  async saveReview(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; review: ReviewInboundIntake; state: "needs_review" | "ready"; actor: Actor }>): Promise<InboundIntake> {
    const result = await this.client.query<IntakeRow>(
      "UPDATE v2_inbound_intakes SET review_draft=$3::jsonb,matched_customer_id=$4,matched_contact_id=$5,intake_state=$6,decision_reason=NULL,failure_code=NULL,failure_message=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",
      [input.organizationId, input.intakeId, JSON.stringify(input.review.reviewDraft), input.review.matchedCustomerId ?? null, input.review.matchedContactId ?? null, input.state],
    );
    if (!result.rows[0]) throw new Error("Inbound work was not found.");
    return intake(result.rows[0]);
  }

  async transition(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; from: readonly InboundIntakeState[]; to: InboundIntakeState; reason?: string; actor: Actor }>): Promise<InboundIntake | null> {
    const result = await this.client.query<IntakeRow>(
      "UPDATE v2_inbound_intakes SET intake_state=$4::varchar,decision_reason=$5::text,failure_code=CASE WHEN $4::varchar IN ('failed','action_required') THEN 'INBOUND_ACTION_REQUIRED' ELSE NULL END,failure_message=CASE WHEN $4::varchar IN ('failed','action_required') THEN $5::text ELSE NULL END,updated_at=now() WHERE organization_id=$1 AND id=$2 AND intake_state=ANY($3::varchar[]) RETURNING *",
      [input.organizationId, input.intakeId, input.from, input.to, input.reason ?? null],
    );
    return result.rows[0] ? intake(result.rows[0]) : null;
  }

  async reserveConversion(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; conversionRequestId: string; actor: Actor }>): Promise<InboundIntake | null> {
    const result = await this.client.query<IntakeRow>(
      "UPDATE v2_inbound_intakes SET intake_state='converting',conversion_request_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 AND ((intake_state='ready' AND (conversion_request_id IS NULL OR conversion_request_id=$3)) OR (intake_state='converting' AND conversion_request_id=$3)) RETURNING *",
      [input.organizationId, input.intakeId, input.conversionRequestId],
    );
    return result.rows[0] ? intake(result.rows[0]) : null;
  }

  async completeConversion(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; conversionRequestId: string; orderId: OrderId; actor: Actor }>): Promise<InboundIntake | null> {
    const result = await this.client.query<IntakeRow>(
      "UPDATE v2_inbound_intakes SET intake_state='converted',converted_order_id=$4,converted_at=now(),failure_code=NULL,failure_message=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND intake_state='converting' AND conversion_request_id=$3 RETURNING *",
      [input.organizationId, input.intakeId, input.conversionRequestId, input.orderId],
    );
    return result.rows[0] ? intake(result.rows[0]) : null;
  }

  async recordEvent(input: Readonly<{ organizationId: OrganizationId; intakeId: InboundIntakeId; type: string; businessRequestId?: string; detail?: Readonly<Record<string, unknown>>; actor: Actor }>): Promise<InboundIntakeEvent> {
    const inserted = await this.client.query<IntakeRow>(
      "INSERT INTO v2_inbound_intake_events(id,organization_id,intake_id,event_type,business_request_id,event_detail,principal_kind,principal_subject,staff_actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) ON CONFLICT(organization_id,intake_id,event_type,business_request_id) DO NOTHING RETURNING *",
      [randomUUID(), input.organizationId, input.intakeId, input.type, input.businessRequestId ?? null, JSON.stringify(input.detail ?? {}), input.actor.principalKind, input.actor.principalSubject, input.actor.staffActorUserId ?? null],
    );
    if (inserted.rows[0]) return event(inserted.rows[0]);
    const existing = await this.client.query<IntakeRow>(
      "SELECT * FROM v2_inbound_intake_events WHERE organization_id=$1 AND intake_id=$2 AND event_type=$3 AND business_request_id IS NOT DISTINCT FROM $4",
      [input.organizationId, input.intakeId, input.type, input.businessRequestId ?? null],
    );
    if (!existing.rows[0]) throw new Error("Inbound event could not be recorded.");
    return event(existing.rows[0]);
  }
}

export class PostgresInboundIntakeStore implements InboundIntakeStore {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(action: (transaction: InboundIntakeTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(new PostgresInboundIntakeTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally { client.release(); }
  }

  async list(organizationId: OrganizationId, query: InboundIntakeQuery): Promise<InboundIntakePage> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const clauses = ["organization_id=$1"];
    const values: unknown[] = [organizationId];
    if (query.status) { values.push(query.status); clauses.push("intake_state=$" + values.length); }
    if (query.search?.trim()) {
      values.push("%" + query.search.trim().replace(/[%_\\]/g, "\\$&") + "%");
      clauses.push("(coalesce(sender_name,'') ILIKE $" + values.length + " ESCAPE '\\\\' OR coalesce(sender_email,'') ILIKE $" + values.length + " ESCAPE '\\\\' OR coalesce(subject,'') ILIKE $" + values.length + " ESCAPE '\\\\')");
    }
    if (cursor) {
      values.push(cursor.receivedAt, cursor.id);
      clauses.push("(received_at,id) < ($" + (values.length - 1) + "::timestamptz,$" + values.length + ")");
    }
    values.push(Math.max(1, Math.min(query.limit, 100)) + 1);
    const result = await this.pool.query<IntakeRow>("SELECT * FROM v2_inbound_intakes WHERE " + clauses.join(" AND ") + " ORDER BY received_at DESC,id DESC LIMIT $" + values.length, values);
    const page = result.rows.slice(0, -1).map(intake);
    const last = page.at(-1);
    return { records: result.rows.length > page.length ? page : result.rows.map(intake), ...(result.rows.length > page.length && last ? { nextCursor: encodeCursor(last) } : {}) };
  }

  async detail(organizationId: OrganizationId, intakeId: InboundIntakeId): Promise<InboundIntakeDetail | null> {
    const client = await this.pool.connect();
    try { return await new PostgresInboundIntakeTransaction(client).detail(organizationId, intakeId); }
    finally { client.release(); }
  }

  async ingest(organizationId: OrganizationId, input: IngestInboundIntake, actor: Actor): Promise<InboundIntake> {
    return this.transaction(async (transaction) => {
      const client = (transaction as PostgresInboundIntakeTransaction as { client: PoolClient }).client;
      const result = await client.query<IntakeRow>(
        "INSERT INTO v2_inbound_intakes(id,organization_id,source_provider,source_message_id,source_mailbox,sender_name,sender_email,recipient_email,subject,received_at,raw_source,normalized_body,extracted_draft,intake_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,'received') ON CONFLICT(organization_id,source_provider,source_message_id) WHERE source_message_id IS NOT NULL DO UPDATE SET updated_at=now() RETURNING *",
        [randomUUID(), organizationId, input.sourceProvider, input.sourceMessageId ?? null, input.sourceMailbox ?? null, input.senderName ?? null, input.senderEmail ?? null, input.recipientEmail ?? null, input.subject ?? null, input.receivedAt, JSON.stringify(input.rawSource), input.normalizedBody ?? null, JSON.stringify(input.extractedDraft ?? {})],
      );
      const created = intake(result.rows[0]!);
      await transaction.recordEvent({ organizationId, intakeId: created.id, type: "ingested", detail: { sourceProvider: input.sourceProvider }, actor });
      return created;
    });
  }
}

const encodeCursor = (value: InboundIntake): string => Buffer.from(JSON.stringify({ receivedAt: value.receivedAt, id: value.id }), "utf8").toString("base64url");
const decodeCursor = (value: string): Readonly<{ receivedAt: string; id: string }> | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { receivedAt?: unknown; id?: unknown };
    return typeof parsed.receivedAt === "string" && typeof parsed.id === "string" ? { receivedAt: parsed.receivedAt, id: parsed.id } : undefined;
  } catch { return undefined; }
};
