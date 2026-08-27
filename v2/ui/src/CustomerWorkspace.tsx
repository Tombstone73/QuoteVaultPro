import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { customerApi, type CustomerCatalogItem, type CustomerWorkspaceRead } from "./api";

const keys = {
  list: (scope: string, organizationId: string, search: string) => ["v2", scope, organizationId, "customers", search] as const,
  detail: (scope: string, organizationId: string, customerId: string) => ["v2", scope, organizationId, "customers", customerId] as const,
};

const unavailable = "—";
const address = (value: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }> | undefined) => {
  if (!value) return unavailable;
  const cityLine = [value.city, value.region, value.postalCode].filter(Boolean).join(" ");
  return [...value.lines, cityLine, value.countryCode].filter(Boolean).join(", ") || unavailable;
};
const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
const contactSummary = (customer: CustomerCatalogItem) => customer.primaryContact?.displayName ?? unavailable;

const SummaryCard = ({ title, count, children }: Readonly<{ title: string; count?: string; children: React.ReactNode }>) => <section className="v2-customer-summary-card">
  <header><h2>{title}</h2>{count && <span>{count}</span>}<i aria-hidden /></header>
  <div>{children}</div>
</section>;

const DetailMetric = ({ label, value }: Readonly<{ label: string; value: string }>) => <div className="v2-customer-metric"><small>{label}</small><strong>{value}</strong></div>;

export const CustomerWorkspace = ({ organizationId, sessionScope, customerId, canView, canCreate, openCustomer, openContact, backToCatalog }: Readonly<{
  organizationId: string;
  sessionScope: string;
  customerId: string;
  canView: boolean;
  canCreate: boolean;
  openCustomer: (customerId: string) => void;
  openContact: (contactId: string) => void;
  backToCatalog: () => void;
}>) => {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, search), queryFn: () => customerApi.list(organizationId, search), enabled: Boolean(organizationId && sessionScope && canView && !customerId) });
  const detail = useQuery({ queryKey: keys.detail(sessionScope, organizationId, customerId), queryFn: () => customerApi.get(organizationId, customerId), enabled: Boolean(organizationId && sessionScope && customerId && canView) });
  const create = useMutation({
    mutationFn: () => customerApi.create(organizationId, { companyName, ...(displayName.trim() ? { displayName } : {}), ...(email.trim() ? { email } : {}), ...(phone.trim() ? { phone } : {}) }),
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] });
      setCreating(false); setCompanyName(""); setDisplayName(""); setEmail(""); setPhone(""); openCustomer(customer.customerId);
    },
  });

  if (!organizationId) return <section className="v2-customers"><div className="v2-proof-empty">Customers are unavailable.</div></section>;
  if (!canView) return <section className="v2-customers"><div className="v2-proof-empty">You do not have permission to view Customers.</div></section>;
  if (customerId) return <CustomerDetail state={detail} openContact={openContact} backToCatalog={backToCatalog} />;

  return <section className="v2-customers" aria-label="Customers">
    <header className="v2-customer-page-header"><div><h1>Customers</h1><p>{list.data ? `${list.data.items.length} customer accounts` : "Customer accounts"}</p></div>{canCreate && <button type="button" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New Customer"}</button>}</header>
    {creating && <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <label>Company name <input value={companyName} required maxLength={255} onChange={(event) => setCompanyName(event.target.value)} /></label>
      <label>Display name <input value={displayName} maxLength={255} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>Email <input type="email" value={email} maxLength={255} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Phone <input value={phone} maxLength={50} onChange={(event) => setPhone(event.target.value)} /></label>
      <button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create Customer"}</button>
      {create.isError && <p role="alert">Customer creation is unavailable.</p>}
    </form>}
    <div className="v2-customers-tools"><label className="v2-customers-search"><span aria-hidden>⌕</span><input aria-label="Search Customers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, contact, email, phone…" /></label></div>
    <div className="v2-customers-table-wrap"><table className="v2-customers-table"><thead><tr><th>Company</th><th>Primary Contact</th><th>Email</th><th>Phone</th></tr></thead><tbody>
      {list.isLoading && <tr><td colSpan={4}>Loading Customers…</td></tr>}
      {list.isError && <tr><td colSpan={4}>Customers are unavailable.</td></tr>}
      {list.isSuccess && !list.data.items.length && <tr><td colSpan={4}>{search ? "No Customers match this search." : "No Customers are available."}</td></tr>}
      {list.data?.items.map((customer) => <tr key={customer.customerId}>
        <td><button className="v2-customers-link" type="button" onClick={() => openCustomer(customer.customerId)}><i>{initials(customer.displayName)}</i><span><b>{customer.displayName}</b>{customer.companyName !== customer.displayName && <small>{customer.companyName}</small>}</span></button></td>
        <td>{contactSummary(customer)}</td><td>{customer.email ?? customer.primaryContact?.email ?? unavailable}</td><td className="num">{customer.phone ?? customer.primaryContact?.phone ?? unavailable}</td>
      </tr>)}
    </tbody></table></div>
  </section>;
};

