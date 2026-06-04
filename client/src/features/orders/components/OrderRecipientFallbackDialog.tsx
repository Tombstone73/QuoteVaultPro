import { useEffect, useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildOrderRecipientFallbackPayload,
  CREATE_NEW_ORDER_CONTACT_CHOICE,
  getInitialOrderRecipientContactChoice,
  getOrderContactDisplayName,
  isValidOrderRecipientEmail,
  type OrderRecipientContactLike,
} from "../orderRecipientFallback";

type OrderRecipientFallbackDialogProps = {
  open: boolean;
  contacts: OrderRecipientContactLike[];
  selectedContactId?: string | null;
  initialRecipientEmail?: string | null;
  initialRecipientName?: string | null;
  attachPdfDefault?: boolean;
  isSending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ReturnType<typeof buildOrderRecipientFallbackPayload>) => void;
};

export function OrderRecipientFallbackDialog({
  open,
  contacts,
  selectedContactId,
  initialRecipientEmail,
  initialRecipientName,
  attachPdfDefault = true,
  isSending = false,
  onOpenChange,
  onSubmit,
}: OrderRecipientFallbackDialogProps) {
  const initialContactChoice = useMemo(
    () => getInitialOrderRecipientContactChoice(contacts, selectedContactId),
    [contacts, selectedContactId],
  );
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [saveToCustomerContact, setSaveToCustomerContact] = useState(true);
  const [contactChoice, setContactChoice] = useState(initialContactChoice);
  const [attachPdf, setAttachPdf] = useState(attachPdfDefault);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecipientEmail(initialRecipientEmail ?? "");
    setRecipientName(initialRecipientName ?? "");
    setSaveToCustomerContact(true);
    setContactChoice(initialContactChoice);
    setAttachPdf(attachPdfDefault);
    setEmailError(null);
  }, [attachPdfDefault, initialContactChoice, initialRecipientEmail, initialRecipientName, open]);

  const submit = () => {
    if (!isValidOrderRecipientEmail(recipientEmail)) {
      setEmailError("Enter a valid recipient email address.");
      return;
    }
    setEmailError(null);
    onSubmit(
      buildOrderRecipientFallbackPayload({
        recipientEmail,
        recipientName,
        saveToCustomerContact,
        contactChoice,
        attachPdf,
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Order
          </DialogTitle>
          <DialogDescription>
            Add a recipient email for this order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="order-recipient-email">Recipient email</Label>
            <Input
              id="order-recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(event) => {
                setRecipientEmail(event.target.value);
                if (emailError) setEmailError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="customer@example.com"
              aria-invalid={emailError ? "true" : "false"}
            />
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-recipient-name">Recipient name</Label>
            <Input
              id="order-recipient-name"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="order-save-recipient"
              checked={saveToCustomerContact}
              onCheckedChange={(checked) => setSaveToCustomerContact(checked === true)}
            />
            <Label htmlFor="order-save-recipient" className="text-sm font-normal">
              Save to customer contact
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="order-attach-pdf"
              checked={attachPdf}
              onCheckedChange={(checked) => setAttachPdf(checked === true)}
            />
            <Label htmlFor="order-attach-pdf" className="text-sm font-normal">
              Attach order PDF
            </Label>
          </div>

          {saveToCustomerContact ? (
            <div className="space-y-2">
              <Label htmlFor="order-contact-choice">Customer contact</Label>
              <Select value={contactChoice} onValueChange={setContactChoice}>
                <SelectTrigger id="order-contact-choice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id ?? getOrderContactDisplayName(contact)} value={contact.id ?? CREATE_NEW_ORDER_CONTACT_CHOICE}>
                      {getOrderContactDisplayName(contact)}
                      {contact.email ? ` (${contact.email})` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={CREATE_NEW_ORDER_CONTACT_CHOICE}>Create new contact</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Use once only. Customer/contact data will not be changed.</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isSending}>
            {isSending ? "Sending..." : "Send Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
