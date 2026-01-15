import "dotenv/config";
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

type AppliedRow = {
  id?: string;
  created_at?: string;
};

function parseNumericMigrationId(id: string | undefined): number | null {
  if (!id) return null;
  const s = String(id);
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function redactDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    const username = parsed.username ? '<user>' : '';
    const password = parsed.password ? ':<password>' : '';
    const host = parsed.host;
    const db = parsed.pathname || '';
    return `${parsed.protocol}//${username}${password}@${host}${db}`;
  } catch {
    return '<invalid DATABASE_URL>';
  }
}

function main() {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, 'drizzle.config.ts');
  const migrationsDir = path.join(repoRoot, 'server', 'db', 'migrations');
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');

  console.log('[db:migrate:verbose] Repo:', repoRoot);
  console.log('[db:migrate:verbose] Config:', configPath);
  console.log('[db:migrate:verbose] Migrations dir:', migrationsDir);
  console.log('[db:migrate:verbose] Journal:', journalPath);

  if (!process.env.DATABASE_URL) {
    console.error('[db:migrate:verbose] DATABASE_URL is missing. Ensure .env contains DATABASE_URL or set it in the shell.');
    process.exit(1);
  } else {
    console.log('[db:migrate:verbose] DATABASE_URL:', redactDatabaseUrl(process.env.DATABASE_URL));
  }

  let journalEntryCount = 0;
  let sqlFileCount = 0;
  let notInJournalCount = 0;
  let journalDriftDetected = false;

  try {
    const journalRaw = fs.readFileSync(journalPath, 'utf8');
    const journal = JSON.parse(journalRaw) as { entries?: Array<{ idx: number; tag: string }> };
    const tags = new Set((journal.entries || []).map((e) => e.tag));

    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const notInJournal = sqlFiles
      .map((f) => path.basename(f, '.sql'))
      .filter((tag) => !tags.has(tag));

    journalEntryCount = (journal.entries || []).length;
    sqlFileCount = sqlFiles.length;
    notInJournalCount = notInJournal.length;
    journalDriftDetected = sqlFileCount !== journalEntryCount || notInJournalCount > 0;

    console.log(`[db:migrate:verbose] Journal entries: ${journalEntryCount}`);
    console.log(`[db:migrate:verbose] SQL files: ${sqlFileCount}`);

    if (notInJournal.length) {
      console.log('[db:migrate:verbose] SQL files NOT in journal (will NOT be applied by drizzle-kit):');
      for (const tag of notInJournal) console.log(`  - ${tag}`);
    }
  } catch (e: any) {
    console.warn('[db:migrate:verbose] Failed to read/parse journal:', e?.message || e);
  }

  // If the DB is already migrated via manual catchup, drizzle-kit migrate is usually unsafe/noisy.
  // We still allow it for an empty DB.
  (async () => {
    try {
      const { sql } = await import('drizzle-orm');
      const { db } = await import('../server/db');

      const result = await db.execute(sql`
        SELECT *
        FROM __drizzle_migrations
        ORDER BY created_at ASC
      `);

      const applied = result.rows as AppliedRow[];
      let highestId: number | null = null;
      for (const row of applied) {
        const n = parseNumericMigrationId(row.id);
        if (n == null) continue;
        highestId = highestId == null ? n : Math.max(highestId, n);
      }

      console.log(`[db:migrate:verbose] Applied migrations (DB __drizzle_migrations): ${applied.length}`);
      console.log(`[db:migrate:verbose] Highest applied id (numeric): ${highestId ?? 'unknown'}`);

      if (applied.length > 0 && journalDriftDetected) {
        console.warn('[db:migrate:verbose] Journal drift detected on a non-empty DB; skipping drizzle-kit migrate.');
        console.warn('[db:migrate:verbose] DB is source of truth in this repo due to manual_catchup migrations.');
        process.exit(0);
      }
    } catch (e: any) {
      console.warn('[db:migrate:verbose] Failed to query __drizzle_migrations:', e?.message || e);
      // Continue to attempt drizzle-kit migrate; it will surface its own errors.
    }

    console.log('[db:migrate:verbose] Running: drizzle-kit migrate --config drizzle.config.ts');

    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(npxCmd, ['drizzle-kit', 'migrate', '--config', 'drizzle.config.ts'], {
      stdio: 'inherit',
    });

    process.exit(result.status ?? 1);
  })().catch((e) => {
    console.error('[db:migrate:verbose] Fatal:', e);
    process.exit(1);
  });
}

main();
