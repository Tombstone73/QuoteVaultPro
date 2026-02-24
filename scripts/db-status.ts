import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join("server", "db", "migrations_v2");
const MIGRATIONS_LEDGER = "public.__drizzle_migrations_v2";
const BASELINE_TAG = "0000_baseline";
const STATIONS_TAG = "0001_stations";

type Journal = {
  entries?: Array<{ idx: number; tag: string; when?: number }>;
};

type AppliedRow = {
  id?: number;
  hash?: string;
  created_at?: number;
};

function requireDatabaseUrl(): string {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('[db:status] DATABASE_URL is missing. Ensure .env contains DATABASE_URL or set it in the shell.');
    process.exit(1);
  }
  return url;
}

function redactDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    const username = parsed.username ? "<user>" : "";
    const password = parsed.password ? ":<password>" : "";
    const host = parsed.host;
    const db = parsed.pathname || "";
    return `${parsed.protocol}//${username}${password}@${host}${db}`;
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

function readLocalMigrationTags(repoRoot: string) {
  const migrationsDir = path.join(repoRoot, MIGRATIONS_DIR);
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  let journal: Journal | null = null;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  } catch {
    journal = null;
  }

  const journalTags = new Set((journal?.entries ?? []).map((e) => e.tag));

  return {
    migrationsDir,
    journalPath,
    sqlFiles,
    journal,
    journalTags,
  };
}

async function queryAppliedMigrations() {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../server/db");

  const existsResult = await db.execute(sql.raw(`
    SELECT to_regclass('${MIGRATIONS_LEDGER}') AS ledger
  `));

  const ledgerExists = Boolean((existsResult.rows as Array<{ ledger?: string | null }>)[0]?.ledger);
  if (!ledgerExists) {
    return {
      ledgerExists,
      rows: [] as AppliedRow[],
    };
  }

  const result = await db.execute(sql.raw(`
    SELECT id, hash, created_at
    FROM ${MIGRATIONS_LEDGER}
    ORDER BY id ASC
  `));

  return {
    ledgerExists,
    rows: result.rows as AppliedRow[],
  };
}

async function main() {
  const repoRoot = process.cwd();
  const { migrationsDir, journalPath, sqlFiles, journal, journalTags } = readLocalMigrationTags(repoRoot);

  console.log("[db:status] Repo:", repoRoot);
  console.log("[db:status] Migrations dir:", migrationsDir);
  console.log("[db:status] Journal:", journalPath);

  const sqlFileCount = sqlFiles.length;
  const journalEntryCount = (journal?.entries ?? []).length;

  console.log(`[db:status] SQL files count: ${sqlFileCount}`);
  console.log(`[db:status] Journal entries count: ${journalEntryCount}`);

  if (sqlFileCount !== journalEntryCount) {
    console.warn('[db:status] Journal drift detected; DB is source of truth in this repo due to manual_catchup migrations. This does not block runtime.');
  }

  const notInJournal = sqlFiles
    .map((f) => path.basename(f, ".sql"))
    .filter((tag) => !journalTags.has(tag));

  if (notInJournal.length) {
    console.log("[db:status] SQL files NOT in drizzle journal (drizzle-kit will not apply these):");
    for (const tag of notInJournal) console.log(`  - ${tag}`);
  }

  const databaseUrl = requireDatabaseUrl();
  console.log("[db:status] DATABASE_URL:", redactDatabaseUrl(databaseUrl));

  let ledgerExists = false;
  let applied: AppliedRow[] = [];
  try {
    const queried = await queryAppliedMigrations();
    ledgerExists = queried.ledgerExists;
    applied = queried.rows;
  } catch (e: any) {
    console.error(`[db:status] Failed to query ${MIGRATIONS_LEDGER}:`, e?.message || e);
    process.exit(1);
  }

  if (!ledgerExists) {
    console.log(`[db:status] Ledger table missing: ${MIGRATIONS_LEDGER}`);
    process.exit(0);
  }

  const appliedCount = applied.length;
  const baselineRows = applied.filter((row) => row.hash === BASELINE_TAG);
  const stationsRows = applied.filter((row) => row.hash === STATIONS_TAG);
  const hasBaselineId1 = baselineRows.some((row) => row.id === 1);

  console.log(`[db:status] Applied migrations (DB ${MIGRATIONS_LEDGER}): ${appliedCount}`);
  console.log(`[db:status] Baseline present (${BASELINE_TAG}): ${baselineRows.length > 0 ? 'yes' : 'no'}`);
  console.log(`[db:status] Baseline id=1: ${hasBaselineId1 ? 'yes' : 'no'}`);
  console.log(`[db:status] Stations present (${STATIONS_TAG}): ${stationsRows.length > 0 ? 'yes' : 'no'}`);

  // Print a compact list.
  for (const row of applied) {
    const id = row.id ?? "<no id>";
    const hash = row.hash ?? "<no hash>";
    const createdAt = row.created_at ?? "";
    console.log(`  - id=${id} hash=${hash}${createdAt ? ` created_at=${createdAt}` : ""}`);
  }
}

main().catch((e) => {
  console.error("[db:status] Fatal:", e);
  process.exit(1);
});
