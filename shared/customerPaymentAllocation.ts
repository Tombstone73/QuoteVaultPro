export const customerPaymentAllocationModes = ["oldest_first", "proportional", "custom"] as const;
export type CustomerPaymentAllocationMode = typeof customerPaymentAllocationModes[number];
export type CustomerPaymentAllocationInvoice = { invoiceId: string; remainingCents: number; dueDate?: string | Date | null; issueDate?: string | Date | null; invoiceNumber?: string | number | null };
export type CustomerPaymentAllocation = { invoiceId: string; amountCents: number };

function chronological(a: CustomerPaymentAllocationInvoice, b: CustomerPaymentAllocationInvoice) {
  const key = (value: unknown) => value ? new Date(value as any).getTime() : Number.MAX_SAFE_INTEGER;
  return key(a.dueDate) - key(b.dueDate) || key(a.issueDate) - key(b.issueDate) || String(a.invoiceNumber ?? "").localeCompare(String(b.invoiceNumber ?? "")) || a.invoiceId.localeCompare(b.invoiceId);
}
function valid(invoices: CustomerPaymentAllocationInvoice[], amountCents: number) {
  if (!invoices.length) throw new Error("Select at least one invoice.");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Payment amount must be a positive number of cents.");
  if (new Set(invoices.map((x) => x.invoiceId)).size !== invoices.length) throw new Error("Invoice IDs must be unique.");
  if (invoices.some((x) => !Number.isInteger(x.remainingCents) || x.remainingCents <= 0)) throw new Error("Every selected invoice must have an outstanding balance.");
  const total = invoices.reduce((sum, x) => sum + x.remainingCents, 0);
  if (amountCents > total) throw new Error("Overpayment not allowed.");
}
export function allocateCustomerPayment(input: { invoices: CustomerPaymentAllocationInvoice[]; amountCents: number; mode: CustomerPaymentAllocationMode; customAllocations?: CustomerPaymentAllocation[] }): CustomerPaymentAllocation[] {
  const { invoices, amountCents, mode } = input; valid(invoices, amountCents);
  if (mode === "custom") {
    const allocations = input.customAllocations || [];
    if (allocations.length !== invoices.length || new Set(allocations.map((x) => x.invoiceId)).size !== allocations.length) throw new Error("Custom allocations must include every selected invoice exactly once.");
    const balances = new Map(invoices.map((x) => [x.invoiceId, x.remainingCents]));
    if (allocations.some((x) => !Number.isInteger(x.amountCents) || x.amountCents < 0 || x.amountCents > (balances.get(x.invoiceId) ?? -1))) throw new Error("A custom allocation exceeds an invoice balance.");
    if (allocations.reduce((sum, x) => sum + x.amountCents, 0) !== amountCents) throw new Error("Custom allocations must equal the payment amount exactly.");
    return allocations.filter((x) => x.amountCents > 0);
  }
  const ordered = [...invoices].sort(chronological);
  if (mode === "oldest_first") {
    let remaining = amountCents;
    return ordered.map((invoice) => { const amount = Math.min(remaining, invoice.remainingCents); remaining -= amount; return { invoiceId: invoice.invoiceId, amountCents: amount }; }).filter((x) => x.amountCents > 0);
  }
  const total = invoices.reduce((sum, x) => sum + x.remainingCents, 0);
  const rows = invoices.map((invoice) => { const product = BigInt(invoice.remainingCents) * BigInt(amountCents); return { invoice, amountCents: Number(product / BigInt(total)), remainder: product % BigInt(total) }; });
  let centsLeft = amountCents - rows.reduce((sum, x) => sum + x.amountCents, 0);
  rows.sort((a, b) => b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : chronological(a.invoice, b.invoice));
  for (let index = 0; centsLeft > 0; index = (index + 1) % rows.length, centsLeft--) rows[index].amountCents++;
  return rows.map((x) => ({ invoiceId: x.invoice.invoiceId, amountCents: x.amountCents })).filter((x) => x.amountCents > 0);
}
