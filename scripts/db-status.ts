import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

type Journal = {
  entries?: Array<{ idx: number; tag: string; when?: number }>;
};

type AppliedRow = {
  id?: string;
  hash?: string;
  created_at?: string;
};

function requireDatabaseUrl(): string {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('[db:status] DATABASE_URL is missing. Ensure .env contains DATABASE_URL or set it in the shell.');
    process.exit(1);
  }
  return url;
}

function parseNumericMigrationId(id: string | undefined): number | null {
  if (!id) return null;
  const s = String(id);
  // Supports "27", "0026_stripe_payments_v1", "0018_mvp_invoicing_billing_ready"
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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
  const migrationsDir = path.join(repoRoot, "server", "db", "migrations");
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

  // Drizzle-kit creates __drizzle_migrations. Column names vary by version; we only need ids.
  // Prefer selecting all columns and printing what exists.
  const result = await db.execute(sql`
    SELECT *
    FROM __drizzle_migrations
    ORDER BY created_at ASC
  `);

  return result.rows as AppliedRow[];
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

  let applied: AppliedRow[] = [];
  try {
    applied = await queryAppliedMigrations();
  } catch (e: any) {
    console.error("[db:status] Failed to query __drizzle_migrations:", e?.message || e);
    process.exit(1);
  }

  const appliedCount = applied.length;
  let highestId: number | null = null;
  for (const row of applied) {
    const n = parseNumericMigrationId(row.id);
    if (n == null) continue;
    highestId = highestId == null ? n : Math.max(highestId, n);
  }

  console.log(`[db:status] Applied migrations (DB __drizzle_migrations): ${appliedCount}`);
  console.log(`[db:status] Highest applied id (numeric): ${highestId ?? 'unknown'}`);

  // Print a compact list. (The id/tag convention is: <tag> from the journal.)
  for (const row of applied) {
    const id = row.id ?? "<no id>";
    const createdAt = row.created_at ?? "";
    console.log(`  - ${id}${createdAt ? ` (${createdAt})` : ""}`);
  }
}

main().catch((e) => {
  console.error("[db:status] Fatal:", e);
  process.exit(1);
});
