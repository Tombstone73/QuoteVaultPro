import { describe, expect, jest, test } from "@jest/globals";
import { OperationRequestIdempotencyConflictError, PostgresOperationRequestRepository } from "../../infrastructure/persistence/postgresOperationRequests";
import { PostgresOutboxRepository } from "../../infrastructure/persistence/postgresOutbox";
import type { TransactionalClient } from "../../infrastructure/persistence/types";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "request-1", organization_id: "org-1", operation: "orders.create", business_request_id: "business-1",
  payload_fingerprint: "fingerprint-a", status: "succeeded", result_resource_type: "order", result_resource_id: "order-1",
  result_json: { orderId: "order-1" }, initiated_principal_kind: "portal", initiated_principal_subject: "portal-1",
  staff_actor_user_id: null, created_at: new Date(), updated_at: new Date(), completed_at: new Date(), ...overrides,
});

const clientWith = (...responses: Array<{ rows?: unknown[]; rowCount?: number }>): TransactionalClient => {
  const query = jest.fn(async () => responses.shift() ?? { rows: [], rowCount: 0 });
  return { query } as unknown as TransactionalClient;
};

describe("Postgres operation request repository", () => {
  test("replays the same organization/operation/business request regardless of principal", async () => {
    const client = clientWith({ rows: [row()] });
    const reservation = await new PostgresOperationRequestRepository().reserve(client, {
      organizationId: "org-1", operation: "orders.create", businessRequestId: "business-1", payloadFingerprint: "fingerprint-a",
      principalKind: "service", principalSubject: "service-1",
    });
    expect(reservation.kind).toBe("replay");
    expect(reservation.request.id).toBe("request-1");
  });

  test("rejects a changed payload for the same business identity", async () => {
    const client = clientWith({ rows: [row()] });
    await expect(new PostgresOperationRequestRepository().reserve(client, {
      organizationId: "org-1", operation: "orders.create", businessRequestId: "business-1", payloadFingerprint: "fingerprint-b",
      principalKind: "staff", principalSubject: "staff-1", staffActorUserId: "staff-1",
    })).rejects.toBeInstanceOf(OperationRequestIdempotencyConflictError);
  });

  test("resumes a retryable request with its original business identity", async () => {
    const client = clientWith({ rows: [row({ status: "retryable_failure", completed_at: null })] }, { rows: [row({ status: "in_progress", completed_at: null })] });
    const reservation = await new PostgresOperationRequestRepository().reserve(client, {
      organizationId: "org-1", operation: "orders.create", businessRequestId: "business-1", payloadFingerprint: "fingerprint-a",
      principalKind: "delegated_ai", principalSubject: "ai-command-1", staffActorUserId: "staff-1",
    });
    expect(reservation.kind).toBe("resumed");
    expect(reservation.request.status).toBe("in_progress");
  });
});

describe("Postgres outbox repository", () => {
  test("uses SKIP LOCKED leases for concurrent claim safety", async () => {
    const client = clientWith({ rows: [row({
      id: "outbox-1", event_type: "proof.delivery", aggregate_type: "proof", aggregate_id: "proof-1", idempotency_key: "event-1",
      payload: {}, status: "processing", attempt_count: 1, available_at: new Date(), claimed_by: "worker-1", lease_expires_at: new Date(), last_error: null,
    })] });
    const repository = new PostgresOutboxRepository();
    const claimed = await repository.claim(client, "worker-1", 30, 10);
    expect(claimed).toHaveLength(1);
    const query = (client.query as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(query).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(query).toMatch(/lease_expires_at/);
  });

  test("only the active lease holder may complete work", async () => {
    const client = clientWith({ rows: [], rowCount: 0 });
    await expect(new PostgresOutboxRepository().complete(client, "outbox-1", "other-worker")).resolves.toBe(false);
  });
});
