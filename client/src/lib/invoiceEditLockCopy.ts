export type InvoiceEditLockArea = "details" | "financial" | "notes";

export function getInvoiceEditLockMessage(status: string | null | undefined, area: InvoiceEditLockArea): string {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "paid" || normalized === "void" || normalized === "voided") {
    return "Paid and void invoices cannot be edited.";
  }

  if (normalized === "draft") {
    return "";
  }

  if (area === "financial") {
    return "Financial edits are locked after an invoice is finalized. Void or create a revised invoice to make changes.";
  }

  return "Invoice edits are locked after an invoice is finalized. Void or create a revised invoice to make changes.";
}
