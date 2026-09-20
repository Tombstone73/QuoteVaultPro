import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Loader2, Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Statement = {
  statementDate: string;
  customer: { companyName: string; billingAddress: string | null };
  summary: { outstandingCents: number; unappliedCreditCents: number; amountDueCents: number; agingCents: { current: number; oneToThirty: number; thirtyOneToSixty: number; sixtyOneToNinety: number; ninetyPlus: number; noDueDate: number } };
  openItems: Array<{ invoiceId: string; invoiceNumber: string; issueDate: string | null; dueDate: string | null; poNumber: string | null; orderNumber: string | null; originalCents: number; paidCents: number; remainingCents: number }>;
  recentPayments: Array<{ id: string; invoiceId: string; amountCents: number; paidAt: string | null; method: string | null }>;
  unappliedCredits: Array<{ id: string; amountCents: number; sourceType: string; createdAt: string; reference: string | null; reason: string | null }>;
};
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function CurrentCustomerStatement({ customerId }: { customerId: string }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [emailResult, setEmailResult] = useState<string | null>(null);
  const statement = useQuery<Statement>({ queryKey: ["customer-current-statement", customerId], queryFn: async () => {
    const response = await fetch(`/api/customers/${customerId}/current-statement`, { credentials: "include" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load statement"); return body.data;
  } });
  const recipients = useQuery<Array<{ email: string; label: string }>>({ queryKey: ["customer-current-statement-recipients", customerId], enabled: emailOpen, queryFn: async () => {
    const response = await fetch(`/api/customers/${customerId}/current-statement/recipients`, { credentials: "include" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load recipients"); return body.data;
  } });
  const emailStatement = useMutation({ mutationFn: async (recipientEmails: string[]) => {
    const response = await fetch(`/api/customers/${customerId}/current-statement/email`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientEmails, idempotencyKey: crypto.randomUUID() }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to queue statement email"); return body.data;
  }, onSuccess: (data) => { setEmailResult(data.status === "already_queued" ? "This statement delivery is already queued." : "Statement queued for delivery."); setEmailOpen(false); } });
  const print = () => window.open(`/api/customers/${customerId}/current-statement/pdf`, "_blank", "noopener,noreferrer");
  const download = () => window.open(`/api/customers/${customerId}/current-statement/pdf?download=1`, "_blank", "noopener,noreferrer");
  if (statement.isLoading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading statement…</div>;
  if (statement.isError || !statement.data) return <div className="rounded border border-destructive/40 p-4 text-sm text-destructive">{statement.error instanceof Error ? statement.error.message : "Unable to load customer statement."}</div>;
  const data = statement.data;
  return <section className="space-y-5 p-4 print:p-0" data-testid="customer-current-statement">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Customer Statement</h2><p className="text-sm text-muted-foreground">{data.customer.companyName} · Statement date {data.statementDate}</p>{data.customer.billingAddress ? <p className="text-sm text-muted-foreground">{data.customer.billingAddress}</p> : null}</div><div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={print}><Printer className="mr-2 h-4 w-4" />Print</Button><Button variant="outline" onClick={download}><Download className="mr-2 h-4 w-4" />Download PDF</Button><Button variant="outline" onClick={() => { setEmailResult(null); setSelectedRecipients([]); setEmailOpen(true); }}><Mail className="mr-2 h-4 w-4" />Email Statement</Button></div></header>
    {emailResult ? <p className="rounded border border-green-600/30 bg-green-50 p-3 text-sm text-green-800 print:hidden">{emailResult}</p> : null}
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border p-4"><p className="text-xs uppercase text-muted-foreground">Balance due</p><p className="text-2xl font-bold">{money(data.summary.amountDueCents)}</p></div><div className="rounded border p-4"><p className="text-xs uppercase text-muted-foreground">Open A/R</p><p className="text-xl font-semibold">{money(data.summary.outstandingCents)}</p></div><div className="rounded border p-4"><p className="text-xs uppercase text-muted-foreground">Unapplied customer credit</p><p className="text-xl font-semibold">{money(data.summary.unappliedCreditCents)}</p></div></div>
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><div>Current <b>{money(data.summary.agingCents.current)}</b></div><div>1–30 <b>{money(data.summary.agingCents.oneToThirty)}</b></div><div>31–60 <b>{money(data.summary.agingCents.thirtyOneToSixty)}</b></div><div>61–90 <b>{money(data.summary.agingCents.sixtyOneToNinety)}</b></div><div>90+ <b>{money(data.summary.agingCents.ninetyPlus)}</b></div></div>
    <div className="overflow-x-auto rounded border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50"><tr><th className="p-2 text-left">Invoice</th><th className="p-2 text-left">Issued</th><th className="p-2 text-left">Due</th><th className="p-2 text-left">PO / Job</th><th className="p-2 text-right">Original</th><th className="p-2 text-right">Payments / Credits</th><th className="p-2 text-right">Balance</th></tr></thead><tbody>{data.openItems.length ? data.openItems.map((item) => <tr key={item.invoiceId} className="border-t"><td className="p-2">{item.invoiceNumber}</td><td className="p-2">{item.issueDate || "—"}</td><td className="p-2">{item.dueDate || "—"}</td><td className="p-2">{[item.poNumber, item.orderNumber ? `Job ${item.orderNumber}` : null].filter(Boolean).join(" · ") || "—"}</td><td className="p-2 text-right">{money(item.originalCents)}</td><td className="p-2 text-right">{money(item.paidCents)}</td><td className="p-2 text-right font-semibold">{money(item.remainingCents)}</td></tr>) : <tr><td className="p-8 text-center text-muted-foreground" colSpan={7}>No approved outstanding invoices. Balance Due: $0.00</td></tr>}</tbody></table></div>
    <Dialog open={emailOpen} onOpenChange={setEmailOpen}><DialogContent><DialogHeader><DialogTitle>Email customer statement</DialogTitle><DialogDescription>The exact statement shown now will be frozen and queued for delivery. It is not marked sent until the email provider accepts it.</DialogDescription></DialogHeader>{recipients.isLoading ? <div className="py-4 text-sm text-muted-foreground">Loading recipients…</div> : recipients.data?.length ? <div className="space-y-3">{recipients.data.map((recipient) => <label key={recipient.email} className="flex items-center gap-3 rounded border p-3 text-sm"><Checkbox checked={selectedRecipients.includes(recipient.email)} onCheckedChange={(checked) => setSelectedRecipients((current) => checked ? [...new Set([...current, recipient.email])] : current.filter((email) => email !== recipient.email))} /><span><span className="font-medium">{recipient.label}</span><br /><span className="text-muted-foreground">{recipient.email}</span></span></label>)}</div> : <div className="rounded border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900">No usable customer email recipient is available. Print or download the statement instead.</div>}{emailStatement.isError ? <p className="text-sm text-destructive">{emailStatement.error instanceof Error ? emailStatement.error.message : "Unable to queue statement email."}</p> : null}<DialogFooter><Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button><Button disabled={!selectedRecipients.length || emailStatement.isPending} onClick={() => emailStatement.mutate(selectedRecipients)}>{emailStatement.isPending ? "Queueing…" : "Queue Statement Email"}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
