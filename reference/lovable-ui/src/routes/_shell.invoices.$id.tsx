import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-store";
import { Field, Panel, Status, TxType, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  customers, docGrand, docTax, docTotal, invoiceNetPaid, invoicePaid, invoiceRefunded,
  invoiceSettlement, lineTotal, money, paymentRefunded, products, type Payment,
} from "@/lib/mock/data";

const METHODS = ["Cash", "Check", "ACH", "Card / Electronic"];

export const Route = createFileRoute("/_shell/invoices/$id")({
  validateSearch: (s: Record<string, unknown>): { pay?: boolean } => (
    s["pay"] === true || s["pay"] === "true" ? { pay: true } : {}
  ),
  head: () => ({
    meta: [
      { title: "Invoice — PrintersHero V2" },
      { name: "description", content: "Document-focused invoice with immutable payment and refund history. Payment lives on the invoice, not the order." },
      { property: "og:title", content: "Invoice — PrintersHero V2" },
      { property: "og:description", content: "Issue, collect and refund against a print job invoice." },
    ],
  }),
  component: InvoiceDetail,
});

interface LedgerRow {
  id: string;
  date: string;
  type: "Payment" | "Refund";
  method: string;
  ref: string;
  amount: number;
  by: string;
  balanceAfter: number;
  payment?: Payment | undefined;
}

