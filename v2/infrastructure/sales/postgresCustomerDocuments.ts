import type { Pool, PoolClient } from "pg";
import { salesConfigurationPresentation } from "../../src/modules/sales/configurationPresentation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrganizationId, OrderId, QuoteId } from "../../src/modules/shared/commercialValues.js";
import { renderCustomerSalesPdf, type CustomerSalesDocument } from "./customerDocumentRenderer.js";

type HeaderRow = { id: string; display_number: string; currency: string; purchase_order_number: string | null; requested_due_date: Date | null; commercial_notes: string | null; customer_name: string | null; customer_email: string | null; contact_id: string | null; contact_exists: string | null; contact_name: string | null; contact_email: string | null; requested_fulfillment_method: string | null; selling_adjustment_cents: string; selling_adjustment_reason: string | null; commercial_charge: unknown; tax_composition: unknown; delivery_state?: "not_sent" | "sent"; };
type LineRow = { description: string; quantity: number; selling_unit_cents: string; selling_line_cents: string; resolved_configuration: unknown };
type BrandingRow = { name: string; address: string | null; phone: string | null; email: string | null; website: string | null };
type CheckpointRow = { payload: unknown; occurred_at: Date };
type AnyRecord = Record<string, unknown>;
const record = (value: unknown): AnyRecord => value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
const integer = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : 0;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const date = (value: Date | null | undefined): string => value ? value.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

/**
 * Tenant-scoped projection only. It is shared by HTTP download/preview and
 * email attachment creation; neither caller sees raw storage identifiers or
 * mutable Product internals.
 */
export class PostgresCustomerDocumentService {
  constructor(private readonly pool: Pool) {}

  async quote(organizationId: OrganizationId, quoteId: QuoteId): Promise<CustomerSalesDocument> {
    return this.quoteFrom(this.pool, organizationId, quoteId);
  }
  /** Builds the attachment from rows held by the delivery-preparation
   * transaction, so its tax evidence is the exact composition being frozen. */
  async quoteInTransaction(client: PoolClient, organizationId: OrganizationId, quoteId: QuoteId): Promise<CustomerSalesDocument> {
    return this.quoteFrom(client, organizationId, quoteId);
  }
  private async quoteFrom(queryable: Pool | PoolClient, organizationId: OrganizationId, quoteId: QuoteId): Promise<CustomerSalesDocument> {
    const [header, branding, sent] = await Promise.all([
      this.quoteHeader(queryable, organizationId, quoteId), this.branding(queryable, organizationId),
      queryable.query<CheckpointRow>("SELECT payload,occurred_at FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2 AND checkpoint_kind='quote_sent' ORDER BY checkpoint_sequence DESC LIMIT 1", [organizationId, quoteId]),
    ]);
    if (!header) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
    if (sent.rows[0]) return this.fromCheckpoint("quote", header, branding, sent.rows[0]);
    const lines = await this.lines(queryable, organizationId, quoteId);
    return this.current("quote", header, branding, lines);
  }

  async order(organizationId: OrganizationId, orderId: OrderId): Promise<CustomerSalesDocument> {
    const [header, branding, lines] = await Promise.all([this.orderHeader(this.pool, organizationId, orderId), this.branding(this.pool, organizationId), this.lines(this.pool, organizationId, orderId)]);
    if (!header) throw new V2ApplicationError("NOT_FOUND", "Order was not found.");
    return this.current("order", header, branding, lines);
  }

  async quotePdf(organizationId: OrganizationId, quoteId: QuoteId): Promise<Uint8Array> { return renderCustomerSalesPdf(await this.quote(organizationId, quoteId)); }
  async orderPdf(organizationId: OrganizationId, orderId: OrderId): Promise<Uint8Array> { return renderCustomerSalesPdf(await this.order(organizationId, orderId)); }
  /** Quote delivery intentionally does not fall back to a different Customer
   * address. A Quote Contact is the explicit recipient selection. */
  async quoteRecipient(organizationId: OrganizationId, quoteId: QuoteId): Promise<string | undefined> {
    return this.quoteRecipientFrom(this.pool, organizationId, quoteId);
  }
  async quoteRecipientInTransaction(client: PoolClient, organizationId: OrganizationId, quoteId: QuoteId): Promise<string | undefined> {
    return this.quoteRecipientFrom(client, organizationId, quoteId);
  }
  async quoteRecipientReadiness(organizationId: OrganizationId, quoteId: QuoteId): Promise<Readonly<{ status: "ready" | "contact_missing" | "email_missing" | "contact_unavailable"; email?: string }>> {
    const header = await this.quoteHeader(this.pool, organizationId, quoteId);
    if (!header) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
    if (!header.contact_id) return { status: "contact_missing" };
    if (!header.contact_exists) return { status: "contact_unavailable" };
    const recipient = text(header.contact_email);
    return recipient ? { status: "ready", email: recipient } : { status: "email_missing" };
  }
  private async quoteRecipientFrom(queryable: Pool | PoolClient, organizationId: OrganizationId, quoteId: QuoteId): Promise<string | undefined> {
    const header = await this.quoteHeader(queryable, organizationId, quoteId);
    if (!header) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
    return text(header.contact_email);
  }

