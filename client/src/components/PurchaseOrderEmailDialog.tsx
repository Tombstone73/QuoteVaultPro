import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DocumentEmailComposeFields, DocumentEmailRecipientField } from "@/components/email/DocumentEmailComposer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceFieldId } from "@/contexts/WorkspaceContext";
import type { PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { documentEmailRecipientFields, parseDocumentEmailRecipients } from "@shared/documentEmailRecipients";

export function purchaseOrderPdfUrl(id: string, revision: number) {
  return "/api/purchase-orders/" + encodeURIComponent(id) + "/revisions/" + revision + "/pdf";
}

export function PurchaseOrderEmailDialog({ po, revision, open, onOpenChange, onRevisionChange }: {
  po: PurchaseOrder; revision: number; open: boolean; onOpenChange: (open: boolean) => void; onRevisionChange: (revision: number) => void;
}) {
  const queryClient = useQueryClient();
  const prefix = useWorkspaceFieldId()("purchase-order");
  const [addresses, setAddresses] = useState({ to: "", cc: "", bcc: "" });
  const [saved, setSaved] = useState<string[]>([]);
  const [subject, setSubject] = useState("Purchase Order " + po.poNumber + (revision ? " (Revision " + revision + ")" : ""));
  const [message, setMessage] = useState("Please review the attached purchase order.");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const isCurrentRevision = po.revision === revision;
  const inFlight = useRef(false);
  const attempt = useRef<{ draft: string; key: string }>();
  const { recipients, errors, limitError } = parseDocumentEmailRecipients({
    ...addresses, to: [...saved, addresses.to].filter(Boolean).join("\n"),
  });
  const vendorAddresses = [
    { email: po.vendor?.email, name: po.vendor?.name },
    { email: po.vendor?.salesRepEmail, name: po.vendor?.salesRepName || "Sales representative" },
  ].filter((entry, index, entries) => entry.email && entries.findIndex(other => other.email?.toLowerCase() === entry.email?.toLowerCase()) === index);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || accepted || !isCurrentRevision || !recipients.to.length || Object.keys(errors).length || limitError || !subject.trim()) return;
    const draft = JSON.stringify({ revision, recipients, subject, message });
    if (attempt.current?.draft !== draft) attempt.current = { draft, key: crypto.randomUUID() };
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/purchase-orders/" + po.id + "/email", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key },
        body: draft,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        if (result.retryable) attempt.current = undefined;
        throw new Error(result.error || "Gmail acceptance could not be confirmed.");
      }
      setAccepted(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Gmail acceptance could not be confirmed.");
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", po.id] });
      inFlight.current = false;
      setSending(false);
    }
  }

  return <Dialog open={open} onOpenChange={value => { if (!sending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Send {po.poNumber}</DialogTitle>
        <DialogDescription>Attach the saved PDF for revision {revision} and send through Gmail.</DialogDescription>
      </DialogHeader>
      {accepted ? <div className="space-y-3">
        <p role="status">Gmail accepted the email.</p><Button onClick={() => onOpenChange(false)}>Done</Button>
      </div> : <form className="space-y-3" onSubmit={send}>
        {vendorAddresses.length > 0 && <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Vendor contacts</legend>
          {vendorAddresses.map(({ email, name }) => email && <label key={email} className="flex items-center gap-2 text-sm">
            <Checkbox checked={saved.includes(email)} disabled={sending}
              onCheckedChange={checked => setSaved(current => checked ? [...current, email] : current.filter(value => value !== email))} />
            <span className="min-w-0 break-words">{name} · {email}</span>
          </label>)}
        </fieldset>}
        {documentEmailRecipientFields.map(field => <DocumentEmailRecipientField key={field} id={prefix + "-" + field}
          label={field === "to" ? "To" : field.toUpperCase()} value={addresses[field]} addresses={recipients[field]} error={errors[field]}
          onChange={value => setAddresses(current => ({ ...current, [field]: value }))} disabled={sending} />)}
        <DocumentEmailComposeFields prefix={prefix} subject={subject} onSubjectChange={setSubject} message={message} onMessageChange={setMessage} disabled={sending} />
        {!isCurrentRevision && po.revision !== null && <div className="space-y-2">
          <p role="status" className="text-sm">Revision {po.revision} is now the current agreement.</p>
          <Button type="button" variant="outline" disabled={sending} onClick={() => {
            if (po.revision !== null) { onRevisionChange(po.revision); setError(""); }
          }}>Use current revision</Button>
        </div>}
        <Button asChild type="button" variant="outline"><a target="_blank" rel="noreferrer" href={purchaseOrderPdfUrl(po.id, revision)}>Preview PDF</a></Button>
        {(error || limitError) && <p role="alert" className="text-sm text-destructive">{error || limitError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Close</Button>
          <Button type="submit" disabled={sending || !isCurrentRevision || !subject.trim() || !recipients.to.length || Boolean(limitError) || Object.keys(errors).length > 0}>
            {sending ? "Sending…" : "Send email"}
          </Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
