import type { OutboxMessageInput, OutboxMessageRecord, TransactionalClient } from "./types";

type OutboxRow = {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  idempotency_key: string;
  payload: unknown;
  status: OutboxMessageRecord["status"];
  attempt_count: number;
  available_at: Date;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  last_error: string | null;
  created_at: Date;
  completed_at: Date | null;
};

const toRecord = (row: OutboxRow): OutboxMessageRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  eventType: row.event_type,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  idempotencyKey: row.idempotency_key,
  payload: row.payload,
  status: row.status,
  attemptCount: row.attempt_count,
  availableAt: row.available_at,
  claimedBy: row.claimed_by,
  leaseExpiresAt: row.lease_expires_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

export class PostgresOutboxRepository {
  async enqueue(client: TransactionalClient, input: OutboxMessageInput): Promise<OutboxMessageRecord> {
    const result = await client.query<OutboxRow>(
      `INSERT INTO v2_outbox_messages (
        organization_id, event_type, aggregate_type, aggregate_id, idempotency_key, payload
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (organization_id, event_type, aggregate_type, aggregate_id, idempotency_key)
      DO UPDATE SET id = v2_outbox_messages.id
      RETURNING *`,
      [input.organizationId, input.eventType, input.aggregateType, input.aggregateId,
        input.idempotencyKey, JSON.stringify(input.payload)],
    );
    return toRecord(result.rows[0]!);
  }

  async claim(client: TransactionalClient, organizationId: string, workerId: string, leaseSeconds: number, limit: number): Promise<OutboxMessageRecord[]> {
    assertWorkerId(workerId);
    if (!Number.isInteger(leaseSeconds) || leaseSeconds <= 0) throw new Error("leaseSeconds must be a positive integer.");
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer.");
    const result = await client.query<OutboxRow>(
      `WITH candidates AS (
        SELECT id FROM v2_outbox_messages
        WHERE organization_id = $1 AND ((status = 'pending' AND available_at <= now())
           OR (status = 'processing' AND lease_expires_at <= now())
        ) ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $4
      )
      UPDATE v2_outbox_messages AS message
      SET status = 'processing', claimed_by = $2,
          lease_expires_at = now() + ($3 * interval '1 second'),
          attempt_count = message.attempt_count + 1
      FROM candidates
      WHERE message.organization_id = $1 AND message.id = candidates.id
      RETURNING message.*`,
      [organizationId, workerId, leaseSeconds, limit],
    );
    return result.rows.map(toRecord);
  }

  async complete(client: TransactionalClient, organizationId: string, id: string, workerId: string): Promise<boolean> {
    assertWorkerId(workerId);
    const result = await client.query(
      `UPDATE v2_outbox_messages
       SET status = 'completed', claimed_by = NULL, lease_expires_at = NULL, completed_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'processing' AND claimed_by = $3 AND lease_expires_at > now()`,
      [organizationId, id, workerId],
    );
    return result.rowCount === 1;
  }

  async retry(client: TransactionalClient, organizationId: string, id: string, workerId: string, availableAt: Date, sanitizedError: string): Promise<boolean> {
    assertWorkerId(workerId);
    const result = await client.query(
      `UPDATE v2_outbox_messages
       SET status = 'pending', claimed_by = NULL, lease_expires_at = NULL, available_at = $4, last_error = $5
       WHERE organization_id = $1 AND id = $2 AND status = 'processing' AND claimed_by = $3 AND lease_expires_at > now()`,
      [organizationId, id, workerId, availableAt, sanitizeOutboxError(sanitizedError)],
    );
    return result.rowCount === 1;
  }

  async deadLetter(client: TransactionalClient, organizationId: string, id: string, workerId: string, sanitizedError: string): Promise<boolean> {
    assertWorkerId(workerId);
    const result = await client.query(
      `UPDATE v2_outbox_messages
       SET status = 'dead_letter', claimed_by = NULL, lease_expires_at = NULL, last_error = $4
       WHERE organization_id = $1 AND id = $2 AND status = 'processing' AND claimed_by = $3 AND lease_expires_at > now()`,
      [organizationId, id, workerId, sanitizeOutboxError(sanitizedError)],
    );
    return result.rowCount === 1;
  }
}

const assertWorkerId = (workerId: string): void => {
  if (!workerId.trim()) throw new Error("workerId must not be blank.");
};

/**
 * Durable diagnostics are not a secret sink. Callers should already supply a
 * stable, public-safe failure summary; this guard removes common URL and
 * password forms before persistence as defense in depth.
 */
export const sanitizeOutboxError = (value: string): string => value
  .replace(/(postgres(?:ql)?|https?):\/\/[^\s@/:]+(?::[^\s@/]*)?@/giu, "$1://[redacted]@")
  .replace(/\b(password|token|secret|api[_-]?key)\s*=\s*[^\s,;]+/giu, "$1=[redacted]")
  .slice(0, 1000);
