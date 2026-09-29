import pg from 'pg';
import { planInvoiceOwnershipReconciliation, type InvoiceOwnershipEvidence } from '../server/services/invoiceOwnershipReconciliation';

// Read-only by construction, including when pointed at MAIN. No --apply option.
async function main() {
  const [organizationId, invoiceId, actor, reason, ...extra] = process.argv.slice(2);
  if (!organizationId || !invoiceId || !actor || !reason || extra.length || !process.env.DATABASE_URL) {
    throw new Error('Usage: audit-invoice-ownership <organization-id> <invoice-id> <actor> <reason>; DATABASE_URL required. Apply is not supported.');
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const target = await client.query(`SELECT to_jsonb(i) AS invoice,
      CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'organization_id',o.organization_id,'customer_id',o.customer_id,'contact_id',o.contact_id) END AS "order"
      FROM invoices i LEFT JOIN orders o ON o.id=i.order_id AND o.organization_id=i.organization_id
      WHERE i.organization_id=$1 AND i.id=$2`, [organizationId, invoiceId]);
    if (target.rows.length !== 1) throw new Error('Invoice unavailable in this organization.');
    const batches = await client.query(`SELECT DISTINCT b.* FROM customer_payment_batches b
      JOIN payments p ON p.customer_payment_batch_id=b.id AND p.organization_id=b.organization_id
      WHERE p.organization_id=$1 AND p.invoice_id=$2`, [organizationId, invoiceId]);
    if (batches.rows.length !== 1) throw new Error('Exactly one payment batch is required for this guarded proposal.');
    const batch = batches.rows[0];
    const allocations = await client.query(`SELECT to_jsonb(p) AS payment,to_jsonb(i) AS invoice,
      CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'organization_id',o.organization_id,'customer_id',o.customer_id,'contact_id',o.contact_id) END AS "order"
      FROM payments p JOIN invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id
      LEFT JOIN orders o ON o.id=i.order_id AND o.organization_id=i.organization_id
      WHERE p.organization_id=$1 AND p.customer_payment_batch_id=$2`, [organizationId, batch.id]);
    const ownerAudit = await client.query(`SELECT id,created_at,entity_id,old_values,new_values FROM audit_logs
      WHERE organization_id=$1 AND entity_type='order' AND entity_id=$2 ORDER BY created_at`, [organizationId, target.rows[0].invoice.order_id]);
    const evidence = { organizationId, invoiceId, actor, reason, ...target.rows[0], batch,
      allocations: allocations.rows, ownerAudit: ownerAudit.rows } as InvoiceOwnershipEvidence;
    console.log(JSON.stringify(planInvoiceOwnershipReconciliation(evidence), null, 2));
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Ownership audit failed.'); process.exitCode = 1; });
