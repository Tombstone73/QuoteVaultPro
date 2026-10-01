import type { Pool, PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { paymentWorkspacePagination, type PaymentWorkspaceAllocation, type PaymentWorkspaceFact, type PaymentWorkspaceInvoicePage, type PaymentWorkspaceInvoiceQuery, type PaymentWorkspacePage, type PaymentWorkspaceQuery, type PaymentWorkspaceReadPort, type PaymentWorkspaceReadRunner, type PaymentWorkspaceSummary, type PaymentWorkspaceSummaryRead } from "../../src/modules/billing/paymentWorkspace.js";
import type { ReportingWindow, ReportingWindowRequest } from "../../src/modules/shared/reportingWindow.js";
import { readReportingWindow } from "../organization/postgresReportingClock.js";

const exactCents = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new V2ApplicationError("CONFLICT", "Payment reporting exceeds the exact cent range.");
  return parsed;
};
type FactRow = Readonly<{
  id: string; amount_cents: string; applied_cents: string; refunded_cents: string; currency: string;
  method: PaymentWorkspaceFact["method"]; source: PaymentWorkspaceFact["source"]; occurred_at: Date; recorded_at: Date;
  principal_kind: PaymentWorkspaceFact["actor"]["kind"] | null; principal_subject: string | null; staff_actor_user_id: string | null;
  allocations: readonly Readonly<{ allocationId: string; invoiceId: string; invoiceNumber: string | null; orderId: string | null; orderNumber: string | null; customerId: string | null; customerName: string | null; amountCents: string; refundedCents: string }>[];
}>;

// One row per immutable Payment BEFORE presentation joins. EXISTS filters a
// Customer cohort without multiplying facts; amounts are never DISTINCT sums.
const paymentFacts = `WITH base AS (
  SELECT p.* FROM v2_billing_payments p
  WHERE p.organization_id=$1 AND p.occurred_at >= $2::timestamptz AND p.occurred_at < $3::timestamptz
    AND p.recorded_at <= $4::timestamptz AND ($5::text IS NULL OR p.method=$5)
    AND ($6::text IS NULL OR EXISTS (
      SELECT 1 FROM v2_billing_payment_allocations a
      JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
      WHERE a.organization_id=p.organization_id AND a.payment_id=p.id AND i.customer_id=$6
    ))
), applied AS (
  SELECT a.payment_id,sum(a.amount_cents) applied_cents FROM v2_billing_payment_allocations a
  JOIN base p ON p.organization_id=a.organization_id AND p.id=a.payment_id
  WHERE a.organization_id=$1 GROUP BY a.payment_id
), refunded AS (
  SELECT a.payment_id,sum(a.amount_cents) refunded_cents FROM v2_billing_refund_allocations a
  JOIN base p ON p.organization_id=a.organization_id AND p.id=a.payment_id
  JOIN v2_billing_refunds r ON r.organization_id=a.organization_id AND r.id=a.refund_id
  WHERE a.organization_id=$1 AND r.recorded_at <= $4::timestamptz GROUP BY a.payment_id
), facts AS (
  SELECT p.*,COALESCE(a.applied_cents,0) applied_cents,COALESCE(r.refunded_cents,0) refunded_cents
  FROM base p LEFT JOIN applied a ON a.payment_id=p.id LEFT JOIN refunded r ON r.payment_id=p.id
)`;
const values = (organizationId: string, query: PaymentWorkspaceQuery, window: ReportingWindow) => [organizationId, window.startInclusive, window.endExclusive, window.asOf, query.method ?? null, query.customerId ?? null];

/** Read-only V2 Payment facts. No legacy Payment interpretation or Invoice-state inference. */
export class PostgresPaymentWorkspace implements PaymentWorkspaceReadPort {
  constructor(private readonly client: Pick<PoolClient, "query">) {}
  readWindow(organizationId: string, request: ReportingWindowRequest, asOf: Date) { return readReportingWindow(this.client, organizationId, { ...request, asOf }); }

