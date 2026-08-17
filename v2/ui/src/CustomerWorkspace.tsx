import { useQuery } from "@tanstack/react-query";
import { customerApi } from "./api";

const address = (value: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }> | undefined) => {
  if (!value) return "Not recorded";
  return [...value.lines, [value.city, value.region, value.postalCode].filter(Boolean).join(" "), value.countryCode].filter(Boolean).join(", ");
};

/** Provisional V2 Customer destination. It deliberately does not mirror financial or order history. */
export const CustomerWorkspace = ({ organizationId, sessionScope, customerId, canView }: Readonly<{ organizationId: string; sessionScope: string; customerId: string; canView: boolean }>) => {
  const customer = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "customers", customerId],
    queryFn: () => customerApi.get(organizationId, customerId),
    enabled: Boolean(organizationId && sessionScope && customerId && canView),
  });
  if (!customerId) return <section className="v2-finance"><h1>Customers</h1><p>Select a Customer from an existing Sales or Finance record.</p></section>;
  if (!canView) return <section className="v2-finance"><h1>Customers</h1><p>You do not have permission to view this Customer.</p></section>;
  if (customer.isLoading) return <section className="v2-finance"><h1>Customers</h1><p>Loading Customer…</p></section>;
  if (customer.isError || !customer.data) return <section className="v2-finance"><h1>Customers</h1><p>This Customer is unavailable in the active organization.</p></section>;
  const value = customer.data;
  const identity = value.presentation;
  return <section className="v2-finance" aria-label="Customer workspace">
    <header className="v2-finance-heading"><div><p className="eyebrow">Sales / Customer</p><h1>{identity.customerDisplayName ?? value.displayName}</h1><p>{identity.companyName ?? "Customer record"}</p></div></header>
    <article className="v2-finance-detail"><header><div><h2>Customer context</h2><p>Canonical CRM identity used by Sales and Finance.</p></div></header><dl className="v2-invoice-totals">
      <div><dt>Customer ID</dt><dd>{value.customerId}</dd></div>
      <div><dt>Primary contact</dt><dd>{identity.contactDisplayName ?? "Not recorded"}</dd></div>
      <div><dt>Email</dt><dd>{identity.email ?? "Not recorded"}</dd></div>
      <div><dt>Phone</dt><dd>{identity.phone ?? "Not recorded"}</dd></div>
      <div><dt>Billing address</dt><dd>{address(identity.billingAddress)}</dd></div>
      <div><dt>Shipping address</dt><dd>{address(identity.shippingAddress)}</dd></div>
    </dl></article>
  </section>;
};
