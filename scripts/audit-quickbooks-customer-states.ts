import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { assessQuickBooksCustomerStates } from '../server/lib/quickbooksCustomerStateAssessment';

async function main() {
  const args = process.argv.slice(2);
  const organizationIds = args.filter(value => value.startsWith('--organization-id='));
  if (organizationIds.length !== 1 || !organizationIds[0].slice('--organization-id='.length).trim() ||
      args.some(value => !value.startsWith('--organization-id=') && value !== '--read-quickbooks')) {
    throw new Error('ARGUMENTS');
  }
  const organizationId = organizationIds[0].slice('--organization-id='.length).trim();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  const { db, pool } = await import('../server/db');
  try {
    const { customers, organizations } = await import('../shared/schema');
    // Customer reads are a consistent, enforced read-only snapshot. Never select contacts,
    // names, emails, tokens or financial data for this report.
    const local = await db.transaction(async tx => {
      const target = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId));
      if (target.length !== 1) throw new Error('ORGANIZATION_NOT_FOUND');
      return tx.select({
        id: customers.id, organizationId: customers.organizationId, externalAccountingId: customers.externalAccountingId,
        status: customers.status, mergedIntoCustomerId: customers.mergedIntoCustomerId, qbFieldOverrides: customers.qbFieldOverrides,
        billingAddress: customers.billingAddress, billingStreet1: customers.billingStreet1, billingStreet2: customers.billingStreet2,
        billingCity: customers.billingCity, billingState: customers.billingState, billingPostalCode: customers.billingPostalCode, billingCountry: customers.billingCountry,
        shippingAddress: customers.shippingAddress, shippingStreet1: customers.shippingStreet1, shippingStreet2: customers.shippingStreet2,
        shippingCity: customers.shippingCity, shippingState: customers.shippingState, shippingPostalCode: customers.shippingPostalCode, shippingCountry: customers.shippingCountry,
      }).from(customers).where(and(eq(customers.organizationId, organizationId), sql`nullif(trim(${customers.externalAccountingId}), '') is not null`));
    }, { accessMode: 'read only', isolationLevel: 'repeatable read' });
    // Existing organization-scoped provider GET path. OAuth refresh/health bookkeeping
    // may update connection metadata; no customer sync or provider writes are invoked.
    const source = args.includes('--read-quickbooks')
      ? (await (await import('../server/quickbooksService')).fetchQBCustomersForMigrationSource(organizationId)).customers
      : null;
    console.log(JSON.stringify(assessQuickBooksCustomerStates(organizationId, local, source), null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // Driver/provider errors can include credentials, addresses or response bodies.
  console.error('QuickBooks state dry-run failed. Requires --organization-id=<id>, configured DATABASE_URL, and (with --read-quickbooks) an authorized tenant connection. No repair applied.');
  process.exitCode = 1;
});
