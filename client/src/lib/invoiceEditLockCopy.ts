export type InvoiceEditLockArea = "details" | "financial" | "notes" | "receivable";

export function getInvoiceEditLockMessage(status: string | null | undefined, area: InvoiceEditLockArea): string {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "paid" || normalized === "void" || normalized === "voided" || normalized === "canceled" || normalized === "cancelled") {
    return "Paid and void invoices cannot be edited.";
  }

  if (area === "receivable") {
    if (["draft", "billed", "finalized", "sent", "partially_paid"].includes(normalized)) return "";
    return "Terms and due date are unavailable for this invoice status.";
  }

  if (normalized === "draft") {
    return "";
  }

  if (area === "financial") {
    return "Financial edits are locked after an invoice is finalized. Void or create a revised invoice to make changes.";
  }

  return "Invoice edits are locked after an invoice is finalized. Void or create a revised invoice to make changes.";
}
