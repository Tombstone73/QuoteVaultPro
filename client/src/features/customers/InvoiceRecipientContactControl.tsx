import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { hasUsableInvoiceRecipientEmail } from "@shared/invoiceRecipientContact";

interface InvoiceRecipientContactControlProps {
  contactId: string;
  contactName: string;
  email: string | null;
  checked: boolean;
  pending: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function InvoiceRecipientContactControl({
  contactId,
  contactName,
  email,
  checked,
  pending,
  onCheckedChange,
}: InvoiceRecipientContactControlProps) {
  const hasUsableEmail = hasUsableInvoiceRecipientEmail(email);
  const disabled = pending || (!hasUsableEmail && !checked);
  const controlId = `receives-invoices-${contactId}`;

  return (
    <div
      className="flex min-w-fit items-center gap-1.5 rounded-titan-md px-2 py-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      data-testid={`invoice-recipient-control-${contactId}`}
    >
      <Checkbox
        id={controlId}
        checked={checked}
        disabled={disabled}
        aria-label={`Receives Invoices for ${contactName}`}
        onCheckedChange={(nextChecked) => {
          if (typeof nextChecked === "boolean") onCheckedChange(nextChecked);
        }}
      />
      <Label
        htmlFor={controlId}
        className={disabled
          ? "cursor-not-allowed whitespace-nowrap text-titan-xs text-titan-text-muted"
          : "cursor-pointer whitespace-nowrap text-titan-xs text-titan-text-secondary"
        }
      >
        Receives Invoices
      </Label>
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin text-titan-text-muted" aria-label="Saving invoice recipient" />
      ) : !hasUsableEmail ? (
        <span className="whitespace-nowrap text-[10px] text-titan-text-muted">Email required</span>
      ) : null}
    </div>
  );
}
