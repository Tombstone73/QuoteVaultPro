import { useQuery } from "@tanstack/react-query";
import { quoteApi } from "./api";

export const quoteKeys = {
  quote: (sessionScope: string, organizationId: string, quoteId: string) =>
    ["v2", sessionScope, organizationId, "quote", quoteId] as const,
  bootstrap: (sessionScope: string, organizationId: string) =>
    ["v2", sessionScope, organizationId, "ui-bootstrap"] as const,
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
export const useQuoteFormContacts = (
  sessionScope: string,
  organizationId: string,
  customerId: string,
) => useQuery(quoteFormQueryOptions.contacts(sessionScope, organizationId, customerId));
export const useQuoteFormProducts = (sessionScope: string, organizationId: string) =>
  useQuery(quoteFormQueryOptions.products(sessionScope, organizationId));
export const useQuoteFormConfiguration = (
  sessionScope: string,
  organizationId: string,
  productId: string,
) => useQuery(quoteFormQueryOptions.configuration(sessionScope, organizationId, productId));
