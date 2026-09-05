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
  FinancialArSummary,
  FinancialCurrencyAmount,
  FinancialInvoicePage,
  FinancialInvoicePageRequest,
  FinancialInvoiceListItem,
  FinancialInvoiceRead,
  FinancialLedgerEntry,
  FinancialLedgerPage,
  FinancialLedgerPageRequest,
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
const financialPageSize = (value: number | undefined) => Math.min(100, Math.max(1, Number.isInteger(value) ? value! : 25));
const financialPage = (value: number | undefined) => Math.max(1, Number.isInteger(value) ? value! : 1);
const financialSearch = (value: string | undefined) => (value ?? "").trim().slice(0, 120).replace(/[\\%_]/g, "\\$&");
const financeSort = (sort: FinancialInvoicePageRequest["sort"]) => ({
  updated: "updated_at",
  invoice_number: "invoice_number",
  customer: "customer_name",
  issued_at: "issued_at",
  total: "gross_cents",
  balance: "balance_cents",
}[sort ?? "updated"]!);
const financeDirection = (direction: FinancialInvoicePageRequest["direction"]) => direction === "asc" ? "ASC" : "DESC";
const ledgerSort = (sort: FinancialLedgerPageRequest["sort"]) => ({
  occurred_at: "occurred_at",
  recorded_at: "recorded_at",
  source: "record_source",
  kind: "kind",
  invoice_number: "source_order_number",
  customer: "customer_name",
  method: "method",
  amount: "CASE WHEN kind='refund' THEN -amount_cents ELSE amount_cents END",
  balance: "balance_after_cents",
}[sort ?? "occurred_at"]!);
type PagedInvoiceRow = Readonly<{
  source: "v2" | "legacy";
  record_id: string;
  invoice_id: string;
  source_order_id: string;
  source_order_number: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string | null;
  lifecycle: "draft" | "issued" | "void";
  settlement: FinancialInvoiceListItem["settlement"] | null;
  currency: string;
  gross_cents: string;
  paid_cents: string;
  refunded_cents: string;
  balance_cents: string;
  issued_at: Date | null;
  updated_at: Date;
}>;
type AggregateRow = Readonly<{
  currency: string;
  invoice_count: string;
  unpaid_count: string;
  unpaid_cents: string;
  partially_paid_count: string;
  partially_paid_cents: string;
  paid_count: string;
  credit_due_count: string;
  credit_due_cents: string;
}>;
type PagedLedgerRow = Readonly<{
  record_source: "v2" | "legacy";
  kind: "payment" | "refund";
  id: string;
  payment_id: string | null;
  invoice_id: string;
  amount_cents: string;
  currency: string;
  method: string | null;
  source: "manual" | "provider" | "legacy";
  occurred_at: Date;
  recorded_at: Date;
  source_order_id: string;
  source_order_number: string;
  customer_id: string | null;
  customer_name: string | null;
  balance_after_cents: string;
}>;
const financialItem = (row: PagedInvoiceRow): FinancialInvoiceListItem => {
  const gross = cents(row.gross_cents), paid = cents(row.paid_cents), refunded = cents(row.refunded_cents), balance = cents(row.balance_cents), code = currencyCode(row.currency);
  return { source: row.source, recordId: row.record_id, invoiceId: brandedId<"InvoiceId">(row.invoice_id), sourceOrderId: row.source_order_id, sourceOrderNumber: row.source_order_number, ...(row.customer_id ? { customerId: brandedId<"CustomerId">(row.customer_id) } : {}), ...(row.customer_name ? { customerName: row.customer_name } : {}), lifecycle: row.lifecycle, currency: row.currency, gross: money(code, gross), paid: money(code, paid), refunded: money(code, refunded), balance: money(code, balance), ...(row.settlement ? { settlement: row.settlement } : {}), ...(row.issued_at ? { issuedAt: row.issued_at.toISOString() } : {}), updatedAt: row.updated_at.toISOString() };
};
const summaryFrom = (rows: readonly AggregateRow[]): FinancialArSummary => {
  const amounts = (field: keyof Pick<AggregateRow, "unpaid_cents" | "partially_paid_cents" | "credit_due_cents">): readonly FinancialCurrencyAmount[] => rows.map((row) => ({ currency: row.currency, cents: cents(row[field]) })).filter((row) => row.cents !== 0);
  const count = (field: keyof Pick<AggregateRow, "unpaid_count" | "partially_paid_count" | "paid_count" | "credit_due_count">) => rows.reduce((total, row) => total + Number(row[field]), 0);
  const unpaid = { count: count("unpaid_count"), balance: amounts("unpaid_cents") };
  const partiallyPaid = { count: count("partially_paid_count"), balance: amounts("partially_paid_cents") };
  return { totalMatching: rows.reduce((total, row) => total + Number(row.invoice_count), 0), outstanding: rows.map((row) => ({ currency: row.currency, cents: cents(row.unpaid_cents) + cents(row.partially_paid_cents) })).filter((row) => row.cents !== 0), openInvoiceCount: unpaid.count + partiallyPaid.count, unpaid, partiallyPaid, paid: { count: count("paid_count"), balance: [] }, creditDue: { count: count("credit_due_count"), balance: amounts("credit_due_cents") } };
};
const ledgerItem = (row: PagedLedgerRow): FinancialLedgerEntry => ({
  kind: row.kind,
  id: brandedId<"PaymentId" | "RefundId">(row.id),
  ...(row.payment_id ? { paymentId: brandedId<"PaymentId">(row.payment_id) } : {}),
  amount: money(currencyCode(row.currency), cents(row.amount_cents)),
  ...(row.method ? { method: row.method as PaymentMethod } : {}),
  source: row.source,
  occurredAt: row.occurred_at.toISOString(),
  recordedAt: row.recorded_at.toISOString(),
  balanceAfter: money(currencyCode(row.currency), cents(row.balance_after_cents)),
  recordSource: row.record_source,
  recordId: row.id,
  invoiceId: brandedId<"InvoiceId">(row.invoice_id),
  sourceOrderId: row.source_order_id,
  sourceOrderNumber: row.source_order_number,
  ...(row.customer_id ? { customerId: brandedId<"CustomerId">(row.customer_id) } : {}),
  ...(row.customer_name ? { customerName: row.customer_name } : {}),
});
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

