import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { contactApi, customerApi, customerCommercialApi, newBusinessRequestId, productApi, type CustomerActivityItem, type CustomerCatalogItem, type CustomerWorkspaceRead } from "./api";
import { invoicePath, orderPath, quotePath, workspacePath } from "./productRouting";

const keys = {
  list: (scope: string, organizationId: string, search: string, cursor: string) => ["v2", scope, organizationId, "customers", "catalog", search, cursor] as const,
  detail: (scope: string, organizationId: string, customerId: string) => ["v2", scope, organizationId, "customers", "detail", customerId] as const,
  activity: (scope: string, organizationId: string, customerId: string, cursor: string) => ["v2", scope, organizationId, "customers", "activity", customerId, cursor] as const,
};

const unavailable = "—";
const address = (value: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }> | undefined) => {
  if (!value) return unavailable;
  const cityLine = [value.city, value.region, value.postalCode].filter(Boolean).join(" ");
  return [...value.lines, cityLine, value.countryCode].filter(Boolean).join(", ") || unavailable;
};
const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
const contactSummary = (customer: CustomerCatalogItem) => customer.primaryContact?.displayName ?? unavailable;
/** Preserve the API's typed, safe operator message instead of flattening
 * actionable validation/conflict outcomes into a generic availability error. */
const mutationErrorMessage = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : fallback;

const SummaryCard = ({ title, count, children }: Readonly<{ title: string; count?: string; children: React.ReactNode }>) => <section className="v2-customer-summary-card">
  <header><h2>{title}</h2>{count && <span>{count}</span>}<i aria-hidden /></header>
  <div>{children}</div>
</section>;

const DetailMetric = ({ label, value }: Readonly<{ label: string; value: string }>) => <div className="v2-customer-metric"><small>{label}</small><strong>{value}</strong></div>;
const money = (cents: number | undefined) => cents === undefined ? "Not configured" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const CustomerWorkspace = ({ organizationId, sessionScope, customerId, canView, canCreate, canManageCommercial = false, openCustomer, openContact, backToCatalog }: Readonly<{
  organizationId: string;
  sessionScope: string;
  customerId: string;
  canView: boolean;
  canCreate: boolean;
  canManageCommercial?: boolean;
  openCustomer: (customerId: string) => void;
  openContact: (contactId: string) => void;
  backToCatalog: () => void;
}>) => {
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
  const [creating, setCreating] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: keys.list(sessionScope, organizationId, search, cursor), queryFn: () => customerApi.list(organizationId, search, { ...(cursor ? { cursor } : {}), limit: 25 }), enabled: Boolean(organizationId && sessionScope && canView && !customerId) });
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
  if (customerId) return <CustomerDetail state={detail} organizationId={organizationId} sessionScope={sessionScope} canCreate={canCreate} canManageCommercial={canManageCommercial} openContact={openContact} backToCatalog={backToCatalog} />;

  return <section className="v2-customers" aria-label="Customers">
    <header className="v2-customer-page-header"><div><h1>Customers</h1><p>{list.data ? `${list.data.totalMatching} customer accounts` : "Customer accounts"}</p></div>{canCreate && <button type="button" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New Customer"}</button>}</header>
    {creating && <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <label>Company name <input value={companyName} required maxLength={255} onChange={(event) => setCompanyName(event.target.value)} /></label>
      <label>Display name <input value={displayName} maxLength={255} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>Email <input type="email" value={email} maxLength={255} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Phone <input value={phone} maxLength={50} onChange={(event) => setPhone(event.target.value)} /></label>
      <button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create Customer"}</button>
      {create.isError && <p role="alert">Customer creation is unavailable.</p>}
    </form>}
    <div className="v2-customers-tools"><label className="v2-customers-search"><span aria-hidden>⌕</span><input aria-label="Search Customers" value={search} onChange={(event) => { setSearch(event.target.value); setCursor(""); setCursorHistory([]); }} placeholder="Company, contact, email, phone…" /></label></div>
    <div className="v2-customers-table-wrap"><table className="v2-customers-table"><thead><tr><th>Company</th><th>Primary Contact</th><th>Email</th><th>Phone</th></tr></thead><tbody>
      {list.isLoading && <tr><td colSpan={4}>Loading Customers…</td></tr>}
      {list.isError && <tr><td colSpan={4}>Customers are unavailable.</td></tr>}
      {list.isSuccess && !list.data.items.length && <tr><td colSpan={4}>{search ? "No Customers match this search." : "No Customers are available."}</td></tr>}
      {list.data?.items.map((customer) => <tr key={customer.customerId}>
        <td><button className="v2-customers-link" type="button" onClick={() => openCustomer(customer.customerId)}><i>{initials(customer.displayName)}</i><span><b>{customer.displayName}</b>{customer.companyName !== customer.displayName && <small>{customer.companyName}</small>}</span></button></td>
        <td>{contactSummary(customer)}</td><td>{customer.email ?? customer.primaryContact?.email ?? unavailable}</td><td className="num">{customer.phone ?? customer.primaryContact?.phone ?? unavailable}</td>
      </tr>)}
    </tbody></table></div>
    <div className="v2-customers-pagination">
      <span>{list.data ? `${list.data.items.length} shown · ${list.data.totalMatching} matching` : "Loading Customers…"}</span>
      <button type="button" disabled={!cursorHistory.length || list.isFetching} onClick={() => { const previous = cursorHistory.at(-1) ?? ""; setCursorHistory((values) => values.slice(0, -1)); setCursor(previous); }}>Previous</button>
      <button type="button" disabled={!list.data?.nextCursor || list.isFetching} onClick={() => { if (!list.data?.nextCursor) return; setCursorHistory((values) => [...values, cursor]); setCursor(list.data.nextCursor!); }}>Next</button>
    </div>
  </section>;
};

