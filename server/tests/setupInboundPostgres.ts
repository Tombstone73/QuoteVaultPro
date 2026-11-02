import { beforeAll } from '@jest/globals';
import { Pool } from 'pg';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireSafeTestDatabaseUrl } from './helpers/safeTestDatabase';

const url = requireSafeTestDatabaseUrl(process.env);
const target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/printershero_inbound_test') {
  throw new Error('Inbound PostgreSQL verification requires the dedicated loopback printershero_inbound_test database.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.MIGRATION_DATABASE_URL = url;
process.env.DIRECT_DATABASE_URL = url;
beforeAll(async () => {
  const directory = realpathSync('node_modules/.cache/inbound-pg-validation/data').replaceAll('\\', '/');
  const marker = JSON.parse(readFileSync('node_modules/.cache/inbound-pg-validation/owner.json', 'utf8'));
  if (marker.directory !== directory || marker.port !== Number(target.port) || marker.database !== target.pathname.slice(1)) {
    throw new Error('Isolated PostgreSQL ownership marker mismatch.');
  }
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(`select current_database() as db, host(inet_server_addr()) as address,
      current_setting('data_directory') as directory`);
    if (rows[0].db !== 'printershero_inbound_test' || rows[0].address !== '127.0.0.1' ||
        rows[0].directory.replaceAll('\\', '/') !== directory) {
      throw new Error('Isolated PostgreSQL identity verification failed.');
    }
  } finally { await pool.end(); }
  const { runMigrations } = await import('../runMigrations');
  await runMigrations();
  const verification = new Pool({ connectionString: url });
  try {
    const journal = JSON.parse(readFileSync('server/db/migrations_v2/meta/_journal.json', 'utf8'));
    const ledger = await verification.query('select hash, created_at from public.__drizzle_migrations_v2');
    for (const entry of journal.entries) {
      const hash = createHash('sha256').update(readFileSync(`server/db/migrations_v2/${entry.tag}.sql`)).digest('hex');
      if (!ledger.rows.some(row => row.hash === hash && Number(row.created_at) === entry.when)) {
        throw new Error(`Canonical migration not actually applied: ${entry.tag}`);
      }
    }
    console.log(`[Inbound PostgreSQL] Verified all ${journal.entries.length} canonical migration hashes/timestamps.`);
  } finally { await verification.end(); }
}, 120000);
