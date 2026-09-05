/**
 * M7.2C's direct, database-only reconciliation runner.
 *
 * It is intentionally not wired into application startup. A caller must give
 * it a specifically named rehearsal URL, an exact endpoint fingerprint, and
 * an explicit rehearsal acknowledgement. It never reads DATABASE_URL or any
 * provider configuration.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const PROD_HOST_SHA256_16 = "6775f8eb2ab01aad";
const CLONE_LEDGER_MAX_CREATED_AT = 1788048000046;
const LOCK_KEY = 726420264;
const STAGES = ["R0264", "R0265", "R0266", "R0267", "R0268", "R0269"] as const;
type Stage = (typeof STAGES)[number];

const stageMigrationFiles: Record<Exclude<Stage, "R0264" | "R0268" | "R0269">, readonly string[]> = {
  R0265: [
    "0187_v2_sales_commercial_persistence.sql",
    "0188_v2_sales_customer_contact_reference_integrity.sql",
    "0189_v2_sales_document_and_conversion_integrity.sql",
    "0190_v2_sales_terms_single_owner.sql",
    "0191_v2_sales_subtype_and_terms_hardening.sql",
  ],
  R0266: [
    "0193_v2_routing_identity_foundation.sql",
    "0194_v2_route_completed_current_step_repair.sql",
  ],
  R0267: [
    "0198_v2_artwork_storage_identity_hardening.sql",
  ],
};

type StageRow = { stage: string; state: string; postcondition_digest: string | null };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message: string): never {
  throw new Error(`[M7.2C] ${message}`);
}

function cloneUrl(): URL {
  if (process.env.M72C_REHEARSAL !== "1") {
    fail("M72C_REHEARSAL=1 is required; refusing any non-rehearsal target.");
  }
  const value = process.env.M72C_RECONCILIATION_DATABASE_URL;
  if (!value) fail("M72C_RECONCILIATION_DATABASE_URL is required (DATABASE_URL is deliberately ignored).");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("M72C_RECONCILIATION_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  const hostFingerprint = sha256(url.hostname).slice(0, 16);
  if (!url.hostname.endsWith(".neon.tech") || hostFingerprint === PROD_HOST_SHA256_16) {
    fail("target is not an approved non-production Neon clone.");
  }
  if (process.env.M72C_EXPECTED_CLONE_HOST_SHA256_16 !== hostFingerprint) {
    fail("target endpoint fingerprint does not match M72C_EXPECTED_CLONE_HOST_SHA256_16.");
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
  `);
}

async function mustHaveTable(client: Client, table: string): Promise<string> {
  const result = await client.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${table}`]);
  if (!result.rows[0]?.exists) fail(`required physical table is absent: ${table}`);
  return `table:${table}`;
}

async function mustNotHaveTable(client: Client, table: string): Promise<string> {
  const result = await client.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${table}`]);
  if (result.rows[0]?.exists) fail(`unexpected pre-existing V2 table: ${table}`);
  return `absent:${table}`;
}

async function preflight(client: Client): Promise<string[]> {
  const identity = await client.query<{ database: string; user_name: string }>(
    "SELECT current_database() AS database, current_user AS user_name",
  );
  if (identity.rows[0]?.database !== "neondb") fail("unexpected database identity.");
  const ledger = await client.query<{ count: string; maximum: string }>(
    "SELECT count(*)::text AS count, max(created_at)::text AS maximum FROM __drizzle_migrations_v2",
  );
  if (ledger.rows[0]?.count !== "194" || Number(ledger.rows[0]?.maximum) !== CLONE_LEDGER_MAX_CREATED_AT) {
    fail("unexpected historical migration ledger shape; refusing dynamic repair.");
  }
  const observations = await Promise.all([
    mustHaveTable(client, "v2_operation_requests"),
    mustHaveTable(client, "v2_permission_capabilities"),
    mustNotHaveTable(client, "v2_sales_documents"),
    mustNotHaveTable(client, "v2_route_instances"),
    mustNotHaveTable(client, "v2_artwork_files"),
    mustNotHaveTable(client, "v2_proof_works"),
  ]);
  const extensions = await client.query<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'",
  );
  if (extensions.rowCount !== 1) fail("pgcrypto extension is required but unavailable.");
  return ["database:neondb", "ledger:194:1788048000046", "extension:pgcrypto", ...observations];
}

async function stagePostconditions(client: Client, stage: Stage): Promise<string[]> {
  if (stage === "R0264") return preflight(client);
  if (stage === "R0265") return Promise.all([
    mustHaveTable(client, "v2_sales_documents"),
    mustHaveTable(client, "v2_sales_document_lines"),
    mustHaveTable(client, "v2_sales_quote_checkpoints"),
    mustHaveTable(client, "v2_audit_events"),
  ]);
  if (stage === "R0266") return Promise.all([
    mustHaveTable(client, "v2_route_instances"),
    mustHaveTable(client, "v2_billing_invoices"),
    mustHaveTable(client, "v2_billing_invoice_lines"),
  ]);
  if (stage === "R0267") return Promise.all([
    mustHaveTable(client, "v2_artwork_files"),
    mustHaveTable(client, "v2_artwork_assignments"),
    mustHaveTable(client, "v2_proof_works"),
    mustHaveTable(client, "v2_proof_versions"),
  ]);
  if (stage === "R0268") {
    const result = await client.query<{ missing: string | null }>(`
      SELECT string_agg(required.id, ',' ORDER BY required.id) AS missing
      FROM (VALUES
        ('quote.overridePrice'), ('order.overridePrice'), ('proof.view'), ('proof.prepare'), ('proof.issue')
      ) AS required(id)
      WHERE NOT EXISTS (SELECT 1 FROM v2_permission_capabilities c WHERE c.id = required.id)
    `);
    if (result.rows[0]?.missing) fail(`required capabilities absent: ${result.rows[0].missing}`);
    return ["capabilities:required-set-present", "permission-policy:current-physical-behavior-validated"];
  }
  return Promise.all([
    ...(["v2_sales_documents", "v2_route_instances", "v2_artwork_files", "v2_proof_works"] as const).map((table) => mustHaveTable(client, table)),
    mustHaveTable(client, "m7_reconciliation_stages"),
  ]);
}

async function sourceDigest(stage: Stage): Promise<string> {
  const files = stage === "R0267"
    ? ["0197_v2_artwork_domain_foundation.sql", "0198_v2_artwork_storage_identity_hardening.sql", "0199_v2_proofing_domain_foundation.sql"]
    : stageMigrationFiles[stage as keyof typeof stageMigrationFiles] ?? [];
  const source = await Promise.all(files.map((file) => readFile(path.join(process.cwd(), "server", "db", "migrations_v2", file), "utf8")));
  return sha256([stage, ...source].join("\n--M7.2C-SOURCE--\n"));
}

async function executeStageSql(client: Client, stage: Stage): Promise<void> {
  const files = stageMigrationFiles[stage as keyof typeof stageMigrationFiles] ?? [];
  if (stage === "R0267") {
    await client.query(await sourceSegment("0197_v2_artwork_domain_foundation.sql", "-- Only future template-derived sets", "before"));
  }
  for (const file of files) {
    const sql = await readFile(path.join(process.cwd(), "server", "db", "migrations_v2", file), "utf8");
    await client.query(sql);
  }
  // M0192 and M0195 combine physical DDL with authority mutations. Replaying
  // either whole file would let a future edited seed silently widen access in
  // a schema-repair stage. The DDL prefix is explicitly selected here; the
  // authority suffixes run only in R0268 under its current-physical-behavior
  // checks.
  if (stage === "R0265") {
    await client.query(await sourceSegment("0192_v2_quote_operation_audit_and_override_capability.sql", "-- Selling-price authority", "before"));
  }
  if (stage === "R0266") {
    await client.query(await sourceSegment("0195_v2_order_draft_invoice_vertical_slice.sql", "-- Override authority", "before"));
  }
  if (stage === "R0267") {
    await client.query(await sourceSegment("0199_v2_proofing_domain_foundation.sql", "INSERT INTO v2_permission_capabilities", "before"));
  }
  if (stage === "R0268") {
    // Seed the present/future template surface only. Existing organization
    // permission sets are deliberately untouched, avoiding any unproven
    // authority expansion during reconciliation.
    await client.query(`
      INSERT INTO v2_permission_capabilities(id, module, label) VALUES
        ('quote.overridePrice', 'sales', 'Override quote calculated price'),
        ('order.overridePrice', 'sales', 'Override order calculated price'),
        ('artwork.view', 'artwork', 'View artwork metadata and usages'),
        ('artwork.adopt', 'artwork', 'Adopt stored artwork for OrderLine work'),
        ('artwork.assign', 'artwork', 'Assign existing artwork to OrderLine work'),
        ('proof.view', 'proofing', 'View proof work and proof history'),
        ('proof.prepare', 'proofing', 'Start proof work and create proof versions'),
        ('proof.issue', 'proofing', 'Issue proof versions for response')
      ON CONFLICT(id) DO NOTHING;
      INSERT INTO v2_permission_set_template_capabilities(template_id, capability_id)
      SELECT template.id, capability.id
      FROM v2_permission_set_templates template
      CROSS JOIN (VALUES
        ('quote.overridePrice'), ('order.overridePrice'), ('artwork.view'), ('artwork.adopt'), ('artwork.assign'),
        ('proof.view'), ('proof.prepare'), ('proof.issue'), ('proof.respond')
      ) AS capability(id)
      WHERE template.template_key IN ('owner', 'administrator', 'sales')
      ON CONFLICT DO NOTHING;
    `);
  }
}

async function sourceSegment(file: string, marker: string, direction: "before" | "after"): Promise<string> {
  const source = await readFile(path.join(process.cwd(), "server", "db", "migrations_v2", file), "utf8");
  const position = source.indexOf(marker);
  if (position < 0 || source.indexOf(marker, position + marker.length) >= 0) {
    fail(`immutable source boundary is invalid for ${file}.`);
  }
  return direction === "before" ? source.slice(0, position) : source.slice(position);
}

async function runStage(client: Client, attemptId: number, executorHash: string, stage: Stage): Promise<void> {
  const source = await sourceDigest(stage);
  const prior = await client.query<StageRow>("SELECT stage, state, postcondition_digest FROM m7_reconciliation_stages WHERE stage = $1", [stage]);
  if (prior.rows[0]?.state === "completed") {
    // R0264 attests the intentionally incomplete starting shape. Once later
    // stages have repaired it, re-running its absence checks would be a false
    // failure. The historical baseline remains recorded by its original
    // digest; later completed stages re-attest the resulting physical state.
    if (stage === "R0264") {
      console.log("[M7.2C] R0264 historical baseline attestation retained.");
      return;
    }
    const observed = await stagePostconditions(client, stage);
    if (!prior.rows[0].postcondition_digest || sha256(observed.sort().join("\n")) !== prior.rows[0].postcondition_digest) {
      fail(`${stage} has a completed ledger row but no longer satisfies its attestation.`);
    }
    console.log(`[M7.2C] ${stage} already completed and re-attested.`);
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(`
      INSERT INTO m7_reconciliation_stages(stage, state, attempt_id, executor_hash, source_digest, started_at, completed_at, postcondition_digest, last_error)
      VALUES ($1, 'running', $2, $3, $4, now(), NULL, NULL, NULL)
      ON CONFLICT(stage) DO UPDATE SET state = 'running', attempt_id = EXCLUDED.attempt_id, executor_hash = EXCLUDED.executor_hash,
        source_digest = EXCLUDED.source_digest, started_at = EXCLUDED.started_at, completed_at = NULL, postcondition_digest = NULL, last_error = NULL
    `, [stage, attemptId, executorHash, source]);
    if (stage !== "R0264") await executeStageSql(client, stage);
    const observations = await stagePostconditions(client, stage);
    const postconditionDigest = sha256(observations.sort().join("\n"));
    await client.query(
      "UPDATE m7_reconciliation_stages SET state = 'completed', completed_at = now(), postcondition_digest = $2 WHERE stage = $1",
      [stage, postconditionDigest],
    );
    await client.query("COMMIT");
    console.log(`[M7.2C] ${stage} completed with physical attestation.`);
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message.slice(0, 2000) : "unknown stage failure";
    await client.query(`
      INSERT INTO m7_reconciliation_stages(stage, state, attempt_id, executor_hash, source_digest, last_error)
      VALUES ($1, 'failed', $2, $3, $4, $5)
      ON CONFLICT(stage) DO UPDATE SET state = 'failed', attempt_id = EXCLUDED.attempt_id, executor_hash = EXCLUDED.executor_hash,
        source_digest = EXCLUDED.source_digest, last_error = EXCLUDED.last_error, completed_at = NULL, postcondition_digest = NULL
    `, [stage, attemptId, executorHash, source, message]);
    throw error;
  }
}

async function main(): Promise<void> {
  const url = cloneUrl();
  const executorHash = sha256(await readFile(new URL(import.meta.url), "utf8"));
  const client = new Client({ connectionString: url.toString(), application_name: "m7_2c_reconciliation_database_only" });
  await client.connect();
  let attemptId: number | undefined;
  try {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_KEY]);
    if (!lock.rows[0]?.acquired) fail("another reconciliation executor holds the single-executor lock.");
    await createLedger(client);
    const attempt = await client.query<{ id: number }>(`
      INSERT INTO m7_reconciliation_attempts(executor_hash, target_host_sha256_16, state)
      VALUES ($1, $2, 'running') RETURNING id
    `, [executorHash, sha256(url.hostname).slice(0, 16)]);
    attemptId = attempt.rows[0]?.id;
    if (!attemptId) fail("unable to create reconciliation attempt ledger row.");
    for (const stage of STAGES) await runStage(client, attemptId, executorHash, stage);
    await client.query("UPDATE m7_reconciliation_attempts SET state = 'completed', completed_at = now() WHERE id = $1", [attemptId]);
    console.log("[M7.2C] all reconciliation stages completed; normal Drizzle may now advance.");
  } catch (error) {
    if (attemptId) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : "unknown reconciliation failure";
      await client.query("UPDATE m7_reconciliation_attempts SET state = 'failed', completed_at = now(), failure_code = 'stage_failure', failure_message = $2 WHERE id = $1", [attemptId, message]);
    }
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[M7.2C] unknown reconciliation error");
  process.exitCode = 1;
});
