/**
 * M7.7B's one-target DEV schema repair.
 *
 * This deliberately does not reuse the clone-only M7.2C executor.  It can
 * run only during Railway's exact PrintersHero DEV deployment context, only
 * after an explicit acknowledgement and endpoint fingerprint are supplied,
 * and only from the audited M0269-ledger physical shape.  It never changes
 * Drizzle's historical journal.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { requireV2DeploymentTarget } from "../src/config/runtimeConfig.js";

const PROD_HOST_SHA256_16 = "6775f8eb2ab01aad";
const EXPECTED_LEDGER_COUNT = 268;
const EXPECTED_LEDGER_MAX_ID = 269;
const EXPECTED_LEDGER_MAX_CREATED_AT = 1788048000120;
const STAGES = ["D0270", "D0271", "D0272", "D0273"] as const;
type Stage = (typeof STAGES)[number];

const stageSource: Record<Stage, string> = {
  D0270: "0270_v2_payment_allocation_aggregate.sql",
  D0271: "0271_v2_refund_allocation_aggregate.sql",
  D0272: "0272_v2_ai_safe_tool_plane.sql",
  D0273: "0273_v2_ai_assistant_access_capability.sql",
};

type StageRow = { stage: string; state: string; postcondition_digest: string | null };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => { throw new Error(`[M7.7B] ${message}`); };

function targetUrl(): URL {
  if (process.env.M77B_DEV_RECONCILIATION !== "1") {
    fail("M77B_DEV_RECONCILIATION=1 is required; this repair is never automatic.");
  }
  if (requireV2DeploymentTarget(process.env) !== "development" || process.env.NODE_ENV !== "production") {
    fail("the repair is restricted to Railway PrintersHero-DEV / Development with NODE_ENV=production.");
  }
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) fail("MIGRATION_DATABASE_URL is required after the guarded deployment configuration step.");
  let url: URL;
  try { url = new URL(raw); } catch { fail("MIGRATION_DATABASE_URL is not a PostgreSQL URL."); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") fail("MIGRATION_DATABASE_URL must be PostgreSQL.");
  if (!url.hostname.endsWith(".neon.tech")) fail("target is not the approved Neon DEV database.");
  const fingerprint = sha256(url.hostname).slice(0, 16);
  if (fingerprint === PROD_HOST_SHA256_16) fail("the known production endpoint is categorically rejected.");
  // A one-time probe may read this non-secret value from a failed predeploy
  // log and bind it back as the explicit expected target. The hostname and
  // credentials never leave this process.
  console.log(`[M7.7B] observed DEV endpoint fingerprint: ${fingerprint}`);
  if (!process.env.M77B_EXPECTED_DEV_HOST_SHA256_16 || process.env.M77B_EXPECTED_DEV_HOST_SHA256_16 !== fingerprint) {
    fail("target endpoint fingerprint does not match M77B_EXPECTED_DEV_HOST_SHA256_16.");
  }
  return url;
}

async function createLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS m7_reconciliation_attempts (
      id bigserial PRIMARY KEY,
      executor_hash varchar(64) NOT NULL,
      target_host_sha256_16 varchar(16) NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      state varchar(16) NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
      failure_code varchar(80),
      failure_message text
    );
    CREATE TABLE IF NOT EXISTS m7_reconciliation_stages (
      stage varchar(8) PRIMARY KEY,
      state varchar(16) NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
      attempt_id bigint NOT NULL REFERENCES m7_reconciliation_attempts(id),
      executor_hash varchar(64) NOT NULL,
      source_digest varchar(64) NOT NULL,
      postcondition_digest varchar(64),
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      last_error text
    );
    CREATE TABLE IF NOT EXISTS m7_reconciliation_lock (
      id smallint PRIMARY KEY CHECK (id = 1),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query("INSERT INTO m7_reconciliation_lock(id) VALUES (1) ON CONFLICT(id) DO NOTHING");
}

async function acquireLock(connectionString: string): Promise<Client> {
  const lock = new Client({ connectionString, application_name: "m7_7b_dev_reconciliation_lock" });
  await lock.connect();
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM m7_reconciliation_lock WHERE id = 1 FOR UPDATE NOWAIT");
    return lock;
  } catch (error) {
    await lock.query("ROLLBACK").catch(() => undefined);
    await lock.end();
    fail(`another reconciliation executor holds the durable lock: ${error instanceof Error ? error.message : "unknown lock error"}`);
  }
}

async function table(client: Client, name: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${name}`]);
  return result.rows[0]?.exists === true;
}

async function column(client: Client, relation: string, name: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS exists",
    [relation, name],
  );
  return result.rows[0]?.exists === true;
}

async function preflight(client: Client): Promise<string[]> {
  const identity = await client.query<{ database: string }>("SELECT current_database() AS database");
  if (identity.rows[0]?.database !== "neondb") fail("unexpected database identity.");
  const ledger = await client.query<{ count: string; max_id: string; max_created_at: string }>(
    "SELECT count(*)::text AS count, max(id)::text AS max_id, max(created_at)::text AS max_created_at FROM public.__drizzle_migrations_v2",
  );
  const row = ledger.rows[0];
  if (row?.count !== String(EXPECTED_LEDGER_COUNT) || row.max_id !== String(EXPECTED_LEDGER_MAX_ID) || Number(row.max_created_at) !== EXPECTED_LEDGER_MAX_CREATED_AT) {
    console.log(`[M7.7B] observed DEV ledger shape: count=${row?.count ?? "unknown"} max_id=${row?.max_id ?? "unknown"} max_created_at=${row?.max_created_at ?? "unknown"}`);
    fail("unexpected DEV migration ledger; refusing dynamic repair.");
  }
  const hasLedger = await table(client, "m7_reconciliation_stages");
  const completed = hasLedger
    ? await client.query<{ stage: string }>("SELECT stage FROM m7_reconciliation_stages WHERE stage = ANY($1::varchar[]) AND state='completed' ORDER BY stage", [STAGES])
    : { rows: [] as Array<{ stage: string }> };
  const completedStages = new Set(completed.rows.map((entry) => entry.stage));
  for (const [index, stage] of STAGES.entries()) {
    if (completedStages.has(stage) && index > 0 && !completedStages.has(STAGES[index - 1])) {
      fail("reconciliation ledger has a non-contiguous completed DEV stage sequence.");
    }
  }
  const required = ["v2_billing_payment_allocations", "v2_billing_refund_allocations", "v2_billing_provider_financial_operations", "v2_permission_capabilities"];
  for (const name of required) if (!await table(client, name)) fail(`required prior V2 relation is absent: ${name}`);
  const physical = {
    D0270: await column(client, "v2_billing_provider_financial_operations", "allocation_intent"),
    D0271: await table(client, "v2_billing_refund_allocation_evidence"),
    D0272: await table(client, "v2_ai_conversations"),
    D0273: (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_permission_capabilities WHERE id='assistant.use'")).rows[0]?.count === "1",
  } satisfies Record<Stage, boolean>;
  for (const [index, stage] of STAGES.entries()) {
    const previous = index > 0 ? STAGES[index - 1] : undefined;
    if (physical[stage] && previous && !physical[previous]) fail(`${stage} exists before its required predecessor physical stage.`);
    if (completedStages.has(stage) && !physical[stage]) fail(`${stage} completed reconciliation ledger entry lacks its physical surface.`);
  }
  const extension = await client.query<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname='pgcrypto'");
  if (extension.rowCount !== 1) fail("pgcrypto extension is required but unavailable.");
  return ["database:neondb", `ledger:${row.count}:${row.max_id}:${row.max_created_at}`, "extension:pgcrypto", ...required.map((name) => `table:${name}`), ...STAGES.map((stage) => `physical:${stage}:${physical[stage]}`), ...[...completedStages].map((stage) => `prior:${stage}`)];
}

async function postconditions(client: Client, stage: Stage): Promise<string[]> {
  if (stage === "D0270") {
    if (!await column(client, "v2_billing_provider_financial_operations", "allocation_intent")) fail("D0270 allocation intent is absent.");
    const mismatch = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM v2_billing_payments p
      WHERE NOT EXISTS (SELECT 1 FROM v2_billing_payment_allocations a WHERE a.organization_id=p.organization_id AND a.payment_id=p.id)
        OR p.amount_cents <> (SELECT COALESCE(sum(a.amount_cents), 0) FROM v2_billing_payment_allocations a WHERE a.organization_id=p.organization_id AND a.payment_id=p.id)
    `);
    if (mismatch.rows[0]?.count !== "0") fail("D0270 payment allocation postcondition failed.");
    const constraint = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_constraint WHERE conrelid='public.v2_billing_payment_allocations'::regclass AND conname='v2_billing_payment_allocations_payment_invoice_uidx'");
    if (constraint.rows[0]?.count !== "1") fail("D0270 payment allocation uniqueness constraint is absent.");
    return ["column:v2_billing_provider_financial_operations.allocation_intent", "payment-allocation-uniqueness:present", "payment-allocation-sums:complete"];
  }
  if (stage === "D0271") {
    if (!await table(client, "v2_billing_refund_allocation_evidence")) fail("D0271 evidence table is absent.");
    const missing = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM v2_billing_refund_allocations a
      LEFT JOIN v2_billing_refund_allocation_evidence e ON e.organization_id=a.organization_id AND e.refund_allocation_id=a.id
      WHERE e.refund_allocation_id IS NULL
    `);
    if (missing.rows[0]?.count !== "0") fail("D0271 refund evidence postcondition failed.");
    const trigger = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_trigger WHERE tgrelid='public.v2_billing_refund_allocation_evidence'::regclass AND tgname='v2_billing_refund_allocation_evidence_immutable_trigger' AND NOT tgisinternal");
    if (trigger.rows[0]?.count !== "1") fail("D0271 immutable refund evidence trigger is absent.");
    return ["table:v2_billing_refund_allocation_evidence", "refund-evidence-immutability:present", "refund-allocation-evidence:complete"];
  }
  if (stage === "D0272") {
    for (const name of ["v2_ai_conversations", "v2_ai_conversation_messages", "v2_ai_pending_commands", "v2_ai_tool_audit"]) if (!await table(client, name)) fail(`D0272 relation is absent: ${name}`);
    const trigger = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_trigger WHERE tgrelid='public.v2_ai_tool_audit'::regclass AND tgname='v2_ai_tool_audit_immutable' AND NOT tgisinternal");
    if (trigger.rows[0]?.count !== "1") fail("D0272 AI audit immutable trigger is absent.");
    return ["ai-evidence-tables:present", "ai-audit-immutability:installed"];
  }
  const capability = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_permission_capabilities WHERE id='assistant.use'");
  if (capability.rows[0]?.count !== "1") fail("D0273 assistant capability is absent.");
  return ["capability:assistant.use", "ai-access-authority:attested"];
}

async function sourceDigest(stage: Stage): Promise<string> {
  const source = await readFile(path.join(process.cwd(), "server", "db", "migrations_v2", stageSource[stage]), "utf8");
  return sha256([stage, source].join("\n--M7.7B-SOURCE--\n"));
}

async function runStage(client: Client, attemptId: number, executorHash: string, stage: Stage): Promise<void> {
  const source = await sourceDigest(stage);
  const previous = await client.query<StageRow>("SELECT stage,state,postcondition_digest FROM m7_reconciliation_stages WHERE stage=$1", [stage]);
  if (previous.rows[0]?.state === "completed") {
    const observed = sha256((await postconditions(client, stage)).sort().join("\n"));
    if (!previous.rows[0].postcondition_digest || previous.rows[0].postcondition_digest !== observed) fail(`${stage} completed ledger entry no longer matches physical attestation.`);
    console.log(`[M7.7B] ${stage} already completed and re-attested.`);
    return;
  }
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO m7_reconciliation_stages(stage,state,attempt_id,executor_hash,source_digest,started_at,completed_at,postcondition_digest,last_error)
      VALUES($1,'running',$2,$3,$4,now(),NULL,NULL,NULL)
      ON CONFLICT(stage) DO UPDATE SET state='running',attempt_id=EXCLUDED.attempt_id,executor_hash=EXCLUDED.executor_hash,source_digest=EXCLUDED.source_digest,started_at=EXCLUDED.started_at,completed_at=NULL,postcondition_digest=NULL,last_error=NULL`, [stage, attemptId, executorHash, source]);
    const exists = stage === "D0270"
      ? await column(client, "v2_billing_provider_financial_operations", "allocation_intent")
      : stage === "D0271"
        ? await table(client, "v2_billing_refund_allocation_evidence")
        : stage === "D0272"
          ? await table(client, "v2_ai_conversations")
          : (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_permission_capabilities WHERE id='assistant.use'")).rows[0]?.count === "1";
    if (!exists) await client.query(await readFile(path.join(process.cwd(), "server", "db", "migrations_v2", stageSource[stage]), "utf8"));
    const digest = sha256((await postconditions(client, stage)).sort().join("\n"));
    await client.query("UPDATE m7_reconciliation_stages SET state='completed',completed_at=now(),postcondition_digest=$2 WHERE stage=$1", [stage, digest]);
    await client.query("COMMIT");
    console.log(`[M7.7B] ${stage} ${exists ? "adopted after physical attestation" : "completed with physical attestation"}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message.slice(0, 2000) : "unknown stage failure";
    await client.query(`INSERT INTO m7_reconciliation_stages(stage,state,attempt_id,executor_hash,source_digest,last_error)
      VALUES($1,'failed',$2,$3,$4,$5)
      ON CONFLICT(stage) DO UPDATE SET state='failed',attempt_id=EXCLUDED.attempt_id,executor_hash=EXCLUDED.executor_hash,source_digest=EXCLUDED.source_digest,last_error=EXCLUDED.last_error,completed_at=NULL,postcondition_digest=NULL`, [stage, attemptId, executorHash, source, message]);
    throw error;
  }
}

export async function runM77BDevSchemaReconciliation(): Promise<void> {
  const url = targetUrl();
  const executorHash = sha256(await readFile(new URL(import.meta.url), "utf8"));
  const client = new Client({ connectionString: url.toString(), application_name: "m7_7b_dev_schema_reconciliation" });
  await client.connect();
  let lock: Client | undefined;
  let attemptId: number | undefined;
  try {
    // Prove the target and historic baseline before creating even the
    // reconciliation ledger. The second check happens while the durable lock
    // is held so a concurrent schema writer cannot change the baseline.
    await preflight(client);
    await createLedger(client);
    lock = await acquireLock(url.toString());
    await preflight(client);
    const attempt = await client.query<{ id: number }>("INSERT INTO m7_reconciliation_attempts(executor_hash,target_host_sha256_16,state) VALUES($1,$2,'running') RETURNING id", [executorHash, sha256(url.hostname).slice(0, 16)]);
    attemptId = attempt.rows[0]?.id;
    if (!attemptId) fail("unable to create reconciliation attempt ledger row.");
    for (const stage of STAGES) await runStage(client, attemptId, executorHash, stage);
    await client.query("UPDATE m7_reconciliation_attempts SET state='completed',completed_at=now() WHERE id=$1", [attemptId]);
  } catch (error) {
    if (attemptId) await client.query("UPDATE m7_reconciliation_attempts SET state='failed',completed_at=now(),failure_code='stage_failure',failure_message=$2 WHERE id=$1", [attemptId, error instanceof Error ? error.message.slice(0, 2000) : "unknown reconciliation failure"]);
    throw error;
  } finally {
    if (lock) { await lock.query("COMMIT").catch(() => undefined); await lock.end(); }
    await client.end();
  }
}

if (process.argv[1]?.endsWith("runM77BDevSchemaReconciliation.ts")) {
  void runM77BDevSchemaReconciliation().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "[M7.7B] unknown reconciliation error"); process.exitCode = 1; });
}
