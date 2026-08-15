import { useQuery } from "@tanstack/react-query";
import { quoteApi } from "./api";

export const quoteFormKeys = {
  customers: (organizationId: string) => ["v2", organizationId, "quote-form", "customers"] as const,
  contacts: (organizationId: string, customerId: string) => ["v2", organizationId, "quote-form", "contacts", customerId] as const,
  products: (organizationId: string) => ["v2", organizationId, "quote-form", "products"] as const,
  configuration: (organizationId: string, productId: string) => ["v2", organizationId, "quote-form", "configuration", productId] as const,
};
export const useQuoteFormCustomers = (organizationId: string) => useQuery({ queryKey: quoteFormKeys.customers(organizationId), queryFn: () => quoteApi.customers(organizationId), enabled: Boolean(organizationId) });
export const useQuoteFormContacts = (organizationId: string, customerId: string) => useQuery({ queryKey: quoteFormKeys.contacts(organizationId, customerId), queryFn: () => quoteApi.contacts(organizationId, customerId), enabled: Boolean(organizationId && customerId) });
export const useQuoteFormProducts = (organizationId: string) => useQuery({ queryKey: quoteFormKeys.products(organizationId), queryFn: () => quoteApi.products(organizationId), enabled: Boolean(organizationId) });
export const useQuoteFormConfiguration = (organizationId: string, productId: string) => useQuery({ queryKey: quoteFormKeys.configuration(organizationId, productId), queryFn: () => quoteApi.configuration(organizationId, productId), enabled: Boolean(organizationId && productId) });
