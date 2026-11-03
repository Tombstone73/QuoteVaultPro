import { Link } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import type { PaymentReceipt } from "@shared/paymentReceiptHistory";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** Same read-only allocation disclosure in customer and global payment history. */
export function PaymentReceiptDetails({ receipt }: { receipt: PaymentReceipt }) {
  return <details className="mt-1 min-w-48 max-w-xl text-xs text-foreground" onClick={event => event.stopPropagation()}>
    <summary className="cursor-pointer rounded py-1 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {receipt.allocations.length} invoice {receipt.allocations.length === 1 ? "allocation" : "allocations"} · {money(receipt.allocatedCents)} allocated{receipt.refundedCents > 0 ? ` · ${money(receipt.refundedCents)} refunded` : ""}
    </summary>
    <div className="mt-1 space-y-2 rounded border border-border bg-muted/30 p-2">
      <p>Unapplied: {receipt.unappliedCents === null ? "Requires review" : money(receipt.unappliedCents)}{receipt.refundedCents > 0 ? ` · Refund entries: ${money(receipt.refundedCents)}` : ""}</p>
      {receipt.amountCents > receipt.retainedCents && <p>Returned change: {money(receipt.amountCents - receipt.retainedCents)} · Retained: {money(receipt.retainedCents)}</p>}
      {receipt.linkageWarning && <p role="note" className="font-medium">Review: {receipt.linkageWarning}</p>}
      {receipt.provider === "customer_credit" && <p>Internal credit application; this is not another cash receipt.</p>}
      <ul className="max-h-56 space-y-1 overflow-auto" aria-label="Invoice allocations">
        {receipt.allocations.map(allocation => <li key={allocation.paymentId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-1 last:border-0">
          <Link className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={ROUTES.invoices.detail(allocation.invoiceId)}>Invoice {allocation.invoiceNumber}</Link>
          <span>{money(allocation.amountCents)} · {allocation.status.replace(/_/g, " ")}</span>
          {allocation.reference && allocation.reference !== receipt.reference && <span className="w-full break-all text-muted-foreground">Reference: {allocation.reference}</span>}
        </li>)}
      </ul>
      {!receipt.allocations.length && <p>No invoice allocations.</p>}
      <p className="break-all text-muted-foreground">{receipt.batchId ? "Receipt" : receipt.creditId ? "Customer advance" : "Payment"} ID: {receipt.batchId || receipt.creditId || receipt.paymentId}</p>
      {!receipt.batchId && !receipt.creditId && <p className="text-muted-foreground">Shown separately; no verified shared receipt identity.</p>}
    </div>
  </details>;
}