/**
 * The compatibility population is normalized in PostgreSQL so the exact same
 * tenant-scoped rows drive page results and A/R aggregates.  The legacy arm
 * only excludes an exact same-record identity; it never guesses that matching
 * document numbers are duplicates.
 */
const financialProjection = `
  WITH payment_totals AS (
    SELECT organization_id,invoice_id,COALESCE(sum(amount_cents),0)::bigint paid_cents
    FROM v2_billing_payment_allocations
    WHERE organization_id=$1
    GROUP BY organization_id,invoice_id
  ), refund_totals AS (
    SELECT organization_id,invoice_id,COALESCE(sum(amount_cents),0)::bigint refunded_cents
    FROM v2_billing_refunds
    WHERE organization_id=$1
    GROUP BY organization_id,invoice_id
  ), native_rows AS (
    SELECT 'v2'::text source,i.id record_id,i.id invoice_id,i.sales_order_document_id source_order_id,
      d.display_number source_order_number,COALESCE(i.invoice_display_number,d.display_number) invoice_number,
      i.customer_id,COALESCE(c.display_name,c.company_name) customer_name,i.invoice_state lifecycle,
      i.currency,i.total_cents gross_cents,COALESCE(p.paid_cents,0)::bigint paid_cents,
      COALESCE(r.refunded_cents,0)::bigint refunded_cents,
      (i.total_cents-COALESCE(p.paid_cents,0)+COALESCE(r.refunded_cents,0))::bigint balance_cents,
      i.issued_at,i.updated_at,i.purchase_order_number
    FROM v2_billing_invoices i
    JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
    LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
    LEFT JOIN payment_totals p ON p.organization_id=i.organization_id AND p.invoice_id=i.id
    LEFT JOIN refund_totals r ON r.organization_id=i.organization_id AND r.invoice_id=i.id
    WHERE i.organization_id=$1
  ), legacy_rows AS (
    SELECT 'legacy'::text source,i.id record_id,i.id invoice_id,COALESCE(i.order_id,'') source_order_id,
      COALESCE(o.display_number,o.order_number,'Order unavailable') source_order_number,
      COALESCE(i.display_number,'Invoice '||i.id) invoice_number,i.customer_id,
      COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,
      CASE WHEN i.status::text='void' THEN 'void' WHEN i.status::text='draft' THEN 'draft' ELSE 'issued' END lifecycle,
      COALESCE(NULLIF(i.currency,''),'USD') currency,
      COALESCE(NULLIF(i.total_cents,0),ROUND(i.total*100)::bigint)::bigint gross_cents,
      ROUND(COALESCE(i.amount_paid,0)*100)::bigint paid_cents,0::bigint refunded_cents,
      ROUND(COALESCE(i.balance_due,0)*100)::bigint balance_cents,i.issued_at,
      COALESCE(i.updated_at,i.created_at) updated_at,o.po_number purchase_order_number
    FROM invoices i
    LEFT JOIN orders o ON o.organization_id=i.organization_id AND o.id=i.order_id
    LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
    WHERE i.organization_id=$1
      AND NOT EXISTS (SELECT 1 FROM v2_billing_invoices v WHERE v.organization_id=i.organization_id AND v.id=i.id)
  ), normalized AS (
    SELECT source,record_id,invoice_id,source_order_id,source_order_number,invoice_number,customer_id,customer_name,lifecycle,currency,gross_cents,paid_cents,refunded_cents,balance_cents,issued_at,updated_at,purchase_order_number,
      CASE WHEN lifecycle='void' THEN NULL
        WHEN balance_cents<0 THEN 'credit_due'
        WHEN balance_cents=0 THEN 'paid'
        WHEN paid_cents=0 AND refunded_cents=0 THEN 'unpaid'
        ELSE 'partially_paid' END settlement
    FROM (SELECT * FROM native_rows UNION ALL SELECT * FROM legacy_rows) compatibility
  ), filtered AS (
    SELECT * FROM normalized
    WHERE ($2::text='' OR invoice_number ILIKE '%'||$2||'%' ESCAPE '\\'
      OR source_order_number ILIKE '%'||$2||'%' ESCAPE '\\'
      OR COALESCE(customer_name,'') ILIKE '%'||$2||'%' ESCAPE '\\'
      OR COALESCE(purchase_order_number,'') ILIKE '%'||$2||'%' ESCAPE '\\')
      AND ($3::text IS NULL OR lifecycle=$3)
      AND ($4::text IS NULL OR settlement=$4)
  )`;

