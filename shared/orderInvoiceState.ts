export type OrderInvoiceStateKey =
  | "not_invoiced"
  | "ready_to_invoice"
  | "invoice_draft"
  | "invoice_finalized"
  | "invoice_sent"
  | "partially_paid"
  | "credit"
  | "paid"
  | "overdue";

export type OrderInvoiceStateSummary = {
  key: OrderInvoiceStateKey;
  label: string;
  invoiceCount: number;
  activeInvoiceCount: number;
};

export type OrderInvoiceStateInput = {
  status?: string | null;
  dueDate?: string | Date | null;
  lastSentAt?: string | Date | null;
  amountPaid?: string | number | null;
  balanceDue?: string | number | null;
  total?: string | number | null;
};

const LABELS: Record<OrderInvoiceStateKey, string> = {
  not_invoiced: "Not invoiced",
  ready_to_invoice: "Ready to invoice",
  invoice_draft: "Invoice draft",
  invoice_finalized: "Invoice finalized",
  invoice_sent: "Invoice sent",
  partially_paid: "Partially paid",
  credit: "Credit / Refund Due",
  paid: "Paid",
  overdue: "Overdue",
};

function dollars(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function remainingBalance(invoice: OrderInvoiceStateInput): number {
  if (invoice.balanceDue != null && invoice.balanceDue !== "") return dollars(invoice.balanceDue);
  return Math.max(0, dollars(invoice.total) - dollars(invoice.amountPaid));
}

export function deriveOrderInvoiceState(input: {
  billingStatus?: string | null;
  invoices?: ReadonlyArray<OrderInvoiceStateInput> | null;
  now?: Date;
}): OrderInvoiceStateSummary {
  const allInvoices = input.invoices ?? [];
  const activeInvoices = allInvoices.filter((invoice) => {
    const status = String(invoice.status ?? "").trim().toLowerCase();
    return status !== "void" && status !== "voided";
  });
  const counts = { invoiceCount: allInvoices.length, activeInvoiceCount: activeInvoices.length };
  const result = (key: OrderInvoiceStateKey): OrderInvoiceStateSummary => ({ key, label: LABELS[key], ...counts });

  if (activeInvoices.length === 0) {
    return result(String(input.billingStatus ?? "").toLowerCase() === "ready" ? "ready_to_invoice" : "not_invoiced");
  }

  const now = input.now ?? new Date();
  const financial = activeInvoices.map((invoice) => ({
    invoice,
    status: String(invoice.status ?? "").trim().toLowerCase(),
    paid: dollars(invoice.amountPaid),
    remaining: remainingBalance(invoice),
    total: dollars(invoice.total),
  }));

  if (financial.some(({ status, paid, total }) => status === "credit" || paid > total)) return result("credit");
  if (financial.every(({ status, paid, remaining, total }) => (
    status === "paid" || (status !== "draft" && remaining <= 0 && paid <= total && (total > 0 || paid > 0))
  ))) return result("paid");
  if (financial.some(({ invoice, status, remaining }) => {
    if (status === "overdue" && remaining > 0) return true;
    if (!invoice.dueDate || remaining <= 0 || status === "draft") return false;
    const due = new Date(invoice.dueDate);
    return Number.isFinite(due.getTime()) && due.getTime() < now.getTime();
  })) return result("overdue");
  if (financial.some(({ status, paid, remaining }) => status === "partially_paid" || (paid > 0 && remaining > 0))) {
    return result("partially_paid");
  }
  if (financial.some(({ invoice, status }) => Boolean(invoice.lastSentAt) || status === "sent")) return result("invoice_sent");
  if (financial.some(({ status }) => status === "draft")) return result("invoice_draft");
  return result("invoice_finalized");
}
