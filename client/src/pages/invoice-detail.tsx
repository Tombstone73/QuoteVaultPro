import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { ArrowLeft, Mail, Trash2, RefreshCw, CreditCard, HandCoins, AlertCircle, ExternalLink } from "lucide-react";
import { computeInvoicePaymentRollup, getInvoicePaymentStatusLabel } from "@shared/rollups/invoicePaymentRollup";
import { useAuth } from "@/hooks/useAuth";
import { useInvoice, useBillInvoice, useQueueInvoiceQbSync, useSendInvoice, useRefreshInvoiceStatus, useDeleteInvoice, useMarkInvoiceSent, useUpdateInvoice, useInvoicePayments, useRecordManualInvoicePayment, useVoidInvoicePayment, useInitiateStripeInvoiceRefund, useStripeInvoiceRefundRequests, useRecoverStripeInvoiceRefund, useInvoiceReminderHistory, useSendInvoiceReminder, useInvoiceEmailRecipients } from "@/hooks/useInvoices";
import { useOrder } from "@/hooks/useOrders";
import { useCompleteOrder } from "@/hooks/useOrderState";
import { useToast } from "@/hooks/use-toast";
import { useCreateEpsHostedSession, usePaymentSettings, useRecordEpsHostedResult } from "@/hooks/usePaymentSettings";
import { Page } from "@/components/titan/Page";
import { format } from "date-fns";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TimelinePanel } from "@/components/TimelinePanel";
import StripePayDialog from "@/components/payments/StripePayDialog";
import { QBTransientDisconnectBanner } from "@/components/integrations/QBTransientDisconnectBanner";
import { resolveDocumentDisplayNumber } from "@shared/documentNumbering";
import { getInvoiceEditLockMessage } from "@/lib/invoiceEditLockCopy";
import { resolveHostedPaymentProvider, type HostedPaymentProvider } from "@shared/paymentProviderResolution";
import { getHostedCardUnavailableReason, resolveInvoiceAutoPaymentAction } from "@/lib/paymentResolutionUi";
import { isValidInvoiceRecipientEmail } from "@shared/invoiceEmailRecipients";
import { getInvoiceFinancialPaymentEligibility } from "@shared/paymentOrchestration";
import { getStripeRefundSummary } from "@/lib/stripeRefundUi";

type StripeIntegrationStatusEnvelope = {
  success: boolean;
  data?: {
    connected?: boolean;
    chargesEnabled?: boolean;
    readyForPayments?: boolean;
    modeMismatch?: boolean;
    serverMode?: 'test' | 'live' | 'unknown' | string;
    stripeAccountId?: string | null;
    browserConfig?: { available?: boolean; mode?: 'test' | 'live'; code?: string };
  };
};

type QuickBooksIntegrationStatus = {
  connected?: boolean;
  state?: 'connected' | 'refreshing' | 'degraded' | 'needs_reauth' | 'disconnected' | string;
  authState?: 'connected' | 'not_connected' | 'needs_reauth' | string;
  healthState?: 'ok' | 'transient_error' | string;
  healthMessage?: string;
  lastErrorAt?: string;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastErrorStage?: string | null;
  lastErrorHttpStatus?: number | null;
  lastOAuthError?: string | null;
  lastOAuthErrorDescription?: string | null;
  lastSuccessfulRefreshAt?: string | null;
  lastSuccessfulRequestAt?: string | null;
  consecutiveTransientFailureCount?: number;
  requiresUserAction?: boolean;
  message?: string;
  companyId?: string;
  connectedAt?: string;
  expiresAt?: string;
  error?: string;
};

type OrderDesignBillingVisibilityItem = {
  lineItemId: string;
  orderId: string;
  description: string | null;
  quantity: number;
  productName: string | null;
  effectiveRequiresDesign: boolean;
  designPricingModeSnapshot: string | null;
  visibilityState: 'not_applicable' | 'no_summary' | 'available';
  designCostState: 'not_applicable' | 'estimated' | 'accrued' | 'finalized' | null;
  correctedTrackedMinutes: number | null;
  soldDesignAmount: number | null;
  billableDesignMinutes: number | null;
  billableDesignAmount: number | null;
  billingStatus: 'not_billable' | 'candidate' | 'approved_for_invoice' | 'invoiced' | 'waived' | null;
  lastSyncedAt: string | null;
};

const DESIGN_BILLING_STATUS_LABELS: Record<NonNullable<OrderDesignBillingVisibilityItem['billingStatus']>, string> = {
  not_billable: 'Not billable',
  candidate: 'Candidate',
  approved_for_invoice: 'Approved for invoice',
  invoiced: 'Invoiced',
  waived: 'Waived',
};

