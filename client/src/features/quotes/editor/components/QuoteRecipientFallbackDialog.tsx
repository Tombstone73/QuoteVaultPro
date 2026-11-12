import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { DocumentEmailComposeFields, DocumentEmailRecipientField } from "@/components/email/DocumentEmailComposer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDocumentEmailRecipients, type DocumentEmailRecipientField as AddressField, type QuoteEmailRequest } from "@shared/documentEmailRecipients";
import {
  CREATE_NEW_CONTACT_CHOICE,
  getContactDisplayName,
  getInitialRecipientContactChoice,
  isValidRecipientEmail,
  type QuoteRecipientContactLike,
} from "../quoteRecipientFallback";

type Props = {
  open: boolean;
  contacts: QuoteRecipientContactLike[];
  selectedContactId?: string | null;
  initialRecipientEmail?: string | null;
  initialSubject?: string | null;
  initialBody?: string | null;
  attachPdfDefault?: boolean;
  isSending?: boolean;
  error?: string | null;
  deliveryUnconfirmed?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: QuoteEmailRequest) => Promise<unknown> | void;
};

export function QuoteRecipientFallbackDialog({
  open, contacts, selectedContactId, initialRecipientEmail, initialSubject, initialBody,
  attachPdfDefault = true, isSending = false, error, deliveryUnconfirmed, onOpenChange, onSubmit,
}: Props) {
  const [addresses, setAddresses] = useState({ to: "", cc: "", bcc: "" });
  const [recipientName, setRecipientName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saveToCustomerContact, setSaveToCustomerContact] = useState(false);
  const [contactChoice, setContactChoice] = useState<string | null>(null);
  const [attachPdf, setAttachPdf] = useState(attachPdfDefault);
  const submitting = useRef(false);
  const { recipients, errors, limitError } = parseDocumentEmailRecipients(addresses);
  const canSave = recipients.to.length === 1 && !errors.to;
  const saveContact = canSave && saveToCustomerContact;
  const chosenContact = contactChoice ?? getInitialRecipientContactChoice(contacts, selectedContactId);
  const disabled = isSending || Boolean(deliveryUnconfirmed);
  const canSend = !disabled && recipients.to.length > 0 && !Object.keys(errors).length && !limitError;
  const savedContacts = contacts.filter(contact => contact.id && isValidRecipientEmail(contact.email ?? ""));

  useEffect(() => {
    if (!open) return;
    setAddresses({ to: initialRecipientEmail ?? "", cc: "", bcc: "" });
    setRecipientName("");
    setSubject(initialSubject ?? "");
    setBody(initialBody ?? "");
    setSaveToCustomerContact(false);
    setContactChoice(null);
    setAttachPdf(attachPdfDefault);
  }, [attachPdfDefault, initialBody, initialRecipientEmail, initialSubject, open]);

  const addContact = (contactId: string) => {
    const contact = savedContacts.find(item => item.id === contactId);
    if (!contact?.email || recipients.to.some(email => email.toLowerCase() === contact.email?.trim().toLowerCase())) return;
    setAddresses(previous => ({ ...previous, to: [previous.to.trim(), contact.email!.trim()].filter(Boolean).join("\n") }));
  };

  const submit = async () => {
    if (!canSend || submitting.current) return;
    submitting.current = true;
    try {
      await onSubmit({
        recipients,
        ...(saveContact && recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
        subject: subject.trim(),
        body: body.trim(),
        saveToCustomerContact: saveContact,
        contactId: saveContact && chosenContact !== CREATE_NEW_CONTACT_CHOICE ? chosenContact : null,
        attachPdf,
      });
    } catch {
      // The mutation reports the error and keeps the edited draft open.
    } finally {
      submitting.current = false;
    }
  };

  const addressField = (field: AddressField, label: string) => <DocumentEmailRecipientField
    id={'quote-recipient-' + field} label={label} value={addresses[field]}
    onChange={value => setAddresses(previous => ({ ...previous, [field]: value }))}
    addresses={recipients[field]} error={errors[field]} disabled={disabled}
  />;

  return (
    <Dialog open={open} onOpenChange={next => { if (!isSending && !submitting.current) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Send Quote</DialogTitle>
          <DialogDescription>Review the recipients, message, and PDF before sending.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto px-1 py-2">
          {addressField("to", "To")}
          <p className="text-xs text-muted-foreground">Separate addresses with commas, semicolons, spaces, or new lines.</p>
          {savedContacts.length > 0 && <div className="space-y-1.5">
            <Label htmlFor="quote-add-contact">Add a customer contact to To</Label>
            <Select value="" onValueChange={addContact} disabled={disabled}>
              <SelectTrigger id="quote-add-contact"><SelectValue placeholder="Choose a saved contact" /></SelectTrigger>
              <SelectContent>
                {savedContacts.map(contact => <SelectItem key={contact.id!} value={contact.id!}>{getContactDisplayName(contact)} ({contact.email})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {addressField("cc", "CC")}
            {addressField("bcc", "BCC")}
          </div>
          {limitError && <p className="text-sm text-destructive" role="alert">{limitError}</p>}
          <DocumentEmailComposeFields prefix="quote" subject={subject} onSubjectChange={setSubject}
            message={body} onMessageChange={setBody} messageId="quote-email-body" subjectLimit={500} messageLimit={20000} disabled={disabled} />
          <div className="flex items-center gap-2">
            <Checkbox id="quote-attach-pdf" checked={attachPdf} onCheckedChange={checked => setAttachPdf(checked === true)} disabled={disabled} />
            <Label htmlFor="quote-attach-pdf" className="text-sm font-normal">Attach quote PDF</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="quote-save-recipient" checked={saveContact}
              onCheckedChange={checked => setSaveToCustomerContact(checked === true)} disabled={disabled || !canSave} />
            <Label htmlFor="quote-save-recipient" className="text-sm font-normal">Save To address to a customer contact</Label>
          </div>
          {saveContact ? <div className="space-y-2">
            <Label htmlFor="quote-contact-choice">Customer contact</Label>
            <Select value={chosenContact} onValueChange={setContactChoice} disabled={disabled}>
              <SelectTrigger id="quote-contact-choice"><SelectValue /></SelectTrigger>
              <SelectContent>
                {contacts.filter(contact => contact.id).map(contact => <SelectItem key={contact.id!} value={contact.id!}>
                  {getContactDisplayName(contact)}{contact.email ? ' (' + contact.email + ')' : ''}
                </SelectItem>)}
                <SelectItem value={CREATE_NEW_CONTACT_CHOICE}>Create new contact</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="quote-recipient-name">Recipient name (optional)</Label>
            <Input id="quote-recipient-name" value={recipientName} disabled={disabled}
              onChange={event => setRecipientName(event.target.value)} maxLength={200} />
          </div> : <p className="text-xs text-muted-foreground">
            {recipients.to.length > 1 ? "Select a single To address to enable contact saving." : "Customer contacts will stay as they are."}
          </p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSend}>{isSending ? "Sending…" : "Send Quote"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
