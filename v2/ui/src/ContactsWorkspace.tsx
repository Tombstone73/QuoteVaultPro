import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronLeft, Mail, MapPin, Phone, ShieldCheck, Star } from "lucide-react";
import React, { useState } from "react";
import { contactApi, newBusinessRequestId, type ContactCatalogItem, type ContactWorkspaceRead } from "./api";

const keys = {
  list: (scope: string, organizationId: string, search: string) => ["v2", scope, organizationId, "contacts", search] as const,
  detail: (scope: string, organizationId: string, contactId: string) => ["v2", scope, organizationId, "contacts", contactId] as const,
};
const unavailable = "—";
const address = (value: ContactWorkspaceRead["customerPresentation"]["billingAddress"] | undefined) => {
  if (!value) return unavailable;
  const cityLine = [value.city, value.region, value.postalCode].filter(Boolean).join(" ");
  return [...value.lines, cityLine, value.countryCode].filter(Boolean).join(", ") || unavailable;
};

export const PrimaryBadge = () => <span className="v2-contact-primary"><Star aria-hidden /> Primary</span>;

export const ContactsWorkspace = ({ organizationId, sessionScope, contactId, canView, canEdit, openContact, openCustomer, backToCatalog }: Readonly<{
  organizationId: string;
  sessionScope: string;
  contactId: string;
  canView: boolean;
  canEdit: boolean;
  openContact: (contactId: string) => void;
  openCustomer: (customerId: string) => void;
  backToCatalog: () => void;
}>) => {
  const [search, setSearch] = useState("");
  const list = useQuery({
    queryKey: keys.list(sessionScope, organizationId, search),
    queryFn: () => contactApi.list(organizationId, search),
    enabled: Boolean(organizationId && sessionScope && canView && !contactId),
  });
  const detail = useQuery({
    queryKey: keys.detail(sessionScope, organizationId, contactId),
    queryFn: () => contactApi.get(organizationId, contactId),
    enabled: Boolean(organizationId && sessionScope && canView && contactId),
  });
  if (!organizationId) return <section className="v2-contacts"><p className="v2-contacts-empty">Contacts are unavailable.</p></section>;
  if (!canView) return <section className="v2-contacts"><p className="v2-contacts-empty">You do not have permission to view Contacts.</p></section>;
  if (contactId) return <ContactDetail state={detail} organizationId={organizationId} sessionScope={sessionScope} canEdit={canEdit} openContact={openContact} openCustomer={openCustomer} backToCatalog={backToCatalog} />;
  return <section className="v2-contacts" aria-label="Contacts">
    <header className="v2-contacts-page-header"><div><h1>Contacts</h1><p>{list.data ? `${list.data.total} contacts across ${list.data.accounts} accounts` : ""}</p></div></header>
    <div className="v2-contacts-tools"><label className="v2-contacts-search"><span aria-hidden>⌕</span><input aria-label="Search Contacts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, company, email, phone…" /></label></div>
    <div className="v2-contacts-table-wrap"><table className="v2-contacts-table"><thead><tr><th>Contact</th><th>Company</th><th>Email</th><th>Phone</th><th>Primary</th></tr></thead><tbody>
      {list.isLoading && <tr><td colSpan={5}>Loading Contacts…</td></tr>}
      {list.isError && <tr><td colSpan={5}>Contacts are unavailable.</td></tr>}
      {list.isSuccess && !list.data.items.length && <tr><td colSpan={5}>{search ? "No Contacts match this search." : "No Contacts are available."}</td></tr>}
      {list.data?.items.map((item) => <ContactRow key={`${item.customerId}:${item.contactId}`} item={item} openContact={openContact} openCustomer={openCustomer} />)}
    </tbody></table></div>
  </section>;
};

const ContactRow = ({ item, openContact, openCustomer }: Readonly<{ item: ContactCatalogItem; openContact: (contactId: string) => void; openCustomer: (customerId: string) => void }>) => <tr onClick={() => openContact(item.contactId)}>
  <td><button className="v2-contacts-link" type="button" onClick={(event) => { event.stopPropagation(); openContact(item.contactId); }}><b>{item.displayName}</b></button></td>
  <td><button className="v2-contacts-company" type="button" onClick={(event) => { event.stopPropagation(); openCustomer(item.customerId); }}>{item.customerName}</button></td>
  <td>{item.email ?? unavailable}</td><td className="num">{item.phone ?? unavailable}</td><td>{item.primary ? <PrimaryBadge /> : <span className="v2-contacts-muted">—</span>}</td>
</tr>;

const Line = ({ icon: Icon, label, children }: Readonly<{ icon: typeof Mail; label: string; children: React.ReactNode }>) => <div className="v2-contact-line"><Icon aria-hidden /><div><small>{label}</small><div>{children}</div></div></div>;

