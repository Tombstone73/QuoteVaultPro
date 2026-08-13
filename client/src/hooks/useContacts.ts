/*
 * CONTACTS HOOKS
 * 
 * Provides React Query hooks for:
 * - Fetching contact list with search/pagination
 * - Fetching contact details
 * - Updating contacts
 * - Deleting contacts
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  buildContactListQueryKey,
  buildContactListSearchParams,
  normalizeContactListResponse,
  type ContactListSortBy,
  type ContactListSortDir,
} from "@/lib/contactListQuery";

export interface Contact {
  id: string;
  customerId: string | null;
  organizationId?: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Structured address fields
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  // Internal CRM fields
  internalNotes?: string | null;
  flags?: string[] | null;
}

export interface ContactWithStats extends Contact {
  companyName: string;
  linkedCustomersCount?: number;
  linkedCustomers?: Array<{ id: string; companyName: string; status: string; isPrimary: boolean }>;
  ordersCount: number;
  quotesCount: number;
  lastActivityAt: Date | null;
}

export interface ContactsResponse {
  contacts: ContactWithStats[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ContactDetailResponse {
  contact: Contact;
  customer: {
    id: string;
    companyName: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    address: string | null;
  };
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    createdAt: Date;
    total: number;
  }>;
  recentQuotes: Array<{
    id: string;
    quoteNumber: number;
    status: string | null;
    createdAt: Date;
    totalPrice: number;
  }>;
}

export interface UpdateContactInput {
  customerId?: string | null;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  isPrimary?: boolean;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  internalNotes?: string | null;
  flags?: string[] | null;
}

export interface CreateContactInput extends UpdateContactInput {
  customerId?: string | null;
  firstName: string;
  lastName: string;
}

export function useContacts(filters?: { search?: string; page?: number; pageSize?: number; sortBy?: ContactListSortBy; sortDir?: ContactListSortDir; filter?: string }) {
  const queryState = {
    search: filters?.search ?? "",
    filter: filters?.filter ?? "",
    page: filters?.page ?? 1,
    pageSize: filters?.pageSize ?? 20,
    sortBy: filters?.sortBy ?? "lastName",
    sortDir: filters?.sortDir ?? "asc",
  };

  return useQuery<ContactsResponse>({
    queryKey: buildContactListQueryKey(queryState),
    queryFn: async () => {
      const params = buildContactListSearchParams(queryState);

      const response = await fetch(`/api/contacts?${params.toString()}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch contacts");
      }

      return normalizeContactListResponse<ContactWithStats>(await response.json());
    },
  });
}

export function useContactDetail(contactId: string | undefined) {
  return useQuery<ContactDetailResponse>({
    queryKey: ["contacts", contactId],
    queryFn: async () => {
      if (!contactId) throw new Error("Contact ID is required");

      const response = await fetch(`/api/contacts/${contactId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch contact details");
      }

      return response.json();
    },
    enabled: !!contactId,
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateContactInput }) => {
      const response = await fetch(`/api/customer-contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update contact");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Success",
        description: "Contact updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateContactInput) => {
      const { customerId, ...contactData } = data;
      const response = await fetch(customerId ? `/api/customers/${customerId}/contacts` : "/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactData),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create contact");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Success",
        description: "Contact created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (contactId: string) => {
      const response = await fetch(`/api/customer-contacts/${contactId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete contact");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Success",
        description: "Contact deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
