import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

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
    console.warn('[db:migrate:verbose] DATABASE_URL is not set. Drizzle-kit migrate will fail.');
  } else {
    console.log('[db:migrate:verbose] DATABASE_URL:', redactDatabaseUrl(process.env.DATABASE_URL));
  }

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

    console.log(`[db:migrate:verbose] Journal entries: ${(journal.entries || []).length}`);
    console.log(`[db:migrate:verbose] SQL files: ${sqlFiles.length}`);

    if (notInJournal.length) {
      console.log('[db:migrate:verbose] SQL files NOT in journal (will NOT be applied by drizzle-kit):');
      for (const tag of notInJournal) console.log(`  - ${tag}`);
    }
  } catch (e: any) {
    console.warn('[db:migrate:verbose] Failed to read/parse journal:', e?.message || e);
  }

  console.log('[db:migrate:verbose] Running: drizzle-kit migrate --config drizzle.config.ts');

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, ['drizzle-kit', 'migrate', '--config', 'drizzle.config.ts'], {
    stdio: 'inherit',
  });

  process.exit(result.status ?? 1);
}

main();
