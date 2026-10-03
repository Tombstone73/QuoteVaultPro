import type { Pool } from "pg";
import { PDFDocument } from "pdf-lib";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { DraftInvoiceReadModel, IssuedInvoiceCheckpoint } from "../../src/modules/billing/contracts.js";
import { type InvoiceId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
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
    const invoice = await this.invoice(organizationId, invoiceId);
    const issued = invoice.issuedCheckpoint ?? (invoice.issuedAt ? (await this.pool.query<{checkpoint_json:IssuedInvoiceCheckpoint}>("SELECT checkpoint_json FROM v2_billing_invoice_checkpoints WHERE organization_id=$1 AND invoice_id=$2", [organizationId,invoiceId])).rows[0]?.checkpoint_json : undefined);
    if ((invoice.lifecycle === "issued" || invoice.issuedAt) && !issued) throw new V2ApplicationError("CONFLICT", "Issued Invoice checkpoint is unavailable.");
    if (issued && (!text(issued.organizationPresentation?.name) || !text(issued.invoiceNumber)
      || !issued.customerPresentation || !text(issued.customerPresentation.customerDisplayName ?? issued.customerPresentation.companyName ?? issued.customerPresentation.contactDisplayName)
      || !Number.isFinite(Date.parse(issued.occurredAt)))) throw new V2ApplicationError("CONFLICT", "Historical Invoice presentation is unavailable. Current identity, branding, numbering and dates cannot replace issued evidence.");
    const documentBranding = issued ? issued.organizationPresentation! : await readTenantBranding(this.pool, organizationId);
    const source = issued ? {
      customer: issued.customerPresentation.customerDisplayName ?? issued.customerPresentation.companyName ?? "Customer", contact: issued.customerPresentation.contactDisplayName, address: issued.customerPresentation.billingAddress,
      po: issued.commercial.purchaseOrderNumber, terms: issued.commercial.termsCode, lines: issued.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unitAmount.cents, total: line.lineAmount.cents })),
      subtotal: issued.commercial.subtotal.cents, adjustment: issued.commercial.salesAdjustment?.amount.cents ?? 0, adjustmentReason: issued.commercial.salesAdjustment?.reason, tax: issued.commercial.taxTotal.cents, total: issued.commercial.total.cents, currency: issued.commercial.currency, date: issued.occurredAt.slice(0, 10),
    } : {
      customer: invoice.customerPresentation?.customerDisplayName ?? invoice.customerPresentation?.companyName ?? "Customer", contact: invoice.customerPresentation?.contactDisplayName, address: invoice.customerPresentation?.billingAddress,
      po: invoice.purchaseOrderNumber, terms: invoice.termsCode, lines: invoice.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.sellingUnitAmount.cents, total: line.lineAmount.cents })),
      subtotal: invoice.subtotal.cents, adjustment: invoice.salesAdjustment?.amount.cents ?? 0, adjustmentReason: invoice.salesAdjustment?.reason, tax: invoice.taxTotal.cents, total: invoice.total.cents, currency: invoice.currency, date: invoice.createdAt.slice(0, 10),
    };
    const settlement = !issued && invoice.lifecycle !== "void" ? await this.pool.query<SettlementRow>(`SELECT COALESCE((SELECT sum(amount_cents) FROM v2_billing_payment_allocations WHERE organization_id=$1 AND invoice_id=$2),0)::text paid,COALESCE((SELECT sum(e.amount_cents) FROM v2_billing_refund_allocation_evidence e WHERE e.organization_id=$1 AND e.invoice_id=$2),0)::text refunded`, [organizationId, invoiceId]) : undefined;
    const paid = Number(settlement?.rows[0]?.paid ?? 0);
    const refunded = Number(settlement?.rows[0]?.refunded ?? 0);
    const balance = source.total - paid + refunded;
    const invoiceNumber = issued ? issued.invoiceNumber! : invoice.invoiceNumber ?? invoice.sourceOrderNumber ?? "Invoice";
    const orderBacked = invoice.lifecycle === "draft";
    return { kind: "invoice", title: `Invoice · ${invoiceNumber}`, number: invoiceNumber, issuedAt: source.date, organization: documentBranding, sections: [
      { heading: "Bill to", entries: [{ label: "Customer", value: source.customer }, ...(text(source.contact) ? [{ label: "Contact", value: text(source.contact)! }] : []), ...(source.address ? [{ label: "Billing address", value: [...source.address.lines, source.address.city, source.address.region, source.address.postalCode, source.address.countryCode].filter((part): part is string => Boolean(text(part))).join(", ") }] : []), ...(text(source.po) ? [{ label: "Customer PO", value: text(source.po)! }] : []), ...(text(source.terms) ? [{ label: "Terms", value: text(source.terms)! }] : []), ...(!issued ? [{ label: "Order", value: invoice.sourceOrderNumber ?? "Unavailable" }] : [])] },
      { heading: "Items", entries: source.lines.map((line) => ({ value: `${line.description} · Qty ${line.quantity} · ${money(source.currency, line.unit)} each · ${money(source.currency, line.total)}` })) },
      { heading: "Totals", entries: [{ label: "Subtotal", value: money(source.currency, source.subtotal) }, ...(source.adjustment ? [{ label: source.adjustmentReason ? `Adjustment (${source.adjustmentReason})` : "Adjustment", value: money(source.currency, source.adjustment) }] : []), { label: "Tax", value: money(source.currency, source.tax) }, { label: "Invoice total", value: money(source.currency, source.total) }, ...(!issued && invoice.lifecycle !== "void" ? [{ label: "Paid (current)", value: money(source.currency, paid) }, ...(refunded ? [{ label: "Refunded (current)", value: money(source.currency, refunded) }] : []), { label: balance < 0 ? "Credit / refund due (current)" : "Balance due (current)", value: money(source.currency, balance) }] : [])] },
      ...((text(documentBranding.paymentInstructions) || text(documentBranding.checksPayableTo) || text(documentBranding.remittanceAddress)) ? [{ heading: "Payment and remittance", entries: [...(text(documentBranding.paymentInstructions) ? [{ value: text(documentBranding.paymentInstructions)! }] : []), ...(text(documentBranding.checksPayableTo) ? [{ label: "Checks payable to", value: text(documentBranding.checksPayableTo)! }] : []), ...(text(documentBranding.remittanceAddress) ? [{ label: "Remittance address", value: text(documentBranding.remittanceAddress)! }] : [])] }] : []),
      ...(issued ? [{ heading: "Issued record", entries: [{ value: "Historical Invoice as issued. Later payments, refunds, credits and revisions are not included. View the current Invoice separately for its current balance." }] }] : orderBacked ? [{ heading: "Order-backed status", entries: [{ value: "This payable Invoice follows the current canonical Order commercial projection. Payments and Refunds remain immutable financial facts." }] }] : []),
    ] };
  }
  async pdf(organizationId: OrganizationId, invoiceId: InvoiceId) {
    const document = await this.document(organizationId, invoiceId);
    const bytes = await renderOwnerPdf(document);
    if (!document.sections.some((section) => section.heading === "Issued record")) return bytes;
    // Stable metadata makes this renderer deterministic. It does not recover
    // unarchived original bytes or pin a template across future code changes.
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const issuedDate = new Date(`${document.issuedAt}T00:00:00.000Z`);
    pdf.setCreationDate(issuedDate);
    pdf.setModificationDate(issuedDate);
    return pdf.save();
  }
  async filename(organizationId: OrganizationId, invoiceId: InvoiceId) { return ownerDocumentFilename(await this.document(organizationId, invoiceId)); }
}
