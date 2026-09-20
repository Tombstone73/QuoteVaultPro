import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CustomerStatement } from "../services/customerStatement.service";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** PDF is rendered solely from the statement projection/snapshot, never a second balance calculation. */
export async function generateCustomerStatementPdfBytes(statement: CustomerStatement): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 750;
  const text = (value: string, x: number, size = 10, isBold = false) => { page.drawText(value.slice(0, 120), { x, y, size, font: isBold ? bold : regular, color: rgb(0.1, 0.12, 0.16) }); };
  const next = (amount = 16) => { y -= amount; };
  const tableHeader = () => { text("Invoice", 42, 9, true); text("Issued", 120, 9, true); text("Due", 190, 9, true); text("PO / Job", 255, 9, true); text("Original", 400, 9, true); text("Paid", 464, 9, true); text("Balance", 522, 9, true); next(14); };
  text(statement.organization.companyName, 42, 18, true); text("CUSTOMER STATEMENT", 398, 12, true); next(22);
  text(statement.organization.address || "", 42, 9); text(`Statement date: ${statement.statementDate}`, 398, 9); next(16);
  text(statement.customer.companyName, 42, 12, true); text(`Balance Due: ${money(statement.summary.amountDueCents)}`, 382, 14, true); next(16);
  text(statement.customer.billingAddress || statement.customer.email || "", 42, 9); next(26);
  page.drawRectangle({ x: 42, y: y - 42, width: 528, height: 42, color: rgb(0.94, 0.96, 0.98) });
  text("Aging", 50, 10, true); text(`Current ${money(statement.summary.agingCents.current)}`, 118, 9); text(`1-30 ${money(statement.summary.agingCents.oneToThirty)}`, 225, 9); text(`31-60 ${money(statement.summary.agingCents.thirtyOneToSixty)}`, 325, 9); text(`61-90 ${money(statement.summary.agingCents.sixtyOneToNinety)}`, 430, 9); text(`90+ ${money(statement.summary.agingCents.ninetyPlus)}`, 520, 9); next(58);
  tableHeader();
  for (const item of statement.openItems) {
    if (y < 70) { page = pdf.addPage([612, 792]); y = 750; text(`${statement.organization.companyName} — Customer Statement`, 42, 12, true); next(24); tableHeader(); }
    text(item.invoiceNumber, 42, 8); text(item.issueDate || "—", 120, 8); text(item.dueDate || "—", 190, 8); text([item.poNumber, item.orderNumber ? `Job ${item.orderNumber}` : null].filter(Boolean).join(" · ") || "—", 255, 8); text(money(item.originalCents), 400, 8); text(money(item.paidCents), 464, 8); text(money(item.remainingCents), 522, 8, true); next(15);
  }
  next(8); text(`Open A/R: ${money(statement.summary.outstandingCents)}`, 42, 10, true);
  if (statement.summary.unappliedCreditCents) { text(`Unapplied customer credit: ${money(statement.summary.unappliedCreditCents)}`, 230, 10); }
  next(20); text("This statement reflects open approved receivables as of the statement date.", 42, 8);
  return pdf.save();
}
