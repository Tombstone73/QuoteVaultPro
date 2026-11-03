import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairQuickBooksCustomerStates } from '../services/quickbooksCustomerStateRepair';
import { runCustomerStateRepair } from '../../scripts/repair-quickbooks-customer-states';

const database = { transaction: () => { throw new Error('A rejected plan must never open a database transaction'); } } as Parameters<typeof repairQuickBooksCustomerStates>[0];
const proposal = { customerId: 'customer-a', quickBooksCustomerId: 'qb-a', side: 'billing', field: 'billingState', decision: 'proposed', proposedValue: 'IN', evidenceHash: 'a'.repeat(64) };
const plan = { version: 2, mode: 'DRY_RUN_READ_ONLY', organizationId: 'org-a', sourceRead: true, rows: [proposal] };
const input = { organizationId: 'org-a', actorUserId: 'actor-a', reviewedPlan: plan, source: [], expectedFields: 1 };

test('repair requires a source-backed versioned review plan and exact tenant/count', async () => {
  for (const reviewedPlan of [{ ...plan, sourceRead: false }, { ...plan, version: 1 }, {}]) {
    await expect(repairQuickBooksCustomerStates(database, { ...input, reviewedPlan })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_INVALID_PLAN' });
  }
  await expect(repairQuickBooksCustomerStates(database, { ...input, organizationId: 'other' })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_TENANT_MISMATCH' });
  await expect(repairQuickBooksCustomerStates(database, { ...input, expectedFields: 0 })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_COUNT_MISMATCH' });
});
test('duplicate fields and side/field mismatches cannot become writes', async () => {
  await expect(repairQuickBooksCustomerStates(database, { ...input, expectedFields: 2, reviewedPlan: { ...plan, rows: [proposal, proposal] } })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_DUPLICATE_PROPOSAL' });
  await expect(repairQuickBooksCustomerStates(database, { ...input, reviewedPlan: { ...plan, rows: [{ ...proposal, field: 'shippingState' }] } })).rejects.toMatchObject({ code: 'QB_STATE_REPAIR_INVALID_PROPOSAL' });
});
test('CLI fails closed before connection without reviewed hash/count, on unknown flags or missing explicit apply confirmation', async () => {
  await expect(runCustomerStateRepair(['--apply'])).rejects.toThrow('REVIEWED_PLAN_ARGUMENTS_REQUIRED');
  await expect(runCustomerStateRepair(['--organization-id=org-a', '--force'])).rejects.toThrow('INVALID_ARGUMENTS');
  await expect(runCustomerStateRepair(['--organization-id=org-a', '--organization-id=other'])).rejects.toThrow('INVALID_ARGUMENTS');
  await expect(runCustomerStateRepair(['--organization-id=org-a', '--actor-user-id=actor-a', '--plan-file=unused.json', `--plan-sha256=${'a'.repeat(64)}`, '--expected-fields=1', '--apply'])).rejects.toThrow('APPLY_CONFIRMATION_REQUIRED');
});

test('CLI rejects changed review files and mismatched tenant plans before database/provider access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qb-state-plan-test-'));
  const file = join(directory, 'plan.json');
  const contents = JSON.stringify(plan);
  await writeFile(file, contents);
  const args = ['--organization-id=org-a', '--actor-user-id=actor-a', `--plan-file=${file}`, '--expected-fields=1'];
  try {
    await expect(runCustomerStateRepair([...args, `--plan-sha256=${'0'.repeat(64)}`])).rejects.toThrow('REVIEWED_PLAN_FILE_CHANGED');
    const digest = createHash('sha256').update(contents).digest('hex');
    await expect(runCustomerStateRepair(args.map(arg => arg === '--organization-id=org-a' ? '--organization-id=other' : arg).concat(`--plan-sha256=${digest}`))).rejects.toThrow('PLAN_SCOPE_OR_COUNT_MISMATCH');
  } finally { await unlink(file); await rmdir(directory); }
});
