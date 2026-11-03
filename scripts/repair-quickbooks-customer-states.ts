import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { repairQuickBooksCustomerStates, QuickBooksStateRepairError, customerStateRepairPlanSchema } from '../server/services/quickbooksCustomerStateRepair';

/** No default tenant, no normal sync and no provider writes. Preview is the default. */
export async function runCustomerStateRepair(args: string[]) {
  const allowed = new Set(['organization-id', 'actor-user-id', 'plan-file', 'plan-sha256', 'expected-fields', 'confirm-organization-id']);
  const values = new Map<string, string>();
  let apply = false;
  for (const arg of args) {
    if (arg === '--apply' && !apply) { apply = true; continue; }
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || values.has(match[1])) throw new Error('INVALID_ARGUMENTS');
    values.set(match[1], match[2]);
  }
  const organizationId = values.get('organization-id'), actorUserId = values.get('actor-user-id');
  const planPath = values.get('plan-file'), digest = values.get('plan-sha256'), count = values.get('expected-fields');
  if (!organizationId?.trim() || !actorUserId?.trim() || !planPath || !digest?.match(/^[a-f0-9]{64}$/) || !count?.match(/^\d+$/)) throw new Error('REVIEWED_PLAN_ARGUMENTS_REQUIRED');
  if (apply && values.get('confirm-organization-id') !== organizationId) throw new Error('APPLY_CONFIRMATION_REQUIRED');
  const contents = await readFile(planPath);
  if (createHash('sha256').update(contents).digest('hex') !== digest) throw new Error('REVIEWED_PLAN_FILE_CHANGED');
  const reviewedPlan: unknown = JSON.parse(contents.toString('utf8'));
  const plan = customerStateRepairPlanSchema.parse(reviewedPlan);
  if (plan.organizationId !== organizationId || plan.rows.filter(row => row.decision === 'proposed').length !== Number(count)) throw new Error('PLAN_SCOPE_OR_COUNT_MISMATCH');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  const { db, pool } = await import('../server/db');
  try {
    // Fresh, tenant-scoped provider GETs. The lock-held operation rechecks local
    // linkage, overrides, address identity, state blankness and reviewed evidence.
    const { fetchQBCustomersForMigrationSource } = await import('../server/quickbooksService');
    const source = await fetchQBCustomersForMigrationSource(organizationId);
    return await repairQuickBooksCustomerStates(db, { organizationId, actorUserId, reviewedPlan, source: source.customers, expectedFields: Number(count), apply });
  } finally { await pool.end(); }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/repair-quickbooks-customer-states.ts')) {
  runCustomerStateRepair(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    // Never print driver/provider errors or raw documents/credentials.
    console.error('QuickBooks customer state repair stopped.', error instanceof QuickBooksStateRepairError ? error.code : 'CHECK_ARGUMENTS_ACCESS_OR_CONNECTION');
    process.exitCode = 1;
  });
}
