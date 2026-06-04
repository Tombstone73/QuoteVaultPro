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
  buildQuoteRecipientFallbackPayload,
  CREATE_NEW_CONTACT_CHOICE,
  getContactDisplayName,
  getInitialRecipientContactChoice,
  isValidRecipientEmail,
  type QuoteRecipientContactLike,
} from "../quoteRecipientFallback";

type QuoteRecipientFallbackDialogProps = {
  open: boolean;
  contacts: QuoteRecipientContactLike[];
  selectedContactId?: string | null;
  isSending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ReturnType<typeof buildQuoteRecipientFallbackPayload>) => void;
};

export function QuoteRecipientFallbackDialog({
  open,
  contacts,
  selectedContactId,
  isSending = false,
  onOpenChange,
  onSubmit,
}: QuoteRecipientFallbackDialogProps) {
  const initialContactChoice = useMemo(
    () => getInitialRecipientContactChoice(contacts, selectedContactId),
    [contacts, selectedContactId],
  );
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [saveToCustomerContact, setSaveToCustomerContact] = useState(true);
  const [contactChoice, setContactChoice] = useState(initialContactChoice);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecipientEmail("");
    setRecipientName("");
    setSaveToCustomerContact(true);
    setContactChoice(initialContactChoice);
    setEmailError(null);
  }, [initialContactChoice, open]);

  const submit = () => {
    if (!isValidRecipientEmail(recipientEmail)) {
      setEmailError("Enter a valid recipient email address.");
      return;
    }
    setEmailError(null);
    onSubmit(
      buildQuoteRecipientFallbackPayload({
        recipientEmail,
        recipientName,
        saveToCustomerContact,
        contactChoice,
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Quote
          </DialogTitle>
          <DialogDescription>
            Add a recipient email for this quote.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="quote-recipient-email">Recipient email</Label>
            <Input
              id="quote-recipient-email"
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
            <Label htmlFor="quote-recipient-name">Recipient name</Label>
            <Input
              id="quote-recipient-name"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="quote-save-recipient"
              checked={saveToCustomerContact}
              onCheckedChange={(checked) => setSaveToCustomerContact(checked === true)}
            />
            <Label htmlFor="quote-save-recipient" className="text-sm font-normal">
              Save to customer contact
            </Label>
          </div>

          {saveToCustomerContact ? (
            <div className="space-y-2">
              <Label htmlFor="quote-contact-choice">Customer contact</Label>
              <Select value={contactChoice} onValueChange={setContactChoice}>
                <SelectTrigger id="quote-contact-choice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id ?? getContactDisplayName(contact)} value={contact.id ?? CREATE_NEW_CONTACT_CHOICE}>
                      {getContactDisplayName(contact)}
                      {contact.email ? ` (${contact.email})` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={CREATE_NEW_CONTACT_CHOICE}>Create new contact</SelectItem>
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
            {isSending ? "Sending..." : "Send Quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