const CustomerDetail = ({ state, organizationId, sessionScope, canCreate, canManageCommercial, openContact, backToCatalog }: Readonly<{
  state: ReturnType<typeof useQuery<CustomerWorkspaceRead>>;
  organizationId: string;
  sessionScope: string;
  canCreate: boolean;
  canManageCommercial: boolean;
  openContact: (contactId: string) => void;
  backToCatalog: () => void;
}>) => {
  if (state.isLoading) return <section className="v2-customers"><p className="v2-proof-empty">Loading Customer…</p></section>;
  if (state.isError || !state.data) return <section className="v2-customers"><button className="v2-customers-back" type="button" onClick={backToCatalog}>← Customers</button><p className="v2-proof-empty">Customer not found.</p></section>;
  const customer = state.data;
  const readiness = customer.contactReadiness ?? { status: "needs_attention" as const, reasons: ["contact data is incomplete"] };
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
      <SummaryCard title="Account Details"><CustomerEditForm organizationId={organizationId} sessionScope={sessionScope} customer={customer} canEdit={canCreate} /><dl className="v2-customer-detail-facts"><div><dt>Company</dt><dd>{identity.companyName ?? customer.displayName}</dd></div><div><dt>Primary Contact</dt><dd>{primaryName ?? unavailable}</dd></div><div><dt>Billing Address</dt><dd>{address(identity.billingAddress)}</dd></div><div><dt>Shipping Address</dt><dd>{address(identity.shippingAddress)}</dd></div></dl></SummaryCard>
      <SummaryCard title="Commercial account"><dl className="v2-customer-detail-facts"><div><dt>Payment terms</dt><dd>{customer.commercial.paymentTerms.replaceAll("_", " ")}</dd></div><div><dt>Credit limit</dt><dd>{money(customer.commercial.creditLimitCents)}</dd></div><div><dt>Open A/R</dt><dd>{money(customer.commercial.openReceivableCents)}</dd></div><div><dt>Available credit</dt><dd>{money(customer.commercial.availableCreditCents)}</dd></div><div><dt>Tax</dt><dd>{customer.commercial.taxExempt ? `Exempt${customer.commercial.taxExemptReason ? ` · ${customer.commercial.taxExemptReason}` : ""}` : "Taxable"}</dd></div></dl><p className="v2-customer-empty">Terms and tax apply only to future Sales snapshots. A/R is derived from invoices, payments, and refunds; it does not block work here.</p></SummaryCard>
      <SummaryCard title="Contacts" count={String(customer.contacts.length)}>{readiness.status === "needs_attention" && <p className="v2-customer-empty" role="status">Contact attention: {readiness.reasons.map((reason) => reason.replaceAll("_", " ")).join(", ")}.</p>}<ContactCreateForm organizationId={organizationId} sessionScope={sessionScope} customerId={customer.customerId} customerRevision={customer.revision} canCreate={canCreate} />{customer.contacts.length ? <ul className="v2-customer-contact-list">{customer.contacts.map((contact) => <li key={contact.contactId}><div><button type="button" onClick={() => openContact(contact.contactId)}>{contact.displayName}</button>{contact.primary && <em>Primary</em>}{contact.billing && <em>Billing</em>}{contact.status === "archived" && <em>Inactive</em>}</div><small>{contact.email ?? unavailable}{contact.phone ? ` · ${contact.phone}` : ""}{contact.portalAccessStatus ? ` · Portal ${contact.portalAccessStatus}` : ""}</small>{canCreate && contact.status === "active" && !contact.primary && <PrimaryContactButton organizationId={organizationId} sessionScope={sessionScope} customerId={customer.customerId} customerRevision={customer.revision} contactId={contact.contactId} />}{canCreate && contact.status === "active" && <BillingContactButton organizationId={organizationId} sessionScope={sessionScope} customerId={customer.customerId} customerRevision={customer.revision} contactId={contact.contactId} billing={contact.billing} />}</li>)}</ul> : <p className="v2-customer-empty">No Contacts are linked to this Customer.</p>}</SummaryCard>
      <CustomerActivity organizationId={organizationId} sessionScope={sessionScope} customerId={customer.customerId} />
      <CustomerInternalNotes organizationId={organizationId} sessionScope={sessionScope} customer={customer} canEdit={canCreate} />
      {canManageCommercial && <CustomerCommercialPanel organizationId={organizationId} sessionScope={sessionScope} customerId={customer.customerId} />}
    </div>
  </section>;
};

