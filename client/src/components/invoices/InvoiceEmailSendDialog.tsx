import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvoiceEmailRecipients, useSendInvoice } from "@/hooks/useInvoices";
import { useToast } from "@/hooks/use-toast";
import { isValidInvoiceRecipientEmail } from "@shared/invoiceEmailRecipients";

type InvoiceEmailSendDialogProps = {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
  trigger?: ReactNode;
};

/**
 * The one canonical interactive invoice-email UI. Both the Invoice list and
 * Invoice detail route through this recipient selection and the synchronous
 * single-invoice sender; bulk selection remains a separate queue operation.
 */
export function InvoiceEmailSendDialog({ invoiceId, open, onOpenChange, onSent, trigger }: InvoiceEmailSendDialogProps) {
  const { toast } = useToast();
  const sendInvoice = useSendInvoice();
  const invoiceEmailRecipients = useInvoiceEmailRecipients(invoiceId, open);
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState("");
  const [manualRecipientEmail, setManualRecipientEmail] = useState("");
  const [recipientEmailError, setRecipientEmailError] = useState<string | null>(null);

  const recipientOptions = invoiceEmailRecipients.data?.recipients ?? [];
  const defaultRecipient = invoiceEmailRecipients.data?.defaultRecipient ?? null;
  const selectedRecipient = recipientOptions.find(
    (recipient) => recipient.email.toLowerCase() === selectedRecipientEmail.toLowerCase(),
  ) ?? defaultRecipient;
  const trimmedManualRecipientEmail = manualRecipientEmail.trim();
  const manualRecipientInvalid = Boolean(trimmedManualRecipientEmail)
    && !isValidInvoiceRecipientEmail(trimmedManualRecipientEmail);
  const resolvedRecipientEmail = trimmedManualRecipientEmail || selectedRecipient?.email || null;
  const resolvedRecipientName = trimmedManualRecipientEmail
    ? "One-time recipient"
    : (selectedRecipient?.name || null);
  const usingConfiguredRecipients = !trimmedManualRecipientEmail
    && Boolean(defaultRecipient?.email)
    && selectedRecipientEmail === defaultRecipient?.email;

  useEffect(() => {
    if (!open || selectedRecipientEmail || !defaultRecipient?.email) return;
    setSelectedRecipientEmail(defaultRecipient.email);
  }, [defaultRecipient?.email, open, selectedRecipientEmail]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setSelectedRecipientEmail("");
      setManualRecipientEmail("");
      setRecipientEmailError(null);
    }
  };

  const handleSend = async () => {
    if (!resolvedRecipientEmail || manualRecipientInvalid) {
      setRecipientEmailError(
        manualRecipientInvalid
          ? "Enter a valid email address."
          : "Choose a customer email or enter another valid email address.",
      );
      return;
    }
    try {
      await sendInvoice.mutateAsync(usingConfiguredRecipients
        ? { id: invoiceId }
        : { id: invoiceId, toEmail: resolvedRecipientEmail });
      toast({ title: "Invoice sent", description: "The invoice email was accepted for delivery." });
      onOpenChange(false);
      setSelectedRecipientEmail("");
      setManualRecipientEmail("");
      setRecipientEmailError(null);
      onSent?.();
    } catch (error: any) {
      toast({ title: "Invoice send failed", description: error.message || "Unable to send the invoice email.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Send Invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2.5">
            <div className="text-xs font-medium text-muted-foreground">Sending to</div>
            {invoiceEmailRecipients.isLoading ? (
              <div className="mt-1 text-sm text-muted-foreground">Resolving recipient…</div>
            ) : usingConfiguredRecipients && recipientOptions.length > 1 ? (
              <div className="mt-1 text-sm font-medium">{recipientOptions.length} configured invoice recipients</div>
            ) : resolvedRecipientEmail ? (
              <div className="mt-1 min-w-0">
                <div className="truncate text-sm font-medium">{resolvedRecipientName || resolvedRecipientEmail}</div>
                <a className="block truncate text-sm text-primary underline-offset-2 hover:underline" href={`mailto:${resolvedRecipientEmail}`}>{resolvedRecipientEmail}</a>
              </div>
            ) : <div className="mt-1 text-sm text-muted-foreground">No recipient selected</div>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-customer-email">Choose customer email</Label>
            <Select value={selectedRecipientEmail} onValueChange={(email) => { setSelectedRecipientEmail(email); setManualRecipientEmail(""); setRecipientEmailError(null); }} disabled={invoiceEmailRecipients.isLoading || recipientOptions.length === 0}>
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
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={sendInvoice.isPending}>Cancel</Button></DialogClose>
          <Button onClick={() => void handleSend()} disabled={sendInvoice.isPending || invoiceEmailRecipients.isLoading || !resolvedRecipientEmail || manualRecipientInvalid}>{sendInvoice.isPending ? "Sending..." : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
