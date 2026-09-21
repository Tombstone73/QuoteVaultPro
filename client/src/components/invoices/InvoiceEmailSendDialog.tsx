import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvoiceEmailDraft, useInvoiceEmailRecipients, useSendInvoice } from "@/hooks/useInvoices";
import { useToast } from "@/hooks/use-toast";
import { buildInvoiceEmailRecipients, isValidInvoiceRecipientEmail } from "@shared/invoiceEmailRecipients";
import { DocumentEmailComposeFields } from "@/components/email/DocumentEmailComposer";

type InvoiceEmailSendDialogProps = {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQueued?: () => void;
  trigger?: ReactNode;
};

function createInvoiceEmailRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Older embedded browsers can lack randomUUID. The server additionally
  // scopes this to the invoice, and this value only has to remain stable for
  // this open dialog/request retry.
  return `invoice-email-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The one canonical interactive invoice-email UI. Both the Invoice list and
 * Invoice detail route through this recipient selection and the durable
 * single-invoice queue; bulk selection remains rate-spaced separately.
 */
export function InvoiceEmailSendDialog({ invoiceId, open, onOpenChange, onQueued, trigger }: InvoiceEmailSendDialogProps) {
  const { toast } = useToast();
  const sendInvoice = useSendInvoice();
  const invoiceEmailRecipients = useInvoiceEmailRecipients(invoiceId, open);
  const invoiceEmailDraft = useInvoiceEmailDraft(invoiceId, open);
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState("");
  const [selectedConfiguredRecipientEmails, setSelectedConfiguredRecipientEmails] = useState<string[]>([]);
  const [recipientsInitializedForOpen, setRecipientsInitializedForOpen] = useState(false);
  const [manualRecipientEmail, setManualRecipientEmail] = useState("");
  const [recipientEmailError, setRecipientEmailError] = useState<string | null>(null);
  const [unapprovedOverrideRequired, setUnapprovedOverrideRequired] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [draftInitializedForOpen, setDraftInitializedForOpen] = useState(false);
  // Retain one key until this dialog closes so a browser/network retry replays
  // the same queue request instead of creating an accidental resend.
  const deliveryRequestIdRef = useRef<string | null>(null);

  const recipientOptions = invoiceEmailRecipients.data?.recipients ?? [];
  const selectedRecipient = recipientOptions.find(
    (recipient) => recipient.email.toLowerCase() === selectedRecipientEmail.toLowerCase(),
  ) ?? null;
  const trimmedManualRecipientEmail = manualRecipientEmail.trim();
  const manualRecipientInvalid = Boolean(trimmedManualRecipientEmail)
    && !isValidInvoiceRecipientEmail(trimmedManualRecipientEmail);
  const selectedConfiguredRecipients = recipientOptions.filter((recipient) =>
    selectedConfiguredRecipientEmails.includes(recipient.email.toLowerCase()),
  );
  const finalRecipients = buildInvoiceEmailRecipients([
    ...selectedConfiguredRecipients,
    ...(selectedRecipient ? [selectedRecipient] : []),
    ...(trimmedManualRecipientEmail ? [{ email: trimmedManualRecipientEmail, name: "One-time recipient", source: "one_time" as const }] : []),
  ]);
  const finalRecipientEmails = finalRecipients.map((recipient) => recipient.email);

  useEffect(() => {
    if (!open) {
      if (recipientsInitializedForOpen) setRecipientsInitializedForOpen(false);
      return;
    }
    if (recipientsInitializedForOpen || invoiceEmailRecipients.isLoading || !invoiceEmailRecipients.data) return;
    setSelectedConfiguredRecipientEmails(recipientOptions.map((recipient) => recipient.email.toLowerCase()));
    setRecipientsInitializedForOpen(true);
  }, [invoiceEmailRecipients.data, invoiceEmailRecipients.isLoading, open, recipientOptions, recipientsInitializedForOpen]);

  useEffect(() => {
    if (!open) {
      if (draftInitializedForOpen) setDraftInitializedForOpen(false);
      return;
    }
    // Do not hydrate a reopened dialog from a stale query-cache value while
    // its required fresh server draft is still being fetched.
    if (draftInitializedForOpen || invoiceEmailDraft.isFetching || !invoiceEmailDraft.data) return;
    setSubject(invoiceEmailDraft.data.subject);
    setMessage(invoiceEmailDraft.data.message);
    setDraftInitializedForOpen(true);
  }, [draftInitializedForOpen, invoiceEmailDraft.data, open]);

  const resetCompose = () => {
    setSelectedRecipientEmail("");
    setSelectedConfiguredRecipientEmails([]);
    setRecipientsInitializedForOpen(false);
    setManualRecipientEmail("");
    setRecipientEmailError(null);
    setUnapprovedOverrideRequired(false);
    setSubject("");
    setMessage("");
    setDraftInitializedForOpen(false);
    deliveryRequestIdRef.current = null;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    resetCompose();
  };

  const handleSend = async (allowUnapproved = false) => {
    if (finalRecipientEmails.length === 0 || manualRecipientInvalid) {
      setRecipientEmailError(
        manualRecipientInvalid
          ? "Enter a valid email address."
          : "Select at least one recipient or enter another valid email address.",
      );
      return;
    }
    if (!draftInitializedForOpen || !subject.trim() || !message.trim()) return;
    try {
      const idempotencyKey = deliveryRequestIdRef.current || createInvoiceEmailRequestId();
      deliveryRequestIdRef.current = idempotencyKey;
      await sendInvoice.mutateAsync({ id: invoiceId, recipientEmails: finalRecipientEmails, allowUnapproved, subject, message, idempotencyKey });
      toast({ title: "Invoice queued", description: "The email is queued. Sent status updates only after the provider accepts it." });
      handleOpenChange(false);
      onQueued?.();
    } catch (error: any) {
      if (error?.code === "INVOICE_APPROVAL_REQUIRED" && !allowUnapproved) {
        setUnapprovedOverrideRequired(true);
        return;
      }
      toast({ title: "Invoice send failed", description: error.message || "Unable to send the invoice email.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{unapprovedOverrideRequired ? "Send Unapproved Invoice?" : "Send Invoice"}</DialogTitle></DialogHeader>
        {unapprovedOverrideRequired ? <div className="space-y-3 text-sm">
          <p>This invoice is not approved for accounting.</p>
          <p>Send Anyway will email the invoice but will not approve it for accounting. The invoice will remain Not Approved.</p>
        </div> : <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2.5" data-testid="invoice-send-targets">
            <div className="text-xs font-medium text-muted-foreground">Sending to</div>
            {invoiceEmailRecipients.isLoading ? (
              <div className="mt-1 text-sm text-muted-foreground">Resolving recipient…</div>
            ) : finalRecipients.length > 0 ? (
              <div className="mt-1 min-w-0 space-y-2">
                <div className="text-sm font-medium">{selectedConfiguredRecipients.length} configured invoice recipient{selectedConfiguredRecipients.length === 1 ? "" : "s"} selected</div>
                <div className="space-y-1.5">
                  {recipientOptions.map((recipient) => (
                    <label key={recipient.email.toLowerCase()} className="flex min-w-0 items-start gap-2 rounded-sm py-0.5 text-sm">
                      <Checkbox
                        checked={selectedConfiguredRecipientEmails.includes(recipient.email.toLowerCase())}
                        onCheckedChange={(checked) => setSelectedConfiguredRecipientEmails((current) => checked === true
                          ? Array.from(new Set([...current, recipient.email.toLowerCase()]))
                          : current.filter((email) => email !== recipient.email.toLowerCase()))}
                        aria-label={`Send invoice to ${recipient.email}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{recipient.name || recipient.email}</span>
                        <span className="block break-all text-xs text-muted-foreground">{recipient.email}</span>
                      </span>
                    </label>
                  ))}
                  {finalRecipients.filter((recipient) => !recipientOptions.some((configured) => configured.email.toLowerCase() === recipient.email.toLowerCase())).map((recipient) => (
                    <div key={recipient.email.toLowerCase()} className="min-w-0 pl-6">
                      <div className="truncate text-sm font-medium">{recipient.name || recipient.email}</div>
                      <div className="break-all text-xs text-muted-foreground">{recipient.email}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div className="mt-1 text-sm text-muted-foreground">No recipient selected</div>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-customer-email">Choose customer email</Label>
            <Select value={selectedRecipientEmail} onValueChange={(email) => { setSelectedRecipientEmail(email); setRecipientEmailError(null); }} disabled={invoiceEmailRecipients.isLoading || recipientOptions.length === 0}>
              <SelectTrigger id="invoice-customer-email"><SelectValue placeholder={invoiceEmailRecipients.isLoading ? "Loading customer emails…" : "No saved customer email"} /></SelectTrigger>
              <SelectContent>{recipientOptions.map((recipient) => <SelectItem key={recipient.email.toLowerCase()} value={recipient.email}>{recipient.name} — {recipient.email}</SelectItem>)}</SelectContent>
            </Select>
            {invoiceEmailRecipients.isError ? <p className="text-xs text-destructive">Unable to load saved customer emails. You can still enter another email below.</p> : recipientOptions.length === 0 && !invoiceEmailRecipients.isLoading ? <p className="text-xs text-muted-foreground">No saved customer email is available for this invoice.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-other-email">Send to another email</Label>
            <Input id="invoice-other-email" type="email" value={manualRecipientEmail} onChange={(event) => { setManualRecipientEmail(event.target.value); setRecipientEmailError(null); }} placeholder="email@example.com" aria-invalid={manualRecipientInvalid || Boolean(recipientEmailError)} />
            {manualRecipientInvalid || recipientEmailError ? <p className="text-xs text-destructive">{manualRecipientInvalid ? "Enter a valid email address." : recipientEmailError}</p> : <p className="text-xs text-muted-foreground">This is a one-time recipient override and will not change customer records.</p>}
          </div>
          {invoiceEmailDraft.isFetching && !draftInitializedForOpen ? <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">Preparing email...</div> : null}
          {invoiceEmailDraft.isError ? <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <p className="text-sm font-medium text-destructive">Unable to prepare invoice email</p>
            <Button className="mt-2" size="sm" variant="outline" onClick={() => void invoiceEmailDraft.refetch()}>Retry</Button>
          </div> : null}
          {draftInitializedForOpen && !invoiceEmailDraft.isError ? <>
            <DocumentEmailComposeFields prefix="invoice" subject={subject} onSubjectChange={setSubject} message={message} onMessageChange={setMessage} />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Secure invoice links, payment actions, and the company footer are added automatically.</p>
            </div>
          </> : null}
        </div>}
        <DialogFooter>
          {unapprovedOverrideRequired ? <>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={sendInvoice.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleSend(true)} disabled={sendInvoice.isPending || !draftInitializedForOpen}>{sendInvoice.isPending ? "Queueing..." : "Send Anyway"}</Button>
          </> : <>
            <DialogClose asChild><Button variant="outline" onClick={() => resetCompose()} disabled={sendInvoice.isPending}>Cancel</Button></DialogClose>
            <Button onClick={() => void handleSend()} disabled={sendInvoice.isPending || invoiceEmailRecipients.isLoading || invoiceEmailDraft.isFetching || invoiceEmailDraft.isError || !draftInitializedForOpen || finalRecipientEmails.length === 0 || manualRecipientInvalid}>{sendInvoice.isPending ? "Queueing..." : "Send"}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