const centsFromCommercialInput = (value: string): number | null => {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
};
const basisPointsFromPercent = (value: string): number | null => {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const points = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const signed = match[1] === "-" ? -points : points;
  return Number.isSafeInteger(signed) && signed >= -10_000 ? signed : null;
};

/** Bounded staff authoring for the canonical commercial policy. It never
 * calculates a price or updates a ProductVersion in the browser. */
const CustomerCommercialPanel = ({ organizationId, sessionScope, customerId }: Readonly<{ organizationId: string; sessionScope: string; customerId: string }>) => {
  const [productSearch, setProductSearch] = useState("");
  const [entitlementProductId, setEntitlementProductId] = useState("");
  const [pricingProductId, setPricingProductId] = useState("");
  const [mode, setMode] = useState<"fixed_unit" | "percent_adjustment">("fixed_unit");
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();
  const entitlements = useQuery({ queryKey: ["v2", sessionScope, organizationId, "customer-commercial", customerId, "entitlements"], queryFn: () => customerCommercialApi.entitlements(organizationId, customerId) });
  const agreements = useQuery({ queryKey: ["v2", sessionScope, organizationId, "customer-commercial", customerId, "agreements"], queryFn: () => customerCommercialApi.agreements(organizationId, customerId) });
  const products = useQuery({ queryKey: ["v2", sessionScope, organizationId, "customer-commercial", "products", productSearch], queryFn: () => productApi.list(organizationId, productSearch, 1) });
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customer-commercial", customerId] });
  const saveEntitlement = useMutation({ mutationFn: () => { if (!entitlementProductId) throw new Error("Select a Product before changing portal availability."); const current = entitlements.data?.find((item) => item.productId === entitlementProductId); return customerCommercialApi.setEntitlement(organizationId, customerId, entitlementProductId, !(current?.enabled ?? false)); }, onSuccess: refresh });
  const saveAgreement = useMutation({ mutationFn: () => { if (!pricingProductId) throw new Error("Select a Product before saving customer pricing."); const normalized = mode === "fixed_unit" ? centsFromCommercialInput(value) : basisPointsFromPercent(value); if (normalized === null) throw new Error(mode === "fixed_unit" ? "Enter a non-negative unit price with at most two decimals." : "Enter a percentage adjustment no lower than -100.00%."); return customerCommercialApi.setPricingAgreement(organizationId, customerId, pricingProductId, { currency: "USD", mode, value: normalized }); }, onSuccess: async () => { setValue(""); await refresh(); } });
  const label = (productId: string) => products.data?.items.find((item) => item.productId === productId)?.displayName ?? productId;
  return <SummaryCard title="Portal catalog & pricing">
    <p className="v2-customer-empty">Set customer-specific catalog visibility and commercial agreements. Product pricing is resolved and frozen only by the canonical Sales service.</p>
    <label className="v2-customers-search">Find Product <input aria-label="Find Product for customer commercial policy" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Product name…" /></label>
    <div className="v2-customer-create"><label>Portal Product <select aria-label="Portal Product" value={entitlementProductId} onChange={(event) => setEntitlementProductId(event.target.value)}><option value="">Select Product…</option>{products.data?.items.map((item) => <option key={item.productId} value={item.productId}>{item.displayName}</option>)}</select></label><button type="button" disabled={!entitlementProductId || saveEntitlement.isPending} onClick={() => saveEntitlement.mutate()}>{entitlements.data?.find((item) => item.productId === entitlementProductId)?.enabled ? "Remove from Portal Catalog" : "Allow in Portal Catalog"}</button></div>
    {entitlements.isError || saveEntitlement.isError ? <p role="alert">{mutationErrorMessage(saveEntitlement.error ?? entitlements.error, "Customer catalog policy could not be saved.")}</p> : null}
    <ul className="v2-customer-contact-list" aria-label="Customer portal catalog">{entitlements.data?.length ? entitlements.data.map((item) => <li key={item.productId}><div><b>{label(item.productId)}</b><em>{item.enabled ? "Portal enabled" : "Portal disabled"}</em></div><small>Last changed {new Date(item.updatedAt).toLocaleString()}</small></li>) : <li>No explicit Product entitlements.</li>}</ul>
    <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); saveAgreement.mutate(); }}><label>Product <select aria-label="Customer pricing Product" value={pricingProductId} onChange={(event) => setPricingProductId(event.target.value)}><option value="">Select Product…</option>{products.data?.items.map((item) => <option key={item.productId} value={item.productId}>{item.displayName}</option>)}</select></label><label>Agreement <select aria-label="Customer pricing agreement type" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="fixed_unit">Fixed unit price</option><option value="percent_adjustment">Percentage adjustment</option></select></label><label>{mode === "fixed_unit" ? "Unit price (USD)" : "Adjustment (%)"}<input aria-label={mode === "fixed_unit" ? "Unit price (USD)" : "Adjustment (%)"} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder={mode === "fixed_unit" ? "0.00" : "0.00"} /></label><button type="submit" disabled={!pricingProductId || !value.trim() || saveAgreement.isPending}>{saveAgreement.isPending ? "Saving…" : "Save pricing agreement"}</button></form>
    {agreements.isError || saveAgreement.isError ? <p role="alert">{mutationErrorMessage(saveAgreement.error ?? agreements.error, "Customer pricing agreement could not be saved.")}</p> : null}
    <ul className="v2-customer-contact-list" aria-label="Active customer pricing agreements">{agreements.data?.length ? agreements.data.map((agreement) => <li key={agreement.id}><div><b>{label(agreement.productId)}</b><em>{agreement.mode === "fixed_unit" ? `$${(agreement.value / 100).toFixed(2)} per unit` : `${(agreement.value / 100).toFixed(2)}% adjustment`}</em></div><small>Active from {new Date(agreement.effectiveFrom).toLocaleString()}{agreement.productVersionId ? " · Version-specific" : " · Product-wide"}</small></li>) : <li>No active customer pricing agreements.</li>}</ul>
  </SummaryCard>;
};

