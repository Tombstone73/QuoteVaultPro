import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Invoice, Payment, InvoiceLineItem } from '@shared/schema';
import type { InvoiceAccountingDisplay, QuickBooksLineItemDisplay } from '@shared/invoiceAccountingDisplay';
import type { InvoiceEmailRecipient } from '@shared/invoiceEmailRecipients';
import { apiRequest } from '@/lib/queryClient';

export type InvoiceEmailStatus = 'not_sent' | 'sent_current' | 'sent_outdated';
export type InvoiceEmailDeliveryStatus = 'queued' | 'processing' | 'retrying' | 'sent' | 'failed' | 'needs_review' | 'canceled';

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
  // Queue state is diagnostic only. Last Sent remains populated exclusively
  // after the provider-successful canonical email log is written.
  emailDeliveryStatus: InvoiceEmailDeliveryStatus | null;
  emailDeliveryJobId: string | null;
  emailDeliveryFailureReason: string | null;
  emailDeliveryUpdatedAt: string | null;
  // Reminder tracking
  reminderStatus: ReminderListStatus;
  lastReminderSentAt: string | null;
  lastReminderRecipient: string | null;
  nextReminderDueAt: string | null;
}

export interface InvoiceListPagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface InvoiceDashboardSummary {
  totalInvoices: number;
  totalOutstandingCents: number;
  overdueCount: number;
  paidThisMonthCents: number;
}

export interface InvoiceListResponse {
  items: InvoiceListItem[];
  pagination: InvoiceListPagination;
  summary: InvoiceDashboardSummary;
}

export type InvoiceEmailQueueJob = { id: string; invoiceId: string; invoiceNumber: string | null; legacyInvoiceNumber: number | null; customerName: string | null; recipientEmail: string; status: InvoiceEmailDeliveryStatus; attemptCount: number; maxAttempts: number; queuedAt: string; claimedAt: string | null; claimExpiresAt: string | null; updatedAt: string; availableAt: string; sentAt: string | null; failureReason: string | null; providerMessageId: string | null; metadata: { deliveryReview?: { resolution?: 'verified_not_sent'; reviewedAt?: string; reviewedByUserName?: string | null; replacementJobId?: string } }; };
export type InvoiceEmailQueueResponse = { items: InvoiceEmailQueueJob[]; pagination: InvoiceListPagination; counts: { active: number; failed: number; needsReview: number }; claimSeconds: number };

export function useInvoiceEmailQueue(open: boolean, view: 'active' | 'failed' | 'sent' | 'all', page: number) {
  return useQuery<InvoiceEmailQueueResponse>({
    queryKey: ['invoices', 'email-queue', view, page], enabled: open,
    refetchInterval: (query) => open && Number(query.state.data?.counts.active || 0) > 0 ? 5_000 : false,
    queryFn: async () => {
      const response = await fetch(`/api/invoices/email-queue?view=${view}&page=${page}&pageSize=25`, { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to load invoice email queue');
      return payload.data;
    },
  });
}

export type InvoiceListColumnFilterQuery = {
  accountingApproval?: 'approved' | 'not_approved' | 'needs_reapproval';
  customer?: string;
  contact?: string;
  jobName?: string;
  purchaseOrderNumber?: string;
  columnOrderNumber?: string;
  invoiceNumber?: string;
  issueDateFrom?: string;
  issueDateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  lastSent?: 'sent' | 'not_sent';
  totalMin?: string;
  totalMax?: string;
  paidMin?: string;
  paidMax?: string;
  balanceMin?: string;
  balanceMax?: string;
};

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

export type StripeInvoiceRefundRequest = {
  id: string;
  paymentId: string;
  status: 'reserved' | 'submitted' | 'succeeded' | 'failed' | string;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
};

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

/** Bounded list read for the Invoice dashboard. Legacy consumers retain useInvoices(). */
export function useInvoicesPage(filters: {
  status?: string;
  customerId?: string;
  orderId?: string;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
} & InvoiceListColumnFilterQuery) {
  return useQuery<InvoiceListResponse>({
    queryKey: ['invoices', filters],
    // Poll only while this visible page contains active delivery work. This
    // lets Queue → Sending → Sent/Failed replace the temporary queue label
    // with authoritative backend state without manufacturing Last Sent in
    // the browser or polling an idle invoice workspace.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((invoice) => ["queued", "processing", "retrying"].includes(String(invoice.emailDeliveryStatus || "")))
        ? 5_000
        : false;
    },
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.customerId) params.append('customerId', filters.customerId);
      if (filters?.orderId) params.append('orderId', filters.orderId);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.sortBy) params.append('sortBy', filters.sortBy);
      if (filters?.sortDir) params.append('sortDir', filters.sortDir);
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.pageSize) params.append('pageSize', String(filters.pageSize));
      const columnKeys: Array<keyof InvoiceListColumnFilterQuery> = [
        'customer', 'contact', 'jobName', 'purchaseOrderNumber', 'columnOrderNumber', 'invoiceNumber',
        'accountingApproval',
        'issueDateFrom', 'issueDateTo', 'dueDateFrom', 'dueDateTo', 'lastSent',
        'totalMin', 'totalMax', 'paidMin', 'paidMax', 'balanceMin', 'balanceMax',
      ];
      for (const key of columnKeys) {
        const value = filters[key];
        if (value) params.append(key, value);
      }
      params.append('includeSummary', '1');
      const res = await fetch(`/api/invoices?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const data = await res.json();
      if (!data.summary || !data.pagination) {
        throw new Error('Invoice dashboard data is unavailable. Refresh after the current backend deployment completes.');
      }
      return {
        items: (data.data || []) as InvoiceListItem[],
        pagination: data.pagination as InvoiceListPagination,
        summary: data.summary as InvoiceDashboardSummary,
      };
    },
  });
}

// Get invoice detail
export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: async () => {
      if (!id) return null;
      // Invoice financial state must be authoritative after a payment settles.
      // Avoid accepting a browser-cached representation during settlement.
      const res = await fetch(`/api/invoices/${id}`, { credentials: 'include', cache: 'no-store' });
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
      // Keep payment history in lockstep with the invoice detail after Stripe
      // confirmation by requesting a fresh authoritative representation.
      const res = await fetch(`/api/invoices/${id}/payments`, { credentials: 'include', cache: 'no-store' });
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

/** Owner/admin-only view of durable, non-financial Stripe refund requests. */
export function useStripeInvoiceRefundRequests(invoiceId: string | undefined, enabled: boolean) {
  return useQuery<StripeInvoiceRefundRequest[]>({
    queryKey: ['stripeInvoiceRefundRequests', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/stripe/refund-requests`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch Stripe refund requests');
      const body = await res.json();
      return (body.data || []) as StripeInvoiceRefundRequest[];
    },
    enabled: Boolean(invoiceId) && enabled,
  });
}