  async summarizePayments(organizationId: string, query: PaymentWorkspaceQuery, window: ReportingWindow): Promise<PaymentWorkspaceSummaryRead> {
    const rows = await this.client.query<{ currency: string; count: string; amount: string; applied: string; refunded: string; net: string }>(`${paymentFacts}
      SELECT currency,count(*)::text count,sum(amount_cents)::text amount,sum(applied_cents)::text applied,
        sum(refunded_cents)::text refunded,sum(amount_cents-refunded_cents)::text net
      FROM facts GROUP BY currency ORDER BY currency`, values(organizationId, query, window));
    const byCurrency: PaymentWorkspaceSummary["byCurrency"] = rows.rows.map((row) => ({ currency: row.currency, paymentCount: exactCents(row.count), amountCents: exactCents(row.amount), appliedCents: exactCents(row.applied), refundedCents: exactCents(row.refunded), netCents: exactCents(row.net) }));
    return { scope: "v2_payment_facts", window, summary: { paymentCount: byCurrency.reduce((sum, entry) => sum + entry.paymentCount, 0), byCurrency } };
  }

  async pagePayments(organizationId: string, query: PaymentWorkspaceQuery, window: ReportingWindow): Promise<PaymentWorkspacePage> {
    const { page, pageSize } = paymentWorkspacePagination(query), offset = (page - 1) * pageSize;
    const summary = await this.summarizePayments(organizationId, query, window);
    const rows = await this.client.query<FactRow>(`${paymentFacts}, selected AS (
      SELECT * FROM facts ORDER BY occurred_at DESC,recorded_at DESC,id ASC LIMIT $7 OFFSET $8
    ) SELECT p.id,p.amount_cents::text,p.applied_cents::text,p.refunded_cents::text,p.currency,p.method,p.source,
      p.occurred_at,p.recorded_at,p.principal_kind,p.principal_subject,p.staff_actor_user_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'allocationId',a.id,'invoiceId',a.invoice_id,'invoiceNumber',i.invoice_display_number,
        'orderId',i.sales_order_document_id,'orderNumber',d.display_number,'customerId',i.customer_id,
        'customerName',COALESCE(c.display_name,c.company_name),'amountCents',a.amount_cents::text,
        'refundedCents',COALESCE((SELECT sum(e.amount_cents) FROM v2_billing_refund_allocation_evidence e
          JOIN v2_billing_refunds r ON r.organization_id=e.organization_id AND r.id=e.refund_id
          WHERE e.organization_id=a.organization_id AND e.payment_allocation_id=a.id AND r.recorded_at <= $4::timestamptz),0)::text
      ) ORDER BY a.invoice_id,a.id) FROM v2_billing_payment_allocations a
        LEFT JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
        LEFT JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
        LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
        WHERE a.organization_id=p.organization_id AND a.payment_id=p.id),'[]'::jsonb) allocations
      FROM selected p ORDER BY p.occurred_at DESC,p.recorded_at DESC,p.id ASC`, [...values(organizationId, query, window), pageSize, offset]);
    const items = rows.rows.map((row): PaymentWorkspaceFact => {
      const amount = (cents: string | number) => ({ currency: row.currency, cents: exactCents(cents) });
      const refunded = exactCents(row.refunded_cents), gross = exactCents(row.amount_cents);
      const allocations = row.allocations.map((entry): PaymentWorkspaceAllocation => ({ allocationId: entry.allocationId, invoiceId: entry.invoiceId,
        ...(entry.invoiceNumber ? { invoiceNumber: entry.invoiceNumber } : {}), ...(entry.orderId ? { orderId: entry.orderId } : {}), ...(entry.orderNumber ? { orderNumber: entry.orderNumber } : {}),
        ...(entry.customerId ? { customerId: entry.customerId } : {}), ...(entry.customerName ? { customerName: entry.customerName } : {}), amount: amount(entry.amountCents), refundedAmount: amount(entry.refundedCents) }));
      return { paymentId: row.id, amount: amount(gross), appliedAmount: amount(row.applied_cents), refundedAmount: amount(refunded), netAmount: amount(gross - refunded), method: row.method, source: row.source,
        occurredAt: row.occurred_at.toISOString(), recordedAt: row.recorded_at.toISOString(), actor: { kind: row.principal_kind ?? "unknown", ...(row.principal_subject ? { subjectId: row.principal_subject } : {}), ...(row.staff_actor_user_id ? { staffActorUserId: row.staff_actor_user_id } : {}) },
        refundState: refunded === 0 ? "not_refunded" : refunded >= gross ? "fully_refunded" : "partially_refunded", allocations };
    });
    return { ...summary, items, page, pageSize, totalMatching: summary.summary.paymentCount, hasNextPage: offset + items.length < summary.summary.paymentCount };
  }

