import { sql, type SQL } from "drizzle-orm";
import { payments, invoices, orders, customers, customerContacts } from "@shared/schema";
import { projectPaymentReceipt, type PaymentReceipt } from "@shared/paymentReceiptHistory";
import { db } from "../db";
import { canonicalInvoiceCustomerId } from "./invoiceCustomerProjection";
import { getOrganizationTimezone } from "./orderDueDateService";
import { normalizePaymentListSort, paymentDateWindow, type PaymentListInput } from "./paymentListService";

type Input = { organizationId: string; customerId?: string; search?: string; method?: string; from?: Date; until?: Date;
  sortBy?: PaymentListInput["sortBy"]; sortDir?: "asc" | "desc"; page?: number; pageSize?: number | null };
type Header = Omit<PaymentReceipt, "allocatedCents" | "refundedCents" | "unappliedCents">;

/** Display-only aggregation, before filtering/pagination. Never writes financial history. */
export async function readPaymentReceiptHistory(input: Input) {
  if (input.pageSize === null && !input.customerId) throw new Error("Unpaged receipt history requires a customer.");
  const prefix = sql`with allocation_rows as (
    select ${payments.id} as payment_id, ${payments.customerPaymentBatchId} as batch_id, ca.customer_account_credit_id as credit_id,
      ${payments.amountCents} as amount_cents, ${payments.status} as status,
      case when ${payments.status} = 'refunded' then coalesce(${payments.refundedAt}, ${payments.createdAt})
        else coalesce(${payments.paidAt}, ${payments.succeededAt}, ${payments.appliedAt}, ${payments.createdAt}) end as applied_at,
      ${payments.method} as method, ${payments.provider} as provider,
      coalesce(${payments.providerTransactionId}, ${payments.quickbooksPaymentReference}, ${payments.metadata}->>'reference') as reference,
      coalesce(${payments.notes}, ${payments.note}) as notes,
      ${canonicalInvoiceCustomerId} as customer_id,
      coalesce(${customers.companyName}, nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), ''), ${customerContacts.email}) as customer_name,
      ${invoices.id} as invoice_id, coalesce(nullif(trim(${invoices.displayNumber}), ''), case when ${invoices.numberCore} > 0 then ${invoices.numberCore}::text end, ${invoices.invoiceNumber}::text) as invoice_number,
      ${orders.id} as order_id, ${orders.orderNumber} as order_number, ${orders.label} as job_name
    from ${payments}
    join ${invoices} on ${payments.invoiceId} = ${invoices.id} and ${invoices.organizationId} = ${input.organizationId}
    left join ${orders} on ${invoices.orderId} = ${orders.id} and ${orders.organizationId} = ${input.organizationId}
    left join ${customers} on ${customers.id} = ${canonicalInvoiceCustomerId} and ${customers.organizationId} = ${input.organizationId}
    left join ${customerContacts} on ${customerContacts.id} = ${invoices.contactId} and ${customerContacts.organizationId} = ${input.organizationId}
    left join customer_account_credit_applications ca on ca.id = ${payments.customerAccountCreditApplicationId}
      and ca.organization_id = ${input.organizationId} and ca.customer_id = ${canonicalInvoiceCustomerId}
      and ca.invoice_id = ${payments.invoiceId} and ca.amount_cents = ${payments.amountCents}
    where ${payments.organizationId} = ${input.organizationId}
  ), verified_batches as (
    select b.*, c.company_name as customer_name from customer_payment_batches b
    join customers c on c.id = b.customer_id and c.organization_id = b.organization_id
    where b.organization_id = ${input.organizationId} and b.status in ('succeeded','captured','refunded','partially_refunded','voided','reversed')
      and not exists (
        select 1 from payments p left join allocation_rows a on a.payment_id = p.id
        where p.customer_payment_batch_id = b.id and (p.organization_id <> b.organization_id or a.payment_id is null or a.customer_id is distinct from b.customer_id or p.customer_account_credit_application_id is not null)
      )
  ), verified_advances as (
    select cr.*, c.company_name as customer_name from customer_account_credits cr
    join customers c on c.id = cr.customer_id and c.organization_id = cr.organization_id
    where cr.organization_id = ${input.organizationId} and cr.source_type = 'customer_advance'
      and not exists (select 1 from customer_account_credit_applications ca left join allocation_rows a on a.credit_id = cr.id and a.payment_id in (
        select p.id from payments p where p.customer_account_credit_application_id = ca.id)
        where ca.customer_account_credit_id = cr.id and (ca.organization_id <> cr.organization_id or ca.customer_id <> cr.customer_id or a.payment_id is null or a.customer_id is distinct from cr.customer_id))
  ), headers as (
    select 'batch-' || b.id as id, b.id as batch_id, null::varchar as credit_id, null::varchar as payment_id, b.applied_at,
      case when audit.values->>'amountCents' = b.amount_cents::text
        and audit.values->>'tenderedAmountCents' ~ '^[0-9]{1,10}$' and audit.values->>'changeDueCents' ~ '^[0-9]{1,10}$'
        then case when (audit.values->>'tenderedAmountCents')::bigint = b.amount_cents + (audit.values->>'changeDueCents')::bigint
          then (audit.values->>'tenderedAmountCents')::bigint else b.amount_cents end
        else b.amount_cents end as amount_cents,
      b.amount_cents as retained_cents, b.method, b.provider, b.status, coalesce(b.reference, b.stripe_payment_intent_id) as reference,
      b.notes, b.customer_id, b.customer_name, null::text as linkage_warning
    from verified_batches b left join lateral (
      select new_values as values from audit_logs where organization_id = b.organization_id and entity_type = 'customer_payment_batch'
        and entity_id = b.id and action_type = 'customer_payment_allocated' order by created_at, id limit 1
    ) audit on true
    union all
    select 'advance-' || cr.id, null::varchar, cr.id, null::varchar, coalesce(cr.received_at, cr.created_at), cr.original_amount_cents, cr.original_amount_cents,
      coalesce(cr.received_method, 'other'), 'customer_advance', cr.status, cr.reference, cr.notes, cr.customer_id, cr.customer_name, null::text
    from verified_advances cr
    union all
    select 'payment-' || a.payment_id, null::varchar, null::varchar, a.payment_id, a.applied_at, a.amount_cents, a.amount_cents, a.method, a.provider, a.status, a.reference,
      a.notes, a.customer_id, a.customer_name,
      case when a.batch_id is not null then 'Receipt linkage could not be verified; this allocation is shown separately.' else null end
    from allocation_rows a where a.status in ('succeeded','captured','refunded','partially_refunded','voided','reversed')
      and not exists (select 1 from verified_batches b where b.id = a.batch_id)
      and not exists (select 1 from verified_advances cr where cr.id = a.credit_id)
  ), receipt_members as (
    select 'batch-' || a.batch_id as receipt_id, a.* from allocation_rows a join verified_batches b on b.id = a.batch_id
    union all
    select 'advance-' || a.credit_id, a.* from allocation_rows a join verified_advances cr on cr.id = a.credit_id
    union all
    select 'payment-' || a.payment_id, a.* from allocation_rows a
      where not exists (select 1 from verified_batches b where b.id = a.batch_id)
        and not exists (select 1 from verified_advances cr where cr.id = a.credit_id)
  ), receipt_details as (
    select receipt_id, jsonb_agg(jsonb_build_object('paymentId', a.payment_id, 'invoiceId', a.invoice_id, 'invoiceNumber', a.invoice_number,
      'amountCents', a.amount_cents, 'status', a.status, 'reference', a.reference,
      'orderId', a.order_id, 'orderNumber', a.order_number, 'jobName', a.job_name) order by a.invoice_number, a.payment_id) as allocations,
      string_agg(a.invoice_number, ' ') as invoice_numbers, string_agg(a.order_number, ' ') as order_numbers,
      string_agg(a.job_name, ' ') as job_names, string_agg(a.notes, ' ') as allocation_notes,
      sum(case when a.status in ('refunded','voided','reversed') then a.amount_cents else 0 end) as refunded_cents
    from receipt_members a
    where a.status in ('succeeded','captured','refunded','partially_refunded','voided','reversed') or (a.credit_id is not null and a.status = 'canceled')
    group by receipt_id
  ), receipts as (
    select h.*, coalesce(detail.allocations, '[]'::jsonb) as allocations,
      detail.invoice_numbers, detail.order_numbers, detail.job_names, detail.allocation_notes,
      case when h.provider = 'customer_credit' then 0
        when h.status = 'refunded' then -h.retained_cents when h.status in ('voided','reversed') then 0
        else h.retained_cents - coalesce(detail.refunded_cents, 0) end as collected_cents
    from headers h left join receipt_details detail on detail.receipt_id = h.id
  )`;
  const filters: SQL[] = [];
  if (input.customerId) filters.push(sql`customer_id = ${input.customerId}`);
  if (input.method) filters.push(sql`method = ${input.method}`);
  if (input.from) filters.push(sql`applied_at >= ${input.from.toISOString()}`);
  if (input.until) filters.push(sql`applied_at < ${input.until.toISOString()}`);
  if (input.search?.trim()) {
    const raw = input.search.trim();
    const normalized = /^\$?[\d,]+(?:\.\d{1,2})?$/.test(raw) ? raw.replace(/[$,]/g, "") : raw;
    const query = `%${normalized.replace(/[\\%_]/g, "\\$&")}%`;
    filters.push(sql`concat_ws(' ', id, customer_name, method, replace(method, '_', ' '), reference, notes, allocation_notes, invoice_numbers, order_numbers, job_names,
      (amount_cents::numeric / 100)::text, applied_at::date::text, allocations::text) ilike ${query}`);
  }
  const predicate = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
  const sort = { paymentDate: sql`applied_at`, customer: sql`customer_name`, invoiceNumber: sql`invoice_numbers`, orderNumber: sql`order_numbers`, jobName: sql`job_names`, method: sql`method`, reference: sql`reference`, amount: sql`amount_cents` }[normalizePaymentListSort(input.sortBy)];
  const direction = input.sortDir === "asc" ? sql`asc` : sql`desc`;
  const page = Math.max(1, input.page || 1), pageSize = Math.min(200, Math.max(1, input.pageSize || 50));
  const paging = input.pageSize === null ? sql`` : sql`limit ${pageSize} offset ${(page - 1) * pageSize}`;
  // A single statement/snapshot keeps rows, counts, and totals consistent.
  const result = await db.execute(sql`${prefix}, filtered as (select * from receipts ${predicate})
    select (select count(*)::int from filtered) as count,
      (select coalesce(sum(collected_cents),0)::bigint from filtered) as collected,
      coalesce((select jsonb_agg(row_to_json(page_rows)) from (select * from filtered order by ${sort} ${direction}, id ${direction} ${paging}) page_rows), '[]'::jsonb) as rows`);
  const row = result.rows[0] as { count: number; collected: string; rows: Array<Record<string, unknown>> };
  const rows = row.rows.map(value => projectPaymentReceipt({ id: value.id, batchId: value.batch_id, creditId: value.credit_id, paymentId: value.payment_id,
    appliedAt: new Date(String(value.applied_at)).toISOString(), amountCents: Number(value.amount_cents), retainedCents: Number(value.retained_cents), method: value.method, provider: value.provider, status: value.status,
    reference: value.reference, notes: value.notes, customerId: value.customer_id, customerName: value.customer_name,
    allocations: value.allocations, linkageWarning: value.linkage_warning } as Header));
  return { rows, summary: { totalPayments: Number(row.count), totalCollectedCents: Number(row.collected) },
    pagination: { page, pageSize, totalCount: Number(row.count), totalPages: Math.max(1, Math.ceil(Number(row.count) / pageSize)) } };
}

export async function listPaymentReceipts(input: PaymentListInput) {
  const timezone = await getOrganizationTimezone(input.organizationId);
  const window = paymentDateWindow(input.datePreset || "all", timezone, input.now, input.dateFrom, input.dateTo);
  return { ...await readPaymentReceiptHistory({ ...input, from: window.start, until: window.endExclusive }), timezone, datePreset: input.datePreset || "all" };
}
