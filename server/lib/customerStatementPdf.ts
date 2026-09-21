import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CustomerStatement } from "../services/customerStatement.service";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const customerStatementPdfColumns = {
  invoice: { x: 42, width: 66 }, issued: { x: 108, width: 56 }, due: { x: 164, width: 56 },
  poJob: { x: 220, width: 180 }, original: { x: 400, width: 58 }, paid: { x: 458, width: 56 }, balance: { x: 514, width: 56 },
} as const;

/** Breaks only at whitespace, keeping every rendered line inside its cell. */
export function wrapCustomerStatementPdfText(value: string, maxWidth: number, measure: (text: string) => number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export function customerStatementPdfFilename(statement: CustomerStatement): string {
  const customerName = statement.customer.companyName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "") || "Customer";
  return `${customerName}-Statement-${statement.statementDate}.pdf`;
}

/** PDF is rendered solely from the statement projection/snapshot, never a second balance calculation. */
export async function generateCustomerStatementPdfBytes(statement: CustomerStatement): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 750;
  const text = (value: string, x: number, size = 10, isBold = false) => { page.drawText(value.slice(0, 500), { x, y, size, font: isBold ? bold : regular, color: rgb(0.1, 0.12, 0.16) }); };
  const rightText = (value: string, column: { x: number; width: number }, size = 8, isBold = false) => {
    const font = isBold ? bold : regular;
    page.drawText(value, { x: column.x + column.width - font.widthOfTextAtSize(value, size), y, size, font, color: rgb(0.1, 0.12, 0.16) });
  };
  const next = (amount = 16) => { y -= amount; };
  const tableHeader = () => { text("Invoice", customerStatementPdfColumns.invoice.x, 9, true); text("Issued", customerStatementPdfColumns.issued.x, 9, true); text("Due", customerStatementPdfColumns.due.x, 9, true); text("PO / Job", customerStatementPdfColumns.poJob.x, 9, true); rightText("Original", customerStatementPdfColumns.original, 9, true); rightText("Paid", customerStatementPdfColumns.paid, 9, true); rightText("Balance", customerStatementPdfColumns.balance, 9, true); next(14); };
  text(statement.organization.companyName, 42, 18, true); text("CUSTOMER STATEMENT", 398, 12, true); next(22);
  text(statement.organization.address || "", 42, 9); text(`Statement date: ${statement.statementDate}`, 398, 9); next(16);
  text(statement.customer.companyName, 42, 12, true); text(`Balance Due: ${money(statement.summary.amountDueCents)}`, 382, 14, true); next(16);
  text(statement.customer.billingAddress || statement.customer.email || "", 42, 9); next(26);
  page.drawRectangle({ x: 42, y: y - 42, width: 528, height: 42, color: rgb(0.94, 0.96, 0.98) });
  text("Aging", 50, 10, true); text(`Current ${money(statement.summary.agingCents.current)}`, 118, 9); text(`1-30 ${money(statement.summary.agingCents.oneToThirty)}`, 225, 9); text(`31-60 ${money(statement.summary.agingCents.thirtyOneToSixty)}`, 325, 9); text(`61-90 ${money(statement.summary.agingCents.sixtyOneToNinety)}`, 430, 9); text(`90+ ${money(statement.summary.agingCents.ninetyPlus)}`, 520, 9); next(58);
  tableHeader();
  for (const item of statement.openItems) {
    const poJob = [item.poNumber, item.orderNumber ? `Job ${item.orderNumber}` : null].filter(Boolean).join(" · ") || "—";
    const poJobLines = wrapCustomerStatementPdfText(poJob, customerStatementPdfColumns.poJob.width, (value) => regular.widthOfTextAtSize(value, 8));
    const rowHeight = Math.max(15, poJobLines.length * 10 + 5);
    // Keep the entire logical invoice row on one page, including all wrapped
    // description lines and its financial values.
    if (y - rowHeight < 54) { page = pdf.addPage([612, 792]); y = 750; text(`${statement.organization.companyName} — Customer Statement`, 42, 12, true); next(24); tableHeader(); }
    text(item.invoiceNumber, customerStatementPdfColumns.invoice.x, 8); text(item.issueDate || "—", customerStatementPdfColumns.issued.x, 8); text(item.dueDate || "—", customerStatementPdfColumns.due.x, 8);
    poJobLines.forEach((line, index) => { page.drawText(line, { x: customerStatementPdfColumns.poJob.x, y: y - index * 10, size: 8, font: regular, color: rgb(0.1, 0.12, 0.16) }); });
    rightText(money(item.originalCents), customerStatementPdfColumns.original, 8); rightText(money(item.paidCents), customerStatementPdfColumns.paid, 8); rightText(money(item.remainingCents), customerStatementPdfColumns.balance, 8, true); next(rowHeight);
  }
  next(8); text(`Open A/R: ${money(statement.summary.outstandingCents)}`, 42, 10, true);
  if (statement.summary.unappliedCreditCents) { text(`Unapplied customer credit: ${money(statement.summary.unappliedCreditCents)}`, 230, 10); }
  next(20); text("This statement reflects open approved receivables as of the statement date.", 42, 8);
  return pdf.save();
}
