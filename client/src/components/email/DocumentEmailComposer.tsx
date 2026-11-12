import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type DocumentEmailRecipient = { email: string; label: string; contactId?: string | null; isDefault?: boolean };

/** Shared, controlled controls for customer-facing document email dialogs.
 * The surrounding dialog owns its transport and any document-specific policy. */
export function DocumentEmailComposer({
  prefix, recipients, selectedEmails, onSelectedEmailsChange, manualEmail, onManualEmailChange, subject, onSubjectChange, message, onMessageChange,
}: {
  prefix: string;
  recipients: DocumentEmailRecipient[];
  selectedEmails: string[];
  onSelectedEmailsChange: (emails: string[]) => void;
  manualEmail: string;
  onManualEmailChange: (email: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  message: string;
  onMessageChange: (value: string) => void;
}) {
  const selected = new Set(selectedEmails.map((email) => email.toLowerCase()));
  return <div className="space-y-4" data-testid={`${prefix}-document-email-composer`}>
    <div className="rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="text-xs font-medium text-muted-foreground">Recipients</div>
      <div className="mt-2 space-y-2">
        {recipients.map((recipient) => <label key={recipient.email.toLowerCase()} className="flex min-w-0 items-start gap-2 rounded-sm py-0.5 text-sm">
          <Checkbox checked={selected.has(recipient.email.toLowerCase())} onCheckedChange={(checked) => onSelectedEmailsChange(checked === true ? Array.from(new Set([...selectedEmails, recipient.email])) : selectedEmails.filter((email) => email.toLowerCase() !== recipient.email.toLowerCase()))} aria-label={`Send ${prefix} to ${recipient.email}`} />
          <span className="min-w-0"><span className="block truncate font-medium">{recipient.label}</span><span className="block break-all text-xs text-muted-foreground">{recipient.email}{recipient.isDefault ? " · Default invoice recipient" : ""}</span></span>
        </label>)}
        {!recipients.length ? <p className="text-sm text-muted-foreground">No saved customer email is available. You can still enter another email below.</p> : null}
      </div>
    </div>
    <div className="space-y-1.5"><Label htmlFor={`${prefix}-other-email`}>Send to another email</Label><Input id={`${prefix}-other-email`} type="email" value={manualEmail} onChange={(event) => onManualEmailChange(event.target.value)} placeholder="email@example.com" /><p className="text-xs text-muted-foreground">This one-time recipient will not change customer records.</p></div>
    <DocumentEmailComposeFields prefix={prefix} subject={subject} onSubjectChange={onSubjectChange} message={message} onMessageChange={onMessageChange} />
  </div>;
}

/** Shared editable content fields for customer document emails. */
export function DocumentEmailComposeFields({ prefix, subject, onSubjectChange, message, onMessageChange, messageId = `${prefix}-email-message`, subjectLimit = 250, messageLimit = 10000, disabled = false }: {
  prefix: string; subject: string; onSubjectChange: (value: string) => void; message: string; onMessageChange: (value: string) => void;
  messageId?: string; subjectLimit?: number; messageLimit?: number; disabled?: boolean;
}) {
  return <>
    <div className="space-y-1.5"><Label htmlFor={`${prefix}-email-subject`}>Subject</Label><Input id={`${prefix}-email-subject`} value={subject} onChange={(event) => onSubjectChange(event.target.value)} maxLength={subjectLimit} disabled={disabled} /></div>
    <div className="space-y-1.5"><Label htmlFor={messageId}>Message</Label><Textarea id={messageId} value={message} onChange={(event) => onMessageChange(event.target.value)} maxLength={messageLimit} rows={8} className="resize-y" disabled={disabled} /></div>
  </>;
}

export function DocumentEmailRecipientField({ id, label, value, onChange, addresses, error, disabled }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  addresses: string[]; error?: string; disabled?: boolean;
}) {
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Textarea id={id} value={value} onChange={event => onChange(event.target.value)} rows={2}
      placeholder="email@example.com" disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
      autoCapitalize="none" spellCheck={false} className="min-h-14 resize-y" />
    {addresses.length > 0 && <ul aria-label={`${label} recipients`} className="flex flex-wrap gap-1">
      {addresses.map(address => <li key={address.toLowerCase()} className="max-w-full break-all rounded-md border bg-muted px-2 py-0.5 text-xs text-foreground">{address}</li>)}
    </ul>}
    {error && <p id={`${id}-error`} className="break-all text-xs text-destructive">{error}</p>}
  </div>;
}
