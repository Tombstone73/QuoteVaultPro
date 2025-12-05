/**
 * useCustomer Hook
 * 
 * Provides React Query hooks for fetching individual customer data
 * with related entities (contacts, quotes, orders, invoices).
 */

import { useQuery } from "@tanstack/react-query";

export interface CustomerContact {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isBilling: boolean;
}

export interface CustomerNote {
  id: string;
  noteType: string;
  subject: string | null;
  content: string;
  createdAt: string;
}

export interface CustomerCreditTransaction {
  id: string;
  transactionType: string;
  amount: string;
  balanceAfter: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface CustomerQuote {
  id: string;
  quoteNumber: number;
  totalPrice: string;
  status: string;
  createdAt: string;
  lineItems?: Array<{
    id: string;
    description: string;
    quantity: number;
  }>;
}

export interface CustomerWithRelations {
  id: string;
  companyName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  customerType: string;
  shippingAddressLine1: string | null;
  shippingAddressLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZipCode: string | null;
  shippingCountry: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZipCode: string | null;
  billingCountry: string | null;
  currentBalance: string;
  creditLimit: string;
  availableCredit: string;
  paymentTerms: string;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  contacts: CustomerContact[];
  notes: CustomerNote[];
  creditTransactions: CustomerCreditTransaction[];
  quotes: CustomerQuote[];
}

export function useCustomer(customerId: string | undefined) {
  return useQuery<CustomerWithRelations>({
    queryKey: [`/api/customers/${customerId}`],
    queryFn: async () => {
      if (!customerId) throw new Error("Customer ID is required");
      const response = await fetch(`/api/customers/${customerId}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch customer");
      }
      return response.json();
    },
    enabled: !!customerId,
  });
}

export function useCustomerQuotes(customerId: string | undefined) {
  return useQuery<CustomerQuote[]>({
    queryKey: ["/api/quotes", { customerId }],
    queryFn: async () => {
      if (!customerId) return [];
      const response = await fetch(`/api/quotes?customerId=${customerId}`, {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!customerId,
  });
}
