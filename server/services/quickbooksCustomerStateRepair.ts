import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { db } from '../db';
import { auditLogs, customers, userOrganizations } from '../../shared/schema';
import { assessQuickBooksCustomerStates, type StateAssessmentSourceCustomer } from '../lib/quickbooksCustomerStateAssessment';

export const customerStateRepairPlanSchema = z.object({
  version: z.literal(2), mode: z.literal('DRY_RUN_READ_ONLY'), organizationId: z.string().min(1), sourceRead: z.literal(true),
  rows: z.array(z.object({
    customerId: z.string().min(1), quickBooksCustomerId: z.string().nullable(),
    side: z.enum(['billing', 'shipping']), field: z.enum(['billingState', 'shippingState']), decision: z.string(),
    proposedValue: z.string().min(1).max(100).optional(), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })).max(10000),
});

/** Minimal address projection shared with the read-only audit. No contact or financial data. */
export const customerStateAssessmentColumns = {
  id: customers.id, organizationId: customers.organizationId, externalAccountingId: customers.externalAccountingId,
  status: customers.status, isActive: customers.isActive, mergedIntoCustomerId: customers.mergedIntoCustomerId, qbFieldOverrides: customers.qbFieldOverrides,
  billingAddress: customers.billingAddress, billingStreet1: customers.billingStreet1, billingStreet2: customers.billingStreet2,
  billingCity: customers.billingCity, billingState: customers.billingState, billingPostalCode: customers.billingPostalCode, billingCountry: customers.billingCountry,
  shippingAddress: customers.shippingAddress, shippingStreet1: customers.shippingStreet1, shippingStreet2: customers.shippingStreet2,
  shippingCity: customers.shippingCity, shippingState: customers.shippingState, shippingPostalCode: customers.shippingPostalCode, shippingCountry: customers.shippingCountry,
};

export class QuickBooksStateRepairError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'QuickBooksStateRepairError'; }
}
function fail(code: string): never { throw new QuickBooksStateRepairError(`QB_STATE_REPAIR_${code}`); }

/** Explicitly invoked maintenance operation. Never called by normal import or HTTP routes.
 * Provider GETs must finish before entering this transaction. All selected fields succeed
 * together, or all writes/audit entries roll back. Preview is enforced read-only.
 */
