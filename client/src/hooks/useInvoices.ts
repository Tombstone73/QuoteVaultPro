import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Invoice, Payment, InvoiceLineItem } from '@shared/schema';
import type { InvoiceAccountingDisplay, QuickBooksLineItemDisplay } from '@shared/invoiceAccountingDisplay';
import type { InvoiceEmailRecipient } from '@shared/invoiceEmailRecipients';
import { apiRequest } from '@/lib/queryClient';

export type InvoiceEmailStatus = 'not_sent' | 'sent_current' | 'sent_outdated';

export type ReminderListStatus =
  | 'due'
  | 'sent'
  | 'disabled'
  | 'not_due'
  | 'stopped'
  | 'maxed_out'
  | 'blocked';

export interface InvoiceListItem extends Omit<Invoice, 'lastSentAt'>, InvoiceAccountingDisplay {
  customerName: string | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  orderNumber: string | null;
  orderName: string | null;
  jobName: string | null;
  purchaseOrderNumber: string | null;
  // Email send tracking (original invoice send only — reminders excluded)
  lastSentAt: string | null;
  lastInvoiceEmailRecipient: string | null;
  emailStatus: InvoiceEmailStatus;
  // Reminder tracking
  reminderStatus: ReminderListStatus;
  lastReminderSentAt: string | null;
  lastReminderRecipient: string | null;
  nextReminderDueAt: string | null;
}

export interface InvoiceWithEmailTracking extends Omit<Invoice, 'lastSentAt'>, InvoiceAccountingDisplay {
  lastSentAt?: string | null;
  emailStatus?: InvoiceEmailStatus;
}

interface InvoiceWithRelations {
  invoice: InvoiceWithEmailTracking;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  importedQuickBooksLineItems?: QuickBooksLineItemDisplay[];
  importedQuickBooksLineItemsUnavailableMessage?: string | null;
}

export interface InvoicePaymentWithCreatedBy extends Payment {
  createdBy?: { id: string; name: string | null; email: string | null } | null;
}

// List invoices
export function useInvoices(filters?: {
  status?: string;
  customerId?: string;
  orderId?: string;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  return useQuery<InvoiceListItem[]>({
    queryKey: ['invoices', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.customerId) params.append('customerId', filters.customerId);
      if (filters?.orderId) params.append('orderId', filters.orderId);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.sortBy) params.append('sortBy', filters.sortBy);
      if (filters?.sortDir) params.append('sortDir', filters.sortDir);
      const res = await fetch(`/api/invoices?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const data = await res.json();
      return data.data as InvoiceListItem[];
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

// Invoice-scoped payments list (tenant-scoped server-side)
export function useInvoicePayments(id: string | undefined) {
  return useQuery({
    queryKey: ['invoicePayments', id],
    queryFn: async () => {
      if (!id) return [] as InvoicePaymentWithCreatedBy[];
      const res = await fetch(`/api/invoices/${id}/payments`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invoice payments');
      const data = await res.json();
      return (data.data || []) as InvoicePaymentWithCreatedBy[];
    },
    enabled: !!id,
  });
}

export function useRecordManualInvoicePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      invoiceId: string;
      amountCents: number;
      method: string;
      appliedAt?: string;
      notes?: string;
      reference?: string;
      idempotencyKey: string;
    }) => {
      const res = await fetch(`/api/invoices/${payload.invoiceId}/payments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payload.idempotencyKey },
        body: JSON.stringify({
          amountCents: payload.amountCents,
          method: payload.method,
          appliedAt: payload.appliedAt,
          notes: payload.notes,
          reference: payload.reference,
        }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to record payment');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoicePayments', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
    },
  });
}

export function useVoidInvoicePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { invoiceId: string; paymentId: string }) => {
      const res = await fetch(`/api/invoices/${payload.invoiceId}/payments/${payload.paymentId}/void`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to void payment');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoicePayments', variables.invoiceId] });
    },
  });
}

