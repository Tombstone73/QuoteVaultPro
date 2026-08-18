import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useState } from "react";
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
const contactSummary = (customer: CustomerCatalogItem) => {
  const contact = customer.primaryContact;
  return contact ? contact.displayName : unavailable;
};
const firstLetters = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";

export const CustomerWorkspace = ({ organizationId, sessionScope, customerId, canView, openCustomer, backToCatalog }: Readonly<{
  organizationId: string;
  sessionScope: string;
  customerId: string;
  canView: boolean;
  openCustomer: (customerId: string) => void;
  backToCatalog: () => void;
}>) => {
  const [search, setSearch] = useState("");
  const list = useQuery({
    queryKey: keys.list(sessionScope, organizationId, search),
    queryFn: () => customerApi.list(organizationId, search),
    enabled: Boolean(organizationId && sessionScope && canView && !customerId),
  });
  const detail = useQuery({
    queryKey: keys.detail(sessionScope, organizationId, customerId),
    queryFn: () => customerApi.get(organizationId, customerId),
    enabled: Boolean(organizationId && sessionScope && customerId && canView),
  });

  if (!organizationId) return <section className="v2-customers"><div className="v2-proof-empty">Customers are unavailable.</div></section>;
  if (!canView) return <section className="v2-customers"><div className="v2-proof-empty">You do not have permission to view Customers.</div></section>;
  if (customerId) return <CustomerDetail state={detail} backToCatalog={backToCatalog} />;

  return <section className="v2-customers" aria-label="Customers">
    <header className="v2-customer-page-header">
      <h1>Customers</h1>
    </header>
    <div className="v2-customers-tools">
      <label className="v2-customers-search">
        <span aria-hidden>⌕</span>
        <input aria-label="Search Customers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, contact, email, phone…" />
      </label>
    </div>
    <div className="v2-customers-table-wrap">
      <table className="v2-customers-table">
        <thead><tr><th>Company</th><th>Primary Contact</th><th>Email</th><th>Phone</th></tr></thead>
        <tbody>
          {list.isLoading && <tr><td colSpan={4}>Loading Customers…</td></tr>}
          {list.isError && <tr><td colSpan={4}>Customers are unavailable.</td></tr>}
          {list.isSuccess && !list.data.items.length && <tr><td colSpan={4}>{search ? "No Customers match this search." : "No Customers are available."}</td></tr>}
          {list.data?.items.map((customer) => <tr key={customer.customerId}>
            <td><button className="v2-customers-link" type="button" onClick={() => openCustomer(customer.customerId)}><i>{firstLetters(customer.displayName)}</i><span><b>{customer.displayName}</b>{customer.companyName !== customer.displayName && <small>{customer.companyName}</small>}</span></button></td>
            <td>{contactSummary(customer)}</td>
            <td>{customer.email ?? customer.primaryContact?.email ?? unavailable}</td>
            <td>{customer.phone ?? customer.primaryContact?.phone ?? unavailable}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
};

const CustomerDetail = ({ state, backToCatalog }: Readonly<{
  state: ReturnType<typeof useQuery<CustomerWorkspaceRead>>;
  backToCatalog: () => void;
}>) => {
  if (state.isLoading) return <section className="v2-customers"><p className="v2-proof-empty">Loading Customer…</p></section>;
  if (state.isError || !state.data) return <section className="v2-customers"><button className="v2-customers-back" type="button" onClick={backToCatalog}>← Customers</button><p className="v2-proof-empty">Customer not found.</p></section>;

  const customer = state.data;
  const identity = customer.presentation;
  const primaryName = identity.contactDisplayName ?? customer.contacts[0]?.displayName;
  const primary = customer.contacts.find((contact) => contact.displayName === primaryName) ?? customer.contacts[0];
  const email = identity.email ?? primary?.email;
  const phone = identity.phone ?? primary?.phone;

  return <section className="v2-customers v2-customer-detail" aria-label="Customer detail">
    <button className="v2-customers-back" type="button" onClick={backToCatalog}>← Customers</button>
    <header className="v2-customer-detail-header">
      <div>
        <h1>{identity.customerDisplayName ?? customer.displayName}</h1>
        {identity.companyName && identity.companyName !== (identity.customerDisplayName ?? customer.displayName) && <p>{identity.companyName}</p>}
      </div>
      <dl>
        <div><dt>Primary Contact</dt><dd>{primaryName ?? unavailable}</dd></div>
        <div><dt>Email</dt><dd>{email ?? unavailable}</dd></div>
        <div><dt>Phone</dt><dd>{phone ?? unavailable}</dd></div>
      </dl>
    </header>

    <div className="v2-customer-overview-grid">
      <section className="v2-customer-section v2-customer-details">
        <header><h2>Account Details</h2></header>
        <dl>
          <div><dt>Company</dt><dd>{identity.companyName ?? customer.displayName}</dd></div>
          <div><dt>Primary Contact</dt><dd>{primaryName ?? unavailable}</dd></div>
          <div><dt>Billing Address</dt><dd>{address(identity.billingAddress)}</dd></div>
          <div><dt>Shipping Address</dt><dd>{address(identity.shippingAddress)}</dd></div>
        </dl>
      </section>
      <section className="v2-customer-section v2-customer-contacts">
        <header><h2>Contacts</h2><span>{customer.contacts.length}</span></header>
        {customer.contacts.length ? <ul>
          {customer.contacts.map((contact) => <li key={contact.contactId}>
            <div><b>{contact.displayName}</b>{contact.displayName === primaryName && <em>Primary</em>}</div>
            <small>{contact.email ?? unavailable}{contact.phone ? ` · ${contact.phone}` : ""}</small>
          </li>)}
        </ul> : <p className="v2-customer-empty">No Contacts are linked to this Customer.</p>}
      </section>
      <section className="v2-customer-section v2-customer-context">
        <header><h2>Commercial Context</h2></header>
        <p>No commercial activity is available.</p>
      </section>
    </div>
  </section>;
};
