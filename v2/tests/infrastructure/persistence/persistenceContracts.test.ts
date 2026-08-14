import { describe, expect, test } from "@jest/globals";

import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../../../infrastructure/persistence/physicalPostconditions";
import { OperationRequestIdempotencyConflictError, PostgresOperationRequestRepository } from "../../../infrastructure/persistence/postgresOperationRequests";
import { PostgresOutboxRepository } from "../../../infrastructure/persistence/postgresOutbox";

type Result = { rows: any[]; rowCount?: number | null };

function queueClient(...results: Result[]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  return {
    queries,
    client: {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return results.shift() ?? { rows: [], rowCount: 0 };
      },
    } as any,
  };
}

const requestRow = {
  id: "request-1", organization_id: "org-1", operation: "neutral.operation", business_request_id: "request-key",
  payload_fingerprint: "fingerprint-a", status: "in_progress", result_resource_type: null, result_resource_id: null,
  result_json: null, initiated_principal_kind: "portal", initiated_principal_subject: "portal-subject",
  staff_actor_user_id: null, created_at: new Date("2026-01-01"), updated_at: new Date("2026-01-01"), completed_at: null,
};

describe("V2 M0 operation request and attribution contracts", () => {
  const input = {
    organizationId: "org-1", operation: "neutral.operation", businessRequestId: "request-key", payloadFingerprint: "fingerprint-a",
    principalKind: "portal", principalSubject: "portal-subject", staffActorUserId: null,
  };

  test("reserves a neutral business request independently of the initiating principal", async () => {
    const mock = queueClient({ rows: [] }, { rows: [requestRow] });
    const result = await new PostgresOperationRequestRepository().reserve(mock.client, input);

    expect(result).toMatchObject({ kind: "new", request: { organizationId: "org-1", businessRequestId: "request-key", principalKind: "portal" } });
    expect(mock.queries[1]?.text).toContain("INSERT INTO v2_operation_requests");
    expect(mock.queries[1]?.values).toEqual(expect.arrayContaining(["org-1", "neutral.operation", "request-key", "fingerprint-a", "portal", "portal-subject"]));
  });

  test("replays a matching fingerprint and rejects a conflicting fingerprint", async () => {
    const replay = queueClient({ rows: [requestRow] });
    await expect(new PostgresOperationRequestRepository().reserve(replay.client, input)).resolves.toMatchObject({ kind: "replay", request: { id: "request-1" } });

    const conflict = queueClient({ rows: [requestRow] });
    await expect(new PostgresOperationRequestRepository().reserve(conflict.client, { ...input, payloadFingerprint: "fingerprint-b", principalKind: "service" }))
      .rejects.toBeInstanceOf(OperationRequestIdempotencyConflictError);
  });

  test("writes truthful portal attribution without a fabricated staff user", async () => {
    const mock = queueClient({ rows: [], rowCount: 1 });
    await new PostgresOperationRequestRepository().recordAttribution(mock.client, {
      ...input, operationRequestId: "request-1", resourceType: "neutral_fixture", resourceId: "fixture-1",
    });

    expect(mock.queries[0]?.text).toContain("INSERT INTO v2_principal_attributions");
    expect(mock.queries[0]?.values).toEqual(expect.arrayContaining(["portal", "portal-subject", null]));
  });
});

