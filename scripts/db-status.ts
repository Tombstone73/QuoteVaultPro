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

  console.log(`[db:status] SQL files: ${sqlFiles.length}`);
  console.log(`[db:status] Journal entries: ${(journal?.entries ?? []).length}`);

  const notInJournal = sqlFiles
    .map((f) => path.basename(f, ".sql"))
    .filter((tag) => !journalTags.has(tag));

  if (notInJournal.length) {
    console.log("[db:status] SQL files NOT in drizzle journal (drizzle-kit will not apply these):");
    for (const tag of notInJournal) console.log(`  - ${tag}`);
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[db:status] DATABASE_URL is not set; cannot query __drizzle_migrations.");
    console.warn("[db:status] Set DATABASE_URL (or .env) and re-run.");
    process.exit(0);
  }

  console.log("[db:status] DATABASE_URL:", redactDatabaseUrl(process.env.DATABASE_URL));

  let applied: AppliedRow[] = [];
  try {
    applied = await queryAppliedMigrations();
  } catch (e: any) {
    console.error("[db:status] Failed to query __drizzle_migrations:", e?.message || e);
    process.exit(1);
  }

  console.log(`[db:status] Applied migrations: ${applied.length}`);

  // Print a compact list. (The id/tag convention is: <tag> from the journal.)
  for (const row of applied) {
    const id = row.id ?? "<no id>";
    const createdAt = row.created_at ?? "";
    console.log(`  - ${id}${createdAt ? ` (${createdAt})` : ""}`);
  }

  // Compare applied ids against journal tags where possible.
  const appliedIds = new Set(applied.map((r) => r.id).filter(Boolean) as string[]);
  const missingApplied = Array.from(journalTags).filter((tag) => !appliedIds.has(tag));
  if (missingApplied.length) {
    console.log("[db:status] Journal entries NOT present in DB (may need db:migrate):");
    for (const tag of missingApplied) console.log(`  - ${tag}`);
  }
}

main().catch((e) => {
  console.error("[db:status] Fatal:", e);
  process.exit(1);
});
