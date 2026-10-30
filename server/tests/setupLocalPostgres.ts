import { beforeAll } from '@jest/globals';
import { Pool } from 'pg';
import { requireSafeTestDatabaseUrl } from './helpers/safeTestDatabase';

const url = requireSafeTestDatabaseUrl(process.env);
const target = new URL(url);
if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost' && target.hostname !== '[::1]') {
  throw new Error('Local PostgreSQL tests require a loopback database.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.MIGRATION_DATABASE_URL = url;
process.env.DIRECT_DATABASE_URL = url;

beforeAll(async () => {
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(`
      SELECT current_database() AS database_name,
             host(inet_server_addr()) AS server_address,
             to_regclass('public.orders')::text AS orders_table,
             to_regclass('public.invoices')::text AS invoices_table
    `);
    if (rows[0]?.database_name !== target.pathname.slice(1) ||
        !['127.0.0.1', '::1'].includes(rows[0]?.server_address) ||
        rows[0]?.orders_table !== 'orders' || rows[0]?.invoices_table !== 'invoices') {
      throw new Error('Local PostgreSQL database identity or schema verification failed.');
    }
    // db:push omits this migration-only constraint, which canonical numbering
    // seeds require for their ON CONFLICT target (migration 0029).
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS global_variables_org_name_unique_idx ON public.global_variables (organization_id, name)');
    // Migration 0001 supplies this default; db:push models station IDs as caller-provided varchar.
    // Canonical fulfillment station upsert needs the real migration behavior.
    await pool.query("ALTER TABLE public.stations ALTER COLUMN id SET DEFAULT gen_random_uuid()::text");
    // Production ownership reads and upserts use these migration-only station
    // fields (migrations 0001 and 0002). The local schema projection models
    // station IDs as varchar, so keep the test column's type aligned with it.
    await pool.query('ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS station_id varchar');
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_org_line_item_station_unique
      ON public.production_jobs (organization_id, line_item_id, station_id) WHERE station_id IS NOT NULL`);
  } finally {
    await pool.end();
  }
});
