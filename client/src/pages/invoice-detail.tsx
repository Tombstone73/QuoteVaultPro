import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PdfViewer } from "@/components/media/PdfViewer";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Mail, DollarSign, Trash2, RefreshCw, CreditCard, HandCoins, AlertCircle, ExternalLink } from "lucide-react";
import { computeInvoicePaymentRollup, getInvoicePaymentStatusLabel } from "@shared/rollups/invoicePaymentRollup";
import { useAuth } from "@/hooks/useAuth";
import { useInvoice, useBillInvoice, useRetryInvoiceQbSync, useSendInvoice, useRefreshInvoiceStatus, useDeleteInvoice, useMarkInvoiceSent, useUpdateInvoice, useInvoicePayments, useRecordManualInvoicePayment, useVoidInvoicePayment } from "@/hooks/useInvoices";
import { useOrder } from "@/hooks/useOrders";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/titan/Page";
import { format } from "date-fns";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TimelinePanel } from "@/components/TimelinePanel";
import StripePayDialog from "@/components/payments/StripePayDialog";
import { QBTransientDisconnectBanner } from "@/components/integrations/QBTransientDisconnectBanner";

type StripeIntegrationStatusEnvelope = {
  success: boolean;
  data?: {
    connected?: boolean;
    chargesEnabled?: boolean;
    stripeAccountId?: string | null;
  };
};

type QuickBooksIntegrationStatus = {
  connected?: boolean;
  authState?: 'connected' | 'not_connected' | 'needs_reauth' | string;
  healthState?: 'ok' | 'transient_error' | string;
  healthMessage?: string;
  lastErrorAt?: string;
  message?: string;
  companyId?: string;
  connectedAt?: string;
  expiresAt?: string;
  error?: string;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span className="text-xs text-muted-foreground">Saving…</span>;
  if (state === 'saved') return <span className="text-xs text-muted-foreground">Saved</span>;
  return <span className="text-xs text-destructive">Error</span>;
}

function StatusStrip({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))] xl:[grid-template-columns:repeat(8,minmax(0,200px))] xl:[justify-content:space-between]">
      {children}
    </div>
  );
}

function StatusTile({
  label,
  value,
  valueClassName,
  right,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        {right}
      </div>
      <div className={valueClassName ?? "mt-1 text-sm font-semibold"}>{value}</div>
    </div>
  );
}

