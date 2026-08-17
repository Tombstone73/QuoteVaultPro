import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { customerApi, type CustomerCatalogItem, type CustomerWorkspaceRead } from "./api";

const keys = {
  list: (scope: string, organizationId: string, search: string) => ["v2", scope, organizationId, "customers", search] as const,
  detail: (scope: string, organizationId: string, customerId: string) => ["v2", scope, organizationId, "customers", customerId] as const,
};
const address = (value: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }> | undefined) =>
  value ? [...value.lines, [value.city, value.region, value.postalCode].filter(Boolean).join(" "), value.countryCode].filter(Boolean).join(", ") : "Not recorded";
const contactSummary = (customer: CustomerCatalogItem) => {
  const contact = customer.primaryContact;
  if (!contact) return "Not recorded";
  return [contact.displayName, contact.email ?? contact.phone].filter(Boolean).join(" · ");
};

/** Read-only Customer catalog/detail adapter over canonical Customer and Contact facts. */
export const CustomerWorkspace = ({ organizationId, sessionScope, customerId, canView, openCustomer, backToCatalog }: Readonly<{
  organizationId: string; sessionScope: string; customerId: string; canView: boolean;
  openCustomer: (customerId: string) => void; backToCatalog: () => void;
}>) => {
  const [search, setSearch] = useState("");
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, search), queryFn: () => customerApi.list(organizationId, search), enabled: Boolean(organizationId && sessionScope && canView) });
  const detail = useQuery({ queryKey: keys.detail(sessionScope, organizationId, customerId), queryFn: () => customerApi.get(organizationId, customerId), enabled: Boolean(organizationId && sessionScope && customerId && canView) });
  if (!organizationId) return <section className="v2-customers"><div className="v2-proof-empty">Enter an authenticated organization in Sales before opening Customers.</div></section>;
  if (!canView) return <section className="v2-customers"><div className="v2-proof-empty">You do not have permission to view Customers.</div></section>;
  if (customerId) return <CustomerDetail state={detail} backToCatalog={backToCatalog} />;
  return <section className="v2-customers" aria-label="Customer catalog">
    <header className="v2-customers-heading"><div><p className="eyebrow">Customer relationship</p><h1>Customers</h1><p>{list.data?.items.length ?? 0} active account{list.data?.items.length === 1 ? "" : "s"} in this organization</p></div><span>Read-only catalog</span></header>
    <div className="v2-customers-tools"><label><span>Search Customers</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, contact, email, phone…" /></label><small>Searches the bounded active Customer catalog.</small></div>
    <div className="v2-customers-table-wrap"><table className="v2-customers-table"><thead><tr><th>Company</th><th>Primary contact</th><th>Email</th><th>Phone</th><th>Customer ID</th></tr></thead><tbody>
      {list.isLoading && <tr><td colSpan={5}>Loading Customers…</td></tr>}
      {list.isError && <tr><td colSpan={5}>Customers are unavailable in this organization.</td></tr>}
      {list.isSuccess && !list.data.items.length && <tr><td colSpan={5}>{search ? "No active Customers match this search." : "No active Customers are available in this organization."}</td></tr>}
      {list.data?.items.map((customer) => <tr key={customer.customerId}><td><button className="v2-customers-link" onClick={() => openCustomer(customer.customerId)}><i>{customer.displayName.slice(0, 2).toUpperCase()}</i><span><b>{customer.displayName}</b><small>{customer.companyName}</small></span></button></td><td>{contactSummary(customer)}</td><td>{customer.email ?? customer.primaryContact?.email ?? "—"}</td><td>{customer.phone ?? customer.primaryContact?.phone ?? "—"}</td><td className="v2-customers-mono">{customer.customerId}</td></tr>)}
    </tbody></table></div>
  </section>;
};

const CustomerDetail = ({ state, backToCatalog }: Readonly<{ state: ReturnType<typeof useQuery<CustomerWorkspaceRead>>; backToCatalog: () => void }>) => {
  if (state.isLoading) return <section className="v2-customers"><p className="v2-proof-empty">Loading Customer…</p></section>;
  if (state.isError || !state.data) return <section className="v2-customers"><button className="v2-customers-back" onClick={backToCatalog}>← Customers</button><p className="v2-proof-empty">Customer not found or unavailable in this organization.</p></section>;
  const customer = state.data;
  const identity = customer.presentation;
  return <section className="v2-customers" aria-label="Customer detail"><button className="v2-customers-back" onClick={backToCatalog}>← Customers</button>
    <header className="v2-customers-heading"><div><p className="eyebrow">Customer account</p><h1>{identity.customerDisplayName ?? customer.displayName}</h1><p>{identity.companyName ?? "Customer record"}</p></div><span>Canonical · Read-only</span></header>
    <div className="v2-customer-detail-grid"><article><header><h2>Account details</h2><p>Canonical Customer identity used by Sales and Finance.</p></header><dl><div><dt>Customer ID</dt><dd>{customer.customerId}</dd></div><div><dt>Primary contact</dt><dd>{identity.contactDisplayName ?? customer.contacts[0]?.displayName ?? "Not recorded"}</dd></div><div><dt>Email</dt><dd>{identity.email ?? "Not recorded"}</dd></div><div><dt>Phone</dt><dd>{identity.phone ?? "Not recorded"}</dd></div><div><dt>Billing address</dt><dd>{address(identity.billingAddress)}</dd></div><div><dt>Shipping address</dt><dd>{address(identity.shippingAddress)}</dd></div></dl></article>
      <article className="v2-customer-related"><header><h2>Commercial context</h2><p>Quotes, Orders, Invoices, balances, and payment history remain with Sales and Billing.</p></header><p className="v2-customers-unavailable">No Customer-owned aggregate is shown here. Follow existing Sales or Finance records for their canonical read projections.</p></article>
    </div>
    <article className="v2-customer-contacts"><header><div><h2>Contacts</h2><p>Active Contacts canonically linked to this Customer.</p></div><span>{customer.contacts.length}</span></header>{customer.contacts.length ? <table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Contact ID</th></tr></thead><tbody>{customer.contacts.map((contact) => <tr key={contact.contactId}><td><b>{contact.displayName}</b></td><td>{contact.email ?? "—"}</td><td>{contact.phone ?? "—"}</td><td className="v2-customers-mono">{contact.contactId}</td></tr>)}</tbody></table> : <p className="v2-customers-empty">No active Contacts are linked to this Customer.</p>}</article>
    <article className="v2-customer-unavailable"><h2>Relationship activity</h2><p>Tasks, notes, activity, pipeline, sales representative, balance, and credit are not displayed because this slice has no canonical Customer/CRM or owner-projected read contract for them.</p></article>
  </section>;
};