const DESIGN_COST_STATE_LABELS: Record<NonNullable<OrderDesignBillingVisibilityItem['designCostState']>, string> = {
  not_applicable: 'Not applicable',
  estimated: 'Estimated',
  accrued: 'Accrued',
  finalized: 'Finalized',
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type TakePaymentMethod = 'credit_card' | 'cash' | 'check' | 'bank_transfer' | 'other';

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
  finalized: "bg-blue-600",
  billed: "bg-blue-600",
  sent: "bg-blue-500",
  partially_paid: "bg-yellow-500",
  paid: "bg-green-500",
  overdue: "bg-red-500",
  void: "bg-zinc-500",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  finalized: "Finalized",
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
  const [searchParams, setSearchParams] = useSearchParams();
  const invoiceId = (params as any)?.id as string | undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useInvoice(invoiceId);
  const billInvoice = useBillInvoice();
  const queueQbSync = useQueueInvoiceQbSync();
  const sendInvoice = useSendInvoice();
  const markSent = useMarkInvoiceSent();
  const refreshStatus = useRefreshInvoiceStatus();
  const deleteInvoice = useDeleteInvoice();
  const updateInvoice = useUpdateInvoice();
  const invoicePayments = useInvoicePayments(invoiceId);
  const recordManualPayment = useRecordManualInvoicePayment();
  const voidInvoicePayment = useVoidInvoicePayment();
  const initiateStripeRefund = useInitiateStripeInvoiceRefund();
  const paymentSettings = usePaymentSettings();
  const createEpsHostedSessionMutation = useCreateEpsHostedSession();
  const recordEpsHostedResultMutation = useRecordEpsHostedResult();
  const reminderHistory = useInvoiceReminderHistory(invoiceId);
  const sendReminder = useSendInvoiceReminder();

  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [stripePayOpen, setStripePayOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [recordEpsResultOpen, setRecordEpsResultOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [selectedPaymentToVoid, setSelectedPaymentToVoid] = useState<any | null>(null);
  const [selectedEpsPayment, setSelectedEpsPayment] = useState<any | null>(null);
  const [selectedStripePaymentToRefund, setSelectedStripePaymentToRefund] = useState<any | null>(null);
  const [stripeRefundOpen, setStripeRefundOpen] = useState(false);
  const [stripeRefundAmount, setStripeRefundAmount] = useState('');
  const [stripeRefundError, setStripeRefundError] = useState<string | null>(null);
  const [stripeRefundRequestId, setStripeRefundRequestId] = useState<string | null>(null);
  const [pendingStripeRefunds, setPendingStripeRefunds] = useState<Record<string, { targetRefundedCents: number }>>({});

  const [recordPaymentErrors, setRecordPaymentErrors] = useState<{ amount?: string; method?: string; reference?: string; methodDescription?: string }>({});
  const [pdfLoadState, setPdfLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualMethod, setManualMethod] = useState<TakePaymentMethod>('credit_card');
  const [manualAppliedAt, setManualAppliedAt] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [manualNotes, setManualNotes] = useState<string>('');
  const [manualReference, setManualReference] = useState<string>('');
  const [manualMethodDescription, setManualMethodDescription] = useState<string>('');
  const [epsResult, setEpsResult] = useState<'approved' | 'failed' | 'canceled'>('approved');
  const [epsTransactionId, setEpsTransactionId] = useState('');
  const [epsAuthCode, setEpsAuthCode] = useState('');
  const [epsTokenLast4, setEpsTokenLast4] = useState('');
  const [epsApprovedAmount, setEpsApprovedAmount] = useState('');
  const [epsResponseCode, setEpsResponseCode] = useState('');
  const [epsResponseMessage, setEpsResponseMessage] = useState('');
  const [epsInternalNote, setEpsInternalNote] = useState('');
  const [epsAmountOverride, setEpsAmountOverride] = useState(false);

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [completeFeeOnlyOrderAfterSend, setCompleteFeeOnlyOrderAfterSend] = useState(false);
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState("");
  const [manualRecipientEmail, setManualRecipientEmail] = useState("");
  const [recipientEmailError, setRecipientEmailError] = useState<string | null>(null);
  const [expandedQBLines, setExpandedQBLines] = useState<Set<number>>(new Set());
  const takePaymentAutoLaunchRef = useRef(false);
  const invoiceEmailRecipients = useInvoiceEmailRecipients(invoiceId, emailDialogOpen);

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';
  const isStaffUser = !!user && user.role !== 'customer';
  const stripeRefundRequests = useStripeInvoiceRefundRequests(invoiceId, Boolean(isAdminOrOwner));
  const recoverStripeRefund = useRecoverStripeInvoiceRefund();

  const invoice = data?.invoice;
  const lineItems = data?.lineItems ?? [];
  const payments = data?.payments ?? [];
  const paymentsList: any[] = (invoicePayments.data as any[]) ?? payments;
  const pendingRefundRequestByPaymentId = useMemo(() => new Map(
    (stripeRefundRequests.data || [])
      .filter((request) => ['reserved', 'submitted'].includes(String(request.status || '').toLowerCase()))
      .map((request) => [String(request.paymentId), request]),
  ), [stripeRefundRequests.data]);
  const importedQuickBooksLineItems = data?.importedQuickBooksLineItems ?? [];
  const importedQuickBooksLineItemsUnavailableMessage = data?.importedQuickBooksLineItemsUnavailableMessage ?? null;

  useEffect(() => {
    takePaymentAutoLaunchRef.current = false;
  }, [invoiceId]);

  // Orders Detail parity: when invoice is tied to an order, pull customer/contact + metadata from the order.
  const orderId = invoice?.orderId ?? undefined;
  const completeOrder = useCompleteOrder(orderId || '');
  const { data: orderRaw } = useOrder(orderId || undefined);
  const order: any = orderRaw as any;
  const isServiceFeeOnlyOrder = Array.isArray(order?.lineItems) && order.lineItems.length > 0 && order.lineItems.every(
    (lineItem: any) => lineItem.product?.workflowIntent === 'service_fee',
  );
  const linkedOrderContactId: string | null = order?.contact?.id || order?.contactId || null;
  const orderDesignBillingVisibilityQuery = useQuery<OrderDesignBillingVisibilityItem[]>({
    queryKey: ['orders', 'design-billing-visibility', orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/design-billing-visibility`, { credentials: 'include' });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || 'Failed to load design billing visibility');
      }

      const payload = await response.json();
      return payload.data as OrderDesignBillingVisibilityItem[];
    },
  });

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

  const displayPaidCents = Number((invoice as any)?.displayPaidCents ?? paymentRollup.amountPaidCents ?? 0);
  const remainingCents = Number((invoice as any)?.displayRemainingCents ?? paymentRollup.amountDueCents ?? 0);
  const displayTotalCents = Number((invoice as any)?.displayTotalCents ?? (invoice as any)?.totalCents ?? 0);
  const balanceDue = remainingCents / 100;
  const fallbackPaymentStatusLabel = getInvoicePaymentStatusLabel({
    invoiceStatus: invoice?.status,
    rollup: paymentRollup as any,
  });
  const paymentStatusLabel = String((invoice as any)?.displayStatus || fallbackPaymentStatusLabel);
  const isFullyPaid = Boolean((invoice as any)?.isFullyPaid ?? (remainingCents <= 0 && displayPaidCents >= displayTotalCents && displayTotalCents > 0));
  const isImportedFromQuickBooks = !!invoice && Boolean((invoice as any)?.isImportedFromQuickBooks);
  const isHistoricalImport = !!invoice && Boolean((invoice as any)?.isHistorical);
  const importedQuickBooksPaymentSummary = (invoice as any)?.importedQuickBooksPaymentSummary;
  const importedQuickBooksPaymentsEnabled = isImportedFromQuickBooks && !isHistoricalImport && !!String((invoice as any)?.qbInvoiceId || '').trim();
  const importedQbPendingSyncCents = Number(importedQuickBooksPaymentSummary?.pendingSyncCents || 0);
  const importedQbFailedSyncCents = Number(importedQuickBooksPaymentSummary?.failedSyncCents || 0);
  const importedQbSyncedUnreconciledCents = Number(importedQuickBooksPaymentSummary?.syncedUnreconciledCents || 0);
  const importedQbReconciledCents = Number(importedQuickBooksPaymentSummary?.reconciledCents || 0);
  const hasImportedQbPaymentSummary =
    importedQuickBooksPaymentsEnabled &&
    (importedQbPendingSyncCents > 0 || importedQbFailedSyncCents > 0 || importedQbSyncedUnreconciledCents > 0 || importedQbReconciledCents > 0);
  const paymentActionsLocked = isImportedFromQuickBooks && !importedQuickBooksPaymentsEnabled;
  const financialPaymentEligibility = getInvoiceFinancialPaymentEligibility({ invoiceStatus, remainingCents });
  const canSendInvoiceEmail = isAdminOrOwner && !isImportedFromQuickBooks;
  const canMarkInvoiceSent = isAdminOrOwner && !isImportedFromQuickBooks;
  const canFinalizeInvoice = invoiceStatus === 'draft' && !isImportedFromQuickBooks;
  const canDeleteDraftInvoice = invoice?.status === 'draft' && payments.length === 0 && !isImportedFromQuickBooks;
  const accountingModeLabel = isImportedFromQuickBooks
    ? (isHistoricalImport ? 'Historical' : 'Active A/R')
    : 'Printers Hero';

  const invoicePdfViewUrl = invoiceId ? `/api/invoices/${encodeURIComponent(invoiceId)}/pdf` : '';
  const invoicePdfDownloadUrl = invoiceId ? `/api/invoices/${encodeURIComponent(invoiceId)}/pdf?download=1` : '';
  const invoicePdfFilename = (invoice as any)?.invoiceNumber
    ? `invoice-${String((invoice as any).invoiceNumber)}.pdf`
    : 'invoice.pdf';

  const canRecordPayment = !!invoice && isStaffUser && financialPaymentEligibility.payable && !paymentActionsLocked;
  const epsHostedAvailable =
    canRecordPayment &&
    paymentSettings.data?.epsEnabled === true &&
    paymentSettings.data?.epsReady === true &&
    paymentSettings.data?.epsSupportedModes?.includes("hosted_cnp");
  const canRecordEpsHostedResult = !!invoice && isStaffUser && invoiceStatus !== 'void' && !paymentActionsLocked;

  const canEditInvoice = !!invoice && isStaffUser && invoiceStatus === 'draft' && !(isImportedFromQuickBooks && isHistoricalImport);
  const canEditFinancial = canEditInvoice && !isImportedFromQuickBooks;
  const detailsLockMessage = getInvoiceEditLockMessage(invoiceStatus, "details");
  const financialLockMessage = getInvoiceEditLockMessage(invoiceStatus, "financial");
  const notesLockMessage = getInvoiceEditLockMessage(invoiceStatus, "notes");

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

  const [bottomPanel, setBottomPanel] = useState<"collapsed" | "timeline" | "payments" | "material" | "reminders">("timeline");

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

  const formatPoSource = (source: string | null | undefined) => {
    const raw = String(source || '').trim();
    if (!raw) return '';
    return raw.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const openTakePayment = (initialMethod: TakePaymentMethod = 'credit_card') => {
    setManualAmount(balanceDue > 0 ? (balanceDue).toFixed(2) : '');
    setManualMethod(initialMethod);
    setManualAppliedAt(format(new Date(), 'yyyy-MM-dd'));
    setManualNotes('');
    setManualReference('');
    setManualMethodDescription('');
    setRecordPaymentErrors({});
    setRecordPaymentOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('recordPayment') !== '1') return;
    if (!canRecordPayment) return;
    openTakePayment('cash');
    const next = new URLSearchParams(searchParams);
    next.delete('recordPayment');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canRecordPayment]);

  const parseMoneyToCents = (value: string): number => {
    const n = Number(String(value || '').replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100));
  };

  const submitTakePayment = async () => {
    if (!invoiceId) return;
    const amountCents = parseMoneyToCents(manualAmount);
    const nextErrors: { amount?: string; method?: string; reference?: string; methodDescription?: string } = {};

    if (!manualMethod) nextErrors.method = 'Select a payment method.';
    if (amountCents <= 0) nextErrors.amount = 'Amount must be greater than 0.';
    if (amountCents > remainingCents) nextErrors.amount = `Amount exceeds remaining balance by ${formatCurrencyFromCents(amountCents - remainingCents)}.`;
    if (manualMethod === 'credit_card') {
      if (!canLaunchCardPayment) nextErrors.method = cardPaymentUnavailableReason || 'Configure a card processor in Settings.';
    }
    if (manualMethod === 'check' && !manualReference.trim()) {
      nextErrors.reference = 'Check number is required.';
    }
    if (manualMethod === 'bank_transfer' && !manualReference.trim()) {
      nextErrors.reference = 'Transaction or reference number is required.';
    }
    if (manualMethod === 'other' && !manualMethodDescription.trim()) {
      nextErrors.methodDescription = 'Payment method description is required.';
    }

    setRecordPaymentErrors(nextErrors);
    if (nextErrors.amount || nextErrors.method || nextErrors.reference || nextErrors.methodDescription) return;

    if (manualMethod === 'credit_card') {
      setRecordPaymentOpen(false);
      launchCardPayment();
      return;
    }

    const methodForBackend = manualMethod === 'bank_transfer' ? 'bank_transfer' : manualMethod;
    const methodNote = manualMethod === 'other' && manualMethodDescription.trim()
      ? `Method: ${manualMethodDescription.trim()}${manualNotes.trim() ? `\n${manualNotes.trim()}` : ''}`
      : manualNotes || undefined;

    try {
      await recordManualPayment.mutateAsync({
        invoiceId,
        amountCents,
        idempotencyKey: crypto.randomUUID(),
        method: methodForBackend,
        appliedAt: manualAppliedAt ? new Date(manualAppliedAt).toISOString() : undefined,
        notes: methodNote,
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

  const normalizeProvider = (p: any): 'stripe' | 'eps' | 'manual' => {
    const raw = String(p?.provider || 'manual').trim().toLowerCase();
    if (raw === 'stripe') return 'stripe';
    if (raw === 'eps') return 'eps';
    return 'manual';
  };

  const normalizePaymentStatus = (p: any): string => {
    const raw = String(p?.status || 'succeeded').trim().toLowerCase();
    if (raw === 'void') return 'voided';
    return raw;
  };

  const openStripeRefund = (payment: any) => {
    const summary = getStripeRefundSummary(payment, paymentsList);
    if (summary.remainingRefundableCents <= 0) return;
    setSelectedStripePaymentToRefund(payment);
    setStripeRefundAmount((summary.remainingRefundableCents / 100).toFixed(2));
    setStripeRefundError(null);
    setStripeRefundRequestId(crypto.randomUUID());
    setStripeRefundOpen(true);
  };

  const handleStripeRefundOpenChange = (open: boolean) => {
    if (initiateStripeRefund.isPending) return;
    setStripeRefundOpen(open);
    if (!open) {
      setSelectedStripePaymentToRefund(null);
      setStripeRefundAmount('');
      setStripeRefundError(null);
      setStripeRefundRequestId(null);
    }
  };

  const submitStripeRefund = async () => {
    if (!invoiceId || !selectedStripePaymentToRefund) return;
    const summary = getStripeRefundSummary(selectedStripePaymentToRefund, paymentsList);
    const amountCents = parseMoneyToCents(stripeRefundAmount);
    if (amountCents <= 0) {
      setStripeRefundError('Refund amount must be greater than $0.00.');
      return;
    }
    if (amountCents > summary.remainingRefundableCents) {
      setStripeRefundError(`Refund amount cannot exceed ${formatCurrencyFromCents(summary.remainingRefundableCents)}.`);
      return;
    }

    try {
      await initiateStripeRefund.mutateAsync({
        invoiceId,
        paymentId: String(selectedStripePaymentToRefund.id),
        amountCents,
        // Keep the same identity for an error/retry from this open dialog.
        idempotencyKey: stripeRefundRequestId || crypto.randomUUID(),
      });
      setPendingStripeRefunds((previous) => ({
        ...previous,
        [String(selectedStripePaymentToRefund.id)]: {
          targetRefundedCents: summary.alreadyRefundedCents + amountCents,
        },
      }));
      toast({
        title: 'Stripe refund submitted',
        description: 'The refund is pending Stripe confirmation and reconciliation.',
      });
      handleStripeRefundOpenChange(false);
      void invoicePayments.refetch();
      void refetch();
      window.setTimeout(() => {
        void invoicePayments.refetch();
        void refetch();
      }, 1500);
      window.setTimeout(() => {
        void invoicePayments.refetch();
        void refetch();
      }, 4000);
    } catch (error: any) {
      setStripeRefundError(error?.message || 'Unable to submit Stripe refund.');
    }
  };

  const reconcileExistingStripeRefund = async (paymentId: string, refundRequestId: string) => {
    if (!invoiceId) return;
    try {
      const response = await recoverStripeRefund.mutateAsync({ invoiceId, paymentId, refundRequestId });
      const alreadyReconciled = Boolean(response?.data?.alreadyReconciled);
      toast({
        title: alreadyReconciled ? 'Refund already reconciled' : 'Refund reconciled',
        description: alreadyReconciled ? undefined : 'Verified Stripe refund truth was applied through canonical reconciliation.',
      });
      await Promise.all([refetch(), invoicePayments.refetch(), stripeRefundRequests.refetch()]);
    } catch (error: any) {
      toast({ title: 'Unable to verify refund', description: error?.message || 'Refund reconciliation failed.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (Object.keys(pendingStripeRefunds).length === 0) return;
    setPendingStripeRefunds((current) => {
      let changed = false;
      const next = { ...current };
      for (const [paymentId, pending] of Object.entries(current)) {
        const originalPayment = paymentsList.find((payment: any) => String(payment.id) === paymentId);
        if (originalPayment && getStripeRefundSummary(originalPayment, paymentsList).alreadyRefundedCents >= pending.targetRefundedCents) {
          delete next[paymentId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [paymentsList, pendingStripeRefunds]);

  const pendingEpsHostedPayments = paymentsList.filter((payment: any) =>
    normalizeProvider(payment) === "eps" &&
    normalizePaymentStatus(payment) === "pending" &&
    String(payment?.epsMode || "").trim().toLowerCase() === "hosted_cnp"
  );

  const openHostedPaymentWindow = (hostedPaymentUrl: string): boolean => {
    const opened = window.open(hostedPaymentUrl, '_blank', 'noopener,noreferrer');
    return Boolean(opened);
  };

  const resumeEpsHostedPayment = (payment: any) => {
    const hostedPaymentUrl = String(payment?.epsHostedPaymentUrl || '').trim();
    if (!hostedPaymentUrl) {
      toast({ title: 'Hosted payment unavailable', description: 'This pending payment does not include a resumable EPS URL.', variant: 'destructive' });
      return;
    }
    const opened = openHostedPaymentWindow(hostedPaymentUrl);
    toast({
      title: opened ? 'EPS hosted payment reopened' : 'Popup blocked',
      description: opened ? 'Record the EPS result after staff confirms it in the EPS portal.' : 'Allow popups or use the stored EPS hosted URL from the pending payment.',
      variant: opened ? 'default' : 'destructive',
    });
  };

  const toPaymentMethodLabel = (method: any): string => {
    const raw = String(method || '').trim().toLowerCase();
    if (!raw) return 'Manual';
    if (raw === 'bank_transfer') return 'Bank Transfer';
    if (raw === 'ach') return 'ACH';
    return raw.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const openEpsHostedPayment = async () => {
    if (!invoiceId || !invoice) return;
    try {
      const result = await createEpsHostedSessionMutation.mutateAsync({
        invoiceId,
        amountCents: remainingCents,
        idempotencyKey: `eps-hosted-${invoiceId}-${remainingCents}`,
      });
      const hostedPaymentUrl = result.hostedPaymentUrl || result.payment?.epsHostedPaymentUrl;
      if (!hostedPaymentUrl) {
        throw new Error('EPS did not return a hosted payment URL');
      }
      const opened = openHostedPaymentWindow(hostedPaymentUrl);
      toast({
        title: opened
          ? (result.reused ? 'EPS hosted session reopened' : 'EPS hosted session created')
          : 'EPS hosted session created',
        description: opened
          ? 'The payment is pending until the result is recorded or otherwise confirmed.'
          : 'Your browser blocked the hosted page. Use Resume Card Payment in the pending payment panel.',
        action: !opened ? (
          <ToastAction altText="Show pending payment" onClick={() => setBottomPanel("payments")}>
            Show Pending
          </ToastAction>
        ) : undefined,
      });
      if (!opened) setBottomPanel("payments");
      refetch();
      invoicePayments.refetch();
    } catch (error: any) {
      toast({ title: 'EPS payment failed', description: error.message, variant: 'destructive' });
    }
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

  const openRecordEpsResult = (payment: any, initialResult: 'approved' | 'failed' | 'canceled' = 'approved') => {
    setSelectedEpsPayment(payment);
    setEpsResult(initialResult);
    setEpsTransactionId('');
    setEpsAuthCode('');
    setEpsTokenLast4('');
    setEpsApprovedAmount(initialResult === 'approved' ? formatCurrencyFromCents(Number(payment?.amountCents || 0)).replace(/[$,]/g, '') : '0.00');
    setEpsResponseCode('');
    setEpsResponseMessage('');
    setEpsInternalNote('');
    setEpsAmountOverride(false);
    setRecordEpsResultOpen(true);
  };

  const submitEpsHostedResult = async () => {
    if (!selectedEpsPayment?.id) return;

    const approvedAmountCents = parseMoneyToCents(epsApprovedAmount);
    const pendingAmountCents = Math.max(0, Math.round(Number(selectedEpsPayment.amountCents || 0)));
    const amountMismatch = epsResult === 'approved' && approvedAmountCents !== pendingAmountCents;

    if (epsResult === 'approved' && !epsTransactionId.trim()) {
      toast({ title: 'EPS transaction id required', description: 'Copy the transaction id from the EPS portal.', variant: 'destructive' });
      return;
    }
    if (epsResult === 'approved' && approvedAmountCents <= 0) {
      toast({ title: 'Approved amount required', description: 'Approved EPS payments must have an amount greater than zero.', variant: 'destructive' });
      return;
    }
    if (epsResult === 'approved' && !epsAuthCode.trim()) {
      toast({ title: 'EPS auth code required', description: 'Enter the auth code shown by EPS before recording an approved payment.', variant: 'destructive' });
      return;
    }
    if (epsResult === 'approved' && !/^\d{4}$/.test(epsTokenLast4.trim())) {
      toast({ title: 'EPS last four digits required', description: 'Enter the four card digits shown by EPS before recording an approved payment.', variant: 'destructive' });
      return;
    }
    if (amountMismatch && !epsAmountOverride) {
      toast({ title: 'Amount override required', description: 'Check the override box before recording a different approved amount.', variant: 'destructive' });
      return;
    }

    try {
      await recordEpsHostedResultMutation.mutateAsync({
        paymentId: selectedEpsPayment.id,
        epsTransactionId: epsTransactionId.trim(),
        authCode: epsAuthCode.trim() || null,
        tokenLast4: epsTokenLast4.trim() || null,
        approvedAmountCents,
        responseCode: epsResponseCode.trim() || null,
        responseMessage: epsResponseMessage.trim() || null,
        internalNote: epsInternalNote.trim() || null,
        result: epsResult,
        amountOverride: amountMismatch && epsAmountOverride,
      });
      toast({
        title: epsResult === 'approved' ? 'EPS payment recorded' : 'EPS payment closed',
        description: epsResult === 'approved' ? 'The invoice rollup now reflects the confirmed EPS payment.' : `The pending EPS payment was marked ${epsResult}.`,
      });
      setRecordEpsResultOpen(false);
      setSelectedEpsPayment(null);
      refetch();
      invoicePayments.refetch();
    } catch (e: any) {
      toast({ title: 'Failed to record EPS result', description: e?.message || 'Unknown error', variant: 'destructive' });
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

  const { data: stripeIntegrationStatus, isLoading: isStripeIntegrationStatusLoading } = useQuery<StripeIntegrationStatusEnvelope>({
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
  const emailStatus = String((invoice as any)?.emailStatus || 'not_sent').toLowerCase();
  const lastSentAt = (invoice as any)?.lastSentAt || null;
  const lastQbSyncedVersion = (invoice as any)?.lastQbSyncedVersion == null ? null : Number((invoice as any)?.lastQbSyncedVersion);

  const customerHasLatest = emailStatus === 'sent_current';
  const qbUpToDate = lastQbSyncedVersion === invoiceVersion;
  const qbSyncLabel = qbFailed
    ? 'Failed'
    : (isImportedFromQuickBooks
      ? 'Imported'
      : (qbSyncStatusRaw === 'not_synced'
        ? 'Not Synced'
        : qbUpToDate
        ? 'Synced'
        : (qbSyncStatusRaw === 'pending'
          ? 'Queued'
          : qbSyncStatusRaw === 'needs_resync'
            ? 'Not Synced'
            : (qbSyncStatusRaw ? qbSyncStatusRaw.replaceAll('_', ' ') : 'Not Synced'))));
  const showRetrySync = isAdminOrOwner && !isImportedFromQuickBooks && !['draft', 'void'].includes(invoiceStatus) && qbSyncStatusRaw !== 'pending';

  const qbWarningMessage = (() => {
    const qb = String((invoice as any)?.qbLastError || '').trim();
    if (qb) return qb;
    const sync = String((invoice as any)?.syncError || '').trim();
    if (sync) return sync;
    if (qbFailed) return 'QuickBooks sync failed';
    if (isImportedFromQuickBooks) return '';
    if ((qbSyncStatusRaw === 'not_synced' || qbSyncStatusRaw === 'needs_resync') && invoiceStatus !== 'draft') return 'Use Sync to QuickBooks when this invoice is ready for accounting.';
    return '';
  })();

  const stripeConnected = stripeIntegrationStatus?.success === true && stripeIntegrationStatus?.data?.connected === true;
  const stripeChargesEnabled = paymentSettings.data?.stripeEnabled === true
    && stripeIntegrationStatus?.data?.readyForPayments === true
    && stripeIntegrationStatus?.data?.browserConfig?.available === true;

  const qbConnected = quickbooksIntegrationStatus?.connected === true;
  const allDesignBillingRows = orderDesignBillingVisibilityQuery.data ?? [];
  const designBillingRows = allDesignBillingRows.filter((row) => row.effectiveRequiresDesign || row.visibilityState !== 'not_applicable');
  const nonDesignBillingRowCount = Math.max(allDesignBillingRows.length - designBillingRows.length, 0);
  const designBillingCandidateTotal = designBillingRows.reduce((sum, row) => sum + (row.billableDesignAmount ?? 0), 0);
  const designBillingSoldTotal = designBillingRows.reduce((sum, row) => sum + (row.soldDesignAmount ?? 0), 0);

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
  const stripeHostedAvailable =
    !!invoice &&
    isStaffUser &&
    financialPaymentEligibility.payable &&
    !paymentActionsLocked &&
    stripeConnected &&
    stripeChargesEnabled;
  const availableHostedPaymentProviders = [
    stripeHostedAvailable ? "stripe" : null,
    epsHostedAvailable ? "eps" : null,
  ].filter((provider): provider is HostedPaymentProvider => provider === "stripe" || provider === "eps");
  const hostedPaymentResolution = resolveHostedPaymentProvider({
    configuredDefaultProvider: paymentSettings.data?.provider ?? "none",
    availableProviders: availableHostedPaymentProviders,
  });
  const canPayInvoice = hostedPaymentResolution.provider === "stripe";
  const epsHostedEnabled = hostedPaymentResolution.provider === "eps";
  const showPaymentActions = !!invoice && isStaffUser && financialPaymentEligibility.payable && !paymentActionsLocked;
  const cardPaymentDecision = resolveInvoiceAutoPaymentAction({
    invoiceReady: Boolean(invoice),
    dependenciesLoading: paymentSettings.isLoading || invoicePayments.isLoading || isStripeIntegrationStatusLoading,
    invoiceStatus,
    remainingCents,
    canPayInvoice,
    epsHostedEnabled,
    canRecordPayment,
  });
  const cardPaymentUnavailableReason = cardPaymentDecision.action === "blocked"
    ? cardPaymentDecision.message || getHostedCardUnavailableReason({
        paymentSettingsProvider: paymentSettings.data?.provider,
        paymentSettingsMissing: paymentSettings.data?.missing,
        epsEnabled: paymentSettings.data?.epsEnabled,
        epsReady: paymentSettings.data?.epsReady,
        stripeEnabled: paymentSettings.data?.stripeEnabled,
        stripeConnected,
        stripeChargesEnabled,
      })
    : null;
  const cardPaymentBusy = createEpsHostedSessionMutation.isPending;
  const canLaunchCardPayment = cardPaymentDecision.action === "stripe" || cardPaymentDecision.action === "eps";
  const launchCardPayment = () => {
    if (cardPaymentDecision.action === "stripe") {
      setStripePayOpen(true);
      return;
    }
    if (cardPaymentDecision.action === "eps") {
      void openEpsHostedPayment();
      return;
    }
    toast({
      title: 'Card payment unavailable',
      description: cardPaymentUnavailableReason || 'Configure a card processor in Settings.',
      variant: 'destructive',
    });
  };

  useEffect(() => {
    const shouldTakePayment = searchParams.get('takePayment') === '1';
    if (!shouldTakePayment) return;
    if (takePaymentAutoLaunchRef.current) return;
    if (!invoice || paymentSettings.isLoading || invoicePayments.isLoading || isStripeIntegrationStatusLoading) return;

    const next = new URLSearchParams(searchParams);
    next.delete('takePayment');

    if (!showPaymentActions) {
      setSearchParams(next, { replace: true });
      toast({
        title: 'Payment unavailable',
        description: financialPaymentEligibility.blockedReason || 'Payment cannot be taken for this invoice.',
        variant: remainingCents <= 0 ? 'default' : 'destructive',
      });
      return;
    }

    takePaymentAutoLaunchRef.current = true;
    setSearchParams(next, { replace: true });
    openTakePayment('credit_card');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchParams,
    invoice?.id,
    invoiceStatus,
    remainingCents,
    financialPaymentEligibility.blockedReason,
    showPaymentActions,
    paymentSettings.isLoading,
    invoicePayments.isLoading,
    isStripeIntegrationStatusLoading,
  ]);

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

  const recipientOptions = invoiceEmailRecipients.data?.recipients ?? [];
  const defaultRecipient = invoiceEmailRecipients.data?.defaultRecipient ?? null;
  const selectedRecipient = recipientOptions.find(
    (recipient) => recipient.email.toLowerCase() === selectedRecipientEmail.toLowerCase(),
  ) ?? defaultRecipient;
  const trimmedManualRecipientEmail = manualRecipientEmail.trim();
  const manualRecipientInvalid = Boolean(trimmedManualRecipientEmail)
    && !isValidInvoiceRecipientEmail(trimmedManualRecipientEmail);
  const resolvedRecipientEmail = trimmedManualRecipientEmail || selectedRecipient?.email || null;
  const resolvedRecipientName = trimmedManualRecipientEmail
    ? "One-time recipient"
    : (selectedRecipient?.name || null);

  useEffect(() => {
    if (!emailDialogOpen || selectedRecipientEmail || !defaultRecipient?.email) return;
    setSelectedRecipientEmail(defaultRecipient.email);
  }, [defaultRecipient?.email, emailDialogOpen, selectedRecipientEmail]);

  const handleEmailDialogOpenChange = (open: boolean) => {
    setEmailDialogOpen(open);
    if (open) {
      setSelectedRecipientEmail("");
      setManualRecipientEmail("");
      setRecipientEmailError(null);
    }
  };

  const handleSendEmail = async () => {
    if (!invoiceId) return;
    if (!resolvedRecipientEmail || manualRecipientInvalid) {
      setRecipientEmailError(
        manualRecipientInvalid
          ? "Enter a valid email address."
          : "Choose a customer email or enter another valid email address.",
      );
      return;
    }
    try {
      await sendInvoice.mutateAsync({ id: invoiceId, toEmail: resolvedRecipientEmail });
      toast({ title: "Success", description: "Invoice sent successfully" });
      setEmailDialogOpen(false);
      setSelectedRecipientEmail("");
      setManualRecipientEmail("");
      setRecipientEmailError(null);
      refetch();
      if (isServiceFeeOnlyOrder && orderId) setCompleteFeeOnlyOrderAfterSend(true);
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
      toast({ title: 'Success', description: 'Invoice finalized' });
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
      await queueQbSync.mutateAsync(invoiceId);
      toast({ title: 'Success', description: 'Queued for QuickBooks sync' });
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

  const epsDialogPendingAmountCents = Math.max(0, Math.round(Number(selectedEpsPayment?.amountCents || 0)));
  const epsDialogApprovedAmountCents = parseMoneyToCents(epsApprovedAmount);
  const epsDialogAmountMismatch = epsResult === 'approved' && epsDialogApprovedAmountCents !== epsDialogPendingAmountCents;

  return (
    <Page maxWidth="full">
      <div className="mx-auto w-full max-w-[1600px] space-y-4 min-w-0">
        <StripePayDialog
          open={stripePayOpen}
          onOpenChange={setStripePayOpen}
          invoiceId={invoiceId ?? ''}
          apiBasePath="/api/invoices"
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
            const stripeRefundSummary = selectedStripePaymentToRefund
              ? getStripeRefundSummary(selectedStripePaymentToRefund, paymentsList)
              : null;

            return (
              <>
        <Dialog open={stripeRefundOpen} onOpenChange={handleStripeRefundOpenChange}>
          <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-md">
            <DialogHeader className="shrink-0">
              <DialogTitle>Refund Stripe payment</DialogTitle>
            </DialogHeader>

            {stripeRefundSummary ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="grid gap-4 py-1">
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Processor</span>
                      <Badge variant="secondary" className="gap-1">
                        <CreditCard className="h-3.5 w-3.5" />
                        Stripe
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Original payment</div>
                        <div className="font-medium">{formatCurrencyFromCents(stripeRefundSummary.originalAmountCents)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Already refunded</div>
                        <div className="font-medium">{formatCurrencyFromCents(stripeRefundSummary.alreadyRefundedCents)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Remaining refundable</div>
                        <div className="font-medium">{formatCurrencyFromCents(stripeRefundSummary.remainingRefundableCents)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="stripe-refund-amount">Refund amount</Label>
                    <div className="flex gap-2">
                      <Input
                        id="stripe-refund-amount"
                        inputMode="decimal"
                        value={stripeRefundAmount}
                        onChange={(event) => {
                          setStripeRefundAmount(event.target.value);
                          if (stripeRefundError) setStripeRefundError(null);
                        }}
                        disabled={initiateStripeRefund.isPending}
                        placeholder="0.00"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setStripeRefundAmount((stripeRefundSummary.remainingRefundableCents / 100).toFixed(2));
                          setStripeRefundError(null);
                        }}
                        disabled={initiateStripeRefund.isPending}
                      >
                        Full Refund
                      </Button>
                    </div>
                    {stripeRefundError ? <div className="text-xs text-destructive">{stripeRefundError}</div> : null}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Stripe will process this refund. The invoice balance updates after Stripe’s webhook confirms it.
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter className="shrink-0 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => handleStripeRefundOpenChange(false)} disabled={initiateStripeRefund.isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={submitStripeRefund} disabled={initiateStripeRefund.isPending || !stripeRefundSummary}>
                {initiateStripeRefund.isPending ? 'Submitting refund…' : 'Confirm Refund'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Take Payment</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Invoice</div>
                    <div className="font-medium">
                      {resolveDocumentDisplayNumber({
                        displayNumber: (invoice as any).displayNumber,
                        numberCore: (invoice as any).numberCore,
                        legacyNumber: invoice.invoiceNumber,
                      }) || invoice.invoiceNumber}
                    </div>
                  </div>
                  {orderId ? (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Order</div>
                      <div className="font-medium">{(order as any)?.orderNumber || (order as any)?.displayNumber || orderId}</div>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Customer / Contact</div>
                    <div className="font-medium">{orderCustomerName || orderContactName || orderEmail || "Not specified"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Balance</div>
                    <div className="font-medium">
                      Total {formatCurrencyFromCents(displayTotalCents)} / Paid {formatCurrencyFromCents(displayPaidCents)} / Remaining {formatCurrencyFromCents(remainingCents)}
                    </div>
                  </div>
                </div>
              </div>

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
              </div>

              <div className="grid gap-2">
                <Label>Method</Label>
                <Select value={manualMethod} onValueChange={(v) => {
                  setManualMethod(v as TakePaymentMethod);
                  if (recordPaymentErrors.method || recordPaymentErrors.reference || recordPaymentErrors.methodDescription) {
                    setRecordPaymentErrors((prev) => ({ ...prev, method: undefined, reference: undefined, methodDescription: undefined }));
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="bank_transfer">ACH / Bank Transfer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {recordPaymentErrors.method ? (
                  <div className="text-xs text-destructive">{recordPaymentErrors.method}</div>
                ) : null}
              </div>

              {manualMethod === "credit_card" ? (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">Credit Card</div>
                      <div className="text-xs text-muted-foreground">
                        Processor: {epsHostedEnabled ? "EPS Hosted" : canPayInvoice ? "Stripe" : "Unavailable"}
                      </div>
                    </div>
                    {epsHostedEnabled ? (
                      <Badge variant={paymentSettings.data?.epsMode === "test" ? "secondary" : "outline"}>
                        {paymentSettings.data?.epsMode === "test" ? "TEST MODE" : "LIVE"}
                      </Badge>
                    ) : null}
                  </div>
                  {canLaunchCardPayment ? (
                    <div className="text-xs text-muted-foreground">
                      TitanOS opens the hosted processor page. Do not enter card numbers in TitanOS.
                    </div>
                  ) : (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Card processor unavailable</AlertTitle>
                      <AlertDescription>
                        <div className="space-y-2">
                          <div>{cardPaymentUnavailableReason || "Configure a card processor in Settings."}</div>
                          {isAdminOrOwner ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => navigate('/settings/integrations')}>
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open Payment Settings
                            </Button>
                          ) : null}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : null}

              {manualMethod !== "credit_card" ? (
                <>
              <div className="grid gap-2">
                <Label htmlFor="manual-payment-date">
                  {manualMethod === "cash" ? "Date Received" : manualMethod === "check" ? "Check Date" : "Payment Date"}
                </Label>
                <Input
                  id="manual-payment-date"
                  type="date"
                  value={manualAppliedAt}
                  onChange={(e) => setManualAppliedAt(e.target.value)}
                />
              </div>

              {manualMethod === "other" ? (
                <div className="grid gap-2">
                  <Label htmlFor="manual-payment-method-description">Payment method description</Label>
                  <Input
                    id="manual-payment-method-description"
                    value={manualMethodDescription}
                    onChange={(e) => {
                      setManualMethodDescription(e.target.value);
                      if (recordPaymentErrors.methodDescription) {
                        setRecordPaymentErrors((prev) => ({ ...prev, methodDescription: undefined }));
                      }
                    }}
                    placeholder="Describe how the customer paid"
                  />
                  {recordPaymentErrors.methodDescription ? (
                    <div className="text-xs text-destructive">{recordPaymentErrors.methodDescription}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="manual-payment-reference">
                  {manualMethod === "check"
                    ? "Check number"
                    : manualMethod === "bank_transfer"
                      ? "Transaction / reference number"
                      : "Receipt / reference (optional)"}
                </Label>
                <Input
                  id="manual-payment-reference"
                  value={manualReference}
                  onChange={(e) => {
                    setManualReference(e.target.value);
                    if (recordPaymentErrors.reference) {
                      setRecordPaymentErrors((prev) => ({ ...prev, reference: undefined }));
                    }
                  }}
                  placeholder={manualMethod === "check" || manualMethod === "bank_transfer" ? "Required" : "Optional"}
                />
                {recordPaymentErrors.reference ? (
                  <div className="text-xs text-destructive">{recordPaymentErrors.reference}</div>
                ) : null}
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
                </>
              ) : null}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={recordManualPayment.isPending || cardPaymentBusy}>Cancel</Button>
              </DialogClose>
              <Button
                onClick={submitTakePayment}
                disabled={recordManualPayment.isPending || cardPaymentBusy || (manualMethod === "credit_card" && !canLaunchCardPayment)}
              >
                {manualMethod === "credit_card"
                  ? cardPaymentBusy ? 'Opening processor...' : 'Process Credit Card'
                  : recordManualPayment.isPending
                    ? 'Applying...'
                    : manualMethod === "cash"
                      ? 'Apply Cash Payment'
                      : manualMethod === "check"
                        ? 'Apply Check Payment'
                        : manualMethod === "bank_transfer"
                          ? 'Apply Bank Payment'
                          : 'Apply Payment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={recordEpsResultOpen} onOpenChange={setRecordEpsResultOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record EPS Result</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Confirm this against the EPS portal before recording.</AlertTitle>
                <AlertDescription>
                  PTK creation does not confirm payment. Record only the final EPS portal result for this hosted payment.
                </AlertDescription>
              </Alert>

              <div className="grid gap-2">
                <Label>Payment result</Label>
                <Select value={epsResult} onValueChange={(value) => setEpsResult(value as 'approved' | 'failed' | 'canceled')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eps-transaction-id">EPS transaction id</Label>
                <Input
                  id="eps-transaction-id"
                  value={epsTransactionId}
                  onChange={(event) => setEpsTransactionId(event.target.value)}
                  placeholder={epsResult === 'approved' ? 'Required from EPS portal' : 'Optional'}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eps-auth-code">Auth code</Label>
                <Input
                  id="eps-auth-code"
                  value={epsAuthCode}
                  onChange={(event) => setEpsAuthCode(event.target.value)}
                  placeholder={epsResult === 'approved' ? 'Required from EPS portal' : 'Optional'}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eps-token-last4">Card last four digits</Label>
                <Input
                  id="eps-token-last4"
                  inputMode="numeric"
                  maxLength={4}
                  value={epsTokenLast4}
                  onChange={(event) => setEpsTokenLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder={epsResult === 'approved' ? 'Required from EPS portal' : 'Optional'}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eps-approved-amount">Approved amount</Label>
                <Input
                  id="eps-approved-amount"
                  inputMode="decimal"
                  value={epsApprovedAmount}
                  onChange={(event) => setEpsApprovedAmount(event.target.value)}
                  placeholder="0.00"
                />
                <div className="text-xs text-muted-foreground">
                  Pending amount: {formatCurrencyFromCents(epsDialogPendingAmountCents)}
                </div>
                {epsDialogAmountMismatch ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
                    Approved amount differs from the pending EPS amount. Verify the EPS portal transaction before using the override.
                  </div>
                ) : null}
              </div>

              {epsDialogAmountMismatch ? (
                <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  <Checkbox
                    checked={epsAmountOverride}
                    onCheckedChange={(checked) => setEpsAmountOverride(checked === true)}
                  />
                  <span>
                    I verified the EPS portal amount and want to record this amount override.
                  </span>
                </label>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="eps-response-code">Response code</Label>
                  <Input
                    id="eps-response-code"
                    value={epsResponseCode}
                    onChange={(event) => setEpsResponseCode(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="eps-response-message">Response message</Label>
                  <Input
                    id="eps-response-message"
                    value={epsResponseMessage}
                    onChange={(event) => setEpsResponseMessage(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eps-internal-note">Internal note (optional)</Label>
                <Textarea
                  id="eps-internal-note"
                  value={epsInternalNote}
                  onChange={(event) => setEpsInternalNote(event.target.value)}
                  placeholder="What staff verified in the EPS portal"
                />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={recordEpsHostedResultMutation.isPending}>Cancel</Button>
              </DialogClose>
              <Button
                onClick={submitEpsHostedResult}
                disabled={recordEpsHostedResultMutation.isPending || (epsDialogAmountMismatch && !epsAmountOverride) || (epsResult === 'approved' && (!epsAuthCode.trim() || !/^\d{4}$/.test(epsTokenLast4.trim())))}
              >
                {recordEpsHostedResultMutation.isPending ? 'Recording...' : 'Record EPS Result'}
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
                  Invoice {resolveDocumentDisplayNumber({
                    displayNumber: (invoice as any).displayNumber,
                    numberCore: (invoice as any).numberCore,
                    legacyNumber: invoice.invoiceNumber,
                  }) || invoice.invoiceNumber}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  Issued {formatDate((invoice as any).issuedAt || invoice.issueDate)}
                </div>
                {isImportedFromQuickBooks ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">Imported from QuickBooks</Badge>
                    <Badge variant="outline">{accountingModeLabel}</Badge>
                    <Badge variant="outline">Production workflow disabled</Badge>
                  </div>
                ) : null}
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

                    {canMarkInvoiceSent ? (
                      <Button variant="outline" onClick={handleMarkSent} disabled={markSent.isPending}>
                        {markSent.isPending ? 'Marking…' : 'Mark as Sent'}
                      </Button>
                    ) : null}

                    {canSendInvoiceEmail ? (
                      <Dialog open={emailDialogOpen} onOpenChange={handleEmailDialogOpenChange}>
                        <DialogTrigger asChild>
                          <Button variant="outline">
                            <Mail className="mr-2 h-4 w-4" />
                            Send Email
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Send Invoice</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="rounded-md border bg-muted/30 px-3 py-2.5">
                              <div className="text-xs font-medium text-muted-foreground">Sending to</div>
                              {invoiceEmailRecipients.isLoading ? (
                                <div className="mt-1 text-sm text-muted-foreground">Resolving recipient…</div>
                              ) : resolvedRecipientEmail ? (
                                <div className="mt-1 min-w-0">
                                  <div className="truncate text-sm font-medium">{resolvedRecipientName || resolvedRecipientEmail}</div>
                                  <a className="block truncate text-sm text-primary underline-offset-2 hover:underline" href={`mailto:${resolvedRecipientEmail}`}>
                                    {resolvedRecipientEmail}
                                  </a>
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-muted-foreground">No recipient selected</div>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="invoice-customer-email">Choose customer email</Label>
                              <Select
                                value={selectedRecipientEmail}
                                onValueChange={(email) => {
                                  setSelectedRecipientEmail(email);
                                  setManualRecipientEmail("");
                                  setRecipientEmailError(null);
                                }}
                                disabled={invoiceEmailRecipients.isLoading || recipientOptions.length === 0}
                              >
                                <SelectTrigger id="invoice-customer-email">
                                  <SelectValue placeholder={invoiceEmailRecipients.isLoading ? "Loading customer emails…" : "No saved customer email"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {recipientOptions.map((recipient) => (
                                    <SelectItem key={recipient.email.toLowerCase()} value={recipient.email}>
                                      {recipient.name} — {recipient.email}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {invoiceEmailRecipients.isError ? (
                                <p className="text-xs text-destructive">Unable to load saved customer emails. You can still enter another email below.</p>
                              ) : recipientOptions.length === 0 && !invoiceEmailRecipients.isLoading ? (
                                <p className="text-xs text-muted-foreground">No saved customer email is available for this invoice.</p>
                              ) : null}
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="invoice-other-email">Send to another email</Label>
                              <Input
                                id="invoice-other-email"
                                type="email"
                                value={manualRecipientEmail}
                                onChange={(event) => {
                                  setManualRecipientEmail(event.target.value);
                                  setRecipientEmailError(null);
                                }}
                                placeholder="email@example.com"
                                aria-invalid={manualRecipientInvalid || Boolean(recipientEmailError)}
                              />
                              {manualRecipientInvalid || recipientEmailError ? (
                                <p className="text-xs text-destructive">{manualRecipientInvalid ? "Enter a valid email address." : recipientEmailError}</p>
                              ) : (
                                <p className="text-xs text-muted-foreground">This is a one-time recipient override and will not change customer records.</p>
                              )}
                            </div>
                          </div>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline" disabled={sendInvoice.isPending}>Cancel</Button>
                            </DialogClose>
                            <Button
                              onClick={handleSendEmail}
                              disabled={sendInvoice.isPending || invoiceEmailRecipients.isLoading || !resolvedRecipientEmail || manualRecipientInvalid}
                            >
                              {sendInvoice.isPending ? "Sending..." : "Send"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    ) : null}

                    {showPaymentActions ? (
                      <Button onClick={() => openTakePayment('credit_card')}>
                        <CreditCard className="mr-2 h-4 w-4" />
                        Take Payment
                      </Button>
                    ) : null}

                    {canFinalizeInvoice && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button onClick={handleBill} disabled={billInvoice.isPending}>
                              {billInvoice.isPending ? 'Finalizing…' : 'Finalize'}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Finalizes the invoice for sending. QuickBooks sync is a separate action.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {canDeleteDraftInvoice && (
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
                <div className="mt-1 text-xl font-semibold">{formatCurrency((invoice as any).displayTotal ?? invoice.total)}</div>
              </div>

              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Paid</div>
                <div className={displayPaidCents > 0 ? "mt-1 text-xl font-semibold text-green-600" : "mt-1 text-xl font-semibold"}>
                  {formatCurrencyFromCents(displayPaidCents)}
                </div>
              </div>

              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Remaining</div>
                <div className={remainingCents > 0 ? "mt-1 text-xl font-semibold text-red-600" : "mt-1 text-xl font-semibold text-green-600"}>
                  {formatCurrencyFromCents(remainingCents)}
                </div>
                {isFullyPaid && invoiceStatus !== 'void' ? (
                  <div className="mt-1 text-xs text-muted-foreground">Fully paid</div>
                ) : null}
              </div>

              <div className="rounded-md border bg-card/50 p-3">
                <div className="text-xs font-medium text-muted-foreground">Status</div>
                <div className="mt-2">
                  <Badge
                    variant={isFullyPaid && invoiceStatus !== 'void' ? 'default' : 'secondary'}
                    className={isFullyPaid && invoiceStatus !== 'void' ? 'bg-green-600 text-white hover:bg-green-600' : undefined}
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
            value={formatCurrency((invoice as any).displayTotal ?? invoice.total)}
            valueClassName="mt-1 text-base font-semibold"
          />
          <StatusTile
            label="Paid"
            value={formatCurrencyFromCents(displayPaidCents)}
            valueClassName={
              displayPaidCents > 0
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
            value={<Badge variant={emailStatus === 'sent_outdated' ? 'outline' : 'secondary'}>{customerHasLatest ? 'Sent latest' : emailStatus === 'sent_outdated' ? 'Updated After Sent' : 'Not sent'}</Badge>}
          />
          <StatusTile
            label="Accounting Status"
            value={<Badge variant="secondary">{isImportedFromQuickBooks ? `QuickBooks ${accountingModeLabel}` : qbSyncLabel}</Badge>}
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
                  disabled={queueQbSync.isPending}
                >
                  {queueQbSync.isPending ? 'Queueing…' : 'Sync to QB'}
                </Button>
              ) : null
            }
          />
          <StatusTile
            label="Last Sent"
            value={formatDate(lastSentAt)}
            valueClassName="mt-1 text-sm font-medium"
          />
        </StatusStrip>

        {(isImportedFromQuickBooks || invoice.customerPoNumber) ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Accounting Import Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border bg-card/50 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Source</div>
                  <div className="mt-1 text-sm font-semibold">{isImportedFromQuickBooks ? 'QuickBooks' : 'Printers Hero'}</div>
                </div>
                <div className="rounded-md border bg-card/50 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Lifecycle</div>
                  <div className="mt-1 text-sm font-semibold">{accountingModeLabel}</div>
                </div>
                <div className="rounded-md border bg-card/50 p-3">
                  <div className="text-xs font-medium text-muted-foreground">QuickBooks Doc #</div>
                  <div className="mt-1 text-sm font-semibold">{(invoice as any).qbDocNumber || '—'}</div>
                </div>
                <div className="rounded-md border bg-card/50 p-3">
                  <div className="text-xs font-medium text-muted-foreground">QuickBooks Invoice ID</div>
                  <div className="mt-1 break-all text-sm font-semibold">{(invoice as any).qbInvoiceId || (invoice as any).externalAccountingId || '—'}</div>
                </div>
                <div className="rounded-md border bg-card/50 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Imported At</div>
                  <div className="mt-1 text-sm font-semibold">{formatDate((invoice as any).importedAt || null)}</div>
                </div>
                <div className="rounded-md border bg-card/50 p-3">
                  <div className="text-xs font-medium text-muted-foreground">QB Balance at Import</div>
                  <div className="mt-1 text-sm font-semibold">{formatCurrency((invoice as any).qbImportBalanceDue ?? (invoice as any).displayRemaining ?? 0)}</div>
                </div>
                <div className="rounded-md border bg-card/50 p-3 sm:col-span-2">
                  <div className="text-xs font-medium text-muted-foreground">Customer PO / Description</div>
                  <div className="mt-1 text-sm font-semibold">{invoice.customerPoNumber || '—'}</div>
                  {invoice.qbPoSource ? (
                    <div className="mt-1 text-xs text-muted-foreground">Source: {formatPoSource(invoice.qbPoSource)}</div>
                  ) : null}
                </div>
                <div className="rounded-md border bg-card/50 p-3 sm:col-span-2">
                  <div className="text-xs font-medium text-muted-foreground">Workflow Lock</div>
                  <div className="mt-1 text-sm font-semibold">{(invoice as any).lockedReason ? formatPoSource((invoice as any).lockedReason) : 'Production workflow disabled'}</div>
                </div>
              </div>
              {isImportedFromQuickBooks ? (
                <div className="mt-3 text-xs text-muted-foreground">Imported QuickBooks invoices are accounting history or active A/R snapshots only. Production workflow is disabled for this record.</div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

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
                    {(invoice.orderId || invoice.sourceOrderNumber) ? (
                      <>
                        <span className="text-sm text-muted-foreground">
                          From Order #{invoice.sourceOrderNumber ?? "—"}
                        </span>
                        {invoice.orderId ? (
                          <Button variant="outline" size="sm" className="h-7 px-3 rounded-full" asChild>
                            <Link to={`/orders/${invoice.orderId}`}>View Order</Link>
                          </Button>
                        ) : null}
                      </>
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
                      {lineItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                            {isImportedFromQuickBooks ? 'No Printers Hero production line items for this imported invoice.' : 'No line items recorded.'}
                          </TableCell>
                        </TableRow>
                      ) : lineItems.map((item) => (
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

            {isImportedFromQuickBooks && (importedQuickBooksLineItems.length > 0 || importedQuickBooksLineItemsUnavailableMessage) ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Legacy QuickBooks Lines</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {importedQuickBooksLineItems.length > 0 ? (
                    <div className="w-full overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs w-8">#</TableHead>
                            <TableHead className="text-xs">Product / Description</TableHead>
                            <TableHead className="text-xs">Details</TableHead>
                            <TableHead className="text-xs">Qty</TableHead>
                            <TableHead className="text-xs">Unit Price</TableHead>
                            <TableHead className="text-right text-xs">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importedQuickBooksLineItems.map((item: any, index: number) => {
                            const isExpanded = expandedQBLines.has(index);
                            const hasRaw = Boolean(item.rawDescription);
                            const hasParsed = item.parsedWidth != null || item.parsedSides != null || item.parsedArtFileName != null;
                            const productLabel = item.suggestedProductName ?? item.description ?? '—';
                            const descLabel = item.suggestedProductName && item.description !== item.suggestedProductName ? item.description : null;
                            return (
                              <>
                                <TableRow key={`qb-line-${index}`}>
                                  <TableCell className="text-xs text-muted-foreground">{item.lineNum ?? index + 1}</TableCell>
                                  <TableCell className="text-xs font-medium">
                                    <div>{productLabel}</div>
                                    {descLabel && <div className="text-muted-foreground text-xs truncate max-w-[180px]" title={descLabel}>{descLabel}</div>}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    <div className="flex flex-col gap-0.5">
                                      {item.parsedWidth != null && item.parsedHeight != null && (
                                        <span>{item.parsedWidth} × {item.parsedHeight}</span>
                                      )}
                                      {item.parsedSides && <span>{item.parsedSides}</span>}
                                      {item.parsedArtFileName && <span className="truncate max-w-[140px]" title={item.parsedArtFileName}>{item.parsedArtFileName}</span>}
                                      {!hasParsed && <span className="italic">—</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs">{item.quantity == null ? '—' : item.quantity}</TableCell>
                                  <TableCell className="text-xs">{item.unitPrice == null ? '—' : formatCurrency(item.unitPrice)}</TableCell>
                                  <TableCell className="text-right text-xs font-medium">{item.amount == null ? '—' : formatCurrency(item.amount)}</TableCell>
                                </TableRow>
                                {hasRaw && (
                                  <TableRow key={`qb-line-raw-${index}`} className="bg-muted/30">
                                    <TableCell />
                                    <TableCell colSpan={5} className="text-xs pb-2 pt-0">
                                      <button
                                        className="text-muted-foreground underline decoration-dotted cursor-pointer"
                                        onClick={() => setExpandedQBLines(prev => {
                                          const next = new Set(prev);
                                          if (next.has(index)) next.delete(index); else next.add(index);
                                          return next;
                                        })}
                                      >
                                        {isExpanded ? 'Hide raw description' : 'Show raw description'}
                                      </button>
                                      {isExpanded && (
                                        <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-muted rounded px-2 py-1">
                                          {item.rawDescription}
                                        </pre>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                )}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="px-6 py-4 text-sm text-muted-foreground">{importedQuickBooksLineItemsUnavailableMessage}</div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Design Billing Visibility</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <div>
                    Informational only. Candidate billable amounts are visibility-only and are not automatically invoiced.
                  </div>
                  {designBillingRows.length > 0 ? (
                    <div>
                      Candidate {formatCurrency(designBillingCandidateTotal)} • Sold {formatCurrency(designBillingSoldTotal)}
                    </div>
                  ) : null}
                </div>

                {!orderId ? (
                  <div className="text-sm text-muted-foreground">
                    Not available for this invoice because it is not linked to an order.
                  </div>
                ) : orderDesignBillingVisibilityQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground">Loading design billing visibility…</div>
                ) : orderDesignBillingVisibilityQuery.isError ? (
                  <div className="text-sm text-muted-foreground">
                    {(orderDesignBillingVisibilityQuery.error as Error).message}
                  </div>
                ) : designBillingRows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No design billing visibility is available for this linked order.
                  </div>
                ) : (
                  <>
                    {nonDesignBillingRowCount > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {nonDesignBillingRowCount} non-design line item{nonDesignBillingRowCount === 1 ? '' : 's'} omitted from this section.
                      </div>
                    ) : null}
                    <div className="w-full overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Tracked</TableHead>
                            <TableHead className="text-right">Sold Design</TableHead>
                            <TableHead className="text-right">Candidate Billable</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {designBillingRows.map((row) => {
                            const statusLabel = row.visibilityState === 'no_summary'
                              ? 'No summary yet'
                              : row.billingStatus
                                ? (DESIGN_BILLING_STATUS_LABELS[row.billingStatus] ?? row.billingStatus)
                                : row.designCostState
                                  ? (DESIGN_COST_STATE_LABELS[row.designCostState] ?? row.designCostState)
                                  : 'Available';

                            return (
                              <TableRow key={row.lineItemId}>
                                <TableCell>
                                  <div className="font-medium">{row.description || row.productName || 'Line item'}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Qty {row.quantity}{row.productName ? ` • ${row.productName}` : ''}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={row.visibilityState === 'available' ? 'outline' : 'secondary'}>
                                    {statusLabel}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.correctedTrackedMinutes == null ? '—' : `${row.correctedTrackedMinutes}m`}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.soldDesignAmount == null ? '—' : formatCurrency(row.soldDesignAmount)}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.billableDesignAmount == null ? '—' : formatCurrency(row.billableDesignAmount)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sold design amount reflects historical commercial truth when present. Candidate billable reflects tracked design visibility from the linked order and may not be invoiced on this invoice.
                    </div>
                  </>
                )}
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
                    {notesLockMessage}
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

                  <div className="h-4 w-px bg-muted-foreground/30" aria-hidden="true" />

                  <button
                    type="button"
                    onClick={() => setBottomPanel(prev => prev === "reminders" ? "collapsed" : "reminders")}
                    className={
                      `text-lg font-medium transition-colors hover:text-foreground cursor-pointer ${
                        bottomPanel === "reminders" ? "text-foreground" : "text-muted-foreground"
                      }`
                    }
                  >
                    Reminders
                    {reminderHistory.data && reminderHistory.data.filter(l => l.status === 'sent').length > 0 && (
                      <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                        ({reminderHistory.data.filter(l => l.status === 'sent').length})
                      </span>
                    )}
                  </button>
                </div>
              </CardHeader>

              {bottomPanel !== "collapsed" && (
                <CardContent className="py-4 px-6">
                  {bottomPanel === "timeline" && (
                    invoice.orderId ? (
                      <TimelinePanel orderId={invoice.orderId} invoiceId={invoice.id} />
                    ) : (
                      <div className="text-sm text-muted-foreground">No activity yet.</div>
                    )
                  )}

                  {bottomPanel === "payments" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm text-muted-foreground">
                          Total: <span className="font-medium text-foreground">{formatCurrency((invoice as any).displayTotal ?? invoice.total)}</span>
                          <span className="mx-2 text-muted-foreground/50">•</span>
                          Paid: <span className="font-medium text-foreground">{formatCurrencyFromCents(displayPaidCents)}</span>
                          <span className="mx-2 text-muted-foreground/50">•</span>
                          Remaining: <span className="font-medium text-foreground">{formatCurrencyFromCents(remainingCents)}</span>
                          <span className="mx-2 text-muted-foreground/50">•</span>
                          <Badge variant="secondary">{paymentStatusLabel}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {showPaymentActions && (
                            <Button onClick={() => openTakePayment('credit_card')}>
                              Take Payment
                            </Button>
                          )}
                        </div>
                      </div>

                      {paymentSettings.data?.provider === "eps" && paymentSettings.data?.epsEnabled && !paymentSettings.data?.epsReady ? (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>EPS setup incomplete</AlertTitle>
                          <AlertDescription>
                            EPS payment actions are disabled until required settings are saved in Settings &gt; Accounting &amp; Integrations.
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {pendingEpsHostedPayments.length > 0 ? (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Pending Credit Card Payment</AlertTitle>
                          <AlertDescription>
                            <div className="space-y-3">
                              <div>
                                EPS does not provide a reliable callback here. Keep hosted payments pending until the result is confirmed in the EPS portal and recorded.
                              </div>
                              <div className="space-y-2">
                                {pendingEpsHostedPayments.map((payment: any) => (
                                  <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
                                    <div className="text-sm">
                                      <span className="font-medium">{formatCurrencyFromCents(Number(payment.amountCents || 0))}</span>
                                      <span className="mx-2 text-muted-foreground/50">&bull;</span>
                                      <span className="text-muted-foreground">Created {formatDate(payment.createdAt || payment.appliedAt)}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => resumeEpsHostedPayment(payment)}
                                      >
                                        Resume Payment
                                      </Button>
                                      {canRecordEpsHostedResult ? (
                                        <>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openRecordEpsResult(payment)}
                                          >
                                            Record Result
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openRecordEpsResult(payment, 'canceled')}
                                          >
                                            Cancel Attempt
                                          </Button>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {importedQuickBooksPaymentsEnabled ? (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Imported QuickBooks payment reconciliation</AlertTitle>
                          <AlertDescription>
                            <div className="space-y-2">
                              <div>
                                Printers Hero reduces A/R immediately for local payments on imported QuickBooks invoices. Those payments still need to sync to QuickBooks and later reconcile against the refreshed QuickBooks balance snapshot.
                              </div>
                              {hasImportedQbPaymentSummary ? (
                                <div className="flex flex-wrap gap-2 text-xs">
                                  {importedQbPendingSyncCents > 0 ? (
                                    <Badge variant="outline">
                                      Pending sync {formatCurrencyFromCents(importedQbPendingSyncCents)}
                                    </Badge>
                                  ) : null}
                                  {importedQbFailedSyncCents > 0 ? (
                                    <Badge variant="destructive">
                                      Sync failed {formatCurrencyFromCents(importedQbFailedSyncCents)}
                                    </Badge>
                                  ) : null}
                                  {importedQbSyncedUnreconciledCents > 0 ? (
                                    <Badge variant="secondary">
                                      Synced, awaiting reconciliation {formatCurrencyFromCents(importedQbSyncedUnreconciledCents)}
                                    </Badge>
                                  ) : null}
                                  {importedQbReconciledCents > 0 ? (
                                    <Badge variant="secondary">
                                      Reconciled in QuickBooks {formatCurrencyFromCents(importedQbReconciledCents)}
                                    </Badge>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </AlertDescription>
                        </Alert>
                      ) : null}

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

                      {isStaffUser && qbConnected && !isImportedFromQuickBooks ? (
                        <div className="text-xs text-muted-foreground">
                          Queued for QuickBooks — run “Process Pending Jobs / Sync now” to push now.
                        </div>
                      ) : null}

                      {paymentActionsLocked ? (
                        <div className="text-xs text-muted-foreground">
                          Payments for imported QuickBooks invoices should be reconciled from QuickBooks until payment sync is enabled.
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
                                const isSettled = isSucceeded || status === 'captured';
                                const canVoid = provider === 'manual' && isSucceeded && !isVoided;
                                const stripeRefundSummary = provider === 'stripe'
                                  ? getStripeRefundSummary(payment, paymentsList)
                                  : null;
                                const durablePendingRefundRequest = pendingRefundRequestByPaymentId.get(String(payment.id));
                                const isStripeRefundPending = Boolean(pendingStripeRefunds[String(payment.id)] || durablePendingRefundRequest);
                                const canRefundStripePayment = provider === 'stripe'
                                  && isSettled
                                  && (stripeRefundSummary?.remainingRefundableCents || 0) > 0;
                                const canRecordThisEpsResult =
                                  canRecordEpsHostedResult &&
                                  provider === 'eps' &&
                                  status === 'pending' &&
                                  String(payment?.epsMode || '').trim().toLowerCase() === 'hosted_cnp';

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

                                const canAttemptQbSync = isSettled && !isVoided && qbConnected && invoiceHasQbInvoiceId;
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
                                    ) : provider === 'eps' ? (
                                      <Badge variant="secondary" className="gap-1">
                                        <CreditCard className="h-3.5 w-3.5" />
                                        EPS
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="gap-1">
                                        <HandCoins className="h-3.5 w-3.5" />
                                        Manual
                                      </Badge>
                                    )}
                                    <div className="text-sm text-muted-foreground">
                                      {provider === 'stripe'
                                        ? 'Card (Stripe)'
                                        : provider === 'eps'
                                          ? `${toPaymentMethodLabel(payment.method)}${payment.epsMode ? ` (${String(payment.epsMode).replaceAll('_', ' ')})` : ''}`
                                          : toPaymentMethodLabel(payment.method)}
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
                                    ) : status === 'pending' ? (
                                      <Badge variant="outline">Pending</Badge>
                                    ) : status === 'succeeded' ? (
                                      <Badge className="bg-green-600 text-white hover:bg-green-600">Approved</Badge>
                                    ) : status === 'failed' ? (
                                      <Badge variant="destructive">Failed</Badge>
                                    ) : status === 'canceled' ? (
                                      <Badge variant="secondary">Canceled</Badge>
                                    ) : status === 'refunded' ? (
                                      <Badge variant="secondary">Refunded</Badge>
                                    ) : status === 'captured' ? (
                                      <Badge className="bg-green-600 text-white hover:bg-green-600">Captured</Badge>
                                    ) : null}
                                    <span className="capitalize text-sm">
                                      {status === 'succeeded' ? 'approved' : String(payment.status || 'succeeded').replaceAll('_', ' ')}
                                    </span>
                                    {isStripeRefundPending ? <Badge variant="outline">Refund pending reconciliation</Badge> : null}
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

                                      {!isSyncedToQb && isSettled && !isVoided ? (
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
                                    {canRecordThisEpsResult ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openRecordEpsResult(payment)}
                                      >
                                        Record Result
                                      </Button>
                                    ) : canVoid ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => requestVoidPayment(payment)}
                                        disabled={voidInvoicePayment.isPending}
                                      >
                                        Void
                                      </Button>
                                    ) : isStripeRefundPending ? (
                                      durablePendingRefundRequest && isAdminOrOwner ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => reconcileExistingStripeRefund(String(payment.id), String(durablePendingRefundRequest.id))}
                                          disabled={recoverStripeRefund.isPending}
                                        >
                                          {recoverStripeRefund.isPending ? 'Reconciling…' : 'Reconcile Refund'}
                                        </Button>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">Refund pending reconciliation</span>
                                      )
                                    ) : canRefundStripePayment ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => openStripeRefund(payment)}
                                      >
                                        Refund
                                      </Button>
                                    ) : provider === 'stripe' ? (
                                      <span className="text-xs text-muted-foreground">Stripe (not refundable)</span>
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

                  {bottomPanel === "reminders" && (
                    <div className="space-y-4">
                      {/* Summary + send button */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-muted-foreground">
                          {reminderHistory.data && reminderHistory.data.filter(l => l.status === 'sent').length > 0 ? (
                            <>
                              Last reminder sent:{" "}
                              <span className="text-foreground font-medium">
                                {format(new Date(reminderHistory.data.filter(l => l.status === 'sent')[0].sentAt), "MMM d, yyyy 'at' h:mm a")}
                              </span>
                              <span className="mx-2 text-muted-foreground/50">•</span>
                              Total sent:{" "}
                              <span className="text-foreground font-medium">
                                {reminderHistory.data.filter(l => l.status === 'sent').length}
                              </span>
                            </>
                          ) : (
                            "No reminders have been sent for this invoice."
                          )}
                        </div>
                        {isStaffUser && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              invoiceStatus === 'paid' ||
                              invoiceStatus === 'void' ||
                              sendReminder.isPending
                            }
                            onClick={() => {
                              if (!invoiceId) return;
                              sendReminder.mutate(invoiceId, {
                                onSuccess: () => {
                                  toast({ title: "Reminder sent", description: "The customer has been emailed." });
                                },
                                onError: (err: any) => {
                                  toast({ title: "Could not send reminder", description: err?.message || "An error occurred.", variant: "destructive" });
                                },
                              });
                            }}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            {sendReminder.isPending ? "Sending…" : "Send Reminder"}
                          </Button>
                        )}
                      </div>

                      {/* Reminder history table */}
                      {reminderHistory.isLoading ? (
                        <div className="text-sm text-muted-foreground">Loading reminder history…</div>
                      ) : !reminderHistory.data || reminderHistory.data.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">No reminder history yet</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>#</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Recipient</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Failure Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reminderHistory.data.map((log) => (
                              <TableRow key={log.id} className={log.status === 'failed' ? 'opacity-60' : undefined}>
                                <TableCell className="font-medium">#{log.reminderNumber}</TableCell>
                                <TableCell>{format(new Date(log.sentAt), "MMM d, yyyy 'at' h:mm a")}</TableCell>
                                <TableCell className="text-sm">{log.recipientEmail ?? "—"}</TableCell>
                                <TableCell>
                                  {log.status === 'sent' ? (
                                    <Badge variant="secondary">Sent</Badge>
                                  ) : (
                                    <Badge variant="destructive">Failed</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {log.failureReason ?? "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
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
                    {detailsLockMessage}
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
                    <span className="text-sm font-medium">{formatCurrencyFromCents(displayPaidCents)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Remaining</span>
                    <span className="text-sm font-medium">{formatCurrencyFromCents(remainingCents)}</span>
                  </div>
                </div>

                {!canEditFinancial && (
                  <div className="text-xs text-muted-foreground">
                    {financialLockMessage}
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
      <AlertDialog open={completeFeeOnlyOrderAfterSend} onOpenChange={setCompleteFeeOnlyOrderAfterSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this billing-only order?</AlertDialogTitle>
            <AlertDialogDescription>
              This order has no production work. Mark it operationally complete now? The invoice and payment workflow remain active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Complete Later</AlertDialogCancel>
            <AlertDialogAction
              disabled={completeOrder.isPending}
              onClick={() => orderId && completeOrder.mutate(
                {},
                { onSuccess: () => setCompleteFeeOnlyOrderAfterSend(false) },
              )}
            >
              {completeOrder.isPending ? "Completing..." : "Complete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
