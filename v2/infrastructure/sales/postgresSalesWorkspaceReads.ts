import type { Pool, PoolClient } from "pg";
import { brandedId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import type { LegacyCommercialDetail, OrderListItem, QuoteListItem, SalesOrderHistoryEvent, SalesWorkspacePage, SalesWorkspacePageRequest, SalesWorkspaceReadPort } from "../../src/modules/sales/workspaceReads.js";

type Source = "v2" | "legacy";
type Sort = "updated_desc" | "updated_asc";
type Cursor = Readonly<{ updatedAt: string; source: Source; id: string; sort: Sort }>;
type Common = Readonly<{
  source: Source;
  id: string;
  number: string;
  customer_display_name: string;
  lifecycle: string;
  selling_total_cents: string;
  currency: string;
  requested_due_date: string | null;
  updated_at: Date;
  cursor_updated_at: string;
}>;
type SummaryRow = Readonly<{ item_count: string; selling_total_cents: string; currency_count: string; currency: string | null }>;

const limitFor = (value: number | undefined) => Number.isInteger(value) ? Math.max(1, Math.min(value!, 50)) : 25;
const sortFor = (value: SalesWorkspacePageRequest["sort"]): Sort => value === "updated_asc" ? "updated_asc" : "updated_desc";
const directionFor = (sort: Sort): "ASC" | "DESC" => sort === "updated_asc" ? "ASC" : "DESC";
const operatorFor = (sort: Sort): ">" | "<" => sort === "updated_asc" ? ">" : "<";
const decode = (value?: string): Cursor | undefined => {
  if (!value) return undefined;
  try {
    const row = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof row.updatedAt === "string" && (row.source === "v2" || row.source === "legacy") && typeof row.id === "string" && (row.sort === "updated_desc" || row.sort === "updated_asc") ? row as Cursor : undefined;
  } catch { return undefined; }
};
const encode = (value: Cursor) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const cursorFor = (request: SalesWorkspacePageRequest) => { const cursor = decode(request.cursor); return cursor?.sort === sortFor(request.sort) ? cursor : undefined; };
const compare = (a: Common, b: Common, sort: Sort) => {
  const timestamp = a.cursor_updated_at.localeCompare(b.cursor_updated_at);
  const source = a.source.localeCompare(b.source);
  const id = a.id.localeCompare(b.id);
  return sort === "updated_asc" ? timestamp || source || id : -timestamp || -source || -id;
};
const summaryFrom = (native: SummaryRow | undefined, legacy: SummaryRow | undefined) => {
  const currencies = [...new Set([...(native?.currency ? [native.currency] : []), ...(legacy?.currency ? [legacy.currency] : [])])];
  return { itemCount: Number(native?.item_count ?? 0) + Number(legacy?.item_count ?? 0), currencies, ...(currencies.length === 1 ? { sellingTotalCents: Number(native?.selling_total_cents ?? 0) + Number(legacy?.selling_total_cents ?? 0) } : {}) };
};

export const classifyLegacyOrder = (row: Readonly<{ status: string; state: string; canonical_state: string | null; fulfillment_status: string; payment_status: string; production_open: string; balance_due_cents: string }>): NonNullable<OrderListItem["activeRecordClassification"]> => {
  const closed = ["canceled", "closed"].includes(row.status) || ["canceled", "closed"].includes(row.state) || row.canonical_state === "canceled" || (row.fulfillment_status === "delivered" && Number(row.balance_due_cents) <= 0);
  if (closed) return "CLOSED_HISTORY";
  if (Number(row.production_open) > 0 || ["in_production", "ready_for_shipment"].includes(row.status) || row.fulfillment_status === "packed") return "ACTIVE_REQUIRES_CUTOVER_STRATEGY";
  if (row.status === "new" && row.state === "open" && row.payment_status === "unpaid") return "ACTIVE_BUT_CAN_REMAIN_LEGACY";
  return "AMBIGUOUS";
};

/** Read-only, tenant-qualified compatibility projection. It never materializes V2 records from legacy rows. */
export class PostgresSalesWorkspaceReads implements SalesWorkspaceReadPort {
  constructor(private readonly pool: Pool) {}

  private async read<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private page<T extends Common>(rows: readonly T[], request: SalesWorkspacePageRequest): Readonly<{ items: readonly T[]; nextCursor?: string }> {
    const limit = limitFor(request.limit);
    const sort = sortFor(request.sort);
    const visible = [...rows].sort((a, b) => compare(a, b, sort)).slice(0, limit + 1);
    const items = visible.slice(0, limit);
    const last = items.at(-1);
    return { items, ...(visible.length > limit && last ? { nextCursor: encode({ updatedAt: last.cursor_updated_at, source: last.source, id: last.id, sort }) } : {}) };
  }

  async listOrderHistory(organizationId: OrganizationId, orderId: any): Promise<readonly SalesOrderHistoryEvent[]> {
    return this.read(async (client) => {
      const rows = await client.query<{ event_type: string; occurred_at: Date; changes: unknown }>("SELECT event_type,occurred_at,changes FROM v2_audit_events WHERE organization_id=$1 AND resource_type='order' AND resource_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 100", [organizationId, orderId]);
      return rows.rows.map((row) => { const first = Array.isArray(row.changes) ? row.changes[0] as { summary?: unknown } | undefined : undefined; return { eventType: row.event_type, occurredAt: row.occurred_at.toISOString(), summary: typeof first?.summary === "string" ? first.summary : row.event_type.replaceAll("_", " ") }; });
    });
  }

  async listQuotes(organizationId: OrganizationId, request: SalesWorkspacePageRequest): Promise<SalesWorkspacePage<QuoteListItem>> {
    return this.read(async (client) => {
      const sort = sortFor(request.sort), direction = directionFor(sort), operator = operatorFor(sort), cursor = cursorFor(request);
      const search = request.search?.trim() || null, lifecycle = request.lifecycle ?? null, dueFrom = request.dueFrom || null, dueTo = request.dueTo || null;
      const parameters = [organizationId, search, lifecycle, dueFrom, dueTo, cursor?.updatedAt ?? null, cursor?.source ?? null, cursor?.id ?? null, limitFor(request.limit) + 1];
      type NativeRow = Common & { order_id: string | null; order_number: string | null; purchase_order_number: string | null; line_count: string };
      type LegacyRow = Common & { line_count: string };
      const [native, legacy, nativeSummary, legacySummary] = await Promise.all([
        client.query<NativeRow>(`SELECT 'v2' source,d.id,d.display_number number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_display_name,CASE WHEN conversion.order_document_id IS NOT NULL THEN 'converted' WHEN q.acceptance_state='accepted' THEN 'accepted' WHEN q.delivery_state='sent' THEN 'sent' ELSE 'draft' END lifecycle,COALESCE((SELECT SUM(l.selling_line_cents) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id),0)::text selling_total_cents,d.currency,d.requested_due_date::text,d.updated_at,to_char(d.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_updated_at,conversion.order_document_id order_id,converted.display_number order_number,d.purchase_order_number,(SELECT count(*) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id)::text line_count FROM v2_sales_documents d JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id LEFT JOIN v2_sales_quote_conversions conversion ON conversion.organization_id=d.organization_id AND conversion.quote_document_id=d.id LEFT JOIN v2_sales_documents converted ON converted.organization_id=d.organization_id AND converted.id=conversion.order_document_id WHERE d.organization_id=$1 AND d.document_kind='quote' AND ($2::text IS NULL OR d.display_number ILIKE '%'||$2||'%' OR COALESCE(d.purchase_order_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR (CASE WHEN conversion.order_document_id IS NOT NULL THEN 'converted' WHEN q.acceptance_state='accepted' THEN 'accepted' WHEN q.delivery_state='sent' THEN 'sent' ELSE 'draft' END)=$3) AND ($4::date IS NULL OR d.requested_due_date >= $4::date) AND ($5::date IS NULL OR d.requested_due_date <= $5::date) AND ($6::timestamptz IS NULL OR (d.updated_at,'v2'::text,d.id::text) ${operator} ($6::timestamptz,$7::text,$8::text)) ORDER BY d.updated_at ${direction},d.id ${direction} LIMIT $9`, parameters),
        client.query<LegacyRow>(`SELECT 'legacy' source,q.id,COALESCE(q.display_number,'Q-'||q.quote_number::text) number,COALESCE(c.display_name,c.company_name,q.customer_name,'Customer unavailable') customer_display_name,q.status::text lifecycle,ROUND(COALESCE(q.total_price,0)*100)::bigint::text selling_total_cents,'USD' currency,q.requested_due_date::text,(COALESCE(q.created_at,timestamp '1970-01-01 00:00:00') AT TIME ZONE 'UTC') updated_at,to_char(COALESCE(q.created_at,timestamp '1970-01-01 00:00:00'),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_updated_at,(SELECT count(*) FROM quote_line_items l WHERE l.quote_id=q.id)::text line_count FROM quotes q LEFT JOIN customers c ON c.organization_id=q.organization_id AND c.id=q.customer_id WHERE q.organization_id=$1 AND ($2::text IS NULL OR COALESCE(q.display_number,'Q-'||q.quote_number::text) ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,q.customer_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR q.status::text=$3) AND ($4::date IS NULL OR q.requested_due_date >= $4::date) AND ($5::date IS NULL OR q.requested_due_date <= $5::date) AND ($6::timestamptz IS NULL OR ((COALESCE(q.created_at,timestamp '1970-01-01 00:00:00') AT TIME ZONE 'UTC'),'legacy'::text,q.id::text) ${operator} ($6::timestamptz,$7::text,$8::text)) ORDER BY COALESCE(q.created_at,timestamp '1970-01-01 00:00:00') ${direction},q.id ${direction} LIMIT $9`, parameters),
        client.query<SummaryRow>(`SELECT count(*)::text item_count,COALESCE(SUM((SELECT COALESCE(SUM(l.selling_line_cents),0) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id)),0)::text selling_total_cents,count(DISTINCT d.currency)::text currency_count,min(d.currency) currency FROM v2_sales_documents d JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id LEFT JOIN v2_sales_quote_conversions conversion ON conversion.organization_id=d.organization_id AND conversion.quote_document_id=d.id WHERE d.organization_id=$1 AND d.document_kind='quote' AND ($2::text IS NULL OR d.display_number ILIKE '%'||$2||'%' OR COALESCE(d.purchase_order_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR (CASE WHEN conversion.order_document_id IS NOT NULL THEN 'converted' WHEN q.acceptance_state='accepted' THEN 'accepted' WHEN q.delivery_state='sent' THEN 'sent' ELSE 'draft' END)=$3) AND ($4::date IS NULL OR d.requested_due_date >= $4::date) AND ($5::date IS NULL OR d.requested_due_date <= $5::date)`, parameters.slice(0, 5)),
        client.query<SummaryRow>(`SELECT count(*)::text item_count,COALESCE(SUM(ROUND(COALESCE(q.total_price,0)*100)::bigint),0)::text selling_total_cents,CASE WHEN count(*)=0 THEN '0' ELSE '1' END currency_count,CASE WHEN count(*)=0 THEN NULL ELSE 'USD' END currency FROM quotes q LEFT JOIN customers c ON c.organization_id=q.organization_id AND c.id=q.customer_id WHERE q.organization_id=$1 AND ($2::text IS NULL OR COALESCE(q.display_number,'Q-'||q.quote_number::text) ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,q.customer_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR q.status::text=$3) AND ($4::date IS NULL OR q.requested_due_date >= $4::date) AND ($5::date IS NULL OR q.requested_due_date <= $5::date)`, parameters.slice(0, 5)),
      ]);
      const candidates: (QuoteListItem & Common)[] = [
        ...native.rows.map((row) => ({ ...row, source: "v2" as const, recordId: row.id, quoteId: brandedId<"QuoteId">(row.id), number: row.number, customerDisplayName: row.customer_display_name, lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency, ...(row.purchase_order_number ? { purchaseOrderNumber: row.purchase_order_number } : {}), lineCount: Number(row.line_count), ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(), ...(row.order_id ? { convertedOrderId: brandedId<"OrderId">(row.order_id) } : {}), ...(row.order_number ? { convertedOrderNumber: row.order_number } : {}) })),
        ...legacy.rows.map((row) => ({ ...row, source: "legacy" as const, recordId: row.id, quoteId: brandedId<"QuoteId">(row.id), number: row.number, customerDisplayName: row.customer_display_name, lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency, lineCount: Number(row.line_count), ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString() })),
      ];
      const page = this.page(candidates, request), summary = summaryFrom(nativeSummary.rows[0], legacySummary.rows[0]);
      return { totalMatching: summary.itemCount, summary, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), items: page.items.map(({ id: _id, customer_display_name: _customer, selling_total_cents: _total, requested_due_date: _due, updated_at: _updated, cursor_updated_at: _cursor, ...item }) => item) };
    });
  }

  async listOrdersForWorkspace(organizationId: OrganizationId, request: SalesWorkspacePageRequest): Promise<SalesWorkspacePage<OrderListItem>> {
    return this.read(async (client) => {
      const sort = sortFor(request.sort), direction = directionFor(sort), operator = operatorFor(sort), cursor = cursorFor(request);
      const search = request.search?.trim() || null, lifecycle = request.lifecycle ?? null, dueFrom = request.dueFrom || null, dueTo = request.dueTo || null;
      const parameters = [organizationId, search, lifecycle, dueFrom, dueTo, cursor?.updatedAt ?? null, cursor?.source ?? null, cursor?.id ?? null, limitFor(request.limit) + 1];
      type NativeRow = Common & { invoice_id: string | null; invoice_total_cents: string | null; route_count: string; purchase_order_number: string | null; line_count: string };
      type LegacyRow = Common & { status: string; state: string; canonical_state: string | null; fulfillment_status: string; payment_status: string; production_open: string; balance_due_cents: string; po_number: string | null; line_count: string };
      const [native, legacy, nativeSummary, legacySummary] = await Promise.all([
        client.query<NativeRow>(`SELECT 'v2' source,d.id,d.display_number number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_display_name,o.commercial_state lifecycle,COALESCE((SELECT SUM(l.selling_line_cents) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id),0)::text selling_total_cents,d.currency,d.requested_due_date::text,d.updated_at,to_char(d.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_updated_at,invoice.id invoice_id,invoice.total_cents::text invoice_total_cents,(SELECT count(*) FROM v2_route_instances r WHERE r.organization_id=d.organization_id AND r.order_document_id=d.id)::text route_count,d.purchase_order_number,(SELECT count(*) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id)::text line_count FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id LEFT JOIN v2_billing_invoices invoice ON invoice.organization_id=d.organization_id AND invoice.sales_order_document_id=d.id AND invoice.invoice_state='draft' WHERE d.organization_id=$1 AND d.document_kind='order' AND ($2::text IS NULL OR d.display_number ILIKE '%'||$2||'%' OR COALESCE(d.purchase_order_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR o.commercial_state=$3) AND ($4::date IS NULL OR d.requested_due_date >= $4::date) AND ($5::date IS NULL OR d.requested_due_date <= $5::date) AND ($6::timestamptz IS NULL OR (d.updated_at,'v2'::text,d.id::text) ${operator} ($6::timestamptz,$7::text,$8::text)) ORDER BY d.updated_at ${direction},d.id ${direction} LIMIT $9`, parameters),
        client.query<LegacyRow>(`SELECT 'legacy' source,o.id,COALESCE(o.display_number,o.order_number) number,COALESCE(c.display_name,c.company_name,o.bill_to_name,'Customer unavailable') customer_display_name,COALESCE(o.canonical_state::text,o.state::text,o.status::text) lifecycle,ROUND(COALESCE(o.total,0)*100)::bigint::text selling_total_cents,'USD' currency,o.requested_due_date::text,(COALESCE(o.updated_at,o.created_at,timestamp '1970-01-01 00:00:00') AT TIME ZONE 'UTC') updated_at,to_char(COALESCE(o.updated_at,o.created_at,timestamp '1970-01-01 00:00:00'),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_updated_at,o.status::text status,o.state::text state,o.canonical_state::text canonical_state,o.fulfillment_status::text fulfillment_status,o.payment_status::text payment_status,(SELECT count(*) FROM production_jobs p WHERE p.organization_id=o.organization_id AND p.order_id=o.id AND COALESCE(p.status::text,'') NOT IN ('completed','canceled'))::text production_open,COALESCE((SELECT ROUND(SUM(i.balance_due)*100)::bigint FROM invoices i WHERE i.organization_id=o.organization_id AND i.order_id=o.id),0)::text balance_due_cents,o.po_number,(SELECT count(*) FROM order_line_items l WHERE l.order_id=o.id)::text line_count FROM orders o LEFT JOIN customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id WHERE o.organization_id=$1 AND ($2::text IS NULL OR COALESCE(o.display_number,o.order_number) ILIKE '%'||$2||'%' OR COALESCE(o.po_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,o.bill_to_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR COALESCE(o.canonical_state::text,o.state::text,o.status::text)=$3) AND ($4::date IS NULL OR o.requested_due_date >= $4::date) AND ($5::date IS NULL OR o.requested_due_date <= $5::date) AND ($6::timestamptz IS NULL OR ((COALESCE(o.updated_at,o.created_at,timestamp '1970-01-01 00:00:00') AT TIME ZONE 'UTC'),'legacy'::text,o.id::text) ${operator} ($6::timestamptz,$7::text,$8::text)) ORDER BY COALESCE(o.updated_at,o.created_at,timestamp '1970-01-01 00:00:00') ${direction},o.id ${direction} LIMIT $9`, parameters),
        client.query<SummaryRow>(`SELECT count(*)::text item_count,COALESCE(SUM((SELECT COALESCE(SUM(l.selling_line_cents),0) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id)),0)::text selling_total_cents,count(DISTINCT d.currency)::text currency_count,min(d.currency) currency FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id WHERE d.organization_id=$1 AND d.document_kind='order' AND ($2::text IS NULL OR d.display_number ILIKE '%'||$2||'%' OR COALESCE(d.purchase_order_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR o.commercial_state=$3) AND ($4::date IS NULL OR d.requested_due_date >= $4::date) AND ($5::date IS NULL OR d.requested_due_date <= $5::date)`, parameters.slice(0, 5)),
        client.query<SummaryRow>(`SELECT count(*)::text item_count,COALESCE(SUM(ROUND(COALESCE(o.total,0)*100)::bigint),0)::text selling_total_cents,CASE WHEN count(*)=0 THEN '0' ELSE '1' END currency_count,CASE WHEN count(*)=0 THEN NULL ELSE 'USD' END currency FROM orders o LEFT JOIN customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id WHERE o.organization_id=$1 AND ($2::text IS NULL OR COALESCE(o.display_number,o.order_number) ILIKE '%'||$2||'%' OR COALESCE(o.po_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,o.bill_to_name,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR COALESCE(o.canonical_state::text,o.state::text,o.status::text)=$3) AND ($4::date IS NULL OR o.requested_due_date >= $4::date) AND ($5::date IS NULL OR o.requested_due_date <= $5::date)`, parameters.slice(0, 5)),
      ]);
      const candidates: (OrderListItem & Common)[] = [
        ...native.rows.map((row) => ({ ...row, source: "v2" as const, recordId: row.id, orderId: brandedId<"OrderId">(row.id), number: row.number, customerDisplayName: row.customer_display_name, lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency, ...(row.purchase_order_number ? { purchaseOrderNumber: row.purchase_order_number } : {}), lineCount: Number(row.line_count), ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(), ...(row.invoice_id ? { draftInvoice: { invoiceId: brandedId<"InvoiceId">(row.invoice_id), lifecycle: "draft" as const, totalCents: Number(row.invoice_total_cents) } } : {}), routing: Number(row.route_count) > 0 ? "routed" as const : "no_route" as const })),
        ...legacy.rows.map((row) => ({ ...row, source: "legacy" as const, recordId: row.id, orderId: brandedId<"OrderId">(row.id), number: row.number, customerDisplayName: row.customer_display_name, lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency, ...(row.po_number ? { purchaseOrderNumber: row.po_number } : {}), lineCount: Number(row.line_count), ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(), routing: "no_route" as const, activeRecordClassification: classifyLegacyOrder(row) })),
      ];
      const page = this.page(candidates, request), summary = summaryFrom(nativeSummary.rows[0], legacySummary.rows[0]);
      return { totalMatching: summary.itemCount, summary, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), items: page.items.map(({ id: _id, customer_display_name: _customer, selling_total_cents: _total, requested_due_date: _due, updated_at: _updated, cursor_updated_at: _cursor, ...item }) => item) };
    });
  }

  async listOrders(organizationId: OrganizationId, request: SalesWorkspacePageRequest): Promise<SalesWorkspacePage<OrderListItem>> { return this.listOrdersForWorkspace(organizationId, request); }

  async readLegacyQuote(organizationId: OrganizationId, recordId: string): Promise<LegacyCommercialDetail | null> {
    return this.read(async (client) => {
      const result = await client.query<Omit<Common, "cursor_updated_at">>(`SELECT 'legacy' source,q.id,COALESCE(q.display_number,'Q-'||q.quote_number::text) number,COALESCE(c.display_name,c.company_name,q.customer_name,'Customer unavailable') customer_display_name,q.status lifecycle,ROUND(COALESCE(q.total_price,0)*100)::bigint::text selling_total_cents,'USD' currency,q.requested_due_date::text,(COALESCE(q.created_at,timestamp '1970-01-01 00:00:00') AT TIME ZONE 'UTC') updated_at FROM quotes q LEFT JOIN customers c ON c.organization_id=q.organization_id AND c.id=q.customer_id WHERE q.organization_id=$1 AND q.id=$2`, [organizationId, recordId]);
      const row = result.rows[0];
      return row ? { source: "legacy", recordId: row.id, number: row.number, customerDisplayName: row.customer_display_name, lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency, ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(), readOnly: true } : null;
    });
  }

  async readLegacyOrder(organizationId: OrganizationId, recordId: string): Promise<LegacyCommercialDetail | null> {
    return this.read(async (client) => {
      type Row = Omit<Common, "cursor_updated_at"> & { status: string; state: string; canonical_state: string | null; fulfillment_status: string; payment_status: string; production_open: string; balance_due_cents: string };
      const result = await client.query<Row>(`SELECT 'legacy' source,o.id,COALESCE(o.display_number,o.order_number) number,COALESCE(c.display_name,c.company_name,o.bill_to_name,'Customer unavailable') customer_display_name,COALESCE(o.canonical_state,o.state,o.status) lifecycle,ROUND(COALESCE(o.total,0)*100)::bigint::text selling_total_cents,'USD' currency,o.requested_due_date::text,(COALESCE(o.updated_at,o.created_at,timestamp '1970-01-01 00:00:00') AT TIME ZONE 'UTC') updated_at,o.status,o.state,o.canonical_state,o.fulfillment_status,o.payment_status,(SELECT count(*) FROM production_jobs p WHERE p.organization_id=o.organization_id AND p.order_id=o.id AND COALESCE(p.status,'') NOT IN ('completed','canceled'))::text production_open,COALESCE((SELECT ROUND(SUM(i.balance_due)*100)::bigint FROM invoices i WHERE i.organization_id=o.organization_id AND i.order_id=o.id),0)::text balance_due_cents FROM orders o LEFT JOIN customers c ON c.organization_id=o.organization_id AND c.id=o.customer_id WHERE o.organization_id=$1 AND o.id=$2`, [organizationId, recordId]);
      const row = result.rows[0];
      return row ? { source: "legacy", recordId: row.id, number: row.number, customerDisplayName: row.customer_display_name, lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency, ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(), readOnly: true, activeRecordClassification: classifyLegacyOrder(row) } : null;
    });
  }
}
