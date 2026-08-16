import type { Pool, PoolClient } from "pg";
import {
  brandedId,
  type OrganizationId,
} from "../../src/modules/shared/commercialValues.js";
import type {
  OrderListItem,
  QuoteListItem,
  SalesWorkspacePage,
  SalesWorkspacePageRequest,
  SalesWorkspaceReadPort,
} from "../../src/modules/sales/workspaceReads.js";

type Cursor = Readonly<{ updatedAt: string; id: string }>;
const boundedLimit = (value: number | undefined): number =>
  Number.isInteger(value) ? Math.max(1, Math.min(value!, 50)) : 25;
const decodeCursor = (value: string | undefined): Cursor | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return typeof parsed.updatedAt === "string" && typeof parsed.id === "string" ? parsed : undefined;
  } catch { return undefined; }
};
const encodeCursor = (value: Cursor): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const page = <T extends { updatedAt: string; quoteId?: string; orderId?: string }>(items: readonly T[], limit: number): SalesWorkspacePage<T> => {
  const visible = items.slice(0, limit);
  const last = visible.at(-1);
  const id = last?.quoteId ?? last?.orderId;
  return {
    items: visible,
    ...(items.length > limit && last && id ? { nextCursor: encodeCursor({ updatedAt: last.updatedAt, id }) } : {}),
  };
};

/** PostgreSQL implementation of the intentionally compact Sales workspace read boundary. */
export class PostgresSalesWorkspaceReads implements SalesWorkspaceReadPort {
  constructor(private readonly pool: Pool) {}

  private async read<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listQuotes(organizationId: OrganizationId, request: SalesWorkspacePageRequest): Promise<SalesWorkspacePage<QuoteListItem>> {
    return this.read(async (client) => {
      const limit = boundedLimit(request.limit), cursor = decodeCursor(request.cursor);
      const rows = await client.query<{
        id: string; display_number: string; customer_display_name: string; lifecycle: QuoteListItem["lifecycle"];
        selling_total_cents: string; currency: string; requested_due_date: string | null; updated_at: Date;
        order_id: string | null; order_number: string | null;
      }>(`
        SELECT d.id,d.display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') AS customer_display_name,
          CASE WHEN conversion.order_document_id IS NOT NULL THEN 'converted'
               WHEN q.acceptance_state='accepted' THEN 'accepted'
               WHEN q.delivery_state='sent' THEN 'sent' ELSE 'draft' END AS lifecycle,
          COALESCE((SELECT SUM(l.selling_line_cents) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id),0) AS selling_total_cents,
          d.currency,d.requested_due_date::text,d.updated_at,conversion.order_document_id AS order_id,converted.display_number AS order_number
        FROM v2_sales_documents d
        JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
        LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
        LEFT JOIN v2_sales_quote_conversions conversion ON conversion.organization_id=d.organization_id AND conversion.quote_document_id=d.id
        LEFT JOIN v2_sales_documents converted ON converted.organization_id=d.organization_id AND converted.id=conversion.order_document_id
        WHERE d.organization_id=$1 AND d.document_kind='quote'
          AND ($2::text IS NULL OR d.display_number ILIKE '%' || $2 || '%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR (CASE WHEN conversion.order_document_id IS NOT NULL THEN 'converted' WHEN q.acceptance_state='accepted' THEN 'accepted' WHEN q.delivery_state='sent' THEN 'sent' ELSE 'draft' END)=$3)
          AND ($4::timestamptz IS NULL OR (d.updated_at,d.id) < ($4::timestamptz,$5::text))
        ORDER BY d.updated_at DESC,d.id DESC LIMIT $6`,
        [organizationId, request.search?.trim() || null, request.lifecycle ?? null, cursor?.updatedAt ?? null, cursor?.id ?? null, limit + 1],
      );
      return page(rows.rows.map((row) => ({
        quoteId: brandedId<"QuoteId">(row.id), number: row.display_number, customerDisplayName: row.customer_display_name,
        lifecycle: row.lifecycle, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency,
        ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(),
        ...(row.order_id ? { convertedOrderId: brandedId<"OrderId">(row.order_id) } : {}),
        ...(row.order_number ? { convertedOrderNumber: row.order_number } : {}),
      })), limit);
    });
  }

  async listOrders(organizationId: OrganizationId, request: SalesWorkspacePageRequest): Promise<SalesWorkspacePage<OrderListItem>> {
    return this.read(async (client) => {
      const limit = boundedLimit(request.limit), cursor = decodeCursor(request.cursor);
      const rows = await client.query<{
        id: string; display_number: string; customer_display_name: string; commercial_state: "open" | "cancelled";
        selling_total_cents: string; currency: string; requested_due_date: string | null; updated_at: Date;
        invoice_id: string | null; invoice_total_cents: string | null; route_count: string;
      }>(`
        SELECT d.id,d.display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') AS customer_display_name,o.commercial_state,
          COALESCE((SELECT SUM(l.selling_line_cents) FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id),0) AS selling_total_cents,
          d.currency,d.requested_due_date::text,d.updated_at,invoice.id AS invoice_id,invoice.total_cents::text AS invoice_total_cents,
          (SELECT count(*) FROM v2_route_instances r WHERE r.organization_id=d.organization_id AND r.order_document_id=d.id)::text AS route_count
        FROM v2_sales_documents d
        JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id
        LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
        LEFT JOIN v2_billing_invoices invoice ON invoice.organization_id=d.organization_id AND invoice.sales_order_document_id=d.id AND invoice.invoice_state='draft'
        WHERE d.organization_id=$1 AND d.document_kind='order'
          AND ($2::text IS NULL OR d.display_number ILIKE '%' || $2 || '%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR o.commercial_state=$3)
          AND ($4::timestamptz IS NULL OR (d.updated_at,d.id) < ($4::timestamptz,$5::text))
        ORDER BY d.updated_at DESC,d.id DESC LIMIT $6`,
        [organizationId, request.search?.trim() || null, request.lifecycle ?? null, cursor?.updatedAt ?? null, cursor?.id ?? null, limit + 1],
      );
      return page(rows.rows.map((row) => ({
        orderId: brandedId<"OrderId">(row.id), number: row.display_number, customerDisplayName: row.customer_display_name,
        lifecycle: row.commercial_state, sellingTotalCents: Number(row.selling_total_cents), currency: row.currency,
        ...(row.requested_due_date ? { requestedDueDate: row.requested_due_date } : {}), updatedAt: row.updated_at.toISOString(),
        ...(row.invoice_id ? { draftInvoice: { invoiceId: brandedId<"InvoiceId">(row.invoice_id), lifecycle: "draft" as const, totalCents: Number(row.invoice_total_cents) } } : {}),
        routing: Number(row.route_count) > 0 ? "routed" : "no_route",
      })), limit);
    });
  }
}