/** A bounded context hub only: source domains retain all mutations and detail ownership. */
const CustomerActivity = ({ organizationId, sessionScope, customerId }: Readonly<{ organizationId: string; sessionScope: string; customerId: string }>) => {
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<readonly string[]>([]);
  const activity = useQuery({
    queryKey: keys.activity(sessionScope, organizationId, customerId, cursor),
    queryFn: () => customerApi.activity(organizationId, customerId, { ...(cursor ? { cursor } : {}), limit: 12 }),
    enabled: Boolean(organizationId && sessionScope && customerId),
  });
  const eventLabel = (value: string) => value.replaceAll("_", " ");
  const occurredAt = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
  };
  const ownerHref = (item: CustomerActivityItem) => {
    if (item.kind === "quote") return quotePath(item.entityId);
    if (item.kind === "order") return orderPath(item.entityId);
    if (item.kind === "invoice") return invoicePath(item.entityId);
    if (item.kind === "proof") return workspacePath("proofing");
    if (item.kind === "fulfillment") return "/fulfillment";
    return workspacePath("payments");
  };
  return <SummaryCard title="Activity" count={activity.data ? String(activity.data.totalMatching) : undefined}>
    {activity.isLoading && <p className="v2-customer-empty">Loading activity…</p>}
    {activity.isError && <p className="v2-customer-empty">Customer activity is unavailable.</p>}
    {activity.data && !activity.data.items.length && <p className="v2-customer-empty">No linked V2 operational activity is available yet.</p>}
    {activity.data?.items.length ? <ul className="v2-customer-contact-list" aria-label="Customer activity">
      {activity.data.items.map((item) => <li key={`${item.kind}:${item.entityId}`}><div><a href={ownerHref(item)}>{item.title}</a><em>{item.kind}</em></div><small>{eventLabel(item.detail)} · {occurredAt(item.occurredAt)}</small></li>)}
    </ul> : null}
    {activity.data && (cursorHistory.length || activity.data.nextCursor) && <div className="v2-customers-pagination">
      <button type="button" disabled={!cursorHistory.length || activity.isFetching} onClick={() => { const previous = cursorHistory.at(-1) ?? ""; setCursorHistory((values) => values.slice(0, -1)); setCursor(previous); }}>Previous activity</button>
      <button type="button" disabled={!activity.data.nextCursor || activity.isFetching} onClick={() => { if (!activity.data?.nextCursor) return; setCursorHistory((values) => [...values, cursor]); setCursor(activity.data.nextCursor!); }}>More activity</button>
    </div>}
  </SummaryCard>;
};