  private async branding(queryable: Pool | PoolClient, organizationId: OrganizationId): Promise<BrandingRow> {
    const result = await queryable.query<BrandingRow>("SELECT COALESCE(NULLIF(btrim(cs.company_display_name),''),NULLIF(btrim(cs.company_name),''),o.name) name,cs.address,cs.phone,cs.email,cs.website FROM organizations o LEFT JOIN company_settings cs ON cs.organization_id=o.id WHERE o.id=$1", [organizationId]);
    const row = result.rows[0];
    if (!row) throw new V2ApplicationError("NOT_FOUND", "Organization was not found.");
    return row;
  }

  private quoteHeader(queryable: Pool | PoolClient, organizationId: OrganizationId, quoteId: QuoteId): Promise<HeaderRow | null> { return this.header(queryable, organizationId, quoteId, "quote"); }
  private orderHeader(queryable: Pool | PoolClient, organizationId: OrganizationId, orderId: OrderId): Promise<HeaderRow | null> { return this.header(queryable, organizationId, orderId, "order"); }
  private async header(queryable: Pool | PoolClient, organizationId: OrganizationId, documentId: string, kind: "quote" | "order"): Promise<HeaderRow | null> {
    const detail = kind === "quote" ? "v2_sales_quote_details" : "v2_sales_order_details";
    const result = await queryable.query<HeaderRow>(`SELECT d.id,d.display_number,d.currency,d.purchase_order_number,d.requested_due_date,d.commercial_notes,COALESCE(c.display_name,c.company_name) customer_name,c.email customer_email,d.contact_id,ct.id contact_exists,trim(concat_ws(' ',ct.first_name,ct.last_name)) contact_name,ct.email contact_email,x.requested_fulfillment_method,x.selling_adjustment_cents,x.selling_adjustment_reason,x.commercial_charge,x.tax_composition${kind === "quote" ? ",x.delivery_state" : ""} FROM v2_sales_documents d JOIN ${detail} x ON x.organization_id=d.organization_id AND x.document_id=d.id LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id LEFT JOIN customer_contacts ct ON ct.organization_id=d.organization_id AND ct.id=d.contact_id WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind=$3`, [organizationId, documentId, kind]);
    return result.rows[0] ?? null;
  }
  private async lines(queryable: Pool | PoolClient, organizationId: OrganizationId, documentId: string): Promise<readonly LineRow[]> {
    return (await queryable.query<LineRow>("SELECT description,quantity,selling_unit_cents,selling_line_cents,resolved_configuration FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY position", [organizationId, documentId])).rows;
  }
  private current(kind: "quote" | "order", header: HeaderRow, branding: BrandingRow, lines: readonly LineRow[]): CustomerSalesDocument {
    const tax = record(header.tax_composition); const charge = record(header.commercial_charge);
    if (tax.status === "unresolved") throw new V2ApplicationError("CONFLICT", "A customer document requires resolved authoritative tax.");
    const lineSubtotalCents = lines.reduce((sum, line) => sum + integer(line.selling_line_cents), 0);
    const adjustmentCents = integer(header.selling_adjustment_cents);
    const chargeCents = integer(charge.cents);
    // Pre-0228 V2 documents deliberately retain their existing zero-tax
    // compatibility semantics. This is a server projection of frozen line
    // facts, not arithmetic performed by the PDF template.
    const taxCents = integer(tax.taxCents);
    const totalCents = text(tax.status) === "resolved"
      ? integer(tax.finalTotalCents)
      : lineSubtotalCents + adjustmentCents + chargeCents;
    return {
      kind, number: header.display_number, issuedAt: date(undefined), organization: { name: branding.name, ...(text(branding.address) ? { address: branding.address! } : {}), ...(text(branding.phone) ? { phone: branding.phone! } : {}), ...(text(branding.email) ? { email: branding.email! } : {}), ...(text(branding.website) ? { website: branding.website! } : {}) },
      customer: { displayName: header.customer_name ?? "Customer", ...(text(header.contact_name) ? { contactName: header.contact_name! } : {}), ...(text(header.contact_email) || text(header.customer_email) ? { email: text(header.contact_email) ?? text(header.customer_email)! } : {}), ...(text(header.purchase_order_number) ? { purchaseOrderNumber: header.purchase_order_number! } : {}), ...(header.requested_due_date ? { requestedDueDate: date(header.requested_due_date) } : {}) },
      lines: lines.map((line) => ({ description: line.description, quantity: line.quantity, configuration: salesConfigurationPresentation(record(line.resolved_configuration)), unitCents: integer(line.selling_unit_cents), totalCents: integer(line.selling_line_cents) })),
      currency: header.currency, lineSubtotalCents, adjustmentCents, ...(text(header.selling_adjustment_reason) ? { adjustmentReason: header.selling_adjustment_reason! } : {}), chargeCents, ...(text(charge.description) || text(charge.kind) ? { chargeLabel: text(charge.description) ?? text(charge.kind)! } : {}), taxCents, totalCents, ...(text(header.requested_fulfillment_method) ? { fulfillment: header.requested_fulfillment_method! } : {}), ...(text(header.commercial_notes) ? { notes: header.commercial_notes! } : {}),
    };
  }
  private fromCheckpoint(kind: "quote", header: HeaderRow, branding: BrandingRow, checkpoint: CheckpointRow): CustomerSalesDocument {
    const payload = record(checkpoint.payload); const commercial = record(payload.commercial); const presentation = record(payload.customerPresentation); const tax = record(commercial.taxComposition); const adjustment = record(commercial.sellingAdjustment); const charge = record(commercial.commercialCharge);
    if (tax.status === "unresolved") throw new V2ApplicationError("CONFLICT", "A customer document requires resolved authoritative tax.");
    const rawLines = Array.isArray(commercial.lines) ? commercial.lines : [];
    const lines = rawLines.map((entry) => { const line = record(entry); const decision = record(line.sellingPriceDecision); return { description: text(line.description) ?? "Line item", quantity: integer(line.quantity), configuration: salesConfigurationPresentation(record(line.resolvedConfiguration)), unitCents: integer(record(decision.resultingUnitAmount).cents), totalCents: integer(record(line.sellingLineAmount).cents) }; });
    const lineSubtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
    const adjustmentCents = integer(adjustment.cents);
    const chargeCents = integer(charge.cents);
    const taxCents = integer(tax.taxCents);
    const totalCents = text(tax.status) === "resolved" ? integer(tax.finalTotalCents) : lineSubtotalCents + adjustmentCents + chargeCents;
    return { kind, number: header.display_number, issuedAt: date(checkpoint.occurred_at), organization: { name: branding.name, ...(text(branding.address) ? { address: branding.address! } : {}), ...(text(branding.phone) ? { phone: branding.phone! } : {}), ...(text(branding.email) ? { email: branding.email! } : {}), ...(text(branding.website) ? { website: branding.website! } : {}) }, customer: { displayName: text(presentation.customerDisplayName) ?? text(presentation.companyName) ?? "Customer", ...(text(presentation.contactDisplayName) ? { contactName: text(presentation.contactDisplayName)! } : {}), ...(text(presentation.email) ? { email: text(presentation.email)! } : {}), ...(text(commercial.purchaseOrderNumber) ? { purchaseOrderNumber: text(commercial.purchaseOrderNumber)! } : {}), ...(text(commercial.requestedDueDate) ? { requestedDueDate: text(commercial.requestedDueDate)! } : {}) }, lines, currency: text(commercial.currency) ?? header.currency, lineSubtotalCents, adjustmentCents, ...(text(adjustment.reason) ? { adjustmentReason: text(adjustment.reason)! } : {}), chargeCents, ...(text(charge.description) || text(charge.kind) ? { chargeLabel: text(charge.description) ?? text(charge.kind)! } : {}), taxCents, totalCents, ...(text(record(commercial.requestedFulfillment).method) ? { fulfillment: text(record(commercial.requestedFulfillment).method)! } : {}), ...(text(record(commercial.terms).commercialNotes) ? { notes: text(record(commercial.terms).commercialNotes)! } : {}) };
  }
}
