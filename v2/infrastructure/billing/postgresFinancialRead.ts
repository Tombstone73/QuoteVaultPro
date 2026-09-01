import type { Pool, PoolClient } from "pg";
import {
  brandedId,
  currencyCode,
  money,
  type InvoiceId,
  type CustomerId,
  type OrderId,
  type OrganizationId,
} from "../../src/modules/shared/commercialValues.js";
import type {
  DraftInvoiceReadModel,
  PaymentMethod,
} from "../../src/modules/billing/contracts.js";
import type {
  FinancialHistoryEntry,
  FinancialInvoiceListItem,
  FinancialInvoiceRead,
  FinancialLedgerEntry,
  FinancialReadPort,
  FinancialReadRunner,
} from "../../src/modules/billing/financialReadApplication.js";
import { PostgresBillingDraftInvoiceTransaction } from "./postgresBillingDraftInvoiceTransaction.js";

type FactRow = {
  kind: "payment" | "refund";
  id: string;
  payment_id: string | null;
  amount_cents: string;
  currency: string;
  method: string | null;
  source: "manual" | "provider";
  occurred_at: Date;
  recorded_at: Date;
  invoice_id: string;
  source_order_id?: string;
  source_order_number?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  gross_cents?: string;
};
const cents = (value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("Financial money is outside the safe cent range.");
  return parsed;
};
const history = (rows: readonly FactRow[], grossCents: number) => {
  let balance = grossCents;
  return rows.map((row) => {
    const amount = cents(row.amount_cents);
    balance += row.kind === "payment" ? -amount : amount;
    return {
      kind: row.kind,
      id: brandedId<"PaymentId" | "RefundId">(row.id),
      ...(row.payment_id
        ? { paymentId: brandedId<"PaymentId">(row.payment_id) }
        : {}),
      amount: money(currencyCode(row.currency), amount),
      ...(row.method ? { method: row.method as PaymentMethod } : {}),
      source: row.source,
      occurredAt: row.occurred_at.toISOString(),
      recordedAt: row.recorded_at.toISOString(),
      balanceAfter: money(currencyCode(row.currency), balance),
    } as FinancialHistoryEntry;
  });
};

const settlementStatus = (
  lifecycle: "draft" | "issued" | "void",
  gross: number,
  paid: number,
  refunded: number,
): FinancialInvoiceListItem["settlement"] => {
  if (lifecycle === "void") return undefined;
  const balance = gross - paid + refunded;
  if (balance < 0) return "credit_due";
  if (balance === 0) return "paid";
  return paid === 0 && refunded === 0 ? "unpaid" : "partially_paid";
};

