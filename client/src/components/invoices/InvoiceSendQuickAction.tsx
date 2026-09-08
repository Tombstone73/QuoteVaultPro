import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoiceEmailSendDialog } from "@/components/invoices/InvoiceEmailSendDialog";

/** Visible, one-invoice entry point for the canonical direct send dialog. */
export function InvoiceSendQuickAction({ invoiceId, invoiceNumber, alreadySent = false }: {
  invoiceId: string;
  invoiceNumber?: string | number | null;
  alreadySent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <InvoiceEmailSendDialog
    invoiceId={invoiceId}
    open={open}
    onOpenChange={setOpen}
    trigger={<Button size="sm" variant="outline" aria-label={`${alreadySent ? "Resend" : "Send"} invoice ${invoiceNumber || invoiceId}`}><Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />{alreadySent ? "Resend" : "Send"}</Button>}
  />;
}
