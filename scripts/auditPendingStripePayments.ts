import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import Stripe from 'stripe';
import { classifyPendingStripePayment } from '../server/lib/stripePendingPaymentAudit';

// Intentionally no apply mode, processor mutation, or application DB import.
const args = process.argv.slice(2);
const orgIndex = args.indexOf('--organization-id');
const organizationId = orgIndex >= 0 ? args[orgIndex + 1] : '';
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 1000;
const namedInvoices = ['20052', '20079', '20070', '20478', '20331', '20466', '20398'];
if (args.includes('--apply')) throw new Error('Read-only audit: --apply is prohibited. Review and approve an exact repair plan separately.');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
  throw new Error('Usage: tsx scripts/auditPendingStripePayments.ts --organization-id UUID [--limit 1000] [--snapshot FILE]');
}

async function collectDatabaseEvidence() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the explicitly selected production connection; no default database is used.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'stripe-pending-readonly-audit' });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const count = Number((await client.query("SELECT count(*) AS count FROM payments WHERE organization_id=$1 AND provider='stripe' AND status='pending'", [organizationId])).rows[0].count);
    if (count > limit) throw new Error(`Audit bound exceeded: ${count} candidates > ${limit}. No partial repair plan produced.`);
    const pending = (await client.query(`SELECT p.*, i.invoice_number, i.display_number, i.organization_id AS invoice_org
      FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id
      WHERE p.organization_id=$1 AND p.provider='stripe' AND p.status='pending' ORDER BY p.created_at,p.id LIMIT $2`, [organizationId, limit])).rows;
    const accounts = (await client.query("SELECT external_account_id AS account FROM integration_connections WHERE organization_id=$1 AND provider='stripe'", [organizationId])).rows;
    const named = (await client.query('SELECT id,invoice_number,display_number FROM invoices WHERE organization_id=$1 AND invoice_number::text=ANY($2::text[])', [organizationId, namedInvoices])).rows;
    const rows = [];
    for (const payment of pending) {
      const attempts = (await client.query(`SELECT * FROM stripe_payment_attempts WHERE organization_id=$1 AND
        (stripe_payment_intent_id=$2 OR id=$3) LIMIT 3`, [organizationId, payment.stripe_payment_intent_id, payment.metadata?.stripePaymentAttemptId || null])).rows;
      const jobs = (await client.query(`SELECT id,status,direction,resource_type,payload_json,created_at,updated_at FROM accounting_sync_jobs
        WHERE organization_id=$1 AND (payload_json::text LIKE $2 OR payload_json::text LIKE $3) LIMIT $4`,
      [organizationId, `%${payment.id}%`, `%${payment.stripe_payment_intent_id || 'NO_INTENT'}%`, limit + 1])).rows;
      const refunds = (await client.query('SELECT id,status,stripe_refund_id FROM stripe_refund_requests WHERE organization_id=$1 AND payment_id=$2 LIMIT $3', [organizationId, payment.id, limit + 1])).rows;
      const events = (await client.query(`SELECT event_id,type,status,processed_at,error FROM payment_webhook_events
        WHERE organization_id=$1 AND payload::text LIKE $2 LIMIT $3`, [organizationId, `%${payment.stripe_payment_intent_id || 'NO_INTENT'}%`, limit + 1])).rows;
      const audit = (await client.query(`SELECT id,action_type,entity_type,entity_id,created_at FROM audit_logs WHERE organization_id=$1 AND
        (entity_id=$2 OR new_values::text LIKE $3 OR new_values::text LIKE $4 OR new_values::text LIKE $5) LIMIT $6`,
      [organizationId, payment.id, `%${payment.id}%`, `%${payment.stripe_payment_intent_id || 'NO_INTENT'}%`, `%${payment.metadata?.stripePaymentAttemptId || 'NO_ATTEMPT'}%`, limit + 1])).rows;
      const relatedEffects = (await client.query(`SELECT id,status,amount_cents,external_accounting_id,quickbooks_payment_reference,stripe_payment_intent_id,metadata
        FROM payments WHERE organization_id=$1 AND invoice_id=$2 AND id<>$3 LIMIT $4`, [organizationId, payment.invoice_id, payment.id, limit + 1])).rows;
      if ([jobs, refunds, events, audit, relatedEffects].some(a => a.length > limit)) throw new Error(`Evidence bound exceeded for ${payment.id}; no partial plan produced.`);
      rows.push({ payment, attempts, jobs, refunds, events, audit, relatedEffects });
    }
    const staleCount = Number((await client.query("SELECT count(*) AS count FROM stripe_payment_attempts WHERE organization_id=$1 AND status IN ('reserved','pending','failed') AND created_at < now()-interval '24 hours'", [organizationId])).rows[0].count);
    if (staleCount > limit) throw new Error(`Stale attempt bound exceeded: ${staleCount}`);
    const staleAttempts = (await client.query("SELECT id,invoice_id,status,amount_cents,stripe_account_id,stripe_payment_intent_id,created_at,updated_at FROM stripe_payment_attempts WHERE organization_id=$1 AND status IN ('reserved','pending','failed') AND created_at < now()-interval '24 hours' ORDER BY created_at LIMIT $2", [organizationId, limit])).rows;
    await client.query('COMMIT');
    return { organizationId, capturedAt: new Date().toISOString(), pendingCount: count, accounts, namedInvoices: named, rows, staleAttempts };
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}