const statusColors: Record<string, string> = {
  draft: "bg-gray-500",
  billed: "bg-blue-600",
  sent: "bg-blue-500",
  partially_paid: "bg-yellow-500",
  paid: "bg-green-500",
  overdue: "bg-red-500",
  void: "bg-zinc-500",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  billed: "Billed",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export default function InvoiceDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const invoiceId = (params as any)?.id as string | undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useInvoice(invoiceId);
  const billInvoice = useBillInvoice();
  const retryQbSync = useRetryInvoiceQbSync();
  const sendInvoice = useSendInvoice();
  const markSent = useMarkInvoiceSent();
  const refreshStatus = useRefreshInvoiceStatus();
  const deleteInvoice = useDeleteInvoice();
  const updateInvoice = useUpdateInvoice();
  const invoicePayments = useInvoicePayments(invoiceId);
  const recordManualPayment = useRecordManualInvoicePayment();
  const voidInvoicePayment = useVoidInvoicePayment();

  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [stripePayOpen, setStripePayOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [selectedPaymentToVoid, setSelectedPaymentToVoid] = useState<any | null>(null);

  const [recordPaymentErrors, setRecordPaymentErrors] = useState<{ amount?: string; method?: string }>({});
  const [pdfLoadState, setPdfLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualMethod, setManualMethod] = useState<string>('');
  const [manualAppliedAt, setManualAppliedAt] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [manualNotes, setManualNotes] = useState<string>('');
  const [manualReference, setManualReference] = useState<string>('');

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';
  const isStaffUser = !!user && user.role !== 'customer';

  const invoice = data?.invoice;
  const lineItems = data?.lineItems ?? [];
  const payments = data?.payments ?? [];
  const paymentsList: any[] = (invoicePayments.data as any[]) ?? payments;

  // Orders Detail parity: when invoice is tied to an order, pull customer/contact + metadata from the order.
  const orderId = invoice?.orderId ?? undefined;
  const { data: orderRaw } = useOrder(orderId || undefined);
  const order: any = orderRaw as any;
  const linkedOrderContactId: string | null = order?.contact?.id || order?.contactId || null;

  const invoiceStatus = String(invoice?.status || '').toLowerCase();
  const paymentRollup = invoice
    ? computeInvoicePaymentRollup({
        invoiceTotalCents: Number((invoice as any).totalCents || 0),
        payments: paymentsList.map((p: any) => ({
          id: p.id,
          status: String(p.status || 'succeeded'),
          amountCents: Number(p.amountCents || 0),
        })),
      })
    : { amountPaidCents: 0, amountDueCents: 0, paymentStatus: 'unpaid' as const };

  const paidCents = paymentRollup.amountPaidCents;
  const remainingCents = paymentRollup.amountDueCents;
  const balanceDue = remainingCents / 100;
  const paymentStatusLabel = getInvoicePaymentStatusLabel({
    invoiceStatus: invoice?.status,
    rollup: paymentRollup as any,
  });

  const invoicePdfViewUrl = invoiceId ? `/api/invoices/${encodeURIComponent(invoiceId)}/pdf` : '';
  const invoicePdfDownloadUrl = invoiceId ? `/api/invoices/${encodeURIComponent(invoiceId)}/pdf?download=1` : '';
  const invoicePdfFilename = (invoice as any)?.invoiceNumber
    ? `invoice-${String((invoice as any).invoiceNumber)}.pdf`
    : 'invoice.pdf';

  // Manual payments may intentionally exceed remaining (rollup clamps). Keep available for staff unless void.
  const canRecordPayment = !!invoice && isStaffUser && invoiceStatus !== 'void';

  const canEditInvoice = !!invoice && isStaffUser && invoiceStatus !== 'paid' && invoiceStatus !== 'void';
  const isBilledUnpaid = !!invoice && invoiceStatus === 'billed' && balanceDue > 0;
  const canEditFinancial = canEditInvoice && (invoiceStatus === 'draft' || isBilledUnpaid);

  const [termsDraft, setTermsDraft] = useState<string>('due_on_receipt');
  const [dueDateDraft, setDueDateDraft] = useState<string>('');
  const [notesPublicDraft, setNotesPublicDraft] = useState<string>('');
  const [notesInternalDraft, setNotesInternalDraft] = useState<string>('');

  const [customerIdDraft, setCustomerIdDraft] = useState<string | null>(null);
  const [contactIdDraft, setContactIdDraft] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>(undefined);

  const [customerSaveState, setCustomerSaveState] = useState<SaveState>('idle');
  const [detailsSaveState, setDetailsSaveState] = useState<SaveState>('idle');
  const [notesSaveState, setNotesSaveState] = useState<SaveState>('idle');
  const [financialSaveState, setFinancialSaveState] = useState<SaveState>('idle');

  const [notesPublicDirty, setNotesPublicDirty] = useState(false);
  const [notesInternalDirty, setNotesInternalDirty] = useState(false);
  const [contactDirty, setContactDirty] = useState(false);

  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({
    customer: null,
    details: null,
    notes: null,
    financial: null,
  });

  const setSaveState = (key: 'customer' | 'details' | 'notes' | 'financial', state: SaveState) => {
    const existing = saveTimersRef.current[key];
    if (existing) clearTimeout(existing);

    const setter =
      key === 'customer'
        ? setCustomerSaveState
        : key === 'details'
          ? setDetailsSaveState
          : key === 'notes'
            ? setNotesSaveState
            : setFinancialSaveState;

    setter(state);
    if (state === 'saved') {
      saveTimersRef.current[key] = setTimeout(() => setter('idle'), 1500);
    }
  };

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((t) => {
        if (t) clearTimeout(t);
      });
    };
  }, []);

  const [subtotalDraft, setSubtotalDraft] = useState<string>('');
  const [taxDraft, setTaxDraft] = useState<string>('');
  const [shippingDraft, setShippingDraft] = useState<string>('');

  const [bottomPanel, setBottomPanel] = useState<"collapsed" | "timeline" | "payments" | "material">("timeline");

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  const formatCurrencyFromCents = (amountCents: number) => {
    const safe = Number.isFinite(Number(amountCents)) ? Number(amountCents) : 0;
    return formatCurrency(safe / 100);
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return "-";
    }
  };

  const openRecordPayment = () => {
    setManualAmount(balanceDue > 0 ? (balanceDue).toFixed(2) : '');
    setManualMethod('');
    setManualAppliedAt(format(new Date(), 'yyyy-MM-dd'));
    setManualNotes('');
    setManualReference('');
    setRecordPaymentErrors({});
    setRecordPaymentOpen(true);
  };

  const parseMoneyToCents = (value: string): number => {
    const n = Number(String(value || '').replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100));
  };

  const manualAmountCentsDraft = parseMoneyToCents(manualAmount);
  const manualIsOverpaymentDraft = !!invoice && manualAmountCentsDraft > remainingCents;

  const submitManualPayment = async () => {
    if (!invoiceId) return;
    const amountCents = parseMoneyToCents(manualAmount);
    const nextErrors: { amount?: string; method?: string } = {};

    if (!manualMethod) nextErrors.method = 'Select a payment method.';
    if (amountCents <= 0) nextErrors.amount = 'Amount must be greater than 0.';

    setRecordPaymentErrors(nextErrors);
    if (nextErrors.amount || nextErrors.method) return;

    try {
      await recordManualPayment.mutateAsync({
        invoiceId,
        amountCents,
        method: manualMethod,
        appliedAt: manualAppliedAt ? new Date(manualAppliedAt).toISOString() : undefined,
        notes: manualNotes || undefined,
        reference: manualReference || undefined,
      });
      toast({ title: 'Payment recorded' });
      setRecordPaymentOpen(false);
      refetch();
      invoicePayments.refetch();
    } catch (e: any) {
      toast({ title: 'Failed to record payment', description: e?.message || 'Unknown error', variant: 'destructive' });
    }
  };

  const normalizeProvider = (p: any): 'stripe' | 'manual' => {
    const raw = String(p?.provider || 'manual').trim().toLowerCase();
    return raw === 'stripe' ? 'stripe' : 'manual';
  };

  const normalizePaymentStatus = (p: any): string => {
    const raw = String(p?.status || 'succeeded').trim().toLowerCase();
    if (raw === 'void') return 'voided';
    return raw;
  };

  const toPaymentMethodLabel = (method: any): string => {
    const raw = String(method || '').trim().toLowerCase();
    if (!raw) return 'Manual';
    if (raw === 'bank_transfer') return 'Bank Transfer';
    if (raw === 'ach') return 'ACH';
    return raw.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  useEffect(() => {
    if (!pdfOpen) {
      setPdfLoadState('idle');
      setPdfError(null);
      return;
    }

    if (!invoicePdfViewUrl) {
      setPdfLoadState('error');
      setPdfError('PDF not available.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setPdfLoadState('loading');
        setPdfError(null);

        const res = await fetch(invoicePdfViewUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/pdf',
          },
        });

        if (!res.ok) {
          throw new Error(`PDF request failed (${res.status})`);
        }

        const contentType = String(res.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/pdf')) {
          throw new Error('PDF response was not application/pdf');
        }

        // Read only the first chunk to validate the %PDF signature, then cancel to avoid downloading the full file twice.
        const reader = res.body?.getReader();
        const first = reader ? await reader.read() : null;
        if (reader) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
        }

        const buf = first?.value ? new Uint8Array(first.value) : new Uint8Array();
        const isPdf = buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
        if (!isPdf) {
          throw new Error('PDF signature check failed');
        }

        if (cancelled) return;
        setPdfLoadState('ready');
      } catch (e: any) {
        if (cancelled) return;
        setPdfLoadState('error');
        setPdfError(e?.message || 'Failed to load PDF');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfOpen, invoicePdfViewUrl]);

  const requestVoidPayment = (payment: any) => {
    setSelectedPaymentToVoid(payment);
    setVoidConfirmOpen(true);
  };

  const confirmVoidPayment = async () => {
    if (!invoiceId || !selectedPaymentToVoid?.id) return;
    try {
      await voidInvoicePayment.mutateAsync({ invoiceId, paymentId: selectedPaymentToVoid.id });
      toast({ title: 'Payment voided' });
      setVoidConfirmOpen(false);
      setSelectedPaymentToVoid(null);
      refetch();
      invoicePayments.refetch();
    } catch (e: any) {
      toast({ title: 'Failed to void payment', description: e?.message || 'Unknown error', variant: 'destructive' });
    }
  };

  const toMoneyDraft = (cents: unknown) => {
    if (typeof cents !== 'number' || Number.isNaN(cents)) return '';
    return (cents / 100).toFixed(2);
  };

  useEffect(() => {
    if (!invoice) return;

    setTermsDraft(String((invoice as any).terms || 'due_on_receipt'));
    setDueDateDraft(invoice.dueDate ? format(new Date(invoice.dueDate as any), 'yyyy-MM-dd') : '');
    setNotesPublicDraft(String(invoice.notesPublic || ''));
    setNotesInternalDraft(String(invoice.notesInternal || ''));
    setSubtotalDraft(toMoneyDraft((invoice as any).subtotalCents));
    setTaxDraft(toMoneyDraft((invoice as any).taxCents));
    setShippingDraft(toMoneyDraft((invoice as any).shippingCents));

    setCustomerIdDraft(invoice.customerId || null);
    setContactIdDraft(null);
    setSelectedCustomer(undefined);
    setNotesPublicDirty(false);
    setNotesInternalDirty(false);
    setContactDirty(false);
    // Only reset drafts when switching invoices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  // Keep contact draft synced to the order contact unless user is actively editing it.
  useEffect(() => {
    if (!invoice?.id) return;
    if (!linkedOrderContactId) return;
    if (contactDirty) return;
    setContactIdDraft(linkedOrderContactId);
  }, [invoice?.id, linkedOrderContactId, contactDirty]);

  const { data: customerDetail } = useQuery<CustomerWithContacts>({
    queryKey: ["/api/customers", customerIdDraft],
    queryFn: async () => {
      if (!customerIdDraft) throw new Error('No customer');
      const response = await fetch(`/api/customers/${customerIdDraft}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch customer');
      return response.json();
    },
    enabled: !!customerIdDraft,
    staleTime: 30000,
  });

  const { data: stripeIntegrationStatus } = useQuery<StripeIntegrationStatusEnvelope>({
    queryKey: ['/api/integrations/stripe/status'],
    staleTime: 30000,
  });

  const { data: quickbooksIntegrationStatus } = useQuery<QuickBooksIntegrationStatus>({
    queryKey: ['/api/integrations/quickbooks/status'],
    staleTime: 30000,
  });

  const qbAuthState = quickbooksIntegrationStatus?.authState ?? (quickbooksIntegrationStatus?.connected ? 'connected' : 'not_connected');

  const truncate = (value: unknown, max = 160) => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
  };

  const effectiveCustomer: CustomerWithContacts | undefined =
    selectedCustomer || customerDetail || ((order?.customer as any) as CustomerWithContacts | undefined);

  const contactOptions = useMemo(() => {
    const contacts = effectiveCustomer?.contacts || [];
    return contacts
      .map((c: any) => {
        const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || c.email || 'Contact';
        return { id: String(c.id), name, email: c.email ? String(c.email) : null, isPrimary: !!c.isPrimary };
      })
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
  }, [effectiveCustomer]);

  const commitOrderContact = async (nextContactId: string | null) => {
    if (!invoice?.orderId) return;
    if (!isStaffUser) return;
    if (!nextContactId) return;

    try {
      setSaveState('customer', 'saving');
      const response = await fetch(`/api/orders/${invoice.orderId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: nextContactId }),
          credentials: 'include',
        });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error || (err as any).message || 'Failed to update contact');
      }
      setSaveState('customer', 'saved');
    } catch (error: any) {
      setSaveState('customer', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setContactIdDraft(linkedOrderContactId);
      setContactDirty(false);
    }
  };

  // Debounced autosave for notes.
  useEffect(() => {
    if (!notesPublicDirty) return;
    if (!canEditInvoice) return;
    const t = setTimeout(() => {
      void commitNotesPublic(notesPublicDraft);
    }, 550);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesPublicDraft, notesPublicDirty, canEditInvoice]);

  useEffect(() => {
    if (!notesInternalDirty) return;
    if (!canEditInvoice) return;
    const t = setTimeout(() => {
      void commitNotesInternal(notesInternalDraft);
    }, 550);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesInternalDraft, notesInternalDirty, canEditInvoice]);

  // Derivations used in both loading + main render (no hooks below this point).
  const qbFailed = !!invoice && ((invoice as any).qbSyncStatus === 'failed' || !!(invoice as any).qbLastError);
  const qbSyncStatusRaw = String((invoice as any)?.qbSyncStatus || '').toLowerCase();

  const invoiceVersion = Number((invoice as any)?.invoiceVersion || 1);
  const lastSentVersion = (invoice as any)?.lastSentVersion == null ? null : Number((invoice as any)?.lastSentVersion);
  const lastQbSyncedVersion = (invoice as any)?.lastQbSyncedVersion == null ? null : Number((invoice as any)?.lastQbSyncedVersion);

  const customerHasLatest = lastSentVersion === invoiceVersion;
  const qbUpToDate = lastQbSyncedVersion === invoiceVersion;
  const qbSyncLabel = qbFailed
    ? 'Failed'
    : (qbUpToDate
      ? 'Synced'
      : (qbSyncStatusRaw === 'pending'
        ? 'Queued for QB'
        : (qbSyncStatusRaw ? qbSyncStatusRaw.replaceAll('_', ' ') : 'Needs resync')));
  const showRetrySync = isAdminOrOwner && (qbFailed || !qbUpToDate);

  const qbWarningMessage = (() => {
    const qb = String((invoice as any)?.qbLastError || '').trim();
    if (qb) return qb;
    const sync = String((invoice as any)?.syncError || '').trim();
    if (sync) return sync;
    if (qbFailed) return 'QuickBooks sync failed';
    if (!qbUpToDate && invoiceStatus !== 'draft') return 'QuickBooks out of date';
    return '';
  })();

  const stripeConnected = stripeIntegrationStatus?.success === true && stripeIntegrationStatus?.data?.connected === true;
  const stripeChargesEnabled = stripeIntegrationStatus?.data?.chargesEnabled === true;

  const qbConnected = quickbooksIntegrationStatus?.connected === true;

  // Transient QB outage banner (dismissible). Needs-reauth remains non-dismissible and is handled elsewhere.
  const showTransientQbBanner = qbAuthState === 'connected';
  const showQbNeedsReauthBanner = qbAuthState === 'needs_reauth';
  const invoiceHasQbInvoiceId = !!(invoice as any)?.qbInvoiceId;

  const qbPaymentSyncMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/qb/sync`, {
        method: 'POST',
        credentials: 'include',
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((payload as any)?.error || (payload as any)?.message || 'Failed to sync payment to QuickBooks');
      }

      if ((payload as any)?.success === false) {
        throw new Error((payload as any)?.error || 'Failed to sync payment to QuickBooks');
      }

      return payload;
    },
    onSuccess: async () => {
      if (invoiceId) {
        await queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
        await queryClient.invalidateQueries({ queryKey: ['invoicePayments', invoiceId] });
      }
      toast({ title: 'Synced to QuickBooks' });
    },
    onError: (e: any) => {
      toast({ title: 'QuickBooks sync failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    },
  });
  const canPayInvoice =
    !!invoice &&
    isStaffUser &&
    invoiceStatus !== 'void' &&
    invoiceStatus !== 'draft' &&
    paymentRollup.paymentStatus === 'unpaid' &&
    remainingCents > 0 &&
    stripeConnected &&
    stripeChargesEnabled;

  const orderCustomerName: string | null = order?.customer?.companyName || order?.customer?.name || order?.billToCompany || null;
  const orderCustomerId: string | null = order?.customer?.id || order?.customerId || null;
  const orderContactName: string | null = (() => {
    const c: any = order?.contact;
    if (!c) return null;
    const name = (c.name || c.fullName || c.displayName || `${c.firstName || ""} ${c.lastName || ""}`).trim();
    return name || null;
  })();
  const orderEmail: string | null = order?.contact?.email || order?.customer?.email || order?.billToEmail || null;
  const orderPhone: string | null = order?.customer?.phone || (order?.contact as any)?.phone || (order?.contact as any)?.phoneNumber || null;

  const getAddressParts = (source: {
    street1?: string | null;
    street2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }) => {
    const line1 = [source.street1, source.street2].filter(Boolean).join(', ');
    const line2 = [source.city, source.state, source.postalCode].filter(Boolean).join(', ');
    const line3 = [source.country].filter(Boolean).join(', ');
    return { line1, line2, line3 };
  };

  const resolvedBillAddress = (() => {
    if (!order) return null;
    if (order.billToAddress1 || order.billToAddress2 || order.billToCity || order.billToState || order.billToPostalCode) {
      return getAddressParts({
        street1: order.billToAddress1,
        street2: order.billToAddress2,
        city: order.billToCity,
        state: order.billToState,
        postalCode: order.billToPostalCode,
        country: (order as any).billToCountry,
      });
    }
    if (order.contact?.street1) {
      return getAddressParts({
        street1: order.contact.street1,
        street2: order.contact.street2,
        city: order.contact.city,
        state: order.contact.state,
        postalCode: order.contact.postalCode,
        country: order.contact.country,
      });
    }
    return null;
  })();

  const handleSendEmail = async () => {
    if (!invoiceId) return;
    try {
      await sendInvoice.mutateAsync({ id: invoiceId, toEmail: recipientEmail || undefined });
      toast({ title: "Success", description: "Invoice sent successfully" });
      setEmailDialogOpen(false);
      setRecipientEmail("");
      refetch();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleRefreshStatus = async () => {
    if (!invoiceId) return;
    try {
      await refreshStatus.mutateAsync(invoiceId);
      toast({ title: "Success", description: "Status refreshed" });
      refetch();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!invoiceId || !confirm("Delete this invoice? This cannot be undone.")) return;
    try {
      await deleteInvoice.mutateAsync(invoiceId);
      toast({ title: "Success", description: "Invoice deleted" });
      navigate("/invoices");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleBill = async () => {
    if (!invoiceId) return;
    try {
      await billInvoice.mutateAsync(invoiceId);
      toast({ title: 'Success', description: 'Invoice finalized (sync attempted)' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleMarkSent = async () => {
    if (!invoiceId) return;
    try {
      await markSent.mutateAsync({ id: invoiceId, via: 'manual' });
      toast({ title: 'Success', description: 'Marked as sent' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleRetryQb = async () => {
    if (!invoiceId) return;
    try {
      await retryQbSync.mutateAsync(invoiceId);
      toast({ title: 'Success', description: 'QuickBooks sync retried' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const showLoading = isLoading;
  const showNotFound = !isLoading && (!data || !invoice);
  const isReady = !showLoading && !showNotFound && !!invoice;

  useEffect(() => {
    // DEV-only sanity check: prove the dialog stays mounted across refetch/loading transitions.
    if (!(import.meta as any).env?.DEV) return;
    if (!stripePayOpen) return;
    console.debug('[InvoiceDetail] stripe pay dialog state', { stripePayOpen, isLoading, invoiceId });
  }, [stripePayOpen, isLoading, invoiceId]);

  const commitTerms = async (next: string) => {
    if (!invoiceId || !invoice || !canEditInvoice) return;
    const normalized = next || 'due_on_receipt';
    if (String((invoice as any).terms || 'due_on_receipt') === normalized) return;

    try {
      setSaveState('details', 'saving');
      await updateInvoice.mutateAsync({ id: invoiceId, terms: normalized });
      setSaveState('details', 'saved');
    } catch (error: any) {
      setSaveState('details', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const commitDueDate = async () => {
    if (!invoiceId || !invoice || !canEditInvoice) return;
    const existing = invoice.dueDate ? format(new Date(invoice.dueDate as any), 'yyyy-MM-dd') : '';
    const next = dueDateDraft.trim();
    if (existing === next) return;

    try {
      setSaveState('details', 'saving');
      await updateInvoice.mutateAsync({ id: invoiceId, customDueDate: next || undefined });
      setSaveState('details', 'saved');
    } catch (error: any) {
      setSaveState('details', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  async function commitCustomer(nextCustomerId: string | null, nextCustomer?: CustomerWithContacts) {
    if (!invoiceId || !invoice || !canEditInvoice) return;
    if (!nextCustomerId) {
      setCustomerIdDraft(invoice.customerId || null);
      return;
    }
    if (String(invoice.customerId) === String(nextCustomerId)) return;

    try {
      setSaveState('customer', 'saving');
      await updateInvoice.mutateAsync({ id: invoiceId, customerId: nextCustomerId });
      setSaveState('customer', 'saved');
      setCustomerIdDraft(nextCustomerId);
      if (nextCustomer) setSelectedCustomer(nextCustomer);
    } catch (error: any) {
      setSaveState('customer', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }

  async function commitNotesPublic(nextValue: string) {
    if (!invoiceId || !invoice || !canEditInvoice) return;
    const existing = String(invoice.notesPublic || '');
    if (existing === nextValue) return;

    try {
      setSaveState('notes', 'saving');
      await updateInvoice.mutateAsync({ id: invoiceId, notesPublic: nextValue });
      setSaveState('notes', 'saved');
    } catch (error: any) {
      setSaveState('notes', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }

  async function commitNotesInternal(nextValue: string) {
    if (!invoiceId || !invoice || !canEditInvoice) return;
    const existing = String(invoice.notesInternal || '');
    if (existing === nextValue) return;

    try {
      setSaveState('notes', 'saving');
      await updateInvoice.mutateAsync({ id: invoiceId, notesInternal: nextValue });
      setSaveState('notes', 'saved');
    } catch (error: any) {
      setSaveState('notes', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  }

  const commitFinancials = async () => {
    if (!invoiceId || !invoice || !canEditFinancial) return;

    const nextSubtotalCents = parseMoneyToCents(subtotalDraft);
    const nextTaxCents = parseMoneyToCents(taxDraft);
    const nextShippingCents = parseMoneyToCents(shippingDraft);

    const existingSubtotalCents = Number((invoice as any).subtotalCents || 0);
    const existingTaxCents = Number((invoice as any).taxCents || 0);
    const existingShippingCents = Number((invoice as any).shippingCents || 0);

    const changed =
      nextSubtotalCents !== existingSubtotalCents ||
      nextTaxCents !== existingTaxCents ||
      nextShippingCents !== existingShippingCents;

    if (!changed) return;

    try {
      setSaveState('financial', 'saving');
      await updateInvoice.mutateAsync({
        id: invoiceId,
        subtotalCents: nextSubtotalCents,
        taxCents: nextTaxCents,
        shippingCents: nextShippingCents,
      });
      setSaveState('financial', 'saved');
    } catch (error: any) {
      setSaveState('financial', 'error');
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <Page maxWidth="full">
      <div className="mx-auto w-full max-w-[1600px] space-y-4 min-w-0">
        <StripePayDialog
          open={stripePayOpen}
          onOpenChange={setStripePayOpen}
          invoiceId={invoiceId ?? ''}
          stripeAccountId={stripeIntegrationStatus?.data?.stripeAccountId ?? undefined}
          onSettled={() => {
            refetch();
            invoicePayments.refetch();
            setTimeout(() => refetch(), 1500);
            setTimeout(() => refetch(), 3500);
          }}
        />

        {showTransientQbBanner ? (
          <QBTransientDisconnectBanner
            qbStatus={quickbooksIntegrationStatus}
            showOpenIntegrations
          />
        ) : null}

        {showLoading ? (
          <div className="text-center py-12">Loading invoice...</div>
        ) : showNotFound ? (
          <div className="text-center py-12">Invoice not found</div>
        ) : isReady ? (
          (() => {
            const inv = invoice as NonNullable<typeof invoice>;

            return (
              <>
        <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="manual-payment-amount">Amount</Label>
                <Input
                  id="manual-payment-amount"
                  inputMode="decimal"
                  value={manualAmount}
                  onChange={(e) => {
                    setManualAmount(e.target.value);
                    if (recordPaymentErrors.amount) {
                      setRecordPaymentErrors((prev) => ({ ...prev, amount: undefined }));
                    }
                  }}
                  placeholder="0.00"
                />
                {recordPaymentErrors.amount ? (
                  <div className="text-xs text-destructive">{recordPaymentErrors.amount}</div>
                ) : null}
                {manualIsOverpaymentDraft && manualAmountCentsDraft > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
                    This exceeds Remaining. It will create an overpayment record. Rollup clamps to the invoice total.
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={manualMethod} onValueChange={(v) => {
                  setManualMethod(v);
                  if (recordPaymentErrors.method) {
                    setRecordPaymentErrors((prev) => ({ ...prev, method: undefined }));
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="wire">Wire</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {recordPaymentErrors.method ? (
                  <div className="text-xs text-destructive">{recordPaymentErrors.method}</div>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="manual-payment-date">Date Applied</Label>
                <Input
                  id="manual-payment-date"
                  type="date"
                  value={manualAppliedAt}
                  onChange={(e) => setManualAppliedAt(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="manual-payment-reference">Reference (optional)</Label>
                <Input
                  id="manual-payment-reference"
                  value={manualReference}
                  onChange={(e) => setManualReference(e.target.value)}
                  placeholder="Check #, wire ref, etc."
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="manual-payment-notes">Notes (optional)</Label>
                <Textarea
                  id="manual-payment-notes"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Internal notes"
                />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={recordManualPayment.isPending}>Cancel</Button>
              </DialogClose>
              <Button
                onClick={submitManualPayment}
                disabled={recordManualPayment.isPending}
              >
                {recordManualPayment.isPending ? 'Recording…' : 'Record Payment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={voidConfirmOpen} onOpenChange={setVoidConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void payment?</AlertDialogTitle>
              <AlertDialogDescription>
                This will mark the payment as voided and remove it from invoice totals. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={voidInvoicePayment.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmVoidPayment} disabled={voidInvoicePayment.isPending}>
                {voidInvoicePayment.isPending ? 'Voiding…' : 'Void Payment'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Sticky Action Bar */}
        <div className="sticky top-0 z-20 py-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="outline" size="icon" asChild>
                <Link to="/invoices">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <div className="text-base sm:text-lg font-semibold truncate">
                  Invoice #{invoice.invoiceNumber}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  Issued {formatDate((invoice as any).issuedAt || invoice.issueDate)}
                </div>
              </div>
            </div>

            {qbWarningMessage ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="sm:ml-4 inline-flex max-w-full items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      <span className="truncate">{qbWarningMessage}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[520px]">
                    <div className="whitespace-pre-wrap text-xs">{qbWarningMessage}</div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}

            {isStaffUser && (
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
                {invoiceId ? (
                  <>
                    <Button variant="outline" onClick={() => setPdfOpen(true)}>
                      View PDF
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void downloadFileFromUrl(invoicePdfDownloadUrl, invoicePdfFilename)}
                    >
                      Download PDF
                    </Button>
                  </>
                ) : null}

                {isAdminOrOwner ? (
                  <>
                    <Button variant="outline" onClick={handleRefreshStatus}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>

                    <Button variant="outline" onClick={handleMarkSent} disabled={markSent.isPending}>
                      {markSent.isPending ? 'Marking…' : 'Mark as Sent'}
                    </Button>

                    <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline">
                          <Mail className="mr-2 h-4 w-4" />
                          Send Email
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Send Invoice</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="email">Recipient Email (optional)</Label>
                            <Input
                              id="email"
                              type="email"
                              value={recipientEmail}
                              onChange={(e) => setRecipientEmail(e.target.value)}
                              placeholder="Leave blank to use customer email"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button onClick={handleSendEmail} disabled={sendInvoice.isPending}>
                            {sendInvoice.isPending ? "Sending..." : "Send"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    {canPayInvoice ? (
                      <Button onClick={() => setStripePayOpen(true)}>
                        <CreditCard className="mr-2 h-4 w-4" />
                        Pay Invoice
                      </Button>
                    ) : null}

                    <Button onClick={openRecordPayment} disabled={!canRecordPayment}>
                      <DollarSign className="mr-2 h-4 w-4" />
                      Record Payment
                    </Button>

                    {invoiceStatus === 'draft' && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button onClick={handleBill} disabled={billInvoice.isPending}>
                              {billInvoice.isPending ? 'Finalizing…' : 'Finalize'}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Finalizes the invoice and queues it for QuickBooks. Use “Process Pending Jobs / Sync now” to push.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {invoice.status === 'draft' && payments.length === 0 && (
                      <Button variant="destructive" onClick={handleDelete}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {isAdminOrOwner && (
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
              </div>
            )}
          </div>
        </div>

        <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Invoice PDF</DialogTitle>
            </DialogHeader>
            {pdfLoadState === 'loading' ? (
              <div className="text-sm text-muted-foreground">Loading PDF…</div>
            ) : pdfLoadState === 'error' ? (
              <div className="space-y-2">
                <div className="text-sm text-destructive">PDF not available.</div>
                {pdfError ? <div className="text-xs text-muted-foreground">{pdfError}</div> : null}
                {invoicePdfDownloadUrl ? (
                  <Button
                    variant="outline"
                    onClick={() => void downloadFileFromUrl(invoicePdfDownloadUrl, invoicePdfFilename)}
                  >
                    Try Download
                  </Button>
                ) : null}
              </div>
            ) : invoicePdfViewUrl ? (
              <PdfViewer viewerUrl={invoicePdfViewUrl} downloadUrl={invoicePdfDownloadUrl} filename={invoicePdfFilename} />
            ) : (
              <div className="text-sm text-muted-foreground">PDF not available.</div>
            )}
          </DialogContent>
        </Dialog>

        {/* Financial Summary (top, staff-clear) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Financial Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Total</div>
                <div className="mt-1 text-xl font-semibold">{formatCurrency(invoice.total)}</div>
              </div>

              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Paid</div>
                <div className={paidCents > 0 ? "mt-1 text-xl font-semibold text-green-600" : "mt-1 text-xl font-semibold"}>
                  {formatCurrencyFromCents(paidCents)}
                </div>
              </div>

              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Remaining</div>
                <div className={remainingCents > 0 ? "mt-1 text-xl font-semibold text-red-600" : "mt-1 text-xl font-semibold text-green-600"}>
                  {formatCurrencyFromCents(remainingCents)}
                </div>
                {remainingCents === 0 && invoiceStatus !== 'void' ? (
                  <div className="mt-1 text-xs text-muted-foreground">Fully paid</div>
                ) : null}
              </div>

              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Status</div>
                <div className="mt-2">
                  <Badge
                    variant={remainingCents === 0 && invoiceStatus !== 'void' ? 'default' : 'secondary'}
                    className={remainingCents === 0 && invoiceStatus !== 'void' ? 'bg-green-600 text-white hover:bg-green-600' : undefined}
                  >
                    {paymentStatusLabel}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Strip (dense, responsive) */}
        <StatusStrip>
          <StatusTile
            label="Total"
            value={formatCurrency(invoice.total)}
            valueClassName="mt-1 text-base font-semibold"
          />
          <StatusTile
            label="Paid"
            value={formatCurrencyFromCents(paidCents)}
            valueClassName={
              paidCents > 0
                ? "mt-1 text-base font-semibold text-green-600"
                : "mt-1 text-base font-semibold"
            }
          />
          <StatusTile
            label="Remaining"
            value={formatCurrencyFromCents(remainingCents)}
            valueClassName={
              remainingCents > 0
                ? "mt-1 text-base font-semibold text-red-600"
                : "mt-1 text-base font-semibold"
            }
          />
          <StatusTile
            label="Status"
            value={<Badge variant="secondary">{paymentStatusLabel}</Badge>}
          />
          <StatusTile
            label="Customer Status"
            value={<Badge variant="secondary">{customerHasLatest ? 'Sent latest' : 'Not sent latest'}</Badge>}
          />
          <StatusTile
            label="Accounting Status"
            value={<Badge variant="secondary">{qbUpToDate ? 'QB up to date' : 'QB out of date'}</Badge>}
          />
          <StatusTile
            label="QB Sync"
            value={
              qbFailed && qbWarningMessage ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="destructive" className="cursor-help">
                        {qbSyncLabel}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md">
                      <div className="whitespace-pre-wrap text-xs">{qbWarningMessage}</div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Badge variant={qbFailed ? 'destructive' : 'secondary'}>{qbSyncLabel}</Badge>
              )
            }
            right={
              showRetrySync ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 rounded-full transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
                  onClick={handleRetryQb}
                  disabled={retryQbSync.isPending}
                >
                  {retryQbSync.isPending ? 'Retry…' : 'Retry'}
                </Button>
              ) : null
            }
          />
          <StatusTile
            label="Last Sent"
            value={formatDate((invoice as any).lastSentAt || null)}
            valueClassName="mt-1 text-sm font-medium"
          />
        </StatusStrip>

        {/* Details + Line Items (Order-style layout) */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Customer</CardTitle>
                  <SaveIndicator state={customerSaveState} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <CustomerSelect
                      value={customerIdDraft}
                      initialCustomer={effectiveCustomer}
                      disabled={!canEditInvoice || updateInvoice.isPending}
                      label=""
                      onChange={(nextCustomerId, nextCustomer, nextContactId) => {
                        setCustomerIdDraft(nextCustomerId);
                        setSelectedCustomer(nextCustomer);
                        void commitCustomer(nextCustomerId, nextCustomer);

                        if (nextContactId) {
                          setContactIdDraft(nextContactId);
                          setContactDirty(true);
                          if (invoice?.orderId) void commitOrderContact(nextContactId);
                        }
                      }}
                    />

                    <div className="space-y-2">
                      <Label>Contact</Label>
                      <Select
                        value={contactIdDraft || ''}
                        onValueChange={(v) => {
                          const next = v || null;
                          setContactIdDraft(next);
                          setContactDirty(true);
                          if (invoice?.orderId) void commitOrderContact(next);
                        }}
                        disabled={!invoice?.orderId || !isStaffUser || contactOptions.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              invoice?.orderId
                                ? (contactOptions.length ? 'Select contact' : 'No contacts')
                                : 'Contact is managed on the linked Order'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {contactOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}{c.email ? ` — ${c.email}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {!invoice?.orderId ? (
                        <div className="text-xs text-muted-foreground">
                          Contact updates are saved on the Order.
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {orderCustomerId || invoice.customerId ? (
                      <Button variant="outline" size="sm" className="h-7 px-3 rounded-full" asChild>
                        <Link to={`/customers/${orderCustomerId || invoice.customerId}`}>View Customer</Link>
                      </Button>
                    ) : null}
                    {linkedOrderContactId ? (
                      <Button variant="outline" size="sm" className="h-7 px-3 rounded-full" asChild>
                        <Link to={`/contacts/${linkedOrderContactId}`}>View Contact</Link>
                      </Button>
                    ) : null}
                    {invoice.orderId ? (
                      <Button variant="outline" size="sm" className="h-7 px-3 rounded-full" asChild>
                        <Link to={`/orders/${invoice.orderId}`}>View Order</Link>
                      </Button>
                    ) : null}
                  </div>
                </div>

                {resolvedBillAddress && (resolvedBillAddress.line1 || resolvedBillAddress.line2 || resolvedBillAddress.line3) && (
                  <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                    {resolvedBillAddress.line1 ? <div className="truncate">{resolvedBillAddress.line1}</div> : null}
                    {resolvedBillAddress.line2 ? <div className="truncate">{resolvedBillAddress.line2}</div> : null}
                    {resolvedBillAddress.line3 ? <div className="truncate">{resolvedBillAddress.line3}</div> : null}
                  </div>
                )}

                {(orderEmail || orderPhone) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {orderEmail ? (
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-card/50 p-2.5">
                        <span className="text-xs text-muted-foreground">Email</span>
                        <span className="text-xs font-medium truncate max-w-[220px]">{orderEmail}</span>
                      </div>
                    ) : null}
                    {orderPhone ? (
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-card/50 p-2.5">
                        <span className="text-xs text-muted-foreground">Phone</span>
                        <span className="text-xs font-medium">{orderPhone}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="font-medium">{item.description}</div>
                            {item.width && item.height && (
                              <div className="text-sm text-muted-foreground">
                                {item.width}" × {item.height}"
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(item.totalPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 pt-2.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="invoice-notes-public">Public Notes</Label>
                    <SaveIndicator state={notesSaveState} />
                  </div>
                  <Textarea
                    id="invoice-notes-public"
                    value={notesPublicDraft}
                    onChange={(e) => {
                      setNotesPublicDraft(e.target.value);
                      setNotesPublicDirty(true);
                    }}
                    onBlur={() => {
                      setNotesPublicDirty(false);
                      void commitNotesPublic(notesPublicDraft);
                    }}
                    disabled={!canEditInvoice || updateInvoice.isPending}
                    placeholder="Visible to the customer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="invoice-notes-internal">Internal Notes</Label>
                    <SaveIndicator state={notesSaveState} />
                  </div>
                  <Textarea
                    id="invoice-notes-internal"
                    value={notesInternalDraft}
                    onChange={(e) => {
                      setNotesInternalDraft(e.target.value);
                      setNotesInternalDirty(true);
                    }}
                    onBlur={() => {
                      setNotesInternalDirty(false);
                      void commitNotesInternal(notesInternalDraft);
                    }}
                    disabled={!canEditInvoice || updateInvoice.isPending}
                    placeholder="Internal-only notes"
                  />
                </div>

                {!canEditInvoice && (
                  <div className="text-xs text-muted-foreground">
                    Notes are locked for paid/void invoices.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-4 px-6">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setBottomPanel(prev => prev === "timeline" ? "collapsed" : "timeline")}
                    className={
                      `text-lg font-medium transition-colors hover:text-foreground cursor-pointer ${
                        bottomPanel === "timeline" ? "text-foreground" : "text-muted-foreground"
                      }`
                    }
                  >
                    Timeline
                  </button>

                  <div className="h-4 w-px bg-muted-foreground/30" aria-hidden="true" />

                  <button
                    type="button"
                    onClick={() => setBottomPanel(prev => prev === "payments" ? "collapsed" : "payments")}
                    className={
                      `text-lg font-medium transition-colors hover:text-foreground cursor-pointer ${
                        bottomPanel === "payments" ? "text-foreground" : "text-muted-foreground"
                      }`
                    }
                  >
                    Payment History
                  </button>

                  <div className="h-4 w-px bg-muted-foreground/30" aria-hidden="true" />

                  <button
                    type="button"
                    onClick={() => setBottomPanel(prev => prev === "material" ? "collapsed" : "material")}
                    className={
                      `text-lg font-medium transition-colors hover:text-foreground cursor-pointer ${
                        bottomPanel === "material" ? "text-foreground" : "text-muted-foreground"
                      }`
                    }
                  >
                    Material Usage
                  </button>
                </div>
              </CardHeader>

              {bottomPanel !== "collapsed" && (
                <CardContent className="py-4 px-6">
                  {bottomPanel === "timeline" && (
                    invoice.orderId ? (
                      <TimelinePanel orderId={invoice.orderId} />
                    ) : (
                      <div className="text-sm text-muted-foreground">No activity yet.</div>
                    )
                  )}

                  {bottomPanel === "payments" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm text-muted-foreground">
                          Total: <span className="font-medium text-foreground">{formatCurrency(invoice.total)}</span>
                          <span className="mx-2 text-muted-foreground/50">•</span>
                          Paid: <span className="font-medium text-foreground">{formatCurrencyFromCents(paidCents)}</span>
                          <span className="mx-2 text-muted-foreground/50">•</span>
                          Remaining: <span className="font-medium text-foreground">{formatCurrencyFromCents(remainingCents)}</span>
                          <span className="mx-2 text-muted-foreground/50">•</span>
                          <Badge variant="secondary">{paymentStatusLabel}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {canRecordPayment && (
                            <Button variant="outline" onClick={openRecordPayment}>
                              Record Payment
                            </Button>
                          )}
                          {canPayInvoice && (
                            <Button onClick={() => setStripePayOpen(true)}>
                              Pay Invoice
                            </Button>
                          )}
                        </div>
                      </div>

                      {showQbNeedsReauthBanner ? (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>QuickBooks authorization expired</AlertTitle>
                          <AlertDescription>
                            <div className="flex flex-col gap-2">
                              <div>Reconnect to resume syncing.</div>
                              <div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => navigate('/settings/integrations')}
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Open Integrations
                                </Button>
                              </div>
                            </div>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {isStaffUser && qbConnected ? (
                        <div className="text-xs text-muted-foreground">
                          Queued for QuickBooks — run “Process Pending Jobs / Sync now” to push now.
                        </div>
                      ) : null}

                      {paymentsList.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">No payments recorded</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Method / Provider</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Created By</TableHead>
                              <TableHead>Notes</TableHead>
                              {isStaffUser && <TableHead>QB Sync</TableHead>}
                              {isStaffUser && <TableHead>Actions</TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paymentsList.map((payment: any) => (
                              (() => {
                                const provider = normalizeProvider(payment);
                                const status = normalizePaymentStatus(payment);
                                const isVoided = status === 'voided';
                                const isSucceeded = status === 'succeeded';
                                const canVoid = provider === 'manual' && isSucceeded && !isVoided;

                                const syncStatusRaw = String(payment?.syncStatus || '').trim().toLowerCase();
                                const syncErrorRaw = String(payment?.syncError || '').trim();
                                const externalAccountingId = payment?.externalAccountingId ? String(payment.externalAccountingId) : '';
                                const syncedAtRaw = payment?.syncedAt || null;

                                const isSyncedToQb = !!externalAccountingId && syncStatusRaw === 'synced';
                                const isQbSyncFailed = syncStatusRaw === 'failed';
                                const qbSyncLabel = isSyncedToQb
                                  ? 'Synced'
                                  : (syncStatusRaw ? syncStatusRaw.replaceAll('_', ' ') : 'pending');

                                const qbSyncDisabledReason = (() => {
                                  if (!qbConnected) return 'QuickBooks is not connected for this organization.';
                                  if (!invoiceHasQbInvoiceId) return 'Sync the invoice to QuickBooks first (needs QB Invoice ID).';
                                  return '';
                                })();

                                const canAttemptQbSync = isSucceeded && !isVoided && qbConnected && invoiceHasQbInvoiceId;
                                const isRowSyncing = qbPaymentSyncMutation.isPending && String(qbPaymentSyncMutation.variables || '') === String(payment.id);

                                return (
                              <TableRow
                                key={payment.id}
                                className={isVoided ? 'opacity-60' : undefined}
                              >
                                <TableCell>{formatDate(payment.appliedAt)}</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {provider === 'stripe' ? (
                                      <Badge variant="secondary" className="gap-1">
                                        <CreditCard className="h-3.5 w-3.5" />
                                        Stripe
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="gap-1">
                                        <HandCoins className="h-3.5 w-3.5" />
                                        Manual
                                      </Badge>
                                    )}
                                    <div className="text-sm text-muted-foreground">
                                      {provider === 'stripe' ? 'Card (Stripe)' : toPaymentMethodLabel(payment.method)}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className={isVoided ? 'text-muted-foreground' : 'font-medium'}>
                                  {formatCurrency(payment.amount)}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {isVoided ? (
                                      <Badge variant="secondary">VOIDED</Badge>
                                    ) : null}
                                    <span className="capitalize text-sm">
                                      {String(payment.status || 'succeeded').replaceAll('_', ' ')}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {payment.createdBy?.name || payment.createdBy?.email || '-'}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{payment.notes || "-"}</TableCell>
                                {isStaffUser && (
                                  <TableCell>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {isSyncedToQb ? (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Badge variant="secondary" className="cursor-help">Synced</Badge>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <div className="max-w-[280px] space-y-1">
                                                <div className="text-xs">QB Payment ID: <span className="font-medium">{externalAccountingId}</span></div>
                                                <div className="text-xs">Synced: <span className="font-medium">{formatDate(syncedAtRaw)}</span></div>
                                              </div>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      ) : (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Badge
                                                variant={isQbSyncFailed ? 'destructive' : 'outline'}
                                                className={syncErrorRaw ? 'cursor-help' : undefined}
                                              >
                                                {qbSyncLabel}
                                              </Badge>
                                            </TooltipTrigger>
                                            {syncErrorRaw ? (
                                              <TooltipContent>
                                                <div className="max-w-[320px] text-xs">
                                                  {truncate(syncErrorRaw, 220)}
                                                </div>
                                              </TooltipContent>
                                            ) : (
                                              <TooltipContent>
                                                <div className="text-xs text-muted-foreground">Not synced to QuickBooks yet.</div>
                                              </TooltipContent>
                                            )}
                                          </Tooltip>
                                        </TooltipProvider>
                                      )}

                                      {!isSyncedToQb && isSucceeded && !isVoided ? (
                                        qbSyncDisabledReason ? (
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span>
                                                  <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled
                                                  >
                                                    {isQbSyncFailed ? 'Retry Sync' : 'Sync to QuickBooks'}
                                                  </Button>
                                                </span>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <div className="max-w-[320px] text-xs">{qbSyncDisabledReason}</div>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                        ) : (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => qbPaymentSyncMutation.mutate(String(payment.id))}
                                            disabled={!canAttemptQbSync || isRowSyncing}
                                          >
                                            {isRowSyncing ? 'Syncing…' : (isQbSyncFailed ? 'Retry Sync' : 'Sync to QuickBooks')}
                                          </Button>
                                        )
                                      ) : (
                                        <span className="text-xs text-muted-foreground">-</span>
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                                {isStaffUser && (
                                  <TableCell>
                                    {canVoid ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => requestVoidPayment(payment)}
                                        disabled={voidInvoicePayment.isPending}
                                      >
                                        Void
                                      </Button>
                                    ) : provider === 'stripe' ? (
                                      <span className="text-xs text-muted-foreground">Stripe (no void)</span>
                                    ) : isVoided ? (
                                      <span className="text-xs text-muted-foreground">Voided</span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">-</span>
                                    )}
                                  </TableCell>
                                )}
                              </TableRow>
                                );
                              })()
                            ))}
                          </TableBody>
                        </Table>
                      )}

                    </div>
                  )}

                  {bottomPanel === "material" && (
                    <div className="text-sm text-muted-foreground">
                      Material usage is tracked on Orders. Coming soon for invoices.
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Invoice Details</CardTitle>
                  <SaveIndicator state={detailsSaveState} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Invoice #</span>
                    <span className="text-sm font-medium">{invoice.invoiceNumber}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Issue Date</span>
                    <span className="text-sm">{formatDate(invoice.issueDate)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Terms</Label>
                  <Select
                    value={termsDraft}
                    onValueChange={(v) => {
                      setTermsDraft(v);
                      void commitTerms(v);
                    }}
                    disabled={!canEditInvoice || updateInvoice.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select terms" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="due_on_receipt">Due on receipt</SelectItem>
                      <SelectItem value="net_15">Net 15</SelectItem>
                      <SelectItem value="net_30">Net 30</SelectItem>
                      <SelectItem value="net_45">Net 45</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice-due-date">Due Date</Label>
                  <Input
                    id="invoice-due-date"
                    type="date"
                    value={dueDateDraft}
                    onChange={(e) => setDueDateDraft(e.target.value)}
                    onBlur={() => void commitDueDate()}
                    disabled={!canEditInvoice || updateInvoice.isPending}
                  />
                </div>

                {!canEditInvoice && (
                  <div className="text-xs text-muted-foreground">
                    Invoice details are locked for paid/void invoices.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Totals</CardTitle>
                  <SaveIndicator state={financialSaveState} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 items-center gap-3">
                    <Label htmlFor="invoice-subtotal">Subtotal</Label>
                    <Input
                      id="invoice-subtotal"
                      inputMode="decimal"
                      value={subtotalDraft}
                      onChange={(e) => setSubtotalDraft(e.target.value)}
                      onBlur={() => void commitFinancials()}
                      disabled={!canEditFinancial || updateInvoice.isPending}
                      className="text-right"
                    />
                  </div>

                  <div className="grid grid-cols-2 items-center gap-3">
                    <Label htmlFor="invoice-tax">Tax</Label>
                    <Input
                      id="invoice-tax"
                      inputMode="decimal"
                      value={taxDraft}
                      onChange={(e) => setTaxDraft(e.target.value)}
                      onBlur={() => void commitFinancials()}
                      disabled={!canEditFinancial || updateInvoice.isPending}
                      className="text-right"
                    />
                  </div>

                  <div className="grid grid-cols-2 items-center gap-3">
                    <Label htmlFor="invoice-shipping">Shipping</Label>
                    <Input
                      id="invoice-shipping"
                      inputMode="decimal"
                      value={shippingDraft}
                      onChange={(e) => setShippingDraft(e.target.value)}
                      onBlur={() => void commitFinancials()}
                      disabled={!canEditFinancial || updateInvoice.isPending}
                      className="text-right"
                    />
                  </div>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-sm font-medium">{formatCurrency(invoice.total)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Paid</span>
                    <span className="text-sm font-medium">{formatCurrencyFromCents(paidCents)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Remaining</span>
                    <span className="text-sm font-medium">{formatCurrencyFromCents(remainingCents)}</span>
                  </div>
                </div>

                {!canEditFinancial && (
                  <div className="text-xs text-muted-foreground">
                    Financial edits are allowed only for Draft invoices and Billed invoices with balance due.
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
              </>
            );
          })()
        ) : (
          <div className="text-center py-12">Invoice not found</div>
        )}
      </div>
    </Page>
  );
}