const ContactCreateForm = ({ organizationId, sessionScope, customerId, customerRevision, canCreate }: Readonly<{
  organizationId: string;
  sessionScope: string;
  customerId: string;
  customerRevision: string;
  canCreate: boolean;
}>) => {
  const [creating, setCreating] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => contactApi.create(organizationId, { businessRequestId: newBusinessRequestId(), expectedCustomerRevision: customerRevision, customerId, firstName, lastName, ...(email.trim() ? { email } : {}), ...(phone.trim() ? { phone } : {}), ...(title.trim() ? { title } : {}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers", customerId] });
      await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] });
      setCreating(false); setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setTitle("");
    },
  });
  if (!canCreate) return null;
  return <>{creating ? <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
    <label>First name <input value={firstName} required maxLength={100} onChange={(event) => setFirstName(event.target.value)} /></label>
    <label>Last name <input value={lastName} required maxLength={100} onChange={(event) => setLastName(event.target.value)} /></label>
    <label>Email <input type="email" value={email} maxLength={255} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Phone <input value={phone} maxLength={50} onChange={(event) => setPhone(event.target.value)} /></label>
    <label>Title <input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} /></label>
    <button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create Contact"}</button><button type="button" onClick={() => setCreating(false)}>Cancel</button>
    {create.isError && <p role="alert">{mutationErrorMessage(create.error, "Contact creation is unavailable.")}</p>}
  </form> : <button type="button" onClick={() => setCreating(true)}>Add Contact</button>}</>;
};