const ContactDetail = ({ state, organizationId, sessionScope, canEdit, openContact, openCustomer, backToCatalog }: Readonly<{
  state: ReturnType<typeof useQuery<ContactWorkspaceRead>>;
  organizationId: string;
  sessionScope: string;
  canEdit: boolean;
  openContact: (contactId: string) => void;
  openCustomer: (customerId: string) => void;
  backToCatalog: () => void;
}>) => {
  if (state.isLoading) return <section className="v2-contacts"><p className="v2-contacts-empty">Loading Contact…</p></section>;
  if (state.isError || !state.data) return <section className="v2-contacts"><button className="v2-contacts-back" type="button" onClick={backToCatalog}>← All Contacts</button><p className="v2-contacts-empty">Contact not found.</p></section>;
  const contact = state.data;
  const customerAddress = address(contact.customerPresentation.billingAddress) !== unavailable
    ? address(contact.customerPresentation.billingAddress)
    : address(contact.customerPresentation.shippingAddress);
  return <section className="v2-contacts v2-contact-detail" aria-label="Contact detail">
    <header className="v2-contact-detail-header"><div><div className="v2-contact-title"><h1>{contact.displayName}</h1>{contact.primary && <PrimaryBadge />}</div><button className="v2-contacts-company" type="button" onClick={() => openCustomer(contact.customerId)}>{contact.customerName}</button></div><div className="v2-contact-actions"><button type="button" className="v2-contacts-back" onClick={backToCatalog}><ChevronLeft aria-hidden /> All Contacts</button><button type="button" className="button" onClick={() => openCustomer(contact.customerId)}><Building2 aria-hidden /> Open Customer</button></div></header>
    <div className="v2-contact-detail-grid"><section className="v2-contact-panel v2-contact-details"><header><h2>Contact Details</h2></header><ContactEditForm organizationId={organizationId} sessionScope={sessionScope} contact={contact} canEdit={canEdit} /><div className="v2-contact-lines">
      <Line icon={Mail} label="Email">{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : unavailable}</Line>
      <Line icon={Phone} label="Phone">{contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : unavailable}</Line>
      <Line icon={Building2} label="Company"><button type="button" className="v2-contacts-company" onClick={() => openCustomer(contact.customerId)}>{contact.customerName}</button></Line>
      <Line icon={MapPin} label="Address">{customerAddress}</Line>
      <Line icon={ShieldCheck} label="Primary Contact">{contact.primary ? "Yes" : "No"}{contact.portalAccessStatus ? ` · Portal ${contact.portalAccessStatus}` : ""}</Line>
    </div></section><section className="v2-contact-panel v2-contact-account"><header><h2>Other Contacts</h2></header>{contact.relatedContacts.filter((item) => item.contactId !== contact.contactId).length ? <ul>{contact.relatedContacts.filter((item) => item.contactId !== contact.contactId).map((item) => <li key={item.contactId}><button type="button" className="v2-contacts-link" onClick={() => openContact(item.contactId)}>{item.displayName}</button>{item.primary && <PrimaryBadge />}</li>)}</ul> : <p className="v2-contacts-muted">None</p>}</section></div>
    <div className="v2-contact-empty-grid"><section className="v2-contact-panel"><header><h2>Recent Documents</h2></header><p className="v2-contact-empty-state">No documents available.</p></section><section className="v2-contact-panel"><header><h2>Communication</h2></header><p className="v2-contact-empty-state">No communication available.</p></section></div>
  </section>;
};

const ContactEditForm = ({ organizationId, sessionScope, contact, canEdit }: Readonly<{ organizationId: string; sessionScope: string; contact: ContactWorkspaceRead; canEdit: boolean }>) => {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(contact.firstName ?? contact.displayName.split(/\s+/)[0] ?? "");
  const [lastName, setLastName] = useState(contact.lastName ?? contact.displayName.split(/\s+/).slice(1).join(" "));
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [title, setTitle] = useState(contact.title ?? "");
  const queryClient = useQueryClient();
  const save = useMutation({ mutationFn: (active: boolean) => contactApi.update(organizationId, contact.contactId, { customerId: contact.customerId, businessRequestId: newBusinessRequestId(), expectedCustomerRevision: contact.customerRevision, expectedContactRevision: contact.revision, firstName, lastName, ...(email.trim() ? { email } : {}), ...(phone.trim() ? { phone } : {}), ...(title.trim() ? { title } : {}), active }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "contacts"] }); await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] }); setEditing(false); } });
  if (!canEdit) return null;
  if (!editing) return <div className="v2-contact-actions"><button type="button" onClick={() => setEditing(true)}>Edit Contact</button>{contact.status === "active" && <button type="button" disabled={save.isPending || contact.primary} title={contact.primary ? "Set another Primary Contact before deactivating." : undefined} onClick={() => save.mutate(false)}>Deactivate</button>}{contact.status === "archived" && <button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>Reactivate</button>}{save.isError && <p role="alert">Contact correction could not be saved. Reload and try again.</p>}</div>;
  return <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); save.mutate(true); }}><label>First name <input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label>Last name <input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label><label>Title <input maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Email <input type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Phone <input maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save Contact"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button>{save.isError && <p role="alert">Contact correction could not be saved. Reload and try again.</p>}</form>;
};