/** Reads an existing Stripe refund and delegates reconciliation to the server. */
export function useRecoverStripeInvoiceRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { invoiceId: string; paymentId: string; refundRequestId: string }) => {
      const res = await apiRequest(
        'POST',
        `/api/invoices/${encodeURIComponent(payload.invoiceId)}/payments/${encodeURIComponent(payload.paymentId)}/stripe/refunds/${encodeURIComponent(payload.refundRequestId)}/reconcile`,
      );
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoicePayments', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['stripeInvoiceRefundRequests', variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
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

export function useApproveInvoicesForAccounting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceIds: string[]) => {
      const endpoint = invoiceIds.length === 1
        ? `/api/invoices/${encodeURIComponent(invoiceIds[0])}/approve-for-accounting`
        : '/api/invoices/accounting-approval/bulk';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: invoiceIds.length === 1 ? undefined : JSON.stringify({ invoiceIds }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Failed to approve invoice for accounting');
      }
      return res.json();
    },
    onSuccess: (_, invoiceIds) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      invoiceIds.forEach((id) => queryClient.invalidateQueries({ queryKey: ['invoices', id] }));
      queryClient.invalidateQueries({ queryKey: ['quickbooksSyncQueue'] });
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
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
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
    mutationFn: async ({ invoiceIds, dryRun = false, idempotencyKey }: { invoiceIds: string[]; dryRun?: boolean; idempotencyKey?: string }) => {
      const res = await fetch('/api/invoices/batch-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({ invoiceIds, dryRun }),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((payload as any).error || (payload as any).message || 'Failed to send selected invoices');
      }
      return payload as {
        success: boolean;
        data: {
          selected: number;
          eligible: number;
          queued?: number;
          alreadyQueued?: number;
          blocked?: Array<{ invoiceId: string; recipientEmail: string; status: 'queued' | 'processing' | 'retrying' | 'needs_review' }>;
          recipientGroups: number;
          skipped: Array<{ invoiceId: string; reason: string }>;
          deliveryMode: 'individual_invoice_messages';
          campaignId?: string | null;
        };
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/operational-summary'] });
    },
  });
}

export function useResolveInvoiceEmailDeliveryReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId }: { jobId: string }) => {
      const response = await fetch(`/api/invoices/email-queue/${jobId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'verified_not_sent' }),
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to resolve invoice email delivery');
      return payload.data as { originalJobId: string; replacementJob: { id: string; status: InvoiceEmailDeliveryStatus; attemptCount: number; maxAttempts: number }; replayed: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices', 'email-queue'] });
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
