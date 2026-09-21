import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentEmailComposer, type DocumentEmailRecipient } from "@/components/email/DocumentEmailComposer";
import { apiFetch } from "@/lib/queryClient";
import { downloadAuthenticatedFile, openAuthenticatedFile } from "@/lib/authenticatedFileAccess";
import { buildInvoiceEmailRecipients, isValidInvoiceRecipientEmail } from "@shared/invoiceEmailRecipients";

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
  const [manualRecipientEmail, setManualRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const initialized = useRef(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const statementPath = `/api/customers/${encodeURIComponent(customerId)}/current-statement`;
  const statement = useQuery<Statement>({ queryKey: ["customer-current-statement", customerId], queryFn: async () => {
    const response = await apiFetch(statementPath, { credentials: "include" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load statement"); return body.data;
  } });
  const recipients = useQuery<DocumentEmailRecipient[]>({ queryKey: ["customer-current-statement-recipients", customerId], enabled: emailOpen, queryFn: async () => {
    const response = await apiFetch(`${statementPath}/recipients`, { credentials: "include" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load recipients"); return body.data;
  } });
  const draft = useQuery<{ subject: string; message: string }>({ queryKey: ["customer-current-statement-email-draft", customerId], enabled: emailOpen, queryFn: async () => { const response = await apiFetch(`${statementPath}/email-draft`, { credentials: "include" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to prepare statement email"); return body.data; } });
  const emailStatement = useMutation({ mutationFn: async (payload: { recipientEmails: string[]; selectedContactIds: string[]; manualRecipientEmails: string[]; subject: string; message: string }) => {
    const response = await apiFetch(`${statementPath}/email`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to queue statement email"); return body.data;
  }, onSuccess: (data) => { setEmailResult(data.status === "already_queued" ? "This statement delivery is already queued." : "Statement queued for delivery."); setEmailOpen(false); } });
  useEffect(() => { if (!emailOpen) { initialized.current = false; return; } if (initialized.current || !recipients.data || !draft.data) return; setSelectedRecipients(recipients.data.filter((recipient) => recipient.isDefault).map((recipient) => recipient.email)); setSubject(draft.data.subject); setMessage(draft.data.message); initialized.current = true; }, [emailOpen, recipients.data, draft.data]);
  const finalRecipients = buildInvoiceEmailRecipients([...recipients.data?.filter((recipient) => selectedRecipients.some((email) => email.toLowerCase() === recipient.email.toLowerCase())).map((recipient) => ({ email: recipient.email, name: recipient.label, source: "customer_contact" as const })) || [], ...(manualRecipientEmail.trim() ? [{ email: manualRecipientEmail.trim(), name: "One-time recipient", source: "one_time" as const }] : [])]);
  const queueStatement = () => { if (manualRecipientEmail.trim() && !isValidInvoiceRecipientEmail(manualRecipientEmail)) return setComposeError("Enter a valid email address."); if (!finalRecipients.length) return setComposeError("Select at least one recipient or enter another valid email address."); if (!subject.trim() || !message.trim()) return setComposeError("Subject and message are required."); setComposeError(null); emailStatement.mutate({ recipientEmails: finalRecipients.map((recipient) => recipient.email), selectedContactIds: (recipients.data || []).filter((recipient) => selectedRecipients.some((email) => email.toLowerCase() === recipient.email.toLowerCase()) && recipient.contactId).map((recipient) => recipient.contactId!), manualRecipientEmails: manualRecipientEmail.trim() ? [manualRecipientEmail.trim()] : [], subject, message }); };
  const print = () => void openAuthenticatedFile(`${statementPath}/pdf`).catch((error) => setDocumentError(error instanceof Error ? error.message : "Unable to generate statement PDF."));
  const download = () => {
    const fallbackFilename = statement.data
      ? `${statement.data.customer.companyName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Customer"}-Statement-${statement.data.statementDate}.pdf`
      : "Customer-Statement.pdf";
    void downloadAuthenticatedFile(`${statementPath}/pdf?download=1`, fallbackFilename).catch((error) => setDocumentError(error instanceof Error ? error.message : "Unable to generate statement PDF."));
  };
  if (statement.isLoading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading statement…</div>;
  if (statement.isError || !statement.data) return <div className="rounded border border-destructive/40 p-4 text-sm text-destructive">{statement.error instanceof Error ? statement.error.message : "Unable to load customer statement."}</div>;
  const data = statement.data;
  return <section className="space-y-5 p-4 print:p-0" data-testid="customer-current-statement">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Customer Statement</h2><p className="text-sm text-muted-foreground">{data.customer.companyName} · Statement date {data.statementDate}</p>{data.customer.billingAddress ? <p className="text-sm text-muted-foreground">{data.customer.billingAddress}</p> : null}</div><div className="flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={print}><Printer className="mr-2 h-4 w-4" />Print</Button><Button variant="outline" onClick={download}><Download className="mr-2 h-4 w-4" />Download PDF</Button><Button variant="outline" onClick={() => { setEmailResult(null); setComposeError(null); setEmailOpen(true); }}><Mail className="mr-2 h-4 w-4" />Email Statement</Button></div></header>
    {emailResult ? <p className="rounded border border-green-600/30 bg-green-50 p-3 text-sm text-green-800 print:hidden">{emailResult}</p> : null}
    {documentError ? <p className="rounded border border-destructive/40 p-3 text-sm text-destructive print:hidden">{documentError}</p> : null}
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border p-4"><p className="text-xs uppercase text-muted-foreground">Balance due</p><p className="text-2xl font-bold">{money(data.summary.amountDueCents)}</p></div><div className="rounded border p-4"><p className="text-xs uppercase text-muted-foreground">Open A/R</p><p className="text-xl font-semibold">{money(data.summary.outstandingCents)}</p></div><div className="rounded border p-4"><p className="text-xs uppercase text-muted-foreground">Unapplied customer credit</p><p className="text-xl font-semibold">{money(data.summary.unappliedCreditCents)}</p></div></div>
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"><div>Current <b>{money(data.summary.agingCents.current)}</b></div><div>1–30 <b>{money(data.summary.agingCents.oneToThirty)}</b></div><div>31–60 <b>{money(data.summary.agingCents.thirtyOneToSixty)}</b></div><div>61–90 <b>{money(data.summary.agingCents.sixtyOneToNinety)}</b></div><div>90+ <b>{money(data.summary.agingCents.ninetyPlus)}</b></div></div>
    <div className="overflow-x-auto rounded border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50"><tr><th className="p-2 text-left">Invoice</th><th className="p-2 text-left">Issued</th><th className="p-2 text-left">Due</th><th className="p-2 text-left">PO / Job</th><th className="p-2 text-right">Original</th><th className="p-2 text-right">Payments / Credits</th><th className="p-2 text-right">Balance</th></tr></thead><tbody>{data.openItems.length ? data.openItems.map((item) => <tr key={item.invoiceId} className="border-t"><td className="p-2">{item.invoiceNumber}</td><td className="p-2">{item.issueDate || "—"}</td><td className="p-2">{item.dueDate || "—"}</td><td className="p-2">{[item.poNumber, item.orderNumber ? `Job ${item.orderNumber}` : null].filter(Boolean).join(" · ") || "—"}</td><td className="p-2 text-right">{money(item.originalCents)}</td><td className="p-2 text-right">{money(item.paidCents)}</td><td className="p-2 text-right font-semibold">{money(item.remainingCents)}</td></tr>) : <tr><td className="p-8 text-center text-muted-foreground" colSpan={7}>No approved outstanding invoices. Balance Due: $0.00</td></tr>}</tbody></table></div>
    <Dialog open={emailOpen} onOpenChange={setEmailOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Email customer statement</DialogTitle><DialogDescription>The exact statement shown now will be frozen and queued for delivery. It is not marked sent until the email provider accepts it.</DialogDescription></DialogHeader>{recipients.isLoading || draft.isLoading ? <div className="py-4 text-sm text-muted-foreground">Preparing email…</div> : <DocumentEmailComposer prefix="statement" recipients={recipients.data || []} selectedEmails={selectedRecipients} onSelectedEmailsChange={setSelectedRecipients} manualEmail={manualRecipientEmail} onManualEmailChange={setManualRecipientEmail} subject={subject} onSubjectChange={setSubject} message={message} onMessageChange={setMessage} />}{composeError || emailStatement.isError ? <p className="text-sm text-destructive">{composeError || (emailStatement.error instanceof Error ? emailStatement.error.message : "Unable to queue statement email.")}</p> : null}<DialogFooter><Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button><Button disabled={recipients.isLoading || draft.isLoading || emailStatement.isPending} onClick={queueStatement}>{emailStatement.isPending ? "Queueing…" : "Queue Statement Email"}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
