import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { PostgresOperationRequestRepository } from "../infrastructure/persistence/postgresOperationRequests.js";
import { PostgresOutboxRepository } from "../infrastructure/persistence/postgresOutbox.js";

async function main() {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  console.log(`[m0-postgres] clone validation passed: ${target.protocol}//${target.hostname}/${target.pathname.slice(1)}`);
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    await pool.query("SELECT 1");
    const findings = await checkV2M0PhysicalPostconditions(pool);
    assertV2M0PhysicalPostconditions(findings);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const org = await client.query<{ id: string }>("SELECT id FROM organizations ORDER BY id LIMIT 1");
      if (!org.rows[0]) throw new Error("Approved clone needs an organization fixture.");
      const run = randomUUID(); const organizationId = org.rows[0].id;
      const requests = new PostgresOperationRequestRepository(); const outbox = new PostgresOutboxRepository();
      const first = await requests.reserve(client, { organizationId, operation: "m0.rehearsal", businessRequestId: run, payloadFingerprint: run, principalKind: "staff", principalSubject: run });
      const replay = await requests.reserve(client, { organizationId, operation: "m0.rehearsal", businessRequestId: run, payloadFingerprint: run, principalKind: "service", principalSubject: run });
      if (first.kind !== "new" || replay.kind !== "replay" || replay.request.id !== first.request.id) throw new Error("Operation replay failed.");
      const one = await outbox.enqueue(client, { organizationId, eventType: "m0.rehearsal", aggregateType: "m0", aggregateId: run, idempotencyKey: run, payload: { run } });
      const two = await outbox.enqueue(client, { organizationId, eventType: "m0.rehearsal", aggregateType: "m0", aggregateId: run, idempotencyKey: run, payload: { run } });
      if (one.id !== two.id) throw new Error("Outbox deduplication failed.");
      await client.query("ROLLBACK");
      console.log(`[m0-postgres] PASS: ${findings.length} catalog checks and rolled-back persistence smoke`);
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch((e: unknown) => { console.error(`[m0-postgres] FAILED: ${e instanceof Error ? e.message : "unknown error"}`); process.exitCode = 1; });
