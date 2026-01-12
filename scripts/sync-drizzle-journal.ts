import "dotenv/config";

import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";

type DbRow = {
  id: number;
  name: string;
  created_at: string;
};

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type JournalFile = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFileIfMissing(filePath: string, content: string) {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function toWhenMs(createdAt: string | Date | null | undefined): number {
  if (!createdAt) return 0;
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function main() {
  const repoRoot = process.cwd();
  const migrationsDir = path.join(repoRoot, "server", "db", "migrations");
  const metaDir = path.join(migrationsDir, "meta");
  const journalPath = path.join(metaDir, "_journal.json");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  ensureDir(metaDir);

  const existingJournalRaw = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf8") : "";
  const existingJournal: JournalFile | null = existingJournalRaw
    ? (JSON.parse(existingJournalRaw) as JournalFile)
    : null;

  const journalVersion = existingJournal?.version ?? "7";
  const journalDialect = existingJournal?.dialect ?? "postgresql";

  const existingWhenByTag = new Map<string, number>();
  if (existingJournal?.entries?.length) {
    for (const e of existingJournal.entries) {
      if (e && typeof e.tag === "string") existingWhenByTag.set(e.tag, typeof e.when === "number" ? e.when : 0);
    }
  }

  const sql = neon(process.env.DATABASE_URL);
  const rows = (await sql<DbRow[]>`
    SELECT id, name, created_at
    FROM public.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `) as unknown as DbRow[];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No rows found in public.__drizzle_migrations");
  }

  const tagsInDb: string[] = [];
  for (const r of rows) {
    if (!r || typeof (r as any).name !== "string") continue;
    const name = (r as any).name as string;
    if (!name.trim()) continue;
    tagsInDb.push(name);
  }

  const dbTagSet = new Set(tagsInDb);

  // Collect local migration tags (numeric prefix only), excluding meta/ and FUTURE_*.
  const localSqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => f !== "FUTURE_0009_quote_workflow_enum_enhancement.sql")
    .sort();

  const localTags = localSqlFiles
    .map((f) => path.basename(f, ".sql"))
    .filter((tag) => /^\d{4}_/.test(tag));

  // Ensure placeholder SQL exists for every applied tag.
  // Drizzle-kit expects: <tag>.sql under the configured migrations folder.
  const createdPlaceholders: string[] = [];
  for (const tag of tagsInDb) {
    const fileName = `${tag}.sql`;
    const filePath = path.join(migrationsDir, fileName);
    const created = writeFileIfMissing(
      filePath,
      `-- NO-OP PLACEHOLDER MIGRATION\n-- This file was created to align local Drizzle journal/history with an already-applied database migration.\n-- Tag: ${tag}\n\nSELECT 1;\n`
    );
    if (created) createdPlaceholders.push(fileName);
  }

  // Rebuild journal entries:
  // 1) all DB-applied migrations in DB order
  // 2) append local numeric migrations not yet present in DB (so drizzle-kit can apply them)
  const entries: JournalEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: any = rows[i];
    const tag = typeof r?.name === "string" ? r.name : "";
    if (!tag.trim()) continue;

    const when = existingWhenByTag.has(tag) ? (existingWhenByTag.get(tag) ?? 0) : toWhenMs(r.created_at);

    entries.push({
      idx: entries.length,
      version: journalVersion,
      when,
      tag,
      breakpoints: true,
    });
  }

  for (let i = 0; i < localTags.length; i++) {
    const tag = localTags[i];
    if (dbTagSet.has(tag)) continue;
    if (entries.some((e) => e.tag === tag)) continue;

    const when = existingWhenByTag.has(tag) ? (existingWhenByTag.get(tag) ?? 0) : 0;
    entries.push({
      idx: entries.length,
      version: journalVersion,
      when,
      tag,
      breakpoints: true,
    });
  }

  const nextJournal: JournalFile = {
    version: journalVersion,
    dialect: journalDialect,
    entries,
  };

  fs.writeFileSync(journalPath, JSON.stringify(nextJournal, null, 2) + "\n", "utf8");

  console.log(`[sync-drizzle-journal] Wrote journal: ${path.relative(repoRoot, journalPath)}`);
  console.log(`[sync-drizzle-journal] Entries: ${entries.length}`);
  if (createdPlaceholders.length) {
    console.log(`[sync-drizzle-journal] Created ${createdPlaceholders.length} placeholder SQL files:`);
    for (const f of createdPlaceholders) console.log(`  - ${f}`);
  } else {
    console.log("[sync-drizzle-journal] No placeholders needed.");
  }
}

main().catch((e) => {
  console.error("[sync-drizzle-journal] Failed:", e);
  process.exit(1);
});