function InvoiceDetail() {
  const { id } = Route.useParams();
  const { pay } = Route.useSearch();
  const { getInvoice, docs, recordPayment, recordRefund, issueInvoice } = useApp();
  const inv = getInvoice(id);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(METHODS[3]!);
  const [payRef, setPayRef] = useState("");
  const [refundOf, setRefundOf] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");

  if (!inv) return <div className="p-8 text-sm text-muted-foreground">Invoice not found.</div>;

  const order = docs.find((d) => d.id === inv.orderId);
  const customer = customers.find((c) => c.id === inv.customerId);
  const total = order ? docGrand(order) : 0;
  const paid = invoicePaid(inv);
  const refunded = invoiceRefunded(inv);
  const balance = total - invoiceNetPaid(inv);
  const issued = inv.status === "Issued";
  const settlement = issued ? invoiceSettlement(inv, total) : null;

  const events = [
    ...inv.payments.map((p) => ({ kind: "Payment" as const, p })),
    ...inv.refunds.map((r) => ({ kind: "Refund" as const, r })),
  ];
  let running = total;
  const ledger: LedgerRow[] = events.map((e) => {
    if (e.kind === "Payment") {
      running -= e.p.amount;
      return { id: e.p.id, date: e.p.date, type: "Payment", method: e.p.method, ref: e.p.ref, amount: e.p.amount, by: e.p.by ?? "—", balanceAfter: running, payment: e.p };
    }
    running += e.r.amount;
    return { id: e.r.id, date: e.r.date, type: "Refund", method: e.r.method, ref: e.r.ref, amount: -e.r.amount, by: e.r.by ?? "—", balanceAfter: running };
  });

  const refundableOf = (p: Payment) => p.amount - paymentRefunded(inv, p.id);

  const openPay = () => { setAmount(balance.toFixed(2)); setPayRef(""); setPayOpen(true); };
  const openRefund = (p: Payment) => { setRefundOf(p); setRefundAmount(refundableOf(p).toFixed(2)); };

  // "Make Payment" from the Order workspace links here — payment stays owned by Billing.
  useEffect(() => {
    if (pay) { setAmount(balance.toFixed(2)); setPayRef(""); setPayOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="num text-lg font-semibold">{inv.number}</h1>
            <Status value={inv.status} />
            {settlement && <Status value={settlement} />}
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {customer && <Link to="/customers/$id" params={{ id: customer.id }} className="text-primary hover:underline">{customer.name}</Link>}
            {order && <> · <Link to="/sales/$id" params={{ id: order.number }} className="text-primary hover:underline">Order #{order.number}</Link></>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            <Field label="Issue Date"><span className="num">{inv.issueDate ?? "Not issued"}</span></Field>
            <Field label="Due Date"><span className="num">{inv.dueDate ?? "—"}</span></Field>
            <Field label="Terms">{inv.terms}</Field>
          </div>
        </div>
        <div className="flex gap-2">
          {!issued && (
            <Button size="sm" className="h-8" onClick={() => { issueInvoice(inv.id); toast.success("Invoice issued"); }}>Issue Invoice</Button>
          )}
          {issued && balance > 0.005 && (
            <Button size="sm" className="h-8" onClick={openPay}>Take Payment</Button>
          )}
        </div>
      </div>

      <div className="metric-band grid grid-cols-2 lg:grid-cols-4">
        <FinCell label="Total" value={money(total)} />
        <FinCell label="Paid" value={money(paid)} tone="ok" />
        <FinCell label="Refunded" value={refunded ? `-${money(refunded)}` : money(0)} tone={refunded ? "warn" : undefined} />
        <FinCell label="Balance" value={money(balance)} tone={balance > 0.005 ? "warn" : "ok"} />
      </div>

      <Tabs defaultValue="Invoice">
        <TabsList className="h-9 justify-start rounded-none border-b border-border bg-transparent px-0">
          {["Invoice", "Financial History"].map((t) => (
            <TabsTrigger key={t} value={t} className="text-[13px] data-[state=active]:bg-accent">{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="Invoice" className="mt-3">
          <Panel dense>
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Description</th><th className={th + " text-right"}>Qty</th><th className={th + " text-right"}>Unit</th><th className={th + " text-right"}>Amount</th></tr></thead>
              <tbody>
                {order?.lines.map((l) => (
                  <tr key={l.id} className="row-h border-t border-border">
                    <td className={td}>
                      <span className="font-medium">{products.find((p) => p.id === l.productId)?.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{l.description} {l.size ? "· " + l.size : ""}</span>
                    </td>
                    <td className={td + " num text-right"}>{l.qty}</td>
                    <td className={td + " num text-right"}>{money(l.sellUnit)}</td>
                    <td className={td + " num text-right"}>{money(lineTotal(l))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end border-t border-border p-3">
              <dl className="w-64 space-y-1 text-[13px]">
                <div className="flex justify-between text-muted-foreground"><dt>Subtotal</dt><dd className="num">{money(order ? docTotal(order) : 0)}</dd></div>
                <div className="flex justify-between text-muted-foreground"><dt>Tax</dt><dd className="num">{money(order ? docTax(order) : 0)}</dd></div>
                <div className="flex justify-between border-t border-border pt-1 text-[15px] font-semibold"><dt>Total</dt><dd className="num">{money(total)}</dd></div>
              </dl>
            </div>
          </Panel>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {issued
              ? "Issued invoice — this document is immutable financial history."
              : "Draft invoice — it tracks the order until it is issued."}
          </p>
        </TabsContent>

        <TabsContent value="Financial History" className="mt-3">
          <Panel dense>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Date</th><th className={th}>Type</th><th className={th}>Method</th>
                  <th className={th}>Reference</th><th className={th}>Recorded By</th>
                  <th className={th + " text-right"}>Amount</th><th className={th + " text-right"}>Balance After</th>
                  <th className={th + " w-24"} />
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="row-h border-t border-border">
                    <td className={td + " num"}>{r.date}</td>
                    <td className={td}><TxType type={r.type} /></td>
                    <td className={td}>{r.method}</td>
                    <td className={td + " num text-muted-foreground"}>{r.ref}</td>
                    <td className={td + " text-muted-foreground"}>{r.by}</td>
                    <td className={td + " num text-right font-medium " + (r.amount < 0 ? "text-warn" : "")}>{r.amount < 0 ? `-${money(-r.amount)}` : money(r.amount)}</td>
                    <td className={td + " num text-right text-muted-foreground"}>{money(r.balanceAfter)}</td>
                    <td className={td + " text-right"}>
                      {r.payment && refundableOf(r.payment) > 0.005 && (
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => openRefund(r.payment!)}>Refund</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 && <tr><td className="px-3 py-6 text-center text-[13px] text-muted-foreground" colSpan={8}>No financial transactions yet.</td></tr>}
              </tbody>
            </table>
          </Panel>
          <p className="mt-2 text-[12px] text-muted-foreground">Payments and refunds are immutable. A refund is recorded as a new transaction against the original payment.</p>
        </TabsContent>
      </Tabs>

      {/* Take Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Take Payment</DialogTitle>
            <DialogDescription className="text-[12px]">{inv.number} · balance due {money(balance)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Amount</Label>
              <Input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={balance.toFixed(2)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reference / note <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Check #, confirmation, note" />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                const amt = Math.min(Number(amount) || balance, balance);
                recordPayment(inv.id, amt, method, payRef);
                setPayOpen(false);
                toast.success(`Payment of ${money(amt)} recorded`);
              }}
            >
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund */}
      <Dialog open={!!refundOf} onOpenChange={(o) => !o && setRefundOf(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Refund</DialogTitle>
            <DialogDescription className="text-[12px]">This creates a new refund transaction. The original payment is not changed.</DialogDescription>
          </DialogHeader>
          {refundOf && (
            <div className="grid gap-3">
              <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[13px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Original payment</span><span className="num">{refundOf.date} · {refundOf.method}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Original amount</span><span className="num">{money(refundOf.amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Already refunded</span><span className="num">{money(paymentRefunded(inv, refundOf.id))}</span></div>
                <div className="flex justify-between font-medium"><span>Refundable</span><span className="num">{money(refundableOf(refundOf))}</span></div>
              </div>
              <div className="grid gap-1.5">
                <Label>Refund amount</Label>
                <Input className="num" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                if (!refundOf) return;
                const amt = Math.min(Number(refundAmount) || refundableOf(refundOf), refundableOf(refundOf));
                recordRefund(inv.id, refundOf.id, amt);
                setRefundOf(null);
                toast.success(`Refund of ${money(amt)} recorded`);
              }}
            >
              Record Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FinCell({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | undefined }) {
  return (
    <div className="metric-cell px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