describe("V2 M0 outbox contracts", () => {
  const outboxRow = {
    id: "outbox-1", organization_id: "org-1", event_type: "neutral.enqueued", aggregate_type: "neutral_fixture",
    aggregate_id: "fixture-1", idempotency_key: "event-key", payload: { fixture: true }, status: "pending", attempt_count: 0,
    available_at: new Date("2026-01-01"), claimed_by: null, lease_expires_at: null, last_error: null,
    created_at: new Date("2026-01-01"), completed_at: null,
  };

  test("enqueues idempotently and requires a valid lease request before claiming", async () => {
    const mock = queueClient({ rows: [outboxRow] });
    const repository = new PostgresOutboxRepository();
    await expect(repository.enqueue(mock.client, {
      organizationId: "org-1", eventType: "neutral.enqueued", aggregateType: "neutral_fixture", aggregateId: "fixture-1",
      idempotencyKey: "event-key", payload: { fixture: true },
    })).resolves.toMatchObject({ id: "outbox-1", status: "pending" });
    expect(mock.queries[0]?.text).toContain("ON CONFLICT (organization_id, event_type, aggregate_type, aggregate_id, idempotency_key)");
    await expect(repository.claim(mock.client, "worker-1", 0, 1)).rejects.toThrow(/leaseSeconds/i);
    await expect(repository.claim(mock.client, "worker-1", 30, 0)).rejects.toThrow(/limit/i);
  });

  test("claims with SKIP LOCKED and only completes an active worker lease", async () => {
    const claimed = { ...outboxRow, status: "processing", attempt_count: 1, claimed_by: "worker-1", lease_expires_at: new Date("2026-01-02") };
    const mock = queueClient({ rows: [claimed] }, { rows: [], rowCount: 1 });
    const repository = new PostgresOutboxRepository();
    await expect(repository.claim(mock.client, "worker-1", 30, 1)).resolves.toMatchObject([{ status: "processing", claimedBy: "worker-1", attemptCount: 1 }]);
    expect(mock.queries[0]?.text).toContain("FOR UPDATE SKIP LOCKED");
    await expect(repository.complete(mock.client, "outbox-1", "worker-1")).resolves.toBe(true);
    expect(mock.queries[1]?.text).toContain("claimed_by = $2 AND lease_expires_at > now()");
  });

  test("rejects blank worker identities and redacts accidental credential text from durable diagnostics", async () => {
    const mock = queueClient({ rows: [], rowCount: 1 });
    const repository = new PostgresOutboxRepository();
    await expect(repository.claim(mock.client, " ", 30, 1)).rejects.toThrow(/workerId/i);
    await repository.retry(mock.client, "outbox-1", "worker-1", new Date("2026-01-02"), "postgresql://user:password@host/db password=hunter2");
    expect(mock.queries[0]?.values?.[3]).toBe("postgresql://[redacted]@host/db password=[redacted]");
  });
});

describe("V2 M0 physical postconditions", () => {
  test("recognizes the complete additive persistence catalog", async () => {
    const client = {
      query: async (text: string) => {
        if (text.includes("FROM information_schema.tables")) return { rows: ["v2_operation_requests", "v2_principal_attributions", "v2_outbox_messages"].map((table_name) => ({ table_name })) };
        if (text.includes("pg_indexes")) return { rows: [
          "v2_operation_requests_org_status_available_idx", "v2_operation_requests_business_request_uidx", "v2_operation_requests_id_organization_uidx",
          "v2_principal_attributions_org_resource_idx", "v2_principal_attributions_operation_request_idx",
          "v2_outbox_messages_identity_uidx", "v2_outbox_messages_claim_idx", "v2_outbox_messages_lease_idx",
        ].map((indexname) => ({ indexname, indexdef: /(?:business_request|id_organization|identity)_uidx/.test(indexname) ? `CREATE UNIQUE INDEX ${indexname}` : `CREATE INDEX ${indexname}` })) };
        if (text.includes("source.relname AS source_table")) return { rows: [
          ["v2_operation_requests", "organizations"], ["v2_operation_requests", "users"],
          ["v2_principal_attributions", "v2_operation_requests"], ["v2_principal_attributions", "organizations"],
          ["v2_principal_attributions", "users"], ["v2_outbox_messages", "organizations"],
        ].map(([source_table, target_table]) => ({ source_table, target_table })) };
        if (text.includes("pg_constraint")) return { rows: ["v2_operation_requests_status_chk", "v2_operation_requests_principal_kind_chk", "v2_operation_requests_completion_chk", "v2_principal_attributions_principal_kind_chk", "v2_principal_attributions_request_tenant_fk", "v2_outbox_messages_status_chk", "v2_outbox_messages_attempt_count_chk", "v2_outbox_messages_lease_chk", "v2_outbox_messages_completion_chk"].map((conname) => ({ conname })) };
        return { rows: [
          "v2_operation_requests.organization_id", "v2_operation_requests.business_request_id", "v2_operation_requests.payload_fingerprint",
          "v2_principal_attributions.principal_subject", "v2_outbox_messages.idempotency_key", "v2_outbox_messages.payload",
        ].map((value) => { const [table_name, column_name] = value.split("."); return { table_name, column_name, is_nullable: "NO" }; }) };
      },
    } as any;
    const findings = await checkV2M0PhysicalPostconditions(client);
    expect(findings.every((finding) => finding.passed)).toBe(true);
    expect(() => assertV2M0PhysicalPostconditions(findings)).not.toThrow();
  });

  test("fails closed for an incomplete catalog", () => {
    expect(() => assertV2M0PhysicalPostconditions([{ id: "table:v2_outbox_messages", passed: false, detail: "missing" }])).toThrow(/v2_outbox_messages/);
  });
});
