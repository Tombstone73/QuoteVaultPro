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
  } finally {
    await pool.end();
  }
});