export class PostgresFinancialRead implements FinancialReadPort {
  constructor(private readonly client: PoolClient) {}
  async readFinancialInvoice(
    organizationId: OrganizationId,
    invoiceId: InvoiceId,
  ): Promise<FinancialInvoiceRead | null> {
    const invoice = await new PostgresBillingDraftInvoiceTransaction(
      this.client,
    ).readInvoice(organizationId, invoiceId);
    if (!invoice) return null;
    const facts = await this.facts(organizationId, invoiceId);
    const rows = history(facts, invoice.total.cents);
    const paid = facts
      .filter((row) => row.kind === "payment")
      .reduce((total, row) => total + cents(row.amount_cents), 0);
    const refunded = facts
      .filter((row) => row.kind === "refund")
      .reduce((total, row) => total + cents(row.amount_cents), 0);
    return {
      invoice,
      settlement: {
        gross: invoice.total,
        paid: money(invoice.currency, paid),
        refunded: money(invoice.currency, refunded),
        balance: money(invoice.currency, invoice.total.cents - paid + refunded),
      },
      history: rows,
    };
  }
  async readLegacyFinancialInvoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<FinancialInvoiceRead | null> {
    const result = await this.client.query<{ id:string; order_id:string|null; customer_id:string|null; customer_name:string|null; status:string; currency:string; total_cents:string; subtotal_cents:string; tax_cents:string; amount_paid_cents:string; balance_due_cents:string; issued_at:Date|null; created_at:Date; updated_at:Date }>(`SELECT i.id,i.order_id,i.customer_id,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,i.status::text,i.currency,COALESCE(NULLIF(i.total_cents,0),ROUND(i.total*100)::int)::text total_cents,COALESCE(NULLIF(i.subtotal_cents,0),ROUND(i.subtotal*100)::int)::text subtotal_cents,COALESCE(NULLIF(i.tax_cents,0),ROUND(i.tax*100)::int)::text tax_cents,ROUND(COALESCE(i.amount_paid,0)*100)::int::text amount_paid_cents,ROUND(COALESCE(i.balance_due,0)*100)::int::text balance_due_cents,i.issued_at,i.created_at,i.updated_at FROM invoices i LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id WHERE i.organization_id=$1 AND i.id=$2`, [organizationId, invoiceId]);
    const row = result.rows[0]; if (!row) return null;
    const code = currencyCode(row.currency || "USD"), gross = cents(row.total_cents), paid = cents(row.amount_paid_cents), balance = cents(row.balance_due_cents);
    const paymentRows = await this.client.query<{ id:string; amount_cents:string; currency:string; method:string|null; occurred_at:Date; recorded_at:Date }>(`SELECT p.id,COALESCE(NULLIF(p.amount_cents,0),ROUND(p.amount*100)::int)::text amount_cents,p.currency,COALESCE(p.method,'other') method,COALESCE(p.paid_at,p.applied_at,p.created_at) occurred_at,p.created_at recorded_at FROM payments p WHERE p.organization_id=$1 AND p.invoice_id=$2 ORDER BY COALESCE(p.paid_at,p.applied_at,p.created_at),p.created_at,p.id`, [organizationId, invoiceId]);
    let remaining = gross;
    const history = paymentRows.rows.map((payment) => { remaining -= cents(payment.amount_cents); return { kind:"payment" as const, id:brandedId<"PaymentId">(payment.id), paymentId:brandedId<"PaymentId">(payment.id), amount:money(currencyCode(payment.currency || row.currency || "USD"), cents(payment.amount_cents)), ...(payment.method ? { method:payment.method as PaymentMethod } : {}), source:"legacy" as const, occurredAt:payment.occurred_at.toISOString(), recordedAt:payment.recorded_at.toISOString(), balanceAfter:money(code, remaining) }; });
    return { invoice: { source:"legacy", readOnly:true, invoiceId, organizationId, sourceOrderId: brandedId<"OrderId">(row.order_id ?? ""), ...(row.customer_id ? { customerId: brandedId<"CustomerId">(row.customer_id), customerPresentation:{ customerDisplayName:row.customer_name ?? "Customer unavailable" } } : {}), lifecycle: row.status === "void" ? "void" : row.status === "draft" ? "draft" : "issued", currency: code, synchronizationVersion:"legacy-read-only", lines:[], subtotal:money(code,cents(row.subtotal_cents)), taxTotal:money(code,cents(row.tax_cents)), total:money(code,gross), ...(row.issued_at ? { issuedAt:row.issued_at.toISOString() } : {}), createdAt:row.created_at.toISOString(), updatedAt:row.updated_at.toISOString() }, settlement:{ gross:money(code,gross), paid:money(code,paid), refunded:money(code,0), balance:money(code,balance) }, history };
  }
  async listFinancialInvoices(
    organizationId: OrganizationId,
  ): Promise<readonly FinancialInvoiceListItem[]> {
    const result = await this.client.query<{
      id: string;
      sales_order_document_id: string;
      display_number: string;
      customer_id: string | null;
      customer_name: string | null;
      invoice_state: "draft" | "issued" | "void";
      currency: string;
      total_cents: string;
      paid: string;
      refunded: string;
      issued_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT i.id,i.sales_order_document_id,d.display_number,i.customer_id,COALESCE(c.display_name,c.company_name) customer_name,i.invoice_state,i.currency,i.total_cents,
        COALESCE((SELECT sum(a.amount_cents) FROM v2_billing_payment_allocations a WHERE a.organization_id=i.organization_id AND a.invoice_id=i.id),0)::text paid,
        COALESCE((SELECT sum(r.amount_cents) FROM v2_billing_refunds r WHERE r.organization_id=i.organization_id AND r.invoice_id=i.id),0)::text refunded,
        i.issued_at,i.updated_at
       FROM v2_billing_invoices i JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
       LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
       WHERE i.organization_id=$1 ORDER BY i.updated_at DESC,i.id DESC`,
      [organizationId],
    );
    const native: FinancialInvoiceListItem[] = result.rows.map((row) => {
      const code = currencyCode(row.currency),
        gross = cents(row.total_cents),
        paid = cents(row.paid),
        refunded = cents(row.refunded),
        balance = gross - paid + refunded,
        settlement = settlementStatus(row.invoice_state, gross, paid, refunded);
      return {
        source: "v2",
        recordId: row.id,
        invoiceId: brandedId<"InvoiceId">(row.id),
        sourceOrderId: row.sales_order_document_id,
        sourceOrderNumber: row.display_number,
        ...(row.customer_id ? { customerId: row.customer_id } : {}),
        ...(row.customer_name ? { customerName: row.customer_name } : {}),
        lifecycle: row.invoice_state,
        currency: row.currency,
        gross: money(code, gross),
        paid: money(code, paid),
        refunded: money(code, refunded),
        balance: money(code, balance),
        ...(settlement ? { settlement } : {}),
        ...(row.issued_at ? { issuedAt: row.issued_at.toISOString() } : {}),
        updatedAt: row.updated_at.toISOString(),
      };
    });
    const legacy = await this.client.query<{
      id: string; order_id: string | null; order_number: string | null; customer_id: string | null; customer_name: string | null;
      status: "draft" | "finalized" | "billed" | "paid" | "void" | "sent" | "partially_paid" | "overdue"; currency: string;
      total_cents: string; amount_paid_cents: string; balance_due_cents: string; issued_at: Date | null; updated_at: Date;
    }>(`SELECT i.id,i.order_id,COALESCE(o.display_number,o.order_number,'Order unavailable') order_number,i.customer_id,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,i.status,i.currency,COALESCE(NULLIF(i.total_cents,0),ROUND(i.total*100)::int)::text total_cents,ROUND(COALESCE(i.amount_paid,0)*100)::int::text amount_paid_cents,ROUND(COALESCE(i.balance_due,0)*100)::int::text balance_due_cents,i.issued_at,i.updated_at FROM invoices i LEFT JOIN orders o ON o.organization_id=i.organization_id AND o.id=i.order_id LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id WHERE i.organization_id=$1 ORDER BY i.updated_at DESC,i.id DESC LIMIT 50`, [organizationId]);
    const legacyItems: FinancialInvoiceListItem[] = legacy.rows.map((row) => {
      const gross = cents(row.total_cents), paid = cents(row.amount_paid_cents), balance = cents(row.balance_due_cents), code = currencyCode(row.currency || "USD");
      const settlement = balance < 0 ? "credit_due" as const : balance === 0 ? "paid" as const : paid > 0 ? "partially_paid" as const : "unpaid" as const;
      return { source: "legacy", recordId: row.id, invoiceId: brandedId<"InvoiceId">(row.id), sourceOrderId: row.order_id ?? "", sourceOrderNumber: row.order_number ?? "Order unavailable", ...(row.customer_id ? { customerId: row.customer_id } : {}), ...(row.customer_name ? { customerName: row.customer_name } : {}), lifecycle: row.status === "void" ? "void" : row.status === "draft" ? "draft" : "issued", currency: row.currency || "USD", gross: money(code, gross), paid: money(code, paid), refunded: money(code, 0), balance: money(code, balance), settlement, ...(row.issued_at ? { issuedAt: row.issued_at.toISOString() } : {}), updatedAt: row.updated_at.toISOString() };
    });
    return [...native, ...legacyItems].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.source.localeCompare(a.source) || b.recordId.localeCompare(a.recordId)).slice(0, 50);
  }
  async listLedger(
    organizationId: OrganizationId,
  ): Promise<readonly FinancialLedgerEntry[]> {
    const result = await this.client.query<FactRow>(
      `SELECT f.*,i.sales_order_document_id source_order_id,d.display_number source_order_number,i.customer_id,COALESCE(c.display_name,c.company_name) customer_name,i.total_cents gross_cents
       FROM (
        SELECT 'payment'::text kind,p.id,p.id payment_id,p.invoice_id,p.amount_cents,p.currency,p.method,p.source,p.occurred_at,p.recorded_at FROM v2_billing_payments p WHERE p.organization_id=$1
        UNION ALL
        SELECT 'refund'::text kind,r.id,a.payment_id,r.invoice_id,r.amount_cents,r.currency,p.method,r.source,r.occurred_at,r.recorded_at FROM v2_billing_refunds r JOIN v2_billing_refund_allocations a ON a.organization_id=r.organization_id AND a.refund_id=r.id JOIN v2_billing_payments p ON p.organization_id=r.organization_id AND p.id=a.payment_id WHERE r.organization_id=$1
       ) f JOIN v2_billing_invoices i ON i.organization_id=$1 AND i.id=f.invoice_id JOIN v2_sales_documents d ON d.organization_id=$1 AND d.id=i.sales_order_document_id LEFT JOIN customers c ON c.organization_id=$1 AND c.id=i.customer_id
       ORDER BY f.occurred_at DESC,f.recorded_at DESC,f.id DESC`,
      [organizationId],
    );
    const perInvoice = new Map<string, readonly FactRow[]>();
    for (const row of result.rows)
      perInvoice.set(row.invoice_id, [
        ...(perInvoice.get(row.invoice_id) ?? []),
        row,
      ]);
    const balances = new Map<string, Map<string, FinancialHistoryEntry>>();
    for (const [invoiceId, rows] of perInvoice) {
      const chronological = [...rows].sort(
        (a, b) =>
          a.occurred_at.getTime() - b.occurred_at.getTime() ||
          a.recorded_at.getTime() - b.recorded_at.getTime() ||
          a.id.localeCompare(b.id),
      );
      balances.set(
        invoiceId,
        new Map(
          history(chronological, cents(chronological[0]!.gross_cents!)).map(
            (entry) => [String(entry.id), entry],
          ),
        ),
      );
    }
    const native = result.rows.map((row) => ({
      ...balances.get(row.invoice_id)!.get(row.id)!,
      recordSource: "v2" as const,
      recordId: row.id,
      invoiceId: brandedId<"InvoiceId">(row.invoice_id),
      sourceOrderId: row.source_order_id!,
      sourceOrderNumber: row.source_order_number!,
      ...(row.customer_id ? { customerId: row.customer_id } : {}),
      ...(row.customer_name ? { customerName: row.customer_name } : {}),
    }));
    const legacy = await this.client.query<{
      id: string; invoice_id: string; amount_cents: string; currency: string; method: string | null; occurred_at: Date; recorded_at: Date; order_id: string | null; order_number: string | null; customer_id: string | null; customer_name: string | null; balance_due_cents: string;
    }>(`SELECT p.id,p.invoice_id,COALESCE(NULLIF(p.amount_cents,0),ROUND(p.amount*100)::int)::text amount_cents,p.currency,p.method,COALESCE(p.paid_at,p.applied_at,p.created_at) occurred_at,p.created_at recorded_at,i.order_id,COALESCE(o.display_number,o.order_number,'Order unavailable') order_number,i.customer_id,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,ROUND(COALESCE(i.balance_due,0)*100)::int::text balance_due_cents FROM payments p JOIN invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id LEFT JOIN orders o ON o.organization_id=i.organization_id AND o.id=i.order_id LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id WHERE p.organization_id=$1 ORDER BY COALESCE(p.paid_at,p.applied_at,p.created_at) DESC,p.id DESC LIMIT 50`, [organizationId]);
    const legacyEntries: FinancialLedgerEntry[] = legacy.rows.map((row) => ({ kind: "payment", id: brandedId<"PaymentId">(row.id), paymentId: brandedId<"PaymentId">(row.id), amount: money(currencyCode(row.currency || "USD"), cents(row.amount_cents)), ...(row.method ? { method: row.method as PaymentMethod } : {}), source: "legacy", occurredAt: row.occurred_at.toISOString(), recordedAt: row.recorded_at.toISOString(), balanceAfter: money(currencyCode(row.currency || "USD"), cents(row.balance_due_cents)), recordSource: "legacy", recordId: row.id, invoiceId: brandedId<"InvoiceId">(row.invoice_id), sourceOrderId: row.order_id ?? "", sourceOrderNumber: row.order_number ?? "Order unavailable", ...(row.customer_id ? { customerId: row.customer_id } : {}), ...(row.customer_name ? { customerName: row.customer_name } : {}) }));
    return [...native, ...legacyEntries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordSource.localeCompare(a.recordSource) || b.recordId.localeCompare(a.recordId)).slice(0, 50);
  }
  private async facts(
    organizationId: OrganizationId,
    invoiceId: InvoiceId,
  ): Promise<readonly FactRow[]> {
    const result = await this.client.query<FactRow>(
      `SELECT 'payment'::text kind,p.id,p.id payment_id,p.invoice_id,p.amount_cents,p.currency,p.method,p.source,p.occurred_at,p.recorded_at FROM v2_billing_payments p WHERE p.organization_id=$1 AND p.invoice_id=$2
       UNION ALL
       SELECT 'refund'::text kind,r.id,a.payment_id,r.invoice_id,r.amount_cents,r.currency,p.method,r.source,r.occurred_at,r.recorded_at FROM v2_billing_refunds r JOIN v2_billing_refund_allocations a ON a.organization_id=r.organization_id AND a.refund_id=r.id JOIN v2_billing_payments p ON p.organization_id=r.organization_id AND p.id=a.payment_id WHERE r.organization_id=$1 AND r.invoice_id=$2
       ORDER BY occurred_at,recorded_at,id`,
      [organizationId, invoiceId],
    );
    return result.rows;
  }
}
export class PostgresFinancialReadRunner implements FinancialReadRunner {
  constructor(private readonly pool: Pool) {}
  async read<T>(action: (port: FinancialReadPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const result = await action(new PostgresFinancialRead(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