/** Finance ledger pages retain derived per-invoice balances without loading every immutable fact into Node. */
const ledgerProjection = `
  WITH native_facts AS (
    SELECT 'v2'::text record_source,'payment'::text kind,p.id,p.id payment_id,p.invoice_id,p.amount_cents,p.currency,p.method,p.source,
      p.occurred_at,p.recorded_at,i.sales_order_document_id source_order_id,d.display_number source_order_number,
      i.customer_id,COALESCE(c.display_name,c.company_name) customer_name,i.total_cents gross_cents,p.amount_cents signed_cents
    FROM v2_billing_payments p
    JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
    JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
    LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
    WHERE p.organization_id=$1
    UNION ALL
    SELECT 'v2'::text,'refund'::text,r.id,a.payment_id,r.invoice_id,r.amount_cents,r.currency,p.method,r.source,
      r.occurred_at,r.recorded_at,i.sales_order_document_id,d.display_number,i.customer_id,
      COALESCE(c.display_name,c.company_name),i.total_cents,-r.amount_cents
    FROM v2_billing_refunds r
    JOIN v2_billing_refund_allocations a ON a.organization_id=r.organization_id AND a.refund_id=r.id
    JOIN v2_billing_payments p ON p.organization_id=r.organization_id AND p.id=a.payment_id
    JOIN v2_billing_invoices i ON i.organization_id=r.organization_id AND i.id=r.invoice_id
    JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
    LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
    WHERE r.organization_id=$1
  ), native_balances AS (
    SELECT *, (gross_cents-sum(signed_cents) OVER (PARTITION BY invoice_id ORDER BY occurred_at,recorded_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::bigint balance_after_cents
    FROM native_facts
  ), legacy_facts AS (
    SELECT 'legacy'::text record_source,'payment'::text kind,p.id,p.id payment_id,p.invoice_id,
      COALESCE(NULLIF(p.amount_cents,0),ROUND(p.amount*100)::bigint)::bigint amount_cents,
      COALESCE(NULLIF(p.currency,''),'USD') currency,p.method,'legacy'::text source,
      COALESCE(p.paid_at,p.applied_at,p.created_at AT TIME ZONE 'UTC') occurred_at,p.created_at recorded_at,
      COALESCE(i.order_id,'') source_order_id,COALESCE(o.display_number,o.order_number,'Order unavailable') source_order_number,
      i.customer_id,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,
      ROUND(COALESCE(i.balance_due,0)*100)::bigint balance_after_cents
    FROM payments p
    JOIN invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
    LEFT JOIN orders o ON o.organization_id=i.organization_id AND o.id=i.order_id
    LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
    WHERE p.organization_id=$1
      AND NOT EXISTS (SELECT 1 FROM v2_billing_payments v WHERE v.organization_id=p.organization_id AND v.id=p.id)
  ), combined AS (
    SELECT record_source,kind,id,payment_id,invoice_id,amount_cents,currency,method,source,occurred_at,recorded_at,source_order_id,source_order_number,customer_id,customer_name,balance_after_cents FROM native_balances
    UNION ALL
    SELECT record_source,kind,id,payment_id,invoice_id,amount_cents,currency,method,source,occurred_at,recorded_at,source_order_id,source_order_number,customer_id,customer_name,balance_after_cents FROM legacy_facts
  ), filtered AS (
    SELECT * FROM combined
    WHERE ($2::text = '' OR source_order_number ILIKE '%' || $2 || '%' ESCAPE '\\' OR COALESCE(customer_name,'') ILIKE '%' || $2 || '%' ESCAPE '\\' OR id ILIKE '%' || $2 || '%' ESCAPE '\\' OR invoice_id ILIKE '%' || $2 || '%' ESCAPE '\\')
      AND ($3::text IS NULL OR kind=$3)
      AND ($4::text IS NULL OR record_source=$4)
  )`;

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
    const paymentRows = await this.client.query<{ id:string; amount_cents:string; currency:string; method:string|null; occurred_at:Date; recorded_at:Date }>(`SELECT p.id,COALESCE(NULLIF(p.amount_cents,0),ROUND(p.amount*100)::int)::text amount_cents,p.currency,COALESCE(p.method,'other') method,COALESCE(p.paid_at,p.applied_at,p.created_at AT TIME ZONE 'UTC') occurred_at,p.created_at recorded_at FROM payments p WHERE p.organization_id=$1 AND p.invoice_id=$2 ORDER BY COALESCE(p.paid_at,p.applied_at,p.created_at AT TIME ZONE 'UTC'),p.created_at,p.id`, [organizationId, invoiceId]);
    let remaining = gross;
    const history = paymentRows.rows.map((payment) => { remaining -= cents(payment.amount_cents); return { kind:"payment" as const, id:brandedId<"PaymentId">(payment.id), paymentId:brandedId<"PaymentId">(payment.id), amount:money(currencyCode(payment.currency || row.currency || "USD"), cents(payment.amount_cents)), ...(payment.method ? { method:payment.method as PaymentMethod } : {}), source:"legacy" as const, occurredAt:payment.occurred_at.toISOString(), recordedAt:payment.recorded_at.toISOString(), balanceAfter:money(code, remaining) }; });
    return { invoice: { source:"legacy", readOnly:true, invoiceId, organizationId, sourceOrderId: brandedId<"OrderId">(row.order_id ?? ""), ...(row.customer_id ? { customerId: brandedId<"CustomerId">(row.customer_id), customerPresentation:{ customerDisplayName:row.customer_name ?? "Customer unavailable" } } : {}), lifecycle: row.status === "void" ? "void" : row.status === "draft" ? "draft" : "issued", currency: code, synchronizationVersion:"legacy-read-only", lines:[], subtotal:money(code,cents(row.subtotal_cents)), taxTotal:money(code,cents(row.tax_cents)), total:money(code,gross), ...(row.issued_at ? { issuedAt:row.issued_at.toISOString() } : {}), createdAt:row.created_at.toISOString(), updatedAt:row.updated_at.toISOString() }, settlement:{ gross:money(code,gross), paid:money(code,paid), refunded:money(code,0), balance:money(code,balance) }, history };
  }
  async pageFinancialInvoices(organizationId: OrganizationId, request: FinancialInvoicePageRequest): Promise<FinancialInvoicePage> {
    const page = financialPage(request.page), pageSize = financialPageSize(request.pageSize), search = financialSearch(request.search), lifecycle = request.lifecycle ?? null, settlement = request.settlement ?? null, offset = (page - 1) * pageSize;
    const sort = financeSort(request.sort), direction = financeDirection(request.direction);
    const order = `${sort} ${direction} NULLS LAST, source ASC, record_id ASC`;
    const values = [organizationId, search, lifecycle, settlement];
    const [rows, summary] = await Promise.all([
      this.client.query<PagedInvoiceRow>(`${financialProjection} SELECT source,record_id,invoice_id,source_order_id,source_order_number,invoice_number,customer_id,customer_name,lifecycle,settlement,currency,gross_cents::text,paid_cents::text,refunded_cents::text,balance_cents::text,issued_at,updated_at FROM filtered ORDER BY ${order} LIMIT $5 OFFSET $6`, [...values, pageSize, offset]),
      this.summary(organizationId, request),
    ]);
    return { items: rows.rows.map(financialItem), page, pageSize, totalMatching: summary.totalMatching, hasNextPage: offset + rows.rows.length < summary.totalMatching, summary };
  }
  async summarizeFinancialInvoices(organizationId: OrganizationId, request: Omit<FinancialInvoicePageRequest, "page" | "pageSize" | "sort" | "direction">): Promise<FinancialArSummary> {
    return this.summary(organizationId, request);
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
  async pageFinancialLedger(organizationId: OrganizationId, request: FinancialLedgerPageRequest): Promise<FinancialLedgerPage> {
    const page = financialPage(request.page), pageSize = financialPageSize(request.pageSize), offset = (page - 1) * pageSize;
    const search = financialSearch(request.search), kind = request.kind ?? null, recordSource = request.recordSource ?? null;
    const order = `${ledgerSort(request.sort)} ${financeDirection(request.direction)} NULLS LAST, occurred_at DESC, recorded_at DESC, record_source ASC, id ASC`;
    const values = [organizationId, search, kind, recordSource];
    const [result, count] = await Promise.all([
      this.client.query<PagedLedgerRow>(`${ledgerProjection} SELECT * FROM filtered ORDER BY ${order} LIMIT $5 OFFSET $6`, [...values, pageSize, offset]),
      this.client.query<{ total_matching: string }>(`${ledgerProjection} SELECT count(*)::text total_matching FROM filtered`, values),
    ]);
    const totalMatching = Number(count.rows[0]?.total_matching ?? "0");
    return { items: result.rows.map(ledgerItem), page, pageSize, totalMatching, hasNextPage: offset + result.rows.length < totalMatching };
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
  private async summary(organizationId: OrganizationId, request: Pick<FinancialInvoicePageRequest, "search" | "lifecycle" | "settlement">): Promise<FinancialArSummary> {
    const aggregate = await this.client.query<AggregateRow>(`${financialProjection} SELECT currency,count(*)::text invoice_count,count(*) FILTER (WHERE settlement='unpaid')::text unpaid_count,COALESCE(sum(CASE WHEN settlement='unpaid' THEN GREATEST(balance_cents,0) ELSE 0 END),0)::text unpaid_cents,count(*) FILTER (WHERE settlement='partially_paid')::text partially_paid_count,COALESCE(sum(CASE WHEN settlement='partially_paid' THEN GREATEST(balance_cents,0) ELSE 0 END),0)::text partially_paid_cents,count(*) FILTER (WHERE settlement='paid')::text paid_count,count(*) FILTER (WHERE settlement='credit_due')::text credit_due_count,COALESCE(sum(CASE WHEN settlement='credit_due' THEN -balance_cents ELSE 0 END),0)::text credit_due_cents FROM filtered GROUP BY currency ORDER BY currency`, [organizationId, financialSearch(request.search), request.lifecycle ?? null, request.settlement ?? null]);
    return summaryFrom(aggregate.rows);
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
