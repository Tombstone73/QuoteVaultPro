/*
 * CONTACTS IMPLEMENTATION AUDIT
 * 
 * What already exists:
 * - Backend: customerContacts table in schema.ts with CRUD operations
 * - Backend: /api/customers/:customerId/contacts route for getting contacts by customer
 * - Backend: /api/customer-contacts/:id for PATCH/DELETE single contact
 * - Component: contact-form.tsx for creating/editing contacts (used in customer detail page)
 * - Contact search in CustomerSelect dropdown component (for quotes/orders)
 * 
 * What was missing (being added now):
 * - Backend: GET /api/contacts with search/pagination for global contact list
 * - Backend: GET /api/contacts/:id for contact detail with orders/quotes
 * - Frontend: This useContacts hook for fetching contact list and detail
 * - Frontend: contacts.tsx page for contact list view
 * - Frontend: contact-detail.tsx page for individual contact view
 * - Frontend: Navigation entry for Contacts section
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Contact {
  id: string;
  customerId: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactWithStats extends Contact {
  customerName: string;
  ordersCount: number;
  quotesCount: number;
  lastActivityAt: Date | null;
}

interface ContactsResponse {
  contacts: ContactWithStats[];
  total: number;
}

interface ContactDetailResponse {
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

export function useContacts(filters?: { search?: string; page?: number; pageSize?: number }) {
  return useQuery<ContactsResponse>({
    queryKey: ["contacts", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.append("search", filters.search);
      if (filters?.page) params.append("page", filters.page.toString());
      if (filters?.pageSize) params.append("pageSize", filters.pageSize.toString());

      const response = await fetch(`/api/contacts?${params.toString()}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch contacts");
      }

      return response.json();
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
        throw new Error("Failed to delete contact");
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
