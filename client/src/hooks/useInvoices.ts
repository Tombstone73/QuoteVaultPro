import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Invoice, Payment, InvoiceLineItem } from '@shared/schema';

interface InvoiceWithRelations {
  invoice: Invoice;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
}

// List invoices
export function useInvoices(filters?: { status?: string; customerId?: string; orderId?: string }) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.customerId) params.append('customerId', filters.customerId);
      if (filters?.orderId) params.append('orderId', filters.orderId);
      const res = await fetch(`/api/invoices?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const data = await res.json();
      return data.data as Invoice[];
    },
  });
}

// Get invoice detail
export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await fetch(`/api/invoices/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invoice');
      const data = await res.json();
      return data.data as InvoiceWithRelations;
    },
    enabled: !!id,
  });
}

// Create invoice from order
export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; terms: string; customDueDate?: string }) => {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create invoice');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

// Update invoice
export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; notesPublic?: string; notesInternal?: string; terms?: string; customDueDate?: string }) => {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to update invoice');
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.id] });
    },
  });
}

// Delete invoice
export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete invoice');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

// Mark invoice sent
export function useMarkInvoiceSent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}/mark-sent`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to mark invoice sent');
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
    },
  });
}

// Send invoice via email
export function useSendInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, toEmail }: { id: string; toEmail?: string }) => {
      const res = await fetch(`/api/invoices/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send invoice');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.id] });
    },
  });
}

// Apply payment
export function useApplyPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { invoiceId: string; amount: number; method: string; notes?: string }) => {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to apply payment');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
    },
  });
}

// Delete payment
export function useDeletePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, invoiceId }: { id: string; invoiceId: string }) => {
      const res = await fetch(`/api/payments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete payment');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
    },
  });
}

// Refresh invoice status
export function useRefreshInvoiceStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}/refresh-status`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to refresh invoice status');
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
    },
  });
}
