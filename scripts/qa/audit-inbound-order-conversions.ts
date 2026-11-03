// Explicit tenant + request scope; no mutations and no automatic .env loading.
// npx tsx scripts/qa/audit-inbound-order-conversions.ts --organization-id ORG --inbound-id ID [--inbound-id ID]
import { sql } from 'drizzle-orm';
import { db, pool } from '../../server/db';
import { auditInboundOrderConversions } from '../../server/services/inboundOrders/inboundOrderConversionAudit';

try {
  const args = process.argv.slice(2); let organizationId = ''; const recordIds: string[] = [];
  while (args.length) {
    const key = args.shift(); const value = args.shift();
    if (!value || !['--organization-id', '--inbound-id'].includes(key ?? '')) throw new Error('Use --organization-id ORG and --inbound-id ID (up to 50).');
    if (key === '--organization-id') organizationId = value; else recordIds.push(value);
  }
  if (!organizationId || !recordIds.length || recordIds.length > 50) throw new Error('Explicit organization and 1–50 inbound IDs required.');
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
    return auditInboundOrderConversions(tx, organizationId, [...new Set(recordIds)]);
  });
  console.log(JSON.stringify({ readOnly: true, organizationId, requested: recordIds.length, found: result.length, records: result }, null, 2));
} catch {
  console.error('Read-only diagnostic failed. Check explicit tenant/request arguments and configured database access. No Orders were changed.');
  process.exitCode = 1;
} finally { await pool.end(); }
