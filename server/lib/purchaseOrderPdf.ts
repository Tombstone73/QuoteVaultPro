import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PurchaseOrderSnapshot } from "@shared/schema";
import { purchasePaymentMethodLabel, purchasePaymentTermsLabel } from "@shared/purchaseOrderWorkflow";
import { wrapCustomerStatementPdfText } from "./customerStatementPdf";

export function purchaseOrderPdfFilename(poNumber: string, revision: number) {
  return poNumber.replace(/[^a-zA-Z0-9_-]/g, "_") + "-r" + revision + ".pdf";
}

export async function generatePurchaseOrderPdf(snapshot: PurchaseOrderSnapshot, revision: number, at: Date) {
  const document = await PDFDocument.create();
  document.setTitle(snapshot.poNumber + " Revision " + revision);
  document.setCreationDate(at);
  document.setModificationDate(at);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(font.getCharacterSet());
  const printable = (text: string) => Array.from(text).map(char => supported.has(char.codePointAt(0)!) ? char : " ").join("");
  const title = snapshot.poNumber + "  |  Revision " + revision;
  let page = document.addPage([612, 792]);
  let y = 750;
  function write(text: string, emphasis = false, size = 11) {
    const face = emphasis ? bold : font;
    for (const paragraph of text.split(/\r?\n/)) {
      const wrapped = wrapCustomerStatementPdfText(printable(paragraph), 520, part => face.widthOfTextAtSize(part, size));
      for (const line of wrapped.length ? wrapped : [""]) {
        if (y < 45) {
          page = document.addPage([612, 792]);
          page.drawText(printable(title), { x: 44, y: 751, size: 10, font: bold });
          y = 726;
        }
        if (line) page.drawText(line, { x: 44, y, size, font: face });
        y -= size + 5;
      }
    }
  }
  write("Purchase Order " + title, true, 18);
  write("Issued " + snapshot.issueDate.slice(0, 10) + "  |  Expected delivery " + (snapshot.expectedDate?.slice(0, 10) ?? "Not set"));
  if (snapshot.vendor) write("Vendor: " + [snapshot.vendor.name, snapshot.vendor.email, snapshot.vendor.phone].filter(Boolean).join("  |  "));
  if (snapshot.shipTo) write("Ship to: " + snapshot.shipTo);
  if (snapshot.orderNumber) write("Related Order: " + snapshot.orderNumber);
  write("Payment terms: " + purchasePaymentTermsLabel(snapshot.paymentTerms));
  write("Payment method: " + purchasePaymentMethodLabel(snapshot.paymentMethod));
  if (snapshot.paymentInstructions) write("Payment instructions: " + snapshot.paymentInstructions);
  y -= 10;
  for (const [index, line] of snapshot.lines.entries()) {
    write((index + 1) + ". " + line.description + (line.vendorSku ? "  |  SKU " + line.vendorSku : ""), true);
    write(line.quantityOrdered + " purchase units x $" + line.unitCost + "  =  $" + line.lineTotal);
  }
  y -= 10;
  write("Subtotal $" + snapshot.subtotal + "  |  Tax $" + snapshot.taxTotal + "  |  Shipping $" + snapshot.shippingTotal);
  write("Purchase order total $" + snapshot.grandTotal, true, 13);
  return Buffer.from(await document.save());
}