const CustomerDetail = ({ state, openContact, backToCatalog }: Readonly<{
  state: ReturnType<typeof useQuery<CustomerWorkspaceRead>>;
  openContact: (contactId: string) => void;
  backToCatalog: () => void;
}>) => {
  if (state.isLoading) return <section className="v2-customers"><p className="v2-proof-empty">Loading Customer…</p></section>;
  if (state.isError || !state.data) return <section className="v2-customers"><button className="v2-customers-back" type="button" onClick={backToCatalog}>← Customers</button><p className="v2-proof-empty">Customer not found.</p></section>;
  const customer = state.data;
  const identity = customer.presentation;
  // Primary ownership belongs to the Customer/contact relationship.  Do not
  // infer it from list position when a legacy Customer has no primary link.
  const primary = customer.contacts.find((contact) => contact.primary);
  const primaryName = primary?.displayName ?? identity.contactDisplayName;
  const email = identity.email ?? primary?.email;
  const phone = identity.phone ?? primary?.phone;
  const displayName = identity.customerDisplayName ?? customer.displayName;

  return <section className="v2-customers v2-customer-detail" aria-label="Customer detail">
    <button className="v2-customers-back" type="button" onClick={backToCatalog}>← Customers</button>
    <header className="v2-customer-detail-header"><div><h1>{displayName}</h1>{identity.companyName && identity.companyName !== displayName && <p>{identity.companyName}</p>}</div><dl><div><dt>Primary Contact</dt><dd>{primaryName ?? unavailable}</dd></div><div><dt>Email</dt><dd>{email ?? unavailable}</dd></div><div><dt>Phone</dt><dd>{phone ?? unavailable}</dd></div></dl></header>
    <div className="v2-customer-metric-band"><DetailMetric label="Contacts" value={String(customer.contacts.length)} /><DetailMetric label="Primary Contact" value={primaryName ?? unavailable} /><DetailMetric label="Email" value={email ?? unavailable} /><DetailMetric label="Phone" value={phone ?? unavailable} /></div>
    <div className="v2-customer-overview-grid">
      <SummaryCard title="Account Details"><dl className="v2-customer-detail-facts"><div><dt>Company</dt><dd>{identity.companyName ?? customer.displayName}</dd></div><div><dt>Primary Contact</dt><dd>{primaryName ?? unavailable}</dd></div><div><dt>Billing Address</dt><dd>{address(identity.billingAddress)}</dd></div><div><dt>Shipping Address</dt><dd>{address(identity.shippingAddress)}</dd></div></dl></SummaryCard>
      <SummaryCard title="Contacts" count={String(customer.contacts.length)}>{customer.contacts.length ? <ul className="v2-customer-contact-list">{customer.contacts.map((contact) => <li key={contact.contactId}><div><button type="button" onClick={() => openContact(contact.contactId)}>{contact.displayName}</button>{contact.primary && <em>Primary</em>}</div><small>{contact.email ?? unavailable}{contact.phone ? ` · ${contact.phone}` : ""}</small></li>)}</ul> : <p className="v2-customer-empty">No Contacts are linked to this Customer.</p>}</SummaryCard>
      <SummaryCard title="Commercial Context"><p className="v2-customer-empty">Customer commercial history remains owned by Sales and Billing. A customer-keyed read projection is not available yet.</p></SummaryCard>
    </div>
  </section>;
};
