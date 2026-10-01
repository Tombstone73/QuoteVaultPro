import React, { useEffect, useState } from "react";
import type { CustomerContactReference } from "../../src/modules/customers/contracts";
import type { SalesContactSelectionQuery, SalesContactSelectionResult } from "../../src/modules/customers/salesContactSelection";
import { brandedId } from "../../src/modules/shared/commercialValues";

export type SalesContactSelectionProps = Readonly<{
  organizationId: string;
  /** Change on tenant, authenticated user/session, or workspace identity change. */
  identityScope: string;
  value: CustomerContactReference | undefined;
  customerOptions: readonly Readonly<{ id: string; label: string }>[];
  /** Already scoped/authorized by the parent workspace boundary. */
  lookupContacts: (query: SalesContactSelectionQuery) => Promise<SalesContactSelectionResult>;
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (reference: CustomerContactReference | undefined) => void;
}>;

type LookupState = Readonly<{
  key: string;
  status: "ready" | "loading" | "error";
  result?: SalesContactSelectionResult;
}>;

/** A keyed scope discards names, searches and outstanding requests on identity
 * changes, before an effect can accidentally present the previous user's data. */
export const SalesContactSelection = (props: SalesContactSelectionProps) => (
  <ScopedSalesContactSelection key={JSON.stringify([props.organizationId, props.identityScope])} {...props} />
);

const ScopedSalesContactSelection = ({ organizationId, identityScope, value, customerOptions, lookupContacts, disabled = false, readOnly = false, onChange }: SalesContactSelectionProps) => {
  const reference = value?.organizationId === organizationId ? value : undefined;
  const [emptyMode, setEmptyMode] = useState<"customer_contact" | "contact_only">("customer_contact");
  const mode = reference?.customerId ? "customer_contact" : reference?.contactId ? "contact_only" : emptyMode;
  const customerId = mode === "customer_contact" ? reference?.customerId : undefined;
  const contactId = reference?.contactId;
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [lookup, setLookup] = useState<LookupState>();
  const hasScope = Boolean(organizationId.trim() && identityScope.trim());
  const wrongTenant = Boolean(value && value.organizationId !== organizationId);
  const locked = disabled || readOnly || !hasScope || wrongTenant;
  const canLookup = hasScope && !wrongTenant && !disabled && (mode === "contact_only" || Boolean(customerId));
  const requestKey = JSON.stringify([mode, customerId, contactId, search, retry]);
  const current = lookup?.key === requestKey ? lookup : undefined;
  const selected = current?.result?.selectedContact ?? current?.result?.items.find((item) => item.id === contactId);
  const items = current?.status === "ready" ? current.result!.items : [];
  const loading = canLookup && (!current || current.status === "loading");

  useEffect(() => {
    if (!canLookup) return;
    let cancelled = false;
    setLookup({ key: requestKey, status: "loading" });
    void (async () => {
      try {
        const result = await lookupContacts({ search, limit: 25, ...(customerId ? { customerId } : {}), ...(contactId ? { selectedContactId: contactId } : {}) });
        if (!cancelled) setLookup({ key: requestKey, status: "ready", result });
      } catch {
        if (!cancelled) setLookup({ key: requestKey, status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [canLookup, requestKey, lookupContacts, search, customerId, contactId]);

  const changeMode = (next: "customer_contact" | "contact_only") => {
    if (locked || next === mode) return;
    setEmptyMode(next); setSearch("");
    // Keeping a contact in contact-only mode is explicit. Returning to Customer
    // mode requires an explicit account selection, never an inferred account.
    onChange(next === "contact_only" && contactId ? { organizationId: brandedId<"OrganizationId">(organizationId), contactId } : undefined);
  };
  const changeCustomer = (id: string) => {
    if (locked || id === customerId || (id && !customerOptions.some((option) => option.id === id))) return;
    setEmptyMode("customer_contact"); setSearch("");
    onChange(id ? { organizationId: brandedId<"OrganizationId">(organizationId), customerId: brandedId<"CustomerId">(id) } : undefined);
  };
  const changeContact = (id: string) => {
    if (locked || !canLookup || loading || current?.status !== "ready" || id === contactId) return;
    if (id && !items.some((item) => item.id === id) && selected?.id !== id) return;
    setEmptyMode(mode);
    const organization = brandedId<"OrganizationId">(organizationId);
    onChange(customerId
      ? { organizationId: organization, customerId, ...(id ? { contactId: brandedId<"ContactId">(id) } : {}) }
      : id ? { organizationId: organization, contactId: brandedId<"ContactId">(id) } : undefined);
  };

  return <section aria-label="Sales contact selection">
    <div className="form-grid">
      <label className="field">Customer / Contact mode
        <select aria-label="Customer / Contact mode" value={mode} disabled={locked} onChange={(event) => {
          if (event.currentTarget.value === "customer_contact" || event.currentTarget.value === "contact_only") changeMode(event.currentTarget.value);
        }}>
          <option value="customer_contact">Customer + Contact</option>
          <option value="contact_only">Contact-only</option>
        </select>
      </label>
      {mode === "customer_contact" && <label className="field">Customer
        <select aria-label="Customer" value={customerId ?? ""} disabled={locked} onChange={(event) => changeCustomer(event.currentTarget.value)}>
          <option value="">Select Customer</option>
          {customerId && !customerOptions.some((option) => option.id === customerId) && <option value={customerId}>Selected Customer</option>}
          {customerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>}
      <label className="field">Search Contacts
        <input aria-label="Search Contacts" type="search" value={search} maxLength={120} disabled={locked || !canLookup} placeholder="Search contact names" onChange={(event) => { if (!locked && canLookup) setSearch(event.currentTarget.value.slice(0, 120)); }} />
      </label>
      <label className="field">Contact
        <select aria-label="Contact" value={contactId ?? ""} disabled={locked || !canLookup || loading || current?.status !== "ready"} onChange={(event) => changeContact(event.currentTarget.value)}>
          <option value="">{customerId ? "No Contact selected" : "Select Contact"}</option>
          {contactId && !items.some((item) => item.id === contactId) && <option value={contactId}>{selected?.label ?? "Saved Contact"}</option>}
          {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
    </div>
    {wrongTenant && <p role="alert">The saved selection belongs to another organization.</p>}
    {!hasScope && <p role="status">Contact selection requires a current workspace identity.</p>}
    {hasScope && !wrongTenant && mode === "customer_contact" && !customerId && <p role="status">Select a Customer, or use Contact-only to search without an account.</p>}
    {loading && <p role="status">Loading Contacts...</p>}
    {canLookup && current?.status === "error" && <p role="alert">Contacts are unavailable. Try again. <button type="button" disabled={locked} onClick={() => { if (!locked) setRetry((attempt) => attempt + 1); }}>Retry Contacts</button></p>}
    {canLookup && current?.status === "ready" && !items.length && <p role="status">{search.trim() ? "No active Contacts match this search." : "No active Contacts are available."}</p>}
    {canLookup && current?.status === "ready" && contactId && !selected && <p role="alert">The saved Contact is unavailable in this scope. Choose an active Contact before saving.</p>}
    {readOnly && <p role="status">Customer / Contact selection is read-only.</p>}
  </section>;
};