  async listCustomers(organizationId: string, search: string) {
    const rows = await this.client.query<{ id: string; name: string }>(`SELECT id,COALESCE(display_name,company_name,'Customer unavailable') name
      FROM customers WHERE organization_id=$1 AND ($2::text='' OR COALESCE(display_name,company_name,'') ILIKE '%'||$2||'%' ESCAPE '\\')
      ORDER BY COALESCE(display_name,company_name,''),id LIMIT 50`, [organizationId, search.replace(/[\\%_]/g, "\\$&")]);
    return rows.rows.map((row) => ({ customerId: row.id, customerName: row.name }));
  }

  async pageCollectibleInvoices(organizationId: string, query: PaymentWorkspaceInvoiceQuery): Promise<PaymentWorkspaceInvoicePage> {
    const { page, pageSize } = paymentWorkspacePagination(query);
    const rows = await this.client.query<{ id: string; invoice_display_number: string | null; order_id: string; order_number: string; customer_id: string; customer_name: string; currency: string; balance: string }>(`
      WITH balances AS (
        SELECT i.id,i.invoice_display_number,i.sales_order_document_id,i.customer_id,i.currency,
          i.total_cents-COALESCE((SELECT sum(a.amount_cents) FROM v2_billing_payment_allocations a WHERE a.organization_id=i.organization_id AND a.invoice_id=i.id),0)
            +COALESCE((SELECT sum(e.amount_cents) FROM v2_billing_refund_allocation_evidence e WHERE e.organization_id=i.organization_id AND e.invoice_id=i.id),0) balance
        FROM v2_billing_invoices i WHERE i.organization_id=$1 AND i.customer_id=$2 AND i.invoice_state<>'void'
      ) SELECT b.id,b.invoice_display_number,b.sales_order_document_id order_id,d.display_number order_number,b.customer_id,
        COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,b.currency,b.balance::text
      FROM balances b JOIN v2_sales_documents d ON d.organization_id=$1 AND d.id=b.sales_order_document_id
      LEFT JOIN customers c ON c.organization_id=$1 AND c.id=b.customer_id WHERE b.balance>0
      ORDER BY d.display_number,b.id LIMIT $3 OFFSET $4`, [organizationId, query.customerId, pageSize + 1, (page - 1) * pageSize]);
    return { page, pageSize, hasNextPage: rows.rows.length > pageSize, items: rows.rows.slice(0, pageSize).map((row) => ({ invoiceId: row.id, ...(row.invoice_display_number ? { invoiceNumber: row.invoice_display_number } : {}), orderId: row.order_id, orderNumber: row.order_number, customerId: row.customer_id, customerName: row.customer_name, collectibleBalance: { currency: row.currency, cents: exactCents(row.balance) } })) };
  }
}

/** Window, fact page and summary use one read-only PostgreSQL snapshot. */
export class PostgresPaymentWorkspaceReadRunner implements PaymentWorkspaceReadRunner {
  constructor(private readonly pool: Pool) {}
  async read<T>(action: (port: PaymentWorkspaceReadPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const value = await action(new PostgresPaymentWorkspace(client));
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
