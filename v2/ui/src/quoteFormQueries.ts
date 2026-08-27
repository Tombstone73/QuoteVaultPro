import { useQuery } from "@tanstack/react-query";
import { customerApi, orderApi, quoteApi } from "./api";

export const quoteKeys = {
  quote: (sessionScope: string, organizationId: string, quoteId: string) =>
    ["v2", sessionScope, organizationId, "quote", quoteId] as const,
  bootstrap: (sessionScope: string, organizationId: string) =>
    ["v2", sessionScope, organizationId, "ui-bootstrap"] as const,
};

export const salesKeys = {
  quotes: (sessionScope: string, organizationId: string, query: Readonly<{ q?: string; lifecycle?: string; dueFrom?: string; dueTo?: string; sort?: "updated_desc" | "updated_asc"; cursor?: string }> = {}) =>
    ["v2", sessionScope, organizationId, "sales", "quotes", query.q ?? "", query.lifecycle ?? "", query.dueFrom ?? "", query.dueTo ?? "", query.sort ?? "updated_desc", query.cursor ?? ""] as const,
  orders: (sessionScope: string, organizationId: string, query: Readonly<{ q?: string; lifecycle?: string; dueFrom?: string; dueTo?: string; sort?: "updated_desc" | "updated_asc"; cursor?: string }> = {}) =>
    ["v2", sessionScope, organizationId, "sales", "orders", query.q ?? "", query.lifecycle ?? "", query.dueFrom ?? "", query.dueTo ?? "", query.sort ?? "updated_desc", query.cursor ?? ""] as const,
  order: (sessionScope: string, organizationId: string, orderId: string) =>
    ["v2", sessionScope, organizationId, "order", orderId] as const,
};

export const quoteFormKeys = {
  customers: (sessionScope: string, organizationId: string) =>
    ["v2", sessionScope, organizationId, "quote-form", "customers"] as const,
  contacts: (sessionScope: string, organizationId: string, customerId: string) =>
    ["v2", sessionScope, organizationId, "quote-form", "contacts", customerId] as const,
  products: (sessionScope: string, organizationId: string) =>
    ["v2", sessionScope, organizationId, "quote-form", "products"] as const,
  configuration: (sessionScope: string, organizationId: string, productId: string) =>
    ["v2", sessionScope, organizationId, "quote-form", "configuration", productId] as const,
};

/** Customer is CRM-owned. Sales asks CRM for a bounded, tenant-scoped search result. */
export const customerLookupKeys = {
  search: (sessionScope: string, organizationId: string, query: string) =>
    ["v2", sessionScope, organizationId, "customer-lookup", query.trim().toLocaleLowerCase()] as const,
};

export const customerLookupQueryOptions = (
  sessionScope: string,
  organizationId: string,
  query: string,
  enabled = true,
) => ({
  queryKey: customerLookupKeys.search(sessionScope, organizationId, query),
  queryFn: () => customerApi.list(organizationId, query.trim()),
  // The CRM endpoint is bounded even with an empty term.  Sales can therefore
  // offer a useful browse list without treating that first page as the tenant's
  // complete Customer catalog; typed terms always remain server-side searches.
  enabled: Boolean(enabled && sessionScope && organizationId),
});

export const quoteFormQueryOptions = {
  customers: (sessionScope: string, organizationId: string) => ({
    queryKey: quoteFormKeys.customers(sessionScope, organizationId),
    queryFn: () => quoteApi.customers(organizationId),
    enabled: Boolean(sessionScope && organizationId),
  }),
  contacts: (sessionScope: string, organizationId: string, customerId: string) => ({
    queryKey: quoteFormKeys.contacts(sessionScope, organizationId, customerId),
    queryFn: () => quoteApi.contacts(organizationId, customerId),
    enabled: Boolean(sessionScope && organizationId && customerId),
  }),
  products: (sessionScope: string, organizationId: string) => ({
    queryKey: quoteFormKeys.products(sessionScope, organizationId),
    queryFn: () => quoteApi.products(organizationId),
    enabled: Boolean(sessionScope && organizationId),
  }),
  configuration: (sessionScope: string, organizationId: string, productId: string) => ({
    queryKey: quoteFormKeys.configuration(sessionScope, organizationId, productId),
    queryFn: () => quoteApi.configuration(organizationId, productId),
    enabled: Boolean(sessionScope && organizationId && productId),
  }),
};

export const useQuoteFormCustomers = (sessionScope: string, organizationId: string) =>
  useQuery(quoteFormQueryOptions.customers(sessionScope, organizationId));
export const useCustomerLookup = (
  sessionScope: string,
  organizationId: string,
  query: string,
  enabled = true,
) => useQuery(customerLookupQueryOptions(sessionScope, organizationId, query, enabled));
export const useQuoteFormContacts = (
  sessionScope: string,
  organizationId: string,
  customerId: string,
) => useQuery(quoteFormQueryOptions.contacts(sessionScope, organizationId, customerId));
export const useQuoteFormProducts = (sessionScope: string, organizationId: string) =>
  useQuery(quoteFormQueryOptions.products(sessionScope, organizationId));
export const useSalesQuotes = (sessionScope: string, organizationId: string, query: Readonly<{ q?: string; lifecycle?: string; dueFrom?: string; dueTo?: string; sort?: "updated_desc" | "updated_asc"; cursor?: string }> = {}) =>
  useQuery({ queryKey: salesKeys.quotes(sessionScope, organizationId, query), queryFn: () => quoteApi.list(organizationId, query), enabled: Boolean(sessionScope && organizationId) });
export const useSalesOrders = (sessionScope: string, organizationId: string, query: Readonly<{ q?: string; lifecycle?: string; dueFrom?: string; dueTo?: string; sort?: "updated_desc" | "updated_asc"; cursor?: string }> = {}) =>
  useQuery({ queryKey: salesKeys.orders(sessionScope, organizationId, query), queryFn: () => orderApi.list(organizationId, query), enabled: Boolean(sessionScope && organizationId) });
export const useQuoteFormConfiguration = (
  sessionScope: string,
  organizationId: string,
  productId: string,
) => useQuery(quoteFormQueryOptions.configuration(sessionScope, organizationId, productId));
