import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/app-store";
import { Field, Panel, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { customers, docGrand, docTax, docTotal, invoicePaid, lineTotal, money, products } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/invoices/$id")({
  head: () => ({
    meta: [
      { title: "Invoice — PrintersHero V2" },
      { name: "description", content: "Document-focused invoice with payments, refunds and history. Payment lives on the invoice, not the order." },
      { property: "og:title", content: "Invoice — PrintersHero V2" },
      { property: "og:description", content: "Issue, pay and reconcile a print job invoice." },
    ],
  }),
  component: InvoiceDetail,
});

function InvoiceDetail() {
  const { id } = Route.useParams();
  const { getInvoice, docs, recordPayment, issueInvoice } = useApp();
  const inv = getInvoice(id);
  const [amount, setAmount] = useState("");
  if (!inv) return <div className="p-8 text-sm text-muted-foreground">Invoice not found.</div>;
  const order = docs.find((d) => d.id === inv.orderId);
  const customer = customers.find((c) => c.id === inv.customerId);
  const total = order ? docGrand(order) : 0;
  const paid = invoicePaid(inv);
  const balance = total - paid;
  const locked = inv.status !== "Draft";

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="num text-lg font-semibold">{inv.number}</h1>
            <Status value={balance <= 0 && locked ? "Paid" : inv.status} />
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {customer?.name} · {order && <Link to="/sales/$id" params={{ id: order.number }} className="text-primary hover:underline">Order #{order.number}</Link>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            <Field label="Issue Date"><span className="num">{inv.issueDate ?? "Not issued"}</span></Field>
            <Field label="Due Date"><span className="num">{inv.dueDate ?? "—"}</span></Field>
            <Field label="Terms">{inv.terms}</Field>
            <Field label="Balance"><span className="num font-medium">{money(balance)}</span></Field>
          </div>
        </div>
        <div className="flex gap-2">
          {inv.status === "Draft" && (
            <Button size="sm" className="h-8" onClick={() => { issueInvoice(inv.id); toast.success("Invoice issued"); }}>Issue Invoice</Button>
          )}
          <Dialog>
            <DialogTrigger asChild><Button size="sm" variant={inv.status === "Draft" ? "outline" : "default"} className="h-8">Record Payment</Button></DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>Amount</Label>
                  <Input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={balance.toFixed(2)} />
                </div>
                <div className="text-[12px] text-muted-foreground">Balance due {money(balance)}</div>
              </div>
              <DialogFooter>
                <Button onClick={() => { recordPayment(inv.id, Number(amount) || balance, "Credit Card"); setAmount(""); toast.success("Payment recorded"); }}>Apply Payment</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="h-8">Send</Button>
        </div>
      </div>

      <Tabs defaultValue="Invoice">
        <TabsList className="h-9 justify-start rounded-none border-b border-border bg-transparent px-0">
          {["Invoice", "Payments", "History"].map((t) => (
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
                <div className="flex justify-between font-medium"><dt>Total</dt><dd className="num">{money(total)}</dd></div>
                <div className="flex justify-between text-muted-foreground"><dt>Paid</dt><dd className="num">-{money(paid)}</dd></div>
                <div className="flex justify-between border-t border-border pt-1 text-[15px] font-semibold"><dt>Balance</dt><dd className="num">{money(balance)}</dd></div>
              </dl>
            </div>
          </Panel>
          {locked && <p className="mt-2 text-[12px] text-muted-foreground">Issued invoice — line editing is unavailable with your permission set.</p>}
        </TabsContent>

        <TabsContent value="Payments" className="mt-3">
          <Panel dense>
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Date</th><th className={th}>Method</th><th className={th}>Reference</th><th className={th + " text-right"}>Amount</th><th className={th + " w-32"} /></tr></thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id} className="row-h border-t border-border">
                    <td className={td + " num"}>{p.date}</td>
                    <td className={td}>{p.method}</td>
                    <td className={td + " num text-muted-foreground"}>{p.ref}</td>
                    <td className={td + " num text-right"}>{money(p.amount)}</td>
                    <td className={td + " text-right"}><Button size="sm" variant="ghost" className="h-7 text-[11px]">Refund</Button></td>
                  </tr>
                ))}
                {inv.payments.length === 0 && <tr><td className="px-3 py-6 text-center text-[13px] text-muted-foreground" colSpan={5}>No payments yet.</td></tr>}
              </tbody>
            </table>
          </Panel>
        </TabsContent>

        <TabsContent value="History" className="mt-3">
          <Panel dense>
            <ul className="divide-y divide-border text-[13px]">
              <li className="px-3 py-2">Invoice created automatically with Order #{order?.number}</li>
              {inv.issueDate && <li className="px-3 py-2">Issued {inv.issueDate} by Dale</li>}
              {inv.payments.map((p) => (<li key={p.id} className="px-3 py-2">{money(p.amount)} {p.method} payment applied — {p.date}</li>))}
            </ul>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