export async function repairQuickBooksCustomerStates(database: Pick<typeof db, 'transaction'>, input: {
  organizationId: string; actorUserId: string; reviewedPlan: unknown; source: StateAssessmentSourceCustomer[];
  expectedFields: number; apply?: boolean;
}) {
  const parsed = customerStateRepairPlanSchema.safeParse(input.reviewedPlan);
  if (!parsed.success) fail('INVALID_PLAN');
  const plan = parsed.data!;
  if (!input.organizationId.trim() || plan.organizationId !== input.organizationId) fail('TENANT_MISMATCH');
  const proposals = plan.rows.filter(row => row.decision === 'proposed');
  if (!Number.isInteger(input.expectedFields) || input.expectedFields !== proposals.length || proposals.length > 2000) fail('COUNT_MISMATCH');
  if (new Set(proposals.map(row => `${row.customerId}:${row.field}`)).size !== proposals.length) fail('DUPLICATE_PROPOSAL');
  for (const proposal of proposals) {
    if (!proposal.quickBooksCustomerId || !proposal.evidenceHash || !proposal.proposedValue?.trim() ||
      proposal.proposedValue !== proposal.proposedValue.trim() || proposal.field !== `${proposal.side}State`) fail('INVALID_PROPOSAL');
  }
  const sourceIds = Array.from(new Set(proposals.map(row => row.quickBooksCustomerId!))).sort();
  const ids = Array.from(new Set(proposals.map(row => row.customerId))).sort();
  const apply = input.apply === true;
  return database.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '30s'`);
    await tx.execute(sql`set local idle_in_transaction_session_timeout = '30s'`);
    const deadline = Date.now() + 60000;
    const [membership] = await tx.select({ role: userOrganizations.role }).from(userOrganizations)
      .where(and(eq(userOrganizations.organizationId, input.organizationId), eq(userOrganizations.userId, input.actorUserId)));
    if (!membership || !['owner', 'admin'].includes(membership.role)) fail('ACTOR_FORBIDDEN');
    if (!proposals.length) return { mode: apply ? 'APPLY' : 'DRY_RUN_READ_ONLY', organizationId: input.organizationId, updatedFields: 0, eligibleFields: 0, alreadyPresentFields: 0, readback: [] };
    if (apply) for (const id of sourceIds) {
      if (Date.now() > deadline) fail('TIME_LIMIT');
      // Same source lock as processPullCustomers; never start a normal sync to repair states.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.organizationId}:qb-customer:${id}`}))`);
    }
    const query = tx.select(customerStateAssessmentColumns).from(customers).where(and(
      eq(customers.organizationId, input.organizationId),
      or(inArray(customers.id, ids), inArray(customers.externalAccountingId, sourceIds)),
    )).orderBy(customers.id);
    const current = apply ? await query.for('update') : await query;
    const fresh = assessQuickBooksCustomerStates(input.organizationId, current, input.source);
    const readback: Array<{ customerId: string; field: 'billingState' | 'shippingState'; value: string }> = [];
    let eligibleFields = 0, alreadyPresentFields = 0;
    for (const proposal of proposals) {
      if (Date.now() > deadline) fail('TIME_LIMIT');
      const row = current.find(customer => customer.id === proposal.customerId);
      if (!row || row.externalAccountingId !== proposal.quickBooksCustomerId) fail('LINKAGE_CHANGED');
      if (row.mergedIntoCustomerId || row.isActive === false || (row.status && row.status !== 'active')) fail('CUSTOMER_INACTIVE');
      const existing = row[proposal.field];
      if (existing?.trim()) {
        if (existing !== proposal.proposedValue) fail('STATE_ALREADY_SET');
        alreadyPresentFields++;
        readback.push({ customerId: row.id, field: proposal.field, value: existing });
        continue;
      }
      const candidate = fresh.rows.find(candidate => candidate.customerId === row.id && candidate.field === proposal.field);
      if (candidate?.decision !== 'proposed' || candidate.evidenceHash !== proposal.evidenceHash || candidate.proposedValue !== proposal.proposedValue) fail('STALE_PLAN');
      eligibleFields++;
      if (!apply) continue;
      const [saved] = await tx.update(customers).set({ [proposal.field]: proposal.proposedValue!, updatedAt: new Date() }).where(and(
        eq(customers.organizationId, input.organizationId), eq(customers.id, row.id),
        eq(customers.externalAccountingId, proposal.quickBooksCustomerId!), sql`nullif(trim(${customers[proposal.field]}), '') is null`,
      )).returning({ id: customers.id, value: customers[proposal.field] });
      if (!saved || typeof saved.value !== 'string' || saved.value !== proposal.proposedValue) fail('WRITE_CONFLICT');
      readback.push({ customerId: saved.id, field: proposal.field, value: saved.value });
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId, userId: input.actorUserId, actionType: 'UPDATE', entityType: 'customer', entityId: row.id,
        description: 'Recovered missing customer state from a verified QuickBooks address',
        oldValues: { [proposal.field]: existing ?? null },
        newValues: { [proposal.field]: saved.value, quickBooksCustomerId: proposal.quickBooksCustomerId, sourceEvidenceHash: proposal.evidenceHash },
      });
    }
    return { mode: apply ? 'APPLY' : 'DRY_RUN_READ_ONLY', organizationId: input.organizationId, updatedFields: apply ? eligibleFields : 0, eligibleFields, alreadyPresentFields, readback };
  }, { isolationLevel: 'repeatable read', accessMode: apply ? 'read write' : 'read only' });
}