/** Initiates a Stripe refund. Webhook reconciliation remains the source of truth for payment effects. */
export function useInitiateStripeInvoiceRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      invoiceId: string;
      paymentId: string;
      amountCents: number;
      idempotencyKey: string;
    }) => {
      const res = await apiRequest(
        'POST',
        `/api/invoices/${encodeURIComponent(payload.invoiceId)}/payments/${encodeURIComponent(payload.paymentId)}/stripe/refund`,
        { amountCents: payload.amountCents },
        { headers: { 'Idempotency-Key': payload.idempotencyKey } },
      );
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoicePayments', variables.invoiceId] });
    },
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

// Create draft invoice from order (preferred endpoint)
export function useCreateOrderInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; terms?: string; customDueDate?: string }) => {
      const res = await fetch(`/api/orders/${payload.orderId}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: payload.terms || 'due_on_receipt', customDueDate: payload.customDueDate }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to create invoice');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', { orderId: variables.orderId }] });
    },
  });
}

// Update invoice
export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      notesPublic?: string;
      notesInternal?: string;
      terms?: string;
      customDueDate?: string;
      subtotalCents?: number;
      taxCents?: number;
      shippingCents?: number;
      customerId?: string;
    }) => {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to update invoice');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.id] });
    },
  });
}

// Bill invoice (draft -> billed)
export function useBillInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}/bill`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to bill invoice');
      }
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
    },
  });
}

// Retry QuickBooks sync for invoice
export function useRetryInvoiceQbSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}/retry-qb-sync`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to retry QuickBooks sync');
      }
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
    },
  });
}

// Queue invoice for explicit QuickBooks sync. Finalize/send do not sync automatically.
export function useQueueInvoiceQbSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/invoices/${id}/qb/queue`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to queue QuickBooks sync');
      }
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
    },
  });
}

// Apply payment via invoice-scoped endpoint
export function useApplyInvoicePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { invoiceId: string; amount: number; method: string; note?: string }) => {
      const res = await fetch(`/api/invoices/${payload.invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ amount: payload.amount, method: payload.method, note: payload.note }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to apply payment');
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
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
    mutationFn: async ({ id, via }: { id: string; via: 'email' | 'manual' | 'portal' }) => {
      const res = await fetch(`/api/invoices/${id}/mark-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ via }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to mark invoice sent');
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/timeline'] });
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
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
    },
  });
}

export type InvoiceEmailRecipientsResponse = {
  recipients: InvoiceEmailRecipient[];
  defaultRecipient: InvoiceEmailRecipient | null;
};

export function useInvoiceEmailRecipients(invoiceId?: string, enabled = true) {
  return useQuery<InvoiceEmailRecipientsResponse>({
    queryKey: ['invoices', invoiceId, 'email-recipients'],
    enabled: Boolean(invoiceId) && enabled,
    queryFn: async () => {
      const response = await fetch(`/api/invoices/${invoiceId}/email-recipients`, { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to load invoice email recipients');
      return payload.data;
    },
  });
}

export function useBatchSendInvoices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceIds }: { invoiceIds: string[] }) => {
      const res = await fetch('/api/invoices/batch-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds }),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((payload as any).error || (payload as any).message || 'Failed to send selected invoices');
      }
      return payload as {
        success: boolean;
        data: {
          sent: number;
          failed: number;
          results: Array<{ invoiceId: string; success: boolean; message?: string }>;
        };
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
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
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
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

// ---- Reminder hooks --------------------------------------------------------

export interface ReminderLogEntry {
  id: string;
  sentAt: string;
  recipientEmail: string | null;
  status: 'sent' | 'failed';
  reminderNumber: number;
  messageId: string | null;
  failureReason: string | null;
}

// Fetch reminder history for one invoice
export function useInvoiceReminderHistory(invoiceId: string | undefined) {
  return useQuery<ReminderLogEntry[]>({
    queryKey: ['invoiceReminderHistory', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const res = await fetch(`/api/invoices/${invoiceId}/reminder-history`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch reminder history');
      const data = await res.json();
      return (data.data || []) as ReminderLogEntry[];
    },
    enabled: !!invoiceId,
  });
}

// Manually send a reminder for one invoice
export function useSendInvoiceReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/invoices/${invoiceId}/send-reminder`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to send reminder');
      }
      return data as { success: true; lastReminderSentAt: string | null; reminderCount: number };
    },
    onSuccess: (_, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoiceReminderHistory', invoiceId] });
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
