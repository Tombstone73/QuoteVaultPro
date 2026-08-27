import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * The renderer is intentionally a presentation-only infrastructure adapter.
 * Sales supplies already-authoritative integer-cent totals; this module never
 * calculates price, tax, or configuration truth.
 */
export type CustomerSalesDocument = Readonly<{
  kind: "quote" | "order";
  number: string;
  issuedAt: string;
  organization: Readonly<{ name: string; address?: string; phone?: string; email?: string; website?: string }>;
  customer: Readonly<{ displayName: string; contactName?: string; email?: string; purchaseOrderNumber?: string; requestedDueDate?: string }>;
  lines: readonly (Readonly<{ description: string; quantity: number; configuration: string; unitCents: number; totalCents: number }>)[];
  currency: string;
  lineSubtotalCents: number;
  adjustmentCents: number;
  adjustmentReason?: string;
  chargeCents: number;
  chargeLabel?: string;
  taxCents: number;
  totalCents: number;
  fulfillment?: string;
  notes?: string;
}>;

const money = (currency: string, cents: number): string => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const safe = (value: string): string => value.replace(/[\u0000-\u001f]/g, " ").trim();

export const customerDocumentFilename = (document: CustomerSalesDocument): string =>
  `${document.kind === "quote" ? "Quote" : "Order"}_${safe(document.number).replace(/[^a-z0-9._-]+/gi, "-") || "document"}.pdf`;

/** Visible customer output must never include an internal identity. */
export const assertCustomerDocumentSafe = (document: CustomerSalesDocument): CustomerSalesDocument => {
  const forbidden = /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b(?:opt|choice)_[\w-]+\b|\b\w*_import\w*\b)/iu;
  const visible = [
    document.number, document.organization.name, document.organization.address, document.organization.phone,
    document.organization.email, document.organization.website, document.customer.displayName,
    document.customer.contactName, document.customer.email, document.customer.purchaseOrderNumber,
    document.customer.requestedDueDate, document.fulfillment, document.notes,
    ...document.lines.flatMap((line) => [line.description, line.configuration]),
  ].filter((value): value is string => typeof value === "string");
  if (visible.some((value) => forbidden.test(value))) throw new Error("Customer document contains an internal identifier.");
  return document;
};

export const renderCustomerSalesPdf = async (input: CustomerSalesDocument): Promise<Uint8Array> => {
  const document = assertCustomerDocumentSafe(input);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 748;
  const write = (text: string, options: Readonly<{ bold?: boolean; size?: number; indent?: number; color?: [number, number, number] }> = {}) => {
    const size = options.size ?? 9;
    // A conservative fixed wrap is more reliable than layout arithmetic and
    // does not affect any commercial fact.
    const lines = safe(text).match(/.{1,84}(?:\s|$)|\S+?(?:\s|$)/g) ?? [safe(text)];
    for (const line of lines) {
      if (y < 54) { page = pdf.addPage([612, 792]); y = 748; }
      page.drawText(line.trim(), { x: 42 + (options.indent ?? 0), y, size, font: options.bold ? bold : regular, color: rgb(...(options.color ?? [0.1, 0.12, 0.16])) });
      y -= size + 4;
    }
  };
  write(document.organization.name || "Organization", { bold: true, size: 18 });
  for (const value of [document.organization.address, document.organization.phone, document.organization.email, document.organization.website]) if (value) write(value, { size: 8, color: [0.32, 0.35, 0.4] });
  y -= 10;
  write(`${document.kind === "quote" ? "QUOTE" : "ORDER"} ${document.number}`, { bold: true, size: 14 });
  write(`Date: ${document.issuedAt}`, { size: 9 });
  if (document.customer.requestedDueDate) write(`Requested due: ${document.customer.requestedDueDate}`, { size: 9 });
  if (document.customer.purchaseOrderNumber) write(`Customer PO: ${document.customer.purchaseOrderNumber}`, { size: 9 });
  y -= 7;
  write(`Customer: ${document.customer.displayName}`, { bold: true, size: 10 });
  if (document.customer.contactName) write(document.customer.contactName, { size: 9 });
  if (document.customer.email) write(document.customer.email, { size: 9 });
  if (document.fulfillment) write(`Fulfillment: ${document.fulfillment}`, { size: 9 });
  y -= 10;
  write("Items", { bold: true, size: 11 });
  for (const line of document.lines) {
    write(`${line.description}  •  Qty ${line.quantity}  •  ${money(document.currency, line.unitCents)} each  •  ${money(document.currency, line.totalCents)}`, { bold: true, size: 9 });
    write(line.configuration || "No additional configuration", { indent: 10, size: 8, color: [0.32, 0.35, 0.4] });
    y -= 3;
  }
  y -= 5;
  write(`Line subtotal: ${money(document.currency, document.lineSubtotalCents)}`, { size: 9 });
  if (document.adjustmentCents) write(`Adjustment${document.adjustmentReason ? ` (${document.adjustmentReason})` : ""}: ${money(document.currency, document.adjustmentCents)}`, { size: 9 });
  if (document.chargeCents) write(`${document.chargeLabel ?? "Commercial charge"}: ${money(document.currency, document.chargeCents)}`, { size: 9 });
  write(`Tax: ${money(document.currency, document.taxCents)}`, { size: 9 });
  write(`Total: ${money(document.currency, document.totalCents)}`, { bold: true, size: 12 });
  if (document.notes) { y -= 8; write("Notes", { bold: true, size: 10 }); write(document.notes, { size: 9 }); }
  return pdf.save();
};
