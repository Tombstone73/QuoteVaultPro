import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../shared/schema';
import { applyHistoricalCloseJobOperationalRepair, listHistoricalCloseJobOperationalRepairs } from '../server/services/historicalCloseJobOperationalRepairService';

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  const orderId = process.env.ORDER_ID?.trim();
  const apply = process.argv.includes('--apply');
  if (!organizationId || !process.env.DATABASE_URL) throw new Error('ORGANIZATION_ID and DATABASE_URL are required.');
  if (apply && !orderId) throw new Error('--apply requires one reviewed ORDER_ID (UUID); bulk mutation is not supported.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const database = drizzle({ client: pool, schema });
  try {
    const result = apply
      ? await applyHistoricalCloseJobOperationalRepair(database, { organizationId, orderId: orderId! })
      : await database.transaction(tx => listHistoricalCloseJobOperationalRepairs(tx, organizationId, orderId), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', result }, null, 2));
  } finally {
    await pool.end();
  }
}
main().catch(error => { console.error('[close-job-operational-repair]', error.message); process.exitCode = 1; });
