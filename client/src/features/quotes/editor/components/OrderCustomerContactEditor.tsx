import { useState, type ReactNode, type Ref } from "react";
import { Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailTopCard } from "@/components/orders/DetailSurface";
import { CustomerSelect, type CustomerSelectRef, type CustomerWithContacts } from "@/components/CustomerSelect";
import { ContactSelect } from "@/components/ContactSelect";
import type { ContactPickerContact } from "@/lib/contactPicker";
import { formatPhoneForDisplay, phoneToTelHref } from "@/lib/utils";

export type OrderCustomerContactEditorProps = {
  customerId: string | null;
  contactId: string | null;
  customerLabel: string;
  contactLabel: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: { line1: string; line2: string };
  readOnly?: boolean;
  customerSelectRef?: Ref<CustomerSelectRef>;
  onCustomerChange: (customerId: string | null, customer?: CustomerWithContacts, contactId?: string | null) => void;
  onContactChange: (contactId: string | null, contact?: ContactPickerContact | null) => void;
  onContactResolved?: (contact: ContactPickerContact | null) => void;
  footer?: ReactNode;
};

/** Shared New Order identity editor. Callers own draft/evidence persistence. */
export function OrderCustomerContactEditor({
  customerId, contactId, customerLabel, contactLabel, customerEmail, customerPhone,
  contactEmail, contactPhone, address, readOnly = false, customerSelectRef,
  onCustomerChange, onContactChange, onContactResolved, footer,
}: OrderCustomerContactEditorProps) {
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  return <DetailTopCard label="Customer and contact" customer>
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Customer</div>
          {!readOnly && (!customerId || editingCustomer)
            ? <CustomerSelect ref={customerSelectRef} value={customerId} onChange={(id, customer, selectedContactId) => {
                onCustomerChange(id, customer, selectedContactId);
                if (id) setEditingCustomer(false);
              }} autoFocus={false} label="" placeholder="Search customers..." />
            : <div className="block truncate text-lg font-semibold leading-6 text-foreground" title={customerLabel}>{customerLabel}</div>}
        </div>
        {!readOnly && customerId && <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="Change customer" title="Change customer" onClick={() => setEditingCustomer(value => !value)}><Edit className="h-3 w-3" /></Button>}
      </div>
      {address && (address.line1 || address.line2) && <div className="space-y-0.5 text-sm leading-5 text-foreground/80">{address.line1 && <div>{address.line1}</div>}{address.line2 && <div>{address.line2}</div>}</div>}
      {customerEmail && <a className="block truncate text-sm leading-5 text-foreground/80 hover:text-foreground hover:underline" href={`mailto:${customerEmail}`}>{customerEmail}</a>}
      {customerPhone && <a className="block text-sm leading-5 text-foreground/80 hover:text-foreground hover:underline" href={phoneToTelHref(customerPhone)}>{formatPhoneForDisplay(customerPhone)}</a>}
      {editingCustomer && !readOnly && customerId && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" aria-label="Clear customer" onClick={() => { onCustomerChange(null, undefined); setEditingCustomer(false); }}>Clear customer</Button>}
    </div>
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Contact</div>
          {!readOnly && (!contactId || editingContact)
            ? <ContactSelect value={contactId} customerId={customerId} onChange={(id, contact) => {
                onContactChange(id, contact);
                if (id) setEditingContact(false);
              }} onResolvedContact={onContactResolved} label="" placeholder="Search contacts..." />
            : contactId ? <div className="truncate text-base font-semibold leading-5 text-foreground" title={contactLabel}>{contactLabel}</div>
              : <p className="text-sm text-muted-foreground">No contact selected</p>}
        </div>
        {!readOnly && contactId && <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="Change contact" title="Change contact" onClick={() => setEditingContact(value => !value)}><Edit className="h-3 w-3" /></Button>}
      </div>
      {contactEmail && <a className="block truncate text-sm leading-5 text-foreground/80 hover:text-foreground hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>}
      {contactPhone && <a className="block text-sm leading-5 text-foreground/80 hover:text-foreground hover:underline" href={phoneToTelHref(contactPhone)}>{formatPhoneForDisplay(contactPhone)}</a>}
      {editingContact && !readOnly && contactId && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" aria-label="Clear contact" onClick={() => { onContactChange(null, null); setEditingContact(false); }}>Clear contact</Button>}
    </div>
    {footer}
  </DetailTopCard>;
}