const PrimaryContactButton = ({ organizationId, sessionScope, customerId, customerRevision, contactId }: Readonly<{ organizationId: string; sessionScope: string; customerId: string; customerRevision: string; contactId: string }>) => {
  const queryClient = useQueryClient();
  const setPrimary = useMutation({ mutationFn: () => customerApi.setPrimaryContact(organizationId, customerId, { businessRequestId: newBusinessRequestId(), expectedCustomerRevision: customerRevision, contactId }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] }); } });
  return <button type="button" disabled={setPrimary.isPending} onClick={() => setPrimary.mutate()}>{setPrimary.isPending ? "Setting Primary…" : "Set as Primary"}</button>;
};
const BillingContactButton = ({ organizationId, sessionScope, customerId, customerRevision, contactId, billing }: Readonly<{ organizationId: string; sessionScope: string; customerId: string; customerRevision: string; contactId: string; billing: boolean }>) => {
  const queryClient = useQueryClient();
  const setBilling = useMutation({ mutationFn: () => customerApi.setBillingContact(organizationId, customerId, { businessRequestId: newBusinessRequestId(), expectedCustomerRevision: customerRevision, contactId, billing: !billing }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] }); } });
  return <button type="button" disabled={setBilling.isPending} onClick={() => setBilling.mutate()}>{billing ? "Remove billing recipient" : "Set as billing recipient"}</button>;
};
const CustomerInternalNotes = ({ organizationId, sessionScope, customer, canEdit }: Readonly<{ organizationId: string; sessionScope: string; customer: CustomerWorkspaceRead; canEdit: boolean }>) => {
  const [note, setNote] = useState(""); const queryClient = useQueryClient();
  const add = useMutation({ mutationFn: () => customerApi.addInternalNote(organizationId, customer.customerId, { businessRequestId: newBusinessRequestId(), expectedCustomerRevision: customer.revision, note }), onSuccess: async () => { setNote(""); await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] }); } });
  return <SummaryCard title="Internal account notes" count={String(customer.internalNotes.length)}>{canEdit && <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); add.mutate(); }}><label>Staff-only note <textarea value={note} maxLength={4000} required onChange={(event) => setNote(event.target.value)} /></label><button type="submit" disabled={!note.trim() || add.isPending}>{add.isPending ? "Adding…" : "Add note"}</button>{add.isError && <p role="alert">{mutationErrorMessage(add.error, "Internal note could not be added.")}</p>}</form>}<ul className="v2-customer-contact-list">{customer.internalNotes.length ? customer.internalNotes.map((entry) => <li key={entry.noteId}><small>{new Date(entry.createdAt).toLocaleString()}</small><p>{entry.note}</p></li>) : <li>No internal account notes.</li>}</ul></SummaryCard>;
};

