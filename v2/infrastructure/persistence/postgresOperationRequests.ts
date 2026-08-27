import type {
  AttributionInput,
  OperationRequestInput,
  OperationRequestRecord,
  OperationRequestReservation,
  TransactionalClient,
} from "./types";
import type { PrincipalKind } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

export class OperationRequestIdempotencyConflictError extends V2ApplicationError {
  constructor() {
    super("IDEMPOTENCY_CONFLICT", "The business request ID was previously used with a different payload.");
  }
}

export class OperationRequestStateError extends V2ApplicationError {
  constructor() {
    super("STALE_STATE", "The operation request is no longer in a state that allows this transition.");
  }
}

type OperationRequestRow = {
  id: string;
  organization_id: string;
  operation: string;
  business_request_id: string;
  payload_fingerprint: string;
  status: OperationRequestRecord["status"];
  result_resource_type: string | null;
  result_resource_id: string | null;
  result_json: unknown | null;
  initiated_principal_kind: PrincipalKind;
  initiated_principal_subject: string;
  staff_actor_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

const toRecord = (row: OperationRequestRow): OperationRequestRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  operation: row.operation,
  businessRequestId: row.business_request_id,
  payloadFingerprint: row.payload_fingerprint,
  status: row.status,
  resultResourceType: row.result_resource_type,
  resultResourceId: row.result_resource_id,
  resultJson: row.result_json,
  principalKind: row.initiated_principal_kind,
  principalSubject: row.initiated_principal_subject,
  staffActorUserId: row.staff_actor_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

export class PostgresOperationRequestRepository {
  async reserve(client: TransactionalClient, input: OperationRequestInput): Promise<OperationRequestReservation> {
    const existing = await this.findForUpdate(client, input);
    if (existing) return this.replayOrResume(client, existing, input);
    // ON CONFLICT avoids aborting a caller-owned PostgreSQL transaction during
    // a same-key race; a subsequent read sees the authoritative winner.
    const inserted = await client.query<OperationRequestRow>(
      `INSERT INTO v2_operation_requests (
          organization_id, operation, business_request_id, payload_fingerprint,
          initiated_principal_kind, initiated_principal_subject, staff_actor_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id, operation, business_request_id) DO NOTHING
         RETURNING *`,
      [input.organizationId, input.operation, input.businessRequestId, input.payloadFingerprint,
        input.principalKind, input.principalSubject, input.staffActorUserId ?? null],
    );
    if (inserted.rows[0]) return { kind: "new", request: toRecord(inserted.rows[0]) };
    {
      const raced = await this.findForUpdate(client, input);
      if (!raced) throw new Error("Operation request race could not reload its authoritative row.");
      return this.replayOrResume(client, raced, input);
    }
  }

  async succeed(
    client: TransactionalClient,
    organizationId: string,
    requestId: string,
    result: { resourceType: string; resourceId: string; resultJson?: unknown },
  ): Promise<OperationRequestRecord> {
    const query = await client.query<OperationRequestRow>(
      `UPDATE v2_operation_requests
       SET status = 'succeeded', result_resource_type = $3, result_resource_id = $4,
           result_json = $5::jsonb, completed_at = now(), updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'in_progress'
       RETURNING *`,
      [organizationId, requestId, result.resourceType, result.resourceId, JSON.stringify(result.resultJson ?? null)],
    );
    if (!query.rows[0]) throw new OperationRequestStateError();
    return toRecord(query.rows[0]);
  }

  async markRetryableFailure(client: TransactionalClient, organizationId: string, requestId: string): Promise<void> {
    await client.query(
      `UPDATE v2_operation_requests SET status = 'retryable_failure', updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'in_progress'`,
      [organizationId, requestId],
    );
  }

  /** A provider outcome may be ambiguous after bytes leave the platform. Such
   * operations must never be automatically replayed. */
  async markPermanentFailure(client: TransactionalClient, organizationId: string, requestId: string): Promise<void> {
    await client.query(
      `UPDATE v2_operation_requests SET status = 'permanent_failure', completed_at = now(), updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'in_progress'`,
      [organizationId, requestId],
    );
  }

  async recordAttribution(client: TransactionalClient, input: AttributionInput): Promise<void> {
    await client.query(
      `INSERT INTO v2_principal_attributions (
        organization_id, operation_request_id, operation, resource_type, resource_id,
        principal_kind, principal_subject, staff_actor_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.organizationId, input.operationRequestId ?? null, input.operation, input.resourceType,
        input.resourceId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null],
    );
  }

  private async findForUpdate(client: TransactionalClient, input: Pick<OperationRequestInput, "organizationId" | "operation" | "businessRequestId">): Promise<OperationRequestRecord | null> {
    const query = await client.query<OperationRequestRow>(
      `SELECT * FROM v2_operation_requests
       WHERE organization_id = $1 AND operation = $2 AND business_request_id = $3
       FOR UPDATE`,
      [input.organizationId, input.operation, input.businessRequestId],
    );
    return query.rows[0] ? toRecord(query.rows[0]) : null;
  }

  private async replayOrResume(client: TransactionalClient, existing: OperationRequestRecord, input: OperationRequestInput): Promise<OperationRequestReservation> {
    if (existing.payloadFingerprint !== input.payloadFingerprint) throw new OperationRequestIdempotencyConflictError();
    if (existing.status === "retryable_failure") {
      const resumed = await client.query<OperationRequestRow>(
        `UPDATE v2_operation_requests SET status = 'in_progress', updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'retryable_failure' RETURNING *`,
        [input.organizationId, existing.id],
      );
      if (!resumed.rows[0]) throw new OperationRequestStateError();
      return { kind: "resumed", request: toRecord(resumed.rows[0]) };
    }
    return { kind: "replay", request: existing };
  }
}
