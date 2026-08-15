import { useQuery } from "@tanstack/react-query";
import { quoteApi } from "./api";

export const quoteKeys = {
  quote: (organizationId: string, quoteId: string) =>
    ["v2", organizationId, "quote", quoteId] as const,
  bootstrap: (organizationId: string) =>
    ["v2", organizationId, "ui-bootstrap"] as const,
};

export const quoteFormKeys = {
  customers: (organizationId: string) =>
    ["v2", organizationId, "quote-form", "customers"] as const,
  contacts: (organizationId: string, customerId: string) =>
    ["v2", organizationId, "quote-form", "contacts", customerId] as const,
  products: (organizationId: string) =>
    ["v2", organizationId, "quote-form", "products"] as const,
  configuration: (organizationId: string, productId: string) =>
    ["v2", organizationId, "quote-form", "configuration", productId] as const,
};

export const quoteFormQueryOptions = {
  customers: (organizationId: string) => ({
    queryKey: quoteFormKeys.customers(organizationId),
    queryFn: () => quoteApi.customers(organizationId),
    enabled: Boolean(organizationId),
  }),
  contacts: (organizationId: string, customerId: string) => ({
    queryKey: quoteFormKeys.contacts(organizationId, customerId),
    queryFn: () => quoteApi.contacts(organizationId, customerId),
    enabled: Boolean(organizationId && customerId),
  }),
  products: (organizationId: string) => ({
    queryKey: quoteFormKeys.products(organizationId),
    queryFn: () => quoteApi.products(organizationId),
    enabled: Boolean(organizationId),
  }),
  configuration: (organizationId: string, productId: string) => ({
    queryKey: quoteFormKeys.configuration(organizationId, productId),
    queryFn: () => quoteApi.configuration(organizationId, productId),
    enabled: Boolean(organizationId && productId),
  }),
};

export const useQuoteFormCustomers = (organizationId: string) =>
  useQuery(quoteFormQueryOptions.customers(organizationId));
export const useQuoteFormContacts = (
  organizationId: string,
  customerId: string,
) => useQuery(quoteFormQueryOptions.contacts(organizationId, customerId));
export const useQuoteFormProducts = (organizationId: string) =>
  useQuery(quoteFormQueryOptions.products(organizationId));
export const useQuoteFormConfiguration = (
  organizationId: string,
  productId: string,
) => useQuery(quoteFormQueryOptions.configuration(organizationId, productId));
