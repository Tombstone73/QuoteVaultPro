import type { Pool } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { DraftInvoiceReadModel } from "../../src/modules/billing/contracts.js";
import { currencyCode, type InvoiceId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { ownerDocumentFilename, renderOwnerPdf, type OwnerPdfDocument } from "../documents/ownerPdfRenderer.js";
import { readTenantBranding } from "../documents/postgresTenantBranding.js";
import { PostgresBillingReadRunner } from "./postgresBillingRead.js";

const money = (currency: string, cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const text = (value: string | undefined) => value?.trim() || undefined;
type SettlementRow = Readonly<{ paid: string; refunded: string }>;

/** Billing-owned PDF projection. Issued commercial/customer facts are read only from the immutable checkpoint. */
export class PostgresInvoiceDocumentService {
  constructor(private readonly pool: Pool) {}
  private async invoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<DraftInvoiceReadModel> {
    const value = await new PostgresBillingReadRunner(this.pool).read((port) => port.readInvoice(organizationId, invoiceId));
    if (!value) throw new V2ApplicationError("NOT_FOUND", "Invoice was not found.");
    return value;
  }
  async document(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<OwnerPdfDocument> {
    const [branding, invoice, settlement] = await Promise.all([
      readTenantBranding(this.pool, organizationId), this.invoice(organizationId, invoiceId),
      this.pool.query<SettlementRow>(`SELECT COALESCE((SELECT sum(amount_cents) FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2),0)::text paid,COALESCE((SELECT sum(amount_cents) FROM v2_billing_refunds WHERE organization_id=$1 AND invoice_id=$2),0)::text refunded`, [organizationId, invoiceId]),
    ]);
    const issued = invoice.lifecycle === "issued" ? invoice.issuedCheckpoint : undefined;
    if (invoice.lifecycle === "issued" && !issued) throw new V2ApplicationError("CONFLICT", "Issued Invoice checkpoint is unavailable.");
    const documentBranding = issued?.organizationPresentation ?? branding;
    const source = issued ? {
      customer: issued.customerPresentation.customerDisplayName ?? issued.customerPresentation.companyName ?? "Customer", contact: issued.customerPresentation.contactDisplayName,
      po: issued.commercial.purchaseOrderNumber, terms: issued.commercial.termsCode, lines: issued.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unitAmount.cents, total: line.lineAmount.cents })),
      subtotal: issued.commercial.subtotal.cents, adjustment: issued.commercial.salesAdjustment?.amount.cents ?? 0, adjustmentReason: issued.commercial.salesAdjustment?.reason, tax: issued.commercial.taxTotal.cents, total: issued.commercial.total.cents, currency: issued.commercial.currency, date: issued.occurredAt.slice(0, 10),
    } : {
      customer: invoice.customerPresentation?.customerDisplayName ?? invoice.customerPresentation?.companyName ?? "Customer", contact: invoice.customerPresentation?.contactDisplayName,
      po: invoice.purchaseOrderNumber, terms: invoice.termsCode, lines: invoice.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.sellingUnitAmount.cents, total: line.lineAmount.cents })),
      subtotal: invoice.subtotal.cents, adjustment: invoice.salesAdjustment?.amount.cents ?? 0, adjustmentReason: invoice.salesAdjustment?.reason, tax: invoice.taxTotal.cents, total: invoice.total.cents, currency: invoice.currency, date: invoice.createdAt.slice(0, 10),
    };
    const paid = Number(settlement.rows[0]?.paid ?? 0);
    const refunded = Number(settlement.rows[0]?.refunded ?? 0);
    const balance = source.total - paid + refunded;
    return { kind: "invoice", title: `${invoice.lifecycle === "draft" ? "Draft invoice" : "Invoice"} · ${invoice.sourceOrderNumber ?? "Order"}`, number: invoice.sourceOrderNumber ?? "Invoice", issuedAt: source.date, organization: documentBranding, sections: [
      { heading: "Bill to", entries: [{ label: "Customer", value: source.customer }, ...(text(source.contact) ? [{ label: "Contact", value: text(source.contact)! }] : []), ...(text(source.po) ? [{ label: "Customer PO", value: text(source.po)! }] : []), ...(text(source.terms) ? [{ label: "Terms", value: text(source.terms)! }] : []), { label: "Order", value: invoice.sourceOrderNumber ?? "Unavailable" }] },
      { heading: "Items", entries: source.lines.map((line) => ({ value: `${line.description} · Qty ${line.quantity} · ${money(source.currency, line.unit)} each · ${money(source.currency, line.total)}` })) },
      { heading: "Totals", entries: [{ label: "Subtotal", value: money(source.currency, source.subtotal) }, ...(source.adjustment ? [{ label: source.adjustmentReason ? `Adjustment (${source.adjustmentReason})` : "Adjustment", value: money(source.currency, source.adjustment) }] : []), { label: "Tax", value: money(source.currency, source.tax) }, { label: "Invoice total", value: money(source.currency, source.total) }, ...(invoice.lifecycle === "issued" ? [{ label: "Paid (current)", value: money(source.currency, paid) }, ...(refunded ? [{ label: "Refunded (current)", value: money(source.currency, refunded) }] : []), { label: "Balance due (current)", value: money(source.currency, balance) }] : [])] },
      ...((text(documentBranding.paymentInstructions) || text(documentBranding.checksPayableTo) || text(documentBranding.remittanceAddress)) ? [{ heading: "Payment and remittance", entries: [...(text(documentBranding.paymentInstructions) ? [{ value: text(documentBranding.paymentInstructions)! }] : []), ...(text(documentBranding.checksPayableTo) ? [{ label: "Checks payable to", value: text(documentBranding.checksPayableTo)! }] : []), ...(text(documentBranding.remittanceAddress) ? [{ label: "Remittance address", value: text(documentBranding.remittanceAddress)! }] : [])] }] : []),
      ...(issued ? [{ heading: "Issued record", entries: [{ value: "Commercial facts and customer presentation are preserved by Billing's immutable issued checkpoint." }] }] : [{ heading: "Draft status", entries: [{ value: "This Draft Invoice follows the current canonical Billing projection until issuance." }] }]),
    ] };
  }
  async pdf(organizationId: OrganizationId, invoiceId: InvoiceId) { return renderOwnerPdf(await this.document(organizationId, invoiceId)); }
  async filename(organizationId: OrganizationId, invoiceId: InvoiceId) { return ownerDocumentFilename(await this.document(organizationId, invoiceId)); }
}