const CustomerEditForm = ({ organizationId, sessionScope, customer, canEdit }: Readonly<{ organizationId: string; sessionScope: string; customer: CustomerWorkspaceRead; canEdit: boolean }>) => {
  const editable = customer.editable ?? { companyName: customer.presentation.companyName ?? customer.displayName };
  const [editing, setEditing] = useState(false);
  const [companyName, setCompanyName] = useState(editable.companyName);
  const [displayName, setDisplayName] = useState(editable.displayName ?? "");
  const [email, setEmail] = useState(editable.email ?? "");
  const [phone, setPhone] = useState(editable.phone ?? "");
  const [billingStreet, setBillingStreet] = useState(editable.billingAddress?.street1 ?? "");
  const [billingStreet2, setBillingStreet2] = useState(editable.billingAddress?.street2 ?? "");
  const [billingCity, setBillingCity] = useState(editable.billingAddress?.city ?? "");
  const [billingState, setBillingState] = useState(editable.billingAddress?.state ?? "");
  const [billingPostalCode, setBillingPostalCode] = useState(editable.billingAddress?.postalCode ?? "");
  const [billingCountry, setBillingCountry] = useState(editable.billingAddress?.country ?? "");
  const [shippingStreet, setShippingStreet] = useState(editable.shippingAddress?.street1 ?? "");
  const [shippingStreet2, setShippingStreet2] = useState(editable.shippingAddress?.street2 ?? "");
  const [shippingCity, setShippingCity] = useState(editable.shippingAddress?.city ?? "");
  const [shippingState, setShippingState] = useState(editable.shippingAddress?.state ?? "");
  const [shippingPostalCode, setShippingPostalCode] = useState(editable.shippingAddress?.postalCode ?? "");
  const [shippingCountry, setShippingCountry] = useState(editable.shippingAddress?.country ?? "");
  const [paymentTerms, setPaymentTerms] = useState(customer.commercial.paymentTerms);
  const [creditLimit, setCreditLimit] = useState(customer.commercial.creditLimitCents === undefined ? "" : (customer.commercial.creditLimitCents / 100).toFixed(2));
  const [taxExempt, setTaxExempt] = useState(customer.commercial.taxExempt);
  const [taxExemptReason, setTaxExemptReason] = useState(customer.commercial.taxExemptReason ?? "");
  const [taxExemptCertificateRef, setTaxExemptCertificateRef] = useState(customer.commercial.taxExemptCertificateRef ?? "");
  const queryClient = useQueryClient();
  const save = useMutation({ mutationFn: () => { const creditLimitCents = creditLimit.trim() ? centsFromCommercialInput(creditLimit) : null; if (creditLimitCents === null && creditLimit.trim()) throw new Error("Credit limit must be a non-negative amount with at most two decimals."); return customerApi.update(organizationId, customer.customerId, { businessRequestId: newBusinessRequestId(), expectedRevision: customer.revision ?? "", companyName, ...(displayName.trim() ? { displayName } : {}), ...(email.trim() ? { email } : {}), ...(phone.trim() ? { phone } : {}), billingAddress: { ...(billingStreet.trim() ? { street1: billingStreet } : {}), ...(billingStreet2.trim() ? { street2: billingStreet2 } : {}), ...(billingCity.trim() ? { city: billingCity } : {}), ...(billingState.trim() ? { state: billingState } : {}), ...(billingPostalCode.trim() ? { postalCode: billingPostalCode } : {}), ...(billingCountry.trim() ? { country: billingCountry } : {}) }, shippingAddress: { ...(shippingStreet.trim() ? { street1: shippingStreet } : {}), ...(shippingStreet2.trim() ? { street2: shippingStreet2 } : {}), ...(shippingCity.trim() ? { city: shippingCity } : {}), ...(shippingState.trim() ? { state: shippingState } : {}), ...(shippingPostalCode.trim() ? { postalCode: shippingPostalCode } : {}), ...(shippingCountry.trim() ? { country: shippingCountry } : {}) }, paymentTerms, creditLimitCents, taxExempt, ...(taxExempt && taxExemptReason.trim() ? { taxExemptReason } : {}), ...(taxExempt && taxExemptCertificateRef.trim() ? { taxExemptCertificateRef } : {}) }); }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["v2", sessionScope, organizationId, "customers"] }); setEditing(false); } });
  if (!canEdit) return null;
  return editing ? <form className="v2-customer-create" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><label>Company name <input required maxLength={255} value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label><label>Display name <input maxLength={255} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Email <input type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Phone <input maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>Payment terms <select value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value as typeof paymentTerms)}><option value="due_on_receipt">Due on receipt</option><option value="net_15">Net 15</option><option value="net_30">Net 30</option><option value="net_45">Net 45</option><option value="custom">Custom</option></select></label><label>Credit limit (USD) <input inputMode="decimal" value={creditLimit} onChange={(event) => setCreditLimit(event.target.value)} placeholder="Unset" /></label><label><input type="checkbox" checked={taxExempt} onChange={(event) => setTaxExempt(event.target.checked)} /> Tax exempt</label>{taxExempt && <><label>Exemption reason <input maxLength={500} value={taxExemptReason} onChange={(event) => setTaxExemptReason(event.target.value)} /></label><label>Certificate reference <input maxLength={255} value={taxExemptCertificateRef} onChange={(event) => setTaxExemptCertificateRef(event.target.value)} /></label></>}<label>Billing street <input maxLength={255} value={billingStreet} onChange={(event) => setBillingStreet(event.target.value)} /></label><label>Billing unit / suite <input maxLength={255} value={billingStreet2} onChange={(event) => setBillingStreet2(event.target.value)} /></label><label>Billing city <input maxLength={100} value={billingCity} onChange={(event) => setBillingCity(event.target.value)} /></label><label>Billing state <input maxLength={100} value={billingState} onChange={(event) => setBillingState(event.target.value)} /></label><label>Billing postal code <input maxLength={20} value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} /></label><label>Billing country <input maxLength={100} value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} /></label><label>Shipping street <input maxLength={255} value={shippingStreet} onChange={(event) => setShippingStreet(event.target.value)} /></label><label>Shipping unit / suite <input maxLength={255} value={shippingStreet2} onChange={(event) => setShippingStreet2(event.target.value)} /></label><label>Shipping city <input maxLength={100} value={shippingCity} onChange={(event) => setShippingCity(event.target.value)} /></label><label>Shipping state <input maxLength={100} value={shippingState} onChange={(event) => setShippingState(event.target.value)} /></label><label>Shipping postal code <input maxLength={20} value={shippingPostalCode} onChange={(event) => setShippingPostalCode(event.target.value)} /></label><label>Shipping country <input maxLength={100} value={shippingCountry} onChange={(event) => setShippingCountry(event.target.value)} /></label><button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save Customer"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button>{save.isError && <p role="alert">{mutationErrorMessage(save.error, "Customer correction could not be saved. Reload and try again.")}</p>}</form> : <button type="button" onClick={() => setEditing(true)}>Edit Customer</button>;
};
