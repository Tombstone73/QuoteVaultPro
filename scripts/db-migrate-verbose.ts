import "dotenv/config";
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const MIGRATIONS_DIR = path.join('server', 'db', 'migrations_v2');
const MIGRATIONS_LEDGER = 'public.__drizzle_migrations_v2';

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

function runDrizzleKitMigrate(repoRoot: string): number {
  const drizzleKitBin = path.join(repoRoot, 'node_modules', 'drizzle-kit', 'bin.cjs');
  if (!fs.existsSync(drizzleKitBin)) {
    console.error('[db:migrate:verbose] drizzle-kit binary not found:', drizzleKitBin);
    console.error('[db:migrate:verbose] Run npm install, then retry the migration.');
    return 1;
  }

  const args = [drizzleKitBin, '--config', 'drizzle.config.ts', 'migrate'];

  console.log('[db:migrate:verbose] Running:', [process.execPath, ...args].join(' '));

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error('[db:migrate:verbose] Failed to spawn drizzle-kit:', result.error);
    return 1;
  }

  if (result.signal) {
    console.error(`[db:migrate:verbose] drizzle-kit terminated by signal: ${result.signal}`);
    return 1;
  }

  const status = result.status ?? 1;
  console.log(`[db:migrate:verbose] drizzle-kit exit code: ${status}`);
  return status;
}

function main() {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, 'drizzle.config.ts');
  const migrationsDir = path.join(repoRoot, MIGRATIONS_DIR);
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

      const result = await db.execute(sql.raw(`
        SELECT *
        FROM ${MIGRATIONS_LEDGER}
        ORDER BY created_at ASC
      `));

      const applied = result.rows as AppliedRow[];
      let highestId: number | null = null;
      for (const row of applied) {
        const n = parseNumericMigrationId(row.id);
        if (n == null) continue;
        highestId = highestId == null ? n : Math.max(highestId, n);
      }

      console.log(`[db:migrate:verbose] Applied migrations (DB ${MIGRATIONS_LEDGER}): ${applied.length}`);
      console.log(`[db:migrate:verbose] Highest applied id (numeric): ${highestId ?? 'unknown'}`);

      const forceDrizzleMigrate = (process.env.FORCE_DRIZZLE_MIGRATE || '').trim() === '1';

      if (applied.length > 0 && journalDriftDetected && forceDrizzleMigrate) {
        console.warn('[db:migrate:verbose] FORCE_DRIZZLE_MIGRATE=1 set; running migrate despite journal drift.');
      }

      if (applied.length > 0 && journalDriftDetected && !forceDrizzleMigrate) {
        console.warn('[db:migrate:verbose] Journal drift detected on a non-empty DB; skipping drizzle-kit migrate.');
        console.warn('[db:migrate:verbose] DB is source of truth in this repo due to manual_catchup migrations.');
        process.exit(0);
      }
    } catch (e: any) {
      console.warn(`[db:migrate:verbose] Failed to query ${MIGRATIONS_LEDGER}:`, e?.message || e);
      // Continue to attempt drizzle-kit migrate; it will surface its own errors.
    }

    process.exit(runDrizzleKitMigrate(repoRoot));
  })().catch((e) => {
    console.error('[db:migrate:verbose] Fatal:', e);
    process.exit(1);
  });
}

main();
