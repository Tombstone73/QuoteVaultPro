import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { OperationRequestIdempotencyConflictError, PostgresOperationRequestRepository } from "../infrastructure/persistence/postgresOperationRequests.js";
import { PostgresOutboxRepository, sanitizeOutboxError } from "../infrastructure/persistence/postgresOutbox.js";

const M0_OPERATION = "m0.rehearsal";
const M0_EVENT = "m0.rehearsal";

async function reserveRace(
  winner: PoolClient,
  contender: PoolClient,
  repository: PostgresOperationRequestRepository,
  input: Parameters<PostgresOperationRequestRepository["reserve"]>[1],
  contenderInput = input,
) {
  await winner.query("BEGIN");
  const created = await repository.reserve(winner, input);
  if (created.kind !== "new") throw new Error("Held transaction did not create its operation request.");

  let insertReached!: () => void;
  const insertStarted = new Promise<void>((resolve) => { insertReached = resolve; });
  const observedContender = {
    query: async (...args: Parameters<PoolClient["query"]>) => {
      if (typeof args[0] === "string" && args[0].includes("INSERT INTO v2_operation_requests")) insertReached();
      return contender.query(...args as [string, unknown[]]);
    },
  } as Pick<PoolClient, "query">;
  const contenderReservation = repository.reserve(observedContender, contenderInput);
  await insertStarted;
  await winner.query("COMMIT");
  return { created, contender: await contenderReservation };
}

