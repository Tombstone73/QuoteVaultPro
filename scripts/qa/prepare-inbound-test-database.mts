import { Pool } from 'pg';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid isolated PostgreSQL port');
const directory = realpathSync('node_modules/.cache/inbound-pg-validation/data').replaceAll('\\', '/');
const marker = JSON.parse(readFileSync('node_modules/.cache/inbound-pg-validation/owner.json', 'utf8'));
if (marker.port !== port || marker.directory !== directory || marker.database !== 'printershero_inbound_test') throw new Error('Cluster ownership marker mismatch');
const options = { host: '127.0.0.1', port, user: 'inbound_test_admin', application_name: 'inbound-isolated-bootstrap' };
const admin = new Pool({ ...options, database: 'postgres' });
try {
  const { rows } = await admin.query("select current_setting('data_directory') as directory, host(inet_server_addr()) as address, current_setting('server_version_num')::int as version");
  if (rows[0].directory.replaceAll('\\', '/') !== directory || rows[0].address !== '127.0.0.1' || rows[0].version < 160000) throw new Error('Isolated server identity mismatch');
  // This script creates a new DB only; an existing name fails closed.
  await admin.query('CREATE DATABASE printershero_inbound_test');
} finally { await admin.end(); }
const pool = new Pool({ ...options, database: 'printershero_inbound_test' });
try {
  const tables = await pool.query("select 1 from information_schema.tables where table_schema='public'");
  if (tables.rowCount) throw new Error('Refusing to bootstrap a nonempty database');
  await pool.query('begin');
  await pool.query(readFileSync(path.resolve('node_modules/.cache/inbound-pg-validation/bootstrap.sql'), 'utf8'));
  await pool.query('commit');
} catch (error) { await pool.query('rollback'); throw error; }
finally { await pool.end(); }
console.log('Verified repository-owned loopback PostgreSQL and prepared a synthetic foundation; canonical migrations still required.');