async function main() {
  const snapshotIndex = args.indexOf('--snapshot');
  const snapshot = snapshotIndex >= 0 ? JSON.parse(readFileSync(args[snapshotIndex + 1], 'utf8')) : await collectDatabaseEvidence();
  if (snapshot.organizationId !== organizationId || snapshot.rows.length !== snapshot.pendingCount || snapshot.rows.length > limit) throw new Error('Snapshot tenant/count/bound mismatch');
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  const results = [];
  for (const row of snapshot.rows) {
    const p = row.payment;
    let lookup: 'found' | 'not_found' | 'unavailable' = 'unavailable';
    let truth: any = undefined;
    let lookupError: string | null = null;
    const account = p.metadata?.stripeAccountId;
    const accountVerified = snapshot.accounts.some((a: any) => a.account === account);
    if (stripe && accountVerified && p.stripe_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id, { stripeAccount: account });
        // Never emit client_secret or raw billing/payment method data.
        truth = { id: pi.id, status: pi.status, amount: pi.amount, amount_received: pi.amount_received, amount_capturable: pi.amount_capturable,
          currency: pi.currency, latest_charge: typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id || null,
          created: pi.created, metadata: { organizationId: pi.metadata.organizationId, invoiceId: pi.metadata.invoiceId, stripeAccountId: pi.metadata.stripeAccountId, stripePaymentAttemptId: pi.metadata.stripePaymentAttemptId } };
        lookup = 'found';
      } catch (error: any) { lookup = error.code === 'resource_missing' ? 'not_found' : 'unavailable'; lookupError = String(error.code || error.type || 'processor_read_failed'); }
    }
    const classification = classifyPendingStripePayment({ organizationId, payment: p, invoiceOrganizationId: p.invoice_org, accountVerified: accountVerified && row.attempts.length <= 1,
      attempt: row.attempts[0], hasAccountingEvidence: row.jobs.length > 0 || row.audit.some((a: any) => /sync|quickbooks|export/i.test(a.action_type)),
      hasRefundOrSuccessfulEvidence: row.refunds.length > 0 || row.events.some((e: any) => /succeeded|refund/.test(e.type)) ||
        row.relatedEffects.some((other: any) => other.stripe_payment_intent_id === p.stripe_payment_intent_id && ['succeeded','captured','refunded'].includes(other.status)),
      lookup, stripe: truth });
    results.push({ ...row, processor: { account, lookup, lookupError, truth }, ...classification });
  }
  console.log(JSON.stringify({ ...snapshot, rows: results, dryRun: true, productionMutations: 0,
    namedInvoiceSummary: namedInvoices.map(number => ({ number, matches: results.filter(r => String(r.payment.invoice_number) === number).map(r => r.payment.id) })),
    otherPendingCount: results.filter(r => !namedInvoices.includes(String(r.payment.invoice_number))).length,
    quickBooksLimit: 'Local export/reference/job evidence only; remote QuickBooks verification is separate.' }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Audit failed'); process.exitCode = 1; });