async function main() {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  console.log(`[m0-postgres] clone validation passed: ${target.protocol}//${target.hostname}/${target.pathname.slice(1)}`);
  // The verifier is released before the held creator and two contenders run;
  // those three concurrent participants require this rehearsal-only capacity.
  const pool = new Pool({ connectionString: url, max: 3 });
  const run = randomUUID();
  let organizationIds: string[] = [];
  try {
    await pool.query("SELECT 1");
    const findings = await checkV2M0PhysicalPostconditions(pool);
    assertV2M0PhysicalPostconditions(findings);
    console.log(`[m0-postgres] physical catalog passed (${findings.length} checks)`);

    const fixtures = await pool.query<{ organization_id: string; staff_actor_user_id: string | null }>(
      `SELECT organization.id AS organization_id, (SELECT id FROM users ORDER BY id LIMIT 1) AS staff_actor_user_id
       FROM organizations AS organization ORDER BY organization.id LIMIT 2`,
    );
    if (fixtures.rows.length < 2) throw new Error("Approved clone needs two existing organization fixtures for tenant-isolation rehearsal.");
    if (!fixtures.rows[0]?.staff_actor_user_id) throw new Error("Approved clone needs one existing user fixture for Staff/AI attribution rehearsal.");
    const [organizationA, organizationB] = fixtures.rows;
    const orgA = organizationA!.organization_id;
    const orgB = organizationB!.organization_id;
    organizationIds = [orgA, orgB];
    const staffActor = organizationA!.staff_actor_user_id!;
    const requests = new PostgresOperationRequestRepository();
    const outbox = new PostgresOutboxRepository();

    const primary = await pool.connect();
    try {
      await primary.query("BEGIN");
      const rollbackKey = `${run}-rollback`;
      const first = await requests.reserve(primary, { organizationId: orgA, operation: M0_OPERATION, businessRequestId: rollbackKey, payloadFingerprint: rollbackKey, principalKind: "staff", principalSubject: staffActor, staffActorUserId: staffActor });
      const replay = await requests.reserve(primary, { organizationId: orgA, operation: M0_OPERATION, businessRequestId: rollbackKey, payloadFingerprint: rollbackKey, principalKind: "service", principalSubject: `service-${run}` });
      if (first.kind !== "new" || replay.kind !== "replay" || replay.request.id !== first.request.id) throw new Error("Principal-neutral operation replay failed.");
      for (const attribution of [
        { principalKind: "staff" as const, principalSubject: staffActor, staffActorUserId: staffActor },
        { principalKind: "delegated_ai" as const, principalSubject: `ai-${run}`, staffActorUserId: staffActor },
        { principalKind: "portal" as const, principalSubject: `portal-${run}`, staffActorUserId: null },
        { principalKind: "service" as const, principalSubject: `service-${run}`, staffActorUserId: null },
      ]) await requests.recordAttribution(primary, { organizationId: orgA, operationRequestId: first.request.id, operation: M0_OPERATION, resourceType: "m0_fixture", resourceId: rollbackKey, ...attribution });
      const one = await outbox.enqueue(primary, { organizationId: orgA, eventType: M0_EVENT, aggregateType: "m0", aggregateId: rollbackKey, idempotencyKey: rollbackKey, payload: { run } });
      const two = await outbox.enqueue(primary, { organizationId: orgA, eventType: M0_EVENT, aggregateType: "m0", aggregateId: rollbackKey, idempotencyKey: rollbackKey, payload: { run } });
      if (one.id !== two.id) throw new Error("Outbox deterministic deduplication failed.");
      await primary.query("ROLLBACK");
      const rolledBack = await primary.query<{ requests: string; attributions: string; work: string }>(
        `SELECT
          (SELECT count(*) FROM v2_operation_requests WHERE organization_id = $1 AND business_request_id = $2) AS requests,
          (SELECT count(*) FROM v2_principal_attributions WHERE organization_id = $1 AND resource_id = $2) AS attributions,
          (SELECT count(*) FROM v2_outbox_messages WHERE organization_id = $1 AND aggregate_id = $2) AS work`,
        [orgA, rollbackKey],
      );
      if (Object.values(rolledBack.rows[0] ?? {}).some((count) => count !== "0")) throw new Error("M0 rollback atomicity failed.");
    } finally { primary.release(); }

    const a = await pool.connect();
    const b = await pool.connect();
    const c = await pool.connect();
    try {
      const sameKey = `${run}-same`;
      const sameInput = { organizationId: orgA, operation: M0_OPERATION, businessRequestId: sameKey, payloadFingerprint: sameKey, principalKind: "staff" as const, principalSubject: staffActor, staffActorUserId: staffActor };
      const pair = await reserveRace(a, b, requests, sameInput, { ...sameInput, principalKind: "portal", principalSubject: `portal-${run}`, staffActorUserId: null });
      if (pair.contender.kind !== "replay" || pair.contender.request.id !== pair.created.request.id) throw new Error("Same-key concurrent operation reservation did not converge.");
      await b.query("SELECT 1");

      const multiKey = `${run}-multi`;
      await a.query("BEGIN");
      const multiCreated = await requests.reserve(a, { ...sameInput, businessRequestId: multiKey, payloadFingerprint: multiKey });
      let bInsertReached!: () => void;
      let cInsertReached!: () => void;
      const bInsertStarted = new Promise<void>((resolve) => { bInsertReached = resolve; });
      const cInsertStarted = new Promise<void>((resolve) => { cInsertReached = resolve; });
      const observedB = { query: async (...args: Parameters<PoolClient["query"]>) => {
        if (typeof args[0] === "string" && args[0].includes("INSERT INTO v2_operation_requests")) bInsertReached();
        return b.query(...args as [string, unknown[]]);
      } } as Pick<PoolClient, "query">;
      const observedC = { query: async (...args: Parameters<PoolClient["query"]>) => {
        if (typeof args[0] === "string" && args[0].includes("INSERT INTO v2_operation_requests")) cInsertReached();
        return c.query(...args as [string, unknown[]]);
      } } as Pick<PoolClient, "query">;
      const multiReservations = [
        requests.reserve(observedB, { ...sameInput, businessRequestId: multiKey, payloadFingerprint: multiKey, principalKind: "portal", principalSubject: `portal-multi-${run}`, staffActorUserId: null }),
        requests.reserve(observedC, { ...sameInput, businessRequestId: multiKey, payloadFingerprint: multiKey, principalKind: "service", principalSubject: `service-multi-${run}`, staffActorUserId: null }),
      ];
      await Promise.all([bInsertStarted, cInsertStarted]);
      await a.query("COMMIT");
      const multi = await Promise.all(multiReservations);
      if (multiCreated.kind !== "new" || multi.some((reservation) => reservation.request.id !== multiCreated.request.id)) throw new Error("Multiple concurrent operation reservations did not converge.");

      const conflictKey = `${run}-conflict`;
      await b.query("BEGIN");
      await reserveRace(a, b, requests, { ...sameInput, businessRequestId: conflictKey, payloadFingerprint: conflictKey }, { ...sameInput, businessRequestId: conflictKey, payloadFingerprint: `other-${conflictKey}` }).then(() => {
        throw new Error("Concurrent different-fingerprint request unexpectedly replayed.");
      }, (error) => {
        if (!(error instanceof OperationRequestIdempotencyConflictError)) throw error;
      });
      await b.query("SELECT 1");
      await b.query("COMMIT");
      const conflictWinner = await requests.reserve(c, { ...sameInput, businessRequestId: conflictKey, payloadFingerprint: conflictKey });
      await requests.markRetryableFailure(c, orgA, conflictWinner.request.id);
      const resumed = await requests.reserve(c, { ...sameInput, businessRequestId: conflictKey, payloadFingerprint: conflictKey });
      if (resumed.kind !== "resumed") throw new Error("Retry after concurrent reservation race failed.");
      const otherOrg = await requests.reserve(c, { ...sameInput, organizationId: orgB, businessRequestId: sameKey, payloadFingerprint: sameKey });
      if (otherOrg.kind !== "new") throw new Error("Different organizations collided on the same business request ID.");

      const workA = await outbox.enqueue(a, { organizationId: orgA, eventType: M0_EVENT, aggregateType: "m0", aggregateId: `${run}-work-a`, idempotencyKey: run, payload: { run } });
      const workADupe = await outbox.enqueue(a, { organizationId: orgA, eventType: M0_EVENT, aggregateType: "m0", aggregateId: `${run}-work-a`, idempotencyKey: run, payload: { run } });
      const workB = await outbox.enqueue(a, { organizationId: orgB, eventType: M0_EVENT, aggregateType: "m0", aggregateId: `${run}-work-b`, idempotencyKey: run, payload: { run } });
      if (workA.id !== workADupe.id || workA.id === workB.id) throw new Error("Outbox deterministic identity was not organization-scoped.");
      const [claimA, claimB] = await Promise.all([outbox.claim(a, orgA, `worker-a-${run}`, 30, 1), outbox.claim(b, orgA, `worker-b-${run}`, 30, 1)]);
      if (claimA.length + claimB.length !== 1) throw new Error("Concurrent outbox claim did not produce exactly one lease owner.");
      const owner = claimA[0]?.claimedBy ?? claimB[0]?.claimedBy;
      if (!owner) throw new Error("Outbox lease owner is missing.");
      if (await outbox.complete(c, orgB, workA.id, owner)) throw new Error("Foreign organization completed known outbox work ID.");
      if (await outbox.retry(c, orgB, workA.id, owner, new Date(), "token=secret")) throw new Error("Foreign organization retried known outbox work ID.");
      if (await outbox.deadLetter(c, orgB, workA.id, owner, "token=secret")) throw new Error("Foreign organization dead-lettered known outbox work ID.");
      const wrongOrgClaim = await outbox.claim(c, orgB, `worker-foreign-${run}`, 30, 1);
      if (wrongOrgClaim.some((message) => message.id === workA.id) || !wrongOrgClaim.some((message) => message.id === workB.id)) throw new Error("Organization-scoped claim leaked or skipped durable work.");
      const workBOwner = wrongOrgClaim.find((message) => message.id === workB.id)?.claimedBy;
      if (!workBOwner || !(await outbox.complete(c, orgB, workB.id, workBOwner))) throw new Error("Correct organization could not complete its leased work.");
      if (await outbox.complete(c, orgB, workB.id, workBOwner)) throw new Error("Repeated outbox completion was not idempotently rejected.");
      if (!(await outbox.retry(a, orgA, workA.id, owner, new Date(Date.now() + 60_000), "password=secret"))) throw new Error("Correct organization could not retry leased work.");
      if ((await outbox.claim(b, orgA, `worker-early-${run}`, 30, 1)).some((message) => message.id === workA.id)) throw new Error("Retry availability was ignored.");
      await a.query("UPDATE v2_outbox_messages SET available_at = now() - interval '1 second' WHERE organization_id = $1 AND id = $2", [orgA, workA.id]);
      const recovered = await outbox.claim(b, orgA, `worker-recovered-${run}`, 30, 1);
      const recoveredWork = recovered.find((message) => message.id === workA.id);
      if (!recoveredWork?.claimedBy) throw new Error("Eligible retry work was not recovered.");
      if (await outbox.complete(a, orgA, workA.id, owner)) throw new Error("Stale worker completed re-leased work.");
      if (!(await outbox.deadLetter(b, orgA, workA.id, recoveredWork.claimedBy, "token=secret"))) throw new Error("Correct lease owner could not dead-letter work.");
      if ((await outbox.claim(a, orgA, `worker-terminal-${run}`, 30, 1)).some((message) => message.id === workA.id)) throw new Error("Dead-letter work was reclaimed.");
      const leaseWork = await outbox.enqueue(a, { organizationId: orgA, eventType: M0_EVENT, aggregateType: "m0", aggregateId: `${run}-lease`, idempotencyKey: run, payload: { run } });
      const firstLease = await outbox.claim(a, orgA, `worker-lease-a-${run}`, 30, 1);
      const firstLeaseWork = firstLease.find((message) => message.id === leaseWork.id);
      if (!firstLeaseWork?.claimedBy) throw new Error("Lease fixture was not claimed.");
      await a.query("UPDATE v2_outbox_messages SET lease_expires_at = now() - interval '1 second' WHERE organization_id = $1 AND id = $2", [orgA, leaseWork.id]);
      const secondLease = await outbox.claim(b, orgA, `worker-lease-b-${run}`, 30, 1);
      const secondLeaseWork = secondLease.find((message) => message.id === leaseWork.id);
      if (!secondLeaseWork?.claimedBy || secondLeaseWork.attemptCount !== 2) throw new Error("Expired lease did not recover to a new worker.");
      if (await outbox.complete(a, orgA, leaseWork.id, firstLeaseWork.claimedBy)) throw new Error("Expired lease owner completed recovered work.");
      if (!(await outbox.complete(b, orgA, leaseWork.id, secondLeaseWork.claimedBy))) throw new Error("Recovered lease owner could not complete work.");
      console.log("[m0-postgres] PASS: request races, transaction usability, attribution, tenant isolation, rollback, outbox leases, retry, completion protection, and dead-letter checks");
    } finally {
      a.release(); b.release(); c.release();
    }
  } finally {
    try {
      if (organizationIds.length > 0) {
        await pool.query("DELETE FROM v2_principal_attributions WHERE organization_id = ANY($1::varchar[]) AND operation = $2 AND resource_id LIKE $3", [organizationIds, M0_OPERATION, `${run}%`]);
        await pool.query("DELETE FROM v2_outbox_messages WHERE organization_id = ANY($1::varchar[]) AND event_type = $2 AND aggregate_id LIKE $3", [organizationIds, M0_EVENT, `${run}%`]);
        await pool.query("DELETE FROM v2_operation_requests WHERE organization_id = ANY($1::varchar[]) AND operation = $2 AND business_request_id LIKE $3", [organizationIds, M0_OPERATION, `${run}%`]);
      }
    } finally {
      await pool.end();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? sanitizeOutboxError(error.message) : "unknown error";
  console.error(`[m0-postgres] FAILED: ${message}`);
  process.exitCode = 1;
});
