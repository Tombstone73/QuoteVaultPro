import { useEffect, useMemo, useState } from "react";
import qbLogoUrl from '@/assets/integrations/qb-logo-01.png';
import stripeLogoUrl from '@/assets/integrations/stripe-logo.png';
import epsLogoUrl from '@/assets/integrations/enhanced-payment-systems-logo.png';
import { usePageVisible } from "@/hooks/usePageVisible";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { usePaymentSettings, useUpdatePaymentSettings, type PaymentProvider } from "@/hooks/usePaymentSettings";
import { QBTransientDisconnectBanner } from "@/components/integrations/QBTransientDisconnectBanner";
import { PaymentProcessorSettingsCard } from "@/components/settings/PaymentProcessorSettingsCard";
import { ROUTES } from "@/config/routes";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download,
  Upload,
  Clock,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";

type QBConnectionStatus = {
  connected: boolean;
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
  companyId?: string;
  connectedAt?: string;
  expiresAt?: string;
  message?: string;
};

type QBCustomerPreviewRow = {
  qbCustomerId: string;
  qbDisplayName: string;
  mappedCompanyName: string;
  mappedContactFirstName: string | null;
  mappedContactLastName: string | null;
  email: string | null;
  phone: string | null;
  willCreateCompany: boolean;
  willUpdateCompany: boolean;
  willCreateContact: boolean;
  importStatus: 'create_company' | 'update_company' | 'create_company_only' | 'update_company_only';
  failureReason: string | null;
  contactNeedsReview: boolean;
  suspiciousFields: string[];
  matchedExistingCustomerId: string | null;
  matchedExistingContactId: string | null;
};

const QB_CUSTOMER_IMPORT_STATUS_LABELS: Record<QBCustomerPreviewRow['importStatus'], string> = {
  create_company: 'Create company + contact',
  update_company: 'Update company + contact',
  create_company_only: 'Create company only',
  update_company_only: 'Update company only',
};

const QB_CUSTOMER_FAILURE_REASON_LABELS: Record<string, string> = {
  missing_person_name: 'Missing person name',
  suspicious_contact_name: 'Suspicious contact name',
};

function getCustomerImportStatusLabel(status: QBCustomerPreviewRow['importStatus'] | undefined): string {
  return status ? QB_CUSTOMER_IMPORT_STATUS_LABELS[status] ?? status : 'Not mapped';
}

function getCustomerFailureReasonLabel(reason: string | null | undefined): string {
  return reason ? QB_CUSTOMER_FAILURE_REASON_LABELS[reason] ?? reason : '-';
}

type QBSyncQueueEnvelope = {
  success: boolean;
  data?: {
    settleWindowMinutes: number;
    stabilityWindowMs: number;
    invoices: { pending: number; failed: number };
    payments: { pending: number; failed: number };
    nextEligibleCounts: { invoices: number; payments: number };
  };
  error?: string;
};

type QBFlushEnvelope = {
  success: boolean;
  data?: {
    settleWindowMinutes: number;
    stabilityWindowMs: number;
    ignoreSettleWindow: boolean;
    ignoreStabilityWindow: boolean;
    invoices: { attempted: number; succeeded: number; failed: number };
    payments: { attempted: number; succeeded: number; failed: number };
  };
  error?: string;
};

type SyncJob = {
  id: string;
  provider: string;
  resourceType: string;
  direction: string;
  status: string;
  error?: string;
  payloadJson?: {
    syncedCount?: number;
    errorCount?: number;
    total?: number;
  };
  createdAt: string;
  updatedAt: string;
};

type StripeStatusData = {
  connected: boolean;
  stripeAccountId: string | null;
  mode?: 'test' | 'live' | string;
  serverMode?: 'test' | 'live' | 'unknown' | string;
  storedConnectionMode?: 'test' | 'live' | null;
  status?: string;
  code?: string | null;
  lastError?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  cardPaymentsCapability?: string | null;
  readyForTestPayments?: boolean;
  readyForProductionPayments?: boolean;
  readyForPayments?: boolean;
  modeMismatch?: boolean;
  browserConfig?: {
    available?: boolean;
    mode?: 'test' | 'live';
    code?: string;
  };
};

type StripeStatusEnvelope = {
  success: boolean;
  data: StripeStatusData;
  error?: string;
};

type QBInvoicePreviewRow = {
  qbInvoiceId: string;
  qbDocNumber: string;
  customerRefName: string;
  qbCustomerRefId: string | null;
  localCustomerId: string | null;
  localCustomerName: string | null;
  txnDate: string;
  dueDate: string | null;
  totalAmt: number;
  balance: number;
  classification: 'open_ar' | 'historical';
  alreadyImported: boolean;
  localInvoiceId: string | null;
  canImport: boolean;
  cannotImportReason?: string;
  exclusionReasons: string[];
  warningReasons: string[];
  customerPoNumber: string | null;
  customerPoSource: string | null;
  referenceDebug?: QBReferenceDebug;
  inspection?: QBInvoicePayloadInspection;
};

type QBInvoicePreviewScope = 'open_ar' | 'historical' | 'all_unsynced';

type QBInvoicePreviewPage = {
  rows: QBInvoicePreviewRow[];
  scope: QBInvoicePreviewScope;
  page: number;
  pageSize: 50 | 100 | 200;
  sourceTotal: number | null;
  sourceRowsOnPage: number;
  alreadyImportedExcludedOnPage: number;
  hasNextPage: boolean;
};

type QBInvoiceImportResult = {
  created: number;
  updated: number;
  skipped: number;
  excluded: number;
  failed: number;
  importedOpenAr: number;
  importedHistorical: number;
  errors: string[];
};

const EXCLUSION_REASON_LABELS: Record<string, string> = {
  missing_customer: 'No local customer match',
  validation_error: 'QB data invalid',
  classification_failed: 'Classification error',
  missing_invoice_number: 'No QB invoice #',
  missing_total: 'No QB total',
  duplicate_doc_number: 'Duplicate doc #',
  unsupported_state: 'Unsupported state',
};

const WARNING_REASON_LABELS: Record<string, string> = {
  already_imported: 'Already imported',
  missing_invoice_number: 'No QB invoice #',
  missing_total: 'No QB total',
};

const EPS_PHASE1_MODE_STATUS: Array<{ label: string; status: "available" | "disabled"; description: string }> = [
  { label: "Hosted Credit Card", status: "available", description: "Available in Phase 1 through the EPS hosted form." },
  { label: "Token CNP", status: "disabled", description: "Coming later after EPS certification docs and official status handling." },
  { label: "ACH", status: "disabled", description: "Coming later after EPS certification docs and clearing/status handling." },
  { label: "Card Present", status: "disabled", description: "Coming later after device certification and status handling." },
  { label: "Gift Card", status: "disabled", description: "Coming later after EPS certification docs and status handling." },
  { label: "Batch Close", status: "disabled", description: "Coming later after settlement/certification procedures are documented." },
];

type QBReferenceDebugField = {
  name: string | null;
  type: string | null;
  value: string | null;
};

type QBReferenceDebug = {
  customFields: QBReferenceDebugField[];
  privateNote: string | null;
  customerMemo: string | null;
  lineDescriptions: string[];
  docNumber: string | null;
  txnDate: string | null;
};

type QBInvoiceMappingDiagnostic = {
  qbField: string;
  titanField: string | null;
  status: 'mapped' | 'ignored' | 'empty' | 'unknown';
  fallbackBehavior: string | null;
  truncationBehavior: string | null;
  valuePreview: string | null;
};

type QBInvoicePayloadInspection = {
  rawPayload: unknown;
  mappedDraft: Record<string, unknown>;
  classification: {
    suggested: 'open_ar' | 'historical';
    rationale: string;
  };
  exclusionReasons: string[];
  warningReasons: string[];
  unmappedFields: string[];
  mappingCoverage: {
    mapped: string[];
    ignored: string[];
    empty: string[];
    unknown: string[];
  };
  mappingDiagnostics: QBInvoiceMappingDiagnostic[];
  poLikeCandidates: Array<{
    qbField: string;
    value: string;
    mapped: boolean;
    destination: string | null;
  }>;
};

export default function SettingsIntegrations() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const isPageVisible = usePageVisible();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [isSyncing, setIsSyncing] = useState(false);

  const { preferences: orgPreferences } = useOrgPreferences();
  const qbSyncPolicy = orgPreferences?.quickBooks?.syncPolicy ?? 'queue_only';
  const qbPushDisabled = qbSyncPolicy === 'queue_only';

  const qbSyncPolicyLabel = qbSyncPolicy === 'queue_only'
    ? 'Queue Only'
    : (qbSyncPolicy === 'immediate' ? 'Immediate' : String(qbSyncPolicy || 'unknown'));

  const [importResource, setImportResource] = useState<'customers' | 'materials'>('customers');
  const [importApplyMode, setImportApplyMode] = useState<'MERGE_RESPECT_OVERRIDES' | 'MERGE_AND_SET_OVERRIDES'>('MERGE_RESPECT_OVERRIDES');
  const [importCsvText, setImportCsvText] = useState<string>('');
  const [importFilename, setImportFilename] = useState<string>('');
  const [lastImportJobId, setLastImportJobId] = useState<string>('');

  // QB invoice preview/import state
  const [invoicePreview, setInvoicePreview] = useState<QBInvoicePreviewRow[] | null>(null);
  const [invoicePreviewPage, setInvoicePreviewPage] = useState<QBInvoicePreviewPage | null>(null);
  const [invoicePreviewScope, setInvoicePreviewScope] = useState<QBInvoicePreviewScope>('open_ar');
  const [invoicePreviewPageNumber, setInvoicePreviewPageNumber] = useState(1);
  const [invoicePreviewPageSize, setInvoicePreviewPageSize] = useState<50 | 100 | 200>(100);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [selectedQBIds, setSelectedQBIds] = useState<Set<string>>(new Set());
  const [isImportingInvoices, setIsImportingInvoices] = useState(false);
  const [showReferenceDiagnostics, setShowReferenceDiagnostics] = useState(false);
  const [expandedDebugIds, setExpandedDebugIds] = useState<Set<string>>(new Set());
  const [invoiceOverrides, setInvoiceOverrides] = useState<Record<string, 'suggested' | 'open_ar' | 'historical' | 'skip'>>({});

  // QB customer preview state
  const [customerPreview, setCustomerPreview] = useState<QBCustomerPreviewRow[] | null>(null);
  const [isLoadingCustomerPreview, setIsLoadingCustomerPreview] = useState(false);
  const [showCustomerPreviewDialog, setShowCustomerPreviewDialog] = useState(false);

  const [qbLogoFailed, setQbLogoFailed] = useState(false);

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setImportFilename(file.name);
    const text = await file.text();
    setImportCsvText(text);
  };

  // Check for OAuth callback params
  const urlParams = new URLSearchParams(window.location.search);
  const qbConnected = urlParams.get('qb_connected');
  const qbError = urlParams.get('qb_error');
  const stripeConnected = urlParams.get('stripe_connected');
  const stripeRefresh = urlParams.get('stripe_refresh');

  // Show toast for OAuth results
  if (qbConnected === 'true' && !sessionStorage.getItem('qb_toast_shown')) {
    sessionStorage.setItem('qb_toast_shown', 'true');
    toast({ title: "Success", description: "QuickBooks connected successfully!" });
    // Invalidate status query to refetch connection status
    queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/status"] });
    // Clean URL
    window.history.replaceState({}, '', '/settings/integrations');
  } else if (qbError && !sessionStorage.getItem('qb_error_shown')) {
    sessionStorage.setItem('qb_error_shown', 'true');
    toast({ title: "Error", description: decodeURIComponent(qbError), variant: "destructive" });
    window.history.replaceState({}, '', '/settings/integrations');
  }

  if (stripeConnected === 'true' && !sessionStorage.getItem('stripe_toast_shown')) {
    sessionStorage.setItem('stripe_toast_shown', 'true');
    toast({ title: 'Stripe', description: 'Stripe Connect setup completed. Checking status…' });
    queryClient.invalidateQueries({ queryKey: ['/api/integrations/stripe/status'] });
    window.history.replaceState({}, '', '/settings/integrations');
  } else if (stripeRefresh === 'true' && !sessionStorage.getItem('stripe_refresh_shown')) {
    sessionStorage.setItem('stripe_refresh_shown', 'true');
    toast({ title: 'Stripe', description: 'Continue Stripe onboarding to enable charges.' });
    queryClient.invalidateQueries({ queryKey: ['/api/integrations/stripe/status'] });
    window.history.replaceState({}, '', '/settings/integrations');
  }

  // Fetch QB connection status
  const { data: qbStatus, isLoading: isLoadingStatus } = useQuery<QBConnectionStatus>({
    queryKey: ["/api/integrations/quickbooks/status"],
  });

  const qbAuthState = qbStatus?.authState ?? (qbStatus?.connected ? 'connected' : 'not_connected');
  const qbNeedsReauth = qbStatus?.requiresUserAction === true || qbAuthState === 'needs_reauth' || qbStatus?.state === 'needs_reauth';
  const qbConnectionState = qbStatus?.state ?? (qbNeedsReauth ? 'needs_reauth' : qbStatus?.connected ? 'connected' : 'disconnected');
  const qbDegraded = qbConnectionState === 'degraded' || qbStatus?.healthState === 'transient_error';

  const { data: qbQueue } = useQuery<QBSyncQueueEnvelope>({
    queryKey: ["/api/integrations/quickbooks/queue"],
    enabled: qbStatus?.connected === true,
    refetchInterval: (query) => {
      // Never poll in hidden tabs.
      if (!isPageVisible) return false;
      // Only poll while there is pending work to watch.
      const d = (query.state.data as QBSyncQueueEnvelope | undefined)?.data;
      const hasPending = (d?.invoices?.pending ?? 0) > 0 || (d?.payments?.pending ?? 0) > 0;
      return hasPending ? 15_000 : false;
    },
  });

  const qbFlushMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/quickbooks/flush', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as QBFlushEnvelope;
      if (!response.ok || (data as any)?.success === false) {
        throw new Error((data as any)?.error || 'Failed to flush QuickBooks queue');
      }
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/queue"] });
      const inv = data?.data?.invoices;
      const pay = data?.data?.payments;
      toast({
        title: 'QuickBooks sync queued',
        description: `Invoices: ${inv?.succeeded || 0} ok, ${inv?.failed || 0} failed. Payments: ${pay?.succeeded || 0} ok, ${pay?.failed || 0} failed.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'QuickBooks sync failed', description: error.message, variant: 'destructive' });
    },
  });

  const { data: stripeStatus } = useQuery<StripeStatusEnvelope>({
    queryKey: ["/api/integrations/stripe/status"],
  });

  const { data: paymentSettings } = usePaymentSettings();
  const updatePaymentSettingsMutation = useUpdatePaymentSettings();
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('none');
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [epsEnabled, setEpsEnabled] = useState(false);
  const [epsMode, setEpsMode] = useState<'test' | 'live'>('test');
  const [epsTestAccountNumber, setEpsTestAccountNumber] = useState('');
  const [epsTestApiKey, setEpsTestApiKey] = useState('');
  const [epsTestBaseUrl, setEpsTestBaseUrl] = useState('https://postransactions.com/cnp');
  const [epsLiveAccountNumber, setEpsLiveAccountNumber] = useState('');
  const [epsLiveApiKey, setEpsLiveApiKey] = useState('');
  const [epsLiveBaseUrl, setEpsLiveBaseUrl] = useState('https://postransactions.com/cnp');

  useEffect(() => {
    if (!paymentSettings) return;
    setPaymentProvider(paymentSettings.provider);
    setStripeEnabled(paymentSettings.stripeEnabled);
    setEpsEnabled(paymentSettings.epsEnabled);
    setEpsMode(paymentSettings.epsMode || 'test');
    setEpsTestAccountNumber(paymentSettings.epsTestAccountNumber || '');
    setEpsTestApiKey('');
    setEpsTestBaseUrl(paymentSettings.epsTestBaseUrl || 'https://postransactions.com/cnp');
    setEpsLiveAccountNumber(paymentSettings.epsLiveAccountNumber || '');
    setEpsLiveApiKey('');
    setEpsLiveBaseUrl(paymentSettings.epsLiveBaseUrl || 'https://postransactions.com/cnp');
  }, [paymentSettings]);

  const savePaymentProviderDefault = async (provider: PaymentProvider) => {
    try {
      const next = await updatePaymentSettingsMutation.mutateAsync({ provider });
      setPaymentProvider(next.provider);
      setStripeEnabled(next.stripeEnabled);
      setEpsEnabled(next.epsEnabled);
      toast({
        title: provider === 'none' ? 'Payment processor default cleared' : 'Default payment processor updated',
      });
    } catch (error: any) {
      toast({ title: 'Payment processor default failed', description: error.message, variant: 'destructive' });
    }
  };

  const saveStripeEnablement = async (enabled: boolean) => {
    try {
      const next = await updatePaymentSettingsMutation.mutateAsync({ stripeEnabled: enabled });
      setStripeEnabled(next.stripeEnabled);
      setPaymentProvider(next.provider);
      toast({ title: enabled ? 'Stripe enabled' : 'Stripe disabled' });
    } catch (error: any) {
      toast({ title: 'Stripe setting failed', description: error.message, variant: 'destructive' });
    }
  };

  const saveEpsSettings = async () => {
    try {
      await updatePaymentSettingsMutation.mutateAsync({
        epsEnabled,
        epsMode,
        epsTestAccountNumber: epsTestAccountNumber.trim() || null,
        ...(epsTestApiKey.trim() ? { epsTestApiKey: epsTestApiKey.trim() } : {}),
        epsTestBaseUrl: epsTestBaseUrl.trim() || 'https://postransactions.com/cnp',
        epsLiveAccountNumber: epsLiveAccountNumber.trim() || null,
        ...(epsLiveApiKey.trim() ? { epsLiveApiKey: epsLiveApiKey.trim() } : {}),
        epsLiveBaseUrl: epsLiveBaseUrl.trim() || 'https://postransactions.com/cnp',
        epsSupportedModes: ["hosted_cnp"],
      });
      setEpsTestApiKey(''); setEpsLiveApiKey('');
      toast({ title: 'EPS settings saved' });
    } catch (error: any) {
      toast({ title: 'EPS settings failed', description: error.message, variant: 'destructive' });
    }
  };

  // Fetch sync jobs
  const { data: jobsData, isLoading: isLoadingJobs } = useQuery<{ jobs: SyncJob[] }>({
    queryKey: ["/api/integrations/quickbooks/jobs"],
    enabled: qbStatus?.connected === true,
    refetchInterval: (query) => {
      if (!isPageVisible) return false;
      const data = query.state.data as { jobs: SyncJob[] } | undefined;
      const jobs = data?.jobs ?? [];
      const hasActiveJob = jobs.some((job) => job.status === 'pending' || job.status === 'processing');
      return hasActiveJob ? 3_000 : false;
    },
  });

  // Connect to QuickBooks
  const handleConnect = async () => {
    try {
      const response = await fetch("/api/integrations/quickbooks/auth-url", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to get authorization URL");
      const { authUrl } = await response.json();
      
      // Clear previous toast flags
      sessionStorage.removeItem('qb_toast_shown');
      sessionStorage.removeItem('qb_error_shown');
      
      // Redirect to QuickBooks OAuth
      window.location.href = authUrl;
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  // Disconnect from QuickBooks
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/integrations/quickbooks/disconnect", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to disconnect");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/status"] });
      toast({ title: "Success", description: "QuickBooks disconnected" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const stripeConnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/stripe/connect', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const code = data?.code ? String(data.code) : undefined;
        const message = data?.message || data?.error || 'Failed to start Stripe onboarding';
        const err = new Error(String(message));
        (err as any).code = code;
        throw err;
      }
      return data as StripeStatusEnvelope & { data: { onboardingUrl: string } };
    },
    onSuccess: (data: any) => {
      const onboardingUrl = data?.data?.onboardingUrl;
      if (onboardingUrl) {
        sessionStorage.removeItem('stripe_toast_shown');
        sessionStorage.removeItem('stripe_refresh_shown');
        window.location.href = onboardingUrl;
        return;
      }
      toast({ title: 'Stripe', description: 'Onboarding link missing', variant: 'destructive' });
    },
    onError: (error: Error) => {
      const code = (error as any)?.code;
      if (code === 'STRIPE_NOT_CONFIGURED') {
        toast({
          title: 'Stripe',
          description: "Stripe isn’t configured on the server yet. Add a valid Stripe server API key and restart the server.",
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Stripe', description: error.message, variant: 'destructive' });
    },
  });

  const stripeDisconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/stripe/disconnect', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to disconnect Stripe');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/stripe/status'] });
      toast({ title: 'Stripe', description: 'Stripe disconnected' });
    },
    onError: (error: Error) => {
      toast({ title: 'Stripe', description: error.message, variant: 'destructive' });
    },
  });

  // Sync operations
  const syncMutation = useMutation({
    mutationFn: async ({ direction, resources }: { direction: 'pull' | 'push'; resources: string[] }) => {
      const response = await fetch(`/api/integrations/quickbooks/sync/${direction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resources }),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to queue sync jobs");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/jobs"] });
      toast({ title: "Success", description: data.message });
      setIsSyncing(true);
      setTimeout(() => setIsSyncing(false), 3000);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setIsSyncing(false);
    },
  });

  const handleSync = (direction: 'pull' | 'push', resources: string[]) => {
    syncMutation.mutate({ direction, resources });
  };

  const getEffectiveInvoiceMode = (row: QBInvoicePreviewRow): 'open_ar' | 'historical' | 'skip' => {
    const override = invoiceOverrides[row.qbInvoiceId];
    if (override === 'open_ar' || override === 'historical' || override === 'skip') return override;
    return row.classification;
  };

  const importSummary = useMemo(() => {
    if (!invoicePreview) return null;
    let openAr = 0, historical = 0, skipped = 0, excluded = 0;
    for (const row of invoicePreview) {
      if (!selectedQBIds.has(row.qbInvoiceId)) continue;
      if (!row.canImport) { excluded++; continue; }
      const override = invoiceOverrides[row.qbInvoiceId];
      const mode = (override === 'open_ar' || override === 'historical' || override === 'skip')
        ? override : row.classification;
      if (mode === 'skip') skipped++;
      else if (mode === 'open_ar') openAr++;
      else historical++;
    }
    return { openAr, historical, skipped, excluded, importable: openAr + historical };
  }, [invoicePreview, selectedQBIds, invoiceOverrides]);

  const handlePreviewInvoices = async (options?: { scope?: QBInvoicePreviewScope; page?: number; pageSize?: 50 | 100 | 200 }) => {
    const scope = options?.scope ?? invoicePreviewScope;
    const page = options?.page ?? invoicePreviewPageNumber;
    const pageSize = options?.pageSize ?? invoicePreviewPageSize;
    setIsLoadingPreview(true);
    setInvoicePreview(null);
    setInvoicePreviewPage(null);
    setSelectedQBIds(new Set());
    setExpandedDebugIds(new Set());
    setInvoiceOverrides({});
    try {
      const params = new URLSearchParams({ scope, page: String(page), pageSize: String(pageSize) });
      if (showReferenceDiagnostics) params.set('debugReferenceFields', '1');
      const url = `/api/integrations/quickbooks/import-preview/invoices?${params.toString()}`;
      const response = await fetch(url, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to fetch invoice preview');
      }
      const preview: QBInvoicePreviewPage = data.data;
      const rows = preview?.rows ?? [];
      setInvoicePreview(rows);
      setInvoicePreviewPage(preview);
      setInvoicePreviewScope(scope);
      setInvoicePreviewPageNumber(page);
      setInvoicePreviewPageSize(pageSize);
      setInvoiceOverrides({});
    } catch (error: any) {
      toast({ title: 'Preview failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handlePreviewCustomers = async () => {
    setIsLoadingCustomerPreview(true);
    setCustomerPreview(null);
    try {
      const response = await fetch('/api/integrations/quickbooks/import-preview/customers', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to fetch customer preview');
      }
      setCustomerPreview(data.data ?? []);
      setShowCustomerPreviewDialog(true);
    } catch (error: any) {
      toast({ title: 'Preview failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoadingCustomerPreview(false);
    }
  };

  const handleConfirmCustomerSync = () => {
    setShowCustomerPreviewDialog(false);
    setCustomerPreview(null);
    handleSync('pull', ['customers']);
  };

  const handleInspectQBCustomer = (row: QBCustomerPreviewRow) => {
    setShowCustomerPreviewDialog(false);
    setLocation(`${ROUTES.developer.qbCustomerInspector}?customerId=${encodeURIComponent(row.qbCustomerId)}`);
  };

  const handleImportInvoices = async (bulkOverride?: 'open_ar' | 'historical', idsToImport = selectedQBIds) => {
    if (!invoicePreview || idsToImport.size === 0) {
      toast({ title: 'Nothing selected', description: 'Select invoices to import first.', variant: 'destructive' });
      return;
    }

    // Build the explicit per-invoice payload
    const invoicesPayload = invoicePreview
      .filter(row => idsToImport.has(row.qbInvoiceId) && row.canImport)
      .map(row => {
        const override = invoiceOverrides[row.qbInvoiceId];
        const classification: 'open_ar' | 'historical' | 'skip' = bulkOverride ?? (
          override === 'open_ar' || override === 'historical' ? override :
          override === 'skip' ? 'skip' :
          row.classification
        );
        return { qbId: row.qbInvoiceId, classification };
      });

    const toImport = invoicesPayload.filter(i => i.classification !== 'skip');
    if (toImport.length === 0) {
      toast({ title: 'Nothing to import', description: 'All selected importable rows are marked Skip.', variant: 'destructive' });
      return;
    }

    setIsImportingInvoices(true);
    try {
      const response = await fetch('/api/integrations/quickbooks/import/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          invoices: invoicesPayload,
          mode: bulkOverride ?? 'suggested',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Import failed');
      }
      const r: QBInvoiceImportResult = data.data ?? { created: 0, updated: 0, skipped: 0, excluded: 0, failed: 0, importedOpenAr: 0, importedHistorical: 0, errors: [] };
      const parts: string[] = [];
      if (r.importedOpenAr > 0) parts.push(`${r.importedOpenAr} as Open A/R`);
      if (r.importedHistorical > 0) parts.push(`${r.importedHistorical} as Historical`);
      if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
      if (r.excluded > 0) parts.push(`${r.excluded} excluded`);
      if (r.failed > 0) parts.push(`${r.failed} failed`);
      toast({
        title: 'Invoice import complete',
        description: parts.length > 0 ? parts.join(' · ') : `Created: ${r.created}, Updated: ${r.updated}`,
      });
      await handlePreviewInvoices();
    } catch (error: any) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsImportingInvoices(false);
    }
  };

  const validateImportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/import/jobs/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: importResource,
          csvData: importCsvText,
          applyMode: importApplyMode,
          sourceFilename: importFilename || undefined,
        }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Failed to validate import');
      return data;
    },
    onSuccess: (data: any) => {
      const jobId = data?.data?.job?.id;
      if (jobId) setLastImportJobId(jobId);
      toast({ title: 'Validated', description: `Import validated (${data?.data?.summary?.valid ?? 0} valid, ${data?.data?.summary?.invalid ?? 0} invalid)` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const applyImportMutation = useMutation({
    mutationFn: async () => {
      if (!lastImportJobId) throw new Error('Validate an import first');
      const response = await fetch(`/api/import/jobs/${lastImportJobId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyMode: importApplyMode }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Failed to apply import');
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Applied',
        description: `Created ${data?.data?.results?.created ?? 0}, updated ${data?.data?.results?.updated ?? 0}, errors ${data?.data?.results?.errors?.length ?? 0}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Trigger manual job processing
  const triggerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/integrations/quickbooks/jobs/trigger", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to trigger sync");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks/jobs"] });
      toast({ title: "Success", description: "Sync processing triggered" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You don't have permission to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

              {/* QuickBooks Sync Queue (derived outbox) */}
              <div>
                <h3 className="font-semibold mb-3">QuickBooks Sync Queue</h3>
                <div className="grid gap-3 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                      Stability window:{" "}
                      <span className="font-medium text-foreground">{qbQueue?.data?.settleWindowMinutes ?? 30} min</span>
                      <span className="mx-2 text-muted-foreground/50">•</span>
                      Eligible now:{" "}
                      <span className="font-medium text-foreground">
                        {qbQueue?.data?.nextEligibleCounts?.invoices ?? 0} invoices, {qbQueue?.data?.nextEligibleCounts?.payments ?? 0} payments
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => qbFlushMutation.mutate()}
                      disabled={qbFlushMutation.isPending}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${qbFlushMutation.isPending ? 'animate-spin' : ''}`} />
                      Sync now
                    </Button>
                    <Button asChild size="sm" variant="outline"><Link to="/settings/integrations/quickbooks-sync-queue">Open Sync Queue</Link></Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <div>
                        <div className="font-medium">Invoices</div>
                        <div className="text-xs text-muted-foreground">pending + failed</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Pending: {qbQueue?.data?.invoices?.pending ?? 0}</Badge>
                        <Badge variant="destructive">Failed: {qbQueue?.data?.invoices?.failed ?? 0}</Badge>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <div>
                        <div className="font-medium">Payments</div>
                        <div className="text-xs text-muted-foreground">pending + failed</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Pending: {qbQueue?.data?.payments?.pending ?? 0}</Badge>
                        <Badge variant="destructive">Failed: {qbQueue?.data?.payments?.failed ?? 0}</Badge>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Sync now bypasses the timer but still waits for recently edited invoices and payments to stabilize. Partial or multi-invoice payments are not supported in MVP.
                  </div>
                </div>
              </div>

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'synced':
        return <Badge className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" />Synced</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
      case 'processing':
        return <Badge variant="secondary"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      case 'pending':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const stripePlatformBrowserReady = stripeStatus?.data?.browserConfig?.available === true;
  const stripeReady = stripeEnabled && stripeStatus?.data?.readyForPayments === true && stripePlatformBrowserReady;
  const stripeNeedsSetup = stripeEnabled && !stripeReady;
  const stripeProcessorStatus = stripeReady ? "ready" : stripeNeedsSetup ? "needs_setup" : "off";
  const epsProcessorStatus = epsEnabled ? (paymentSettings?.epsReady ? "ready" : "needs_setup") : "off";
  const stripeIsDefault = paymentProvider === "stripe";
  const epsIsDefault = paymentProvider === "eps";

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">Connect external services to Printers Hero</p>
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Invoice branding lives in Company settings.</p>
            <p className="text-sm text-muted-foreground">
              Manage company identity, logo, remittance address, and invoice payment copy from the Company tab.
            </p>
          </div>
          <Link href="/settings/company">
            <Button type="button" variant="outline" size="sm">
              Open Company Settings
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* QuickBooks Integration */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                <span className="bg-white/90 rounded-md px-3 py-1.5 inline-flex items-center shrink-0">
                  {qbLogoFailed ? (
                    <span className="text-sm font-semibold text-gray-800">QuickBooks Online</span>
                  ) : (
                    <img
                      src={qbLogoUrl}
                      alt="QuickBooks Online"
                      className="h-8 w-auto object-contain select-none"
                      onError={() => setQbLogoFailed(true)}
                    />
                  )}
                </span>
              </CardTitle>
              <CardDescription>
                Sync customers, invoices, and orders with QuickBooks
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              {isLoadingStatus ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : qbNeedsReauth ? (
                <Badge variant="destructive">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Reauth Required
                </Badge>
              ) : qbDegraded ? (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Temporarily Unavailable
                </Badge>
              ) : qbStatus?.connected ? (
                <Badge className="bg-green-500">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline">
                  <XCircle className="w-3 h-3 mr-1" />
                  Not Connected
                </Badge>
              )}

              <Badge variant="outline">
                Sync Policy: {qbSyncPolicyLabel}
              </Badge>

              <div className="text-xs text-muted-foreground">
                {qbSyncPolicy === 'queue_only'
                  ? 'Changes queue; worker/Sync now pushes later.'
                  : 'May push immediately depending on actions.'}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <QBTransientDisconnectBanner qbStatus={qbStatus} className="mb-4" />

          {qbStatus?.connected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Company ID</p>
                  <p className="font-medium">{qbStatus.companyId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Connected Since</p>
                  <p className="font-medium">
                    {qbStatus.connectedAt ? format(new Date(qbStatus.connectedAt), 'PPp') : 'N/A'}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Pull from QuickBooks — explicit per-resource actions */}
              <div>
                <h3 className="font-semibold mb-1">Import from QuickBooks</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Pull customers first, then preview and import invoices. Invoice import creates read-only records with no production workflow side-effects.
                </p>

                {/* Admin diagnostic toggle — only shown to admin/owner users */}
                {isAdmin && (
                  <label className="flex items-center gap-2 mb-3 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={showReferenceDiagnostics}
                      onChange={e => {
                        setShowReferenceDiagnostics(e.target.checked);
                        // Clear existing preview so next fetch uses the new setting
                        setInvoicePreview(null);
                        setExpandedDebugIds(new Set());
                        setInvoiceOverrides({});
                      }}
                      className="cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground">
                      Show QuickBooks reference diagnostics <span className="text-amber-600 font-medium">(admin only)</span>
                    </span>
                  </label>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Pull Customers — preview first, then confirm */}
                  <Button
                    onClick={handlePreviewCustomers}
                    disabled={syncMutation.isPending || isSyncing || isLoadingCustomerPreview}
                    variant="outline"
                  >
                    {isLoadingCustomerPreview
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <Download className="w-4 h-4 mr-2" />}
                    Pull Customers
                  </Button>

                  {/* The normal, bounded migration entry point. */}
                  <Button
                    onClick={() => handlePreviewInvoices({ scope: 'open_ar', page: 1 })}
                    disabled={isLoadingPreview || isImportingInvoices}
                    variant="outline"
                  >
                    {isLoadingPreview
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <Download className="w-4 h-4 mr-2" />}
                    Preview Open A/R
                  </Button>
                </div>

                {/* Invoice Preview Table */}
                {invoicePreview && (
                  <div className="mt-4">
                    <div className="rounded-md border bg-muted/30 p-3 mb-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {([
                          ['open_ar', 'Open A/R'],
                          ['historical', 'Historical'],
                          ['all_unsynced', 'All unsynced'],
                        ] as Array<[QBInvoicePreviewScope, string]>).map(([scope, label]) => (
                          <Button
                            key={scope}
                            size="sm"
                            variant={invoicePreviewScope === scope ? 'default' : 'outline'}
                            disabled={isLoadingPreview || isImportingInvoices}
                            onClick={() => handlePreviewInvoices({ scope, page: 1 })}
                          >
                            {label}{invoicePreviewScope === scope && invoicePreviewPage?.sourceTotal != null ? ` (${invoicePreviewPage.sourceTotal})` : ''}
                          </Button>
                        ))}
                        <Select
                          value={String(invoicePreviewPageSize)}
                          onValueChange={(value) => handlePreviewInvoices({ page: 1, pageSize: Number(value) as 50 | 100 | 200 })}
                        >
                          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="50">50 per page</SelectItem>
                            <SelectItem value="100">100 per page</SelectItem>
                            <SelectItem value="200">200 per page</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {invoicePreviewScope === 'open_ar' ? 'Open A/R' : invoicePreviewScope === 'historical' ? 'Historical' : 'All unsynced'} — page {invoicePreviewPage?.page ?? 1}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {invoicePreview.length} unsynced candidate{invoicePreview.length === 1 ? '' : 's'} shown; {invoicePreviewPage?.alreadyImportedExcludedOnPage ?? 0} already-imported source ID{(invoicePreviewPage?.alreadyImportedExcludedOnPage ?? 0) === 1 ? '' : 's'} excluded from this page. Nothing is selected by default.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs"
                            onClick={() => setSelectedQBIds(new Set(invoicePreview.filter(r => r.canImport && !r.alreadyImported).map(r => r.qbInvoiceId)))}
                          >
                            Select eligible on this page
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedQBIds(new Set())}>Clear selection</Button>
                          <Button
                            size="sm"
                            onClick={() => handleImportInvoices()}
                            disabled={(importSummary?.importable ?? 0) === 0 || isImportingInvoices || isLoadingPreview}
                          >
                            {isImportingInvoices ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                            Import Selected ({selectedQBIds.size})
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleImportInvoices(undefined, new Set(invoicePreview.filter(r => r.canImport && !r.alreadyImported).map(r => r.qbInvoiceId)))}
                            disabled={invoicePreview.filter(r => r.canImport && !r.alreadyImported).length === 0 || isImportingInvoices || isLoadingPreview}
                          >
                            Import this batch
                          </Button>
                        </div>
                      </div>
                      {importSummary && importSummary.importable > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {[importSummary.openAr > 0 && `${importSummary.openAr} as Open A/R`, importSummary.historical > 0 && `${importSummary.historical} as Historical`, importSummary.skipped > 0 && `${importSummary.skipped} skip`, importSummary.excluded > 0 && `${importSummary.excluded} excluded`].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <Button className="w-full" onClick={() => handleImportInvoices('open_ar')} disabled={selectedQBIds.size === 0 || isImportingInvoices || isLoadingPreview} variant="outline" size="sm" title="Override only the selected records on this page">
                          Override selected → Open A/R
                        </Button>
                        <Button className="w-full" onClick={() => handleImportInvoices('historical')} disabled={selectedQBIds.size === 0 || isImportingInvoices || isLoadingPreview} variant="outline" size="sm" title="Override only the selected records on this page">
                          Override selected → Historical
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">QuickBooks invoices ({invoicePreview.length} shown, {selectedQBIds.size} selected)</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          disabled={invoicePreviewPageNumber <= 1 || isLoadingPreview || isImportingInvoices}
                          onClick={() => handlePreviewInvoices({ page: invoicePreviewPageNumber - 1 })}
                        >
                          Previous page
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          disabled={!invoicePreviewPage?.hasNextPage || isLoadingPreview || isImportingInvoices}
                          onClick={() => handlePreviewInvoices({ page: invoicePreviewPageNumber + 1 })}
                        >
                          Next page
                        </Button>
                      </div>
                    </div>
                    <div className="border rounded-md overflow-auto max-h-80">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8"></TableHead>
                            <TableHead className="text-xs">QB #</TableHead>
                            <TableHead className="text-xs">Customer</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs">Total</TableHead>
                            <TableHead className="text-xs">Balance</TableHead>
                            <TableHead className="text-xs">PO / Legacy Reference</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs">Override</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoicePreview.map(row => {
                            const isExpanded = expandedDebugIds.has(row.qbInvoiceId);
                            const hasDebug = !!row.referenceDebug || !!row.inspection;
                            const colSpan = 10;
                            const effectiveMode = getEffectiveInvoiceMode(row);
                            return (
                              <>
                                <TableRow
                                  key={row.qbInvoiceId}
                                  className={!row.canImport ? 'opacity-50' : undefined}
                                >
                                  <TableCell className="w-8 pr-0">
                                    <input
                                      type="checkbox"
                                      checked={selectedQBIds.has(row.qbInvoiceId)}
                                      disabled={!row.canImport}
                                      onChange={e => {
                                        setSelectedQBIds(prev => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(row.qbInvoiceId);
                                          else next.delete(row.qbInvoiceId);
                                          return next;
                                        });
                                        if (e.target.checked && invoiceOverrides[row.qbInvoiceId] === 'skip') {
                                          setInvoiceOverrides(prev => ({ ...prev, [row.qbInvoiceId]: 'suggested' }));
                                        }
                                      }}
                                      className="cursor-pointer"
                                    />
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{row.qbDocNumber || row.qbInvoiceId}</TableCell>
                                  <TableCell className="text-xs">
                                    {row.localCustomerName ?? <span className="text-muted-foreground italic">{row.customerRefName}</span>}
                                  </TableCell>
                                  <TableCell className="text-xs">{row.txnDate}</TableCell>
                                  <TableCell className="text-xs">${row.totalAmt.toFixed(2)}</TableCell>
                                  <TableCell className="text-xs">${row.balance.toFixed(2)}</TableCell>
                                  <TableCell className="text-xs">
                                    {row.customerPoNumber
                                      ? (() => {
                                          const sourceLabel =
                                            row.customerPoSource === 'custom_field_sales1'
                                              ? 'From QuickBooks sales1 field (InfoFloPrint legacy reference)'
                                              : row.customerPoSource === 'line_description'
                                              ? 'Derived from QuickBooks line descriptions'
                                              : row.customerPoSource === 'custom_field_reference'
                                              ? 'From QuickBooks reference custom field'
                                              : row.customerPoSource === 'custom_field'
                                              ? 'From QuickBooks PO custom field'
                                              : row.customerPoSource === 'customer_memo'
                                              ? 'From QuickBooks Customer Memo'
                                              : row.customerPoSource === 'private_note'
                                              ? 'From QuickBooks Private Note'
                                              : `Source: ${row.customerPoSource ?? 'unknown'}`;
                                          return (
                                            <span title={sourceLabel} className="cursor-help">
                                              {row.customerPoNumber}
                                              {(row.customerPoSource === 'line_description' || row.customerPoSource === 'custom_field_reference') && (
                                                <span className="ml-1 text-muted-foreground text-xs">(desc)</span>
                                              )}
                                            </span>
                                          );
                                        })()
                                      : hasDebug
                                        ? (
                                          <button
                                            className="text-muted-foreground italic underline decoration-dotted cursor-pointer text-xs text-left"
                                            onClick={() => setExpandedDebugIds(prev => {
                                              const next = new Set(prev);
                                              if (next.has(row.qbInvoiceId)) next.delete(row.qbInvoiceId);
                                              else next.add(row.qbInvoiceId);
                                              return next;
                                            })}
                                          >
                                            No PO / description detected — inspect fields
                                          </button>
                                        )
                                        : <span className="text-muted-foreground italic text-xs">No PO / description detected. Enable diagnostics to inspect QB fields.</span>
                                    }
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <Badge variant={row.classification === 'open_ar' ? 'default' : 'secondary'} className="text-xs">
                                      {row.classification === 'open_ar' ? 'Open A/R' : 'Historical'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <Select
                                      value={invoiceOverrides[row.qbInvoiceId] ?? 'suggested'}
                                      onValueChange={(value) => {
                                        setInvoiceOverrides(prev => ({
                                          ...prev,
                                          [row.qbInvoiceId]: value as 'suggested' | 'open_ar' | 'historical' | 'skip',
                                        }));
                                        if (value === 'skip') {
                                          setSelectedQBIds(prev => {
                                            const next = new Set(prev);
                                            next.delete(row.qbInvoiceId);
                                            return next;
                                          });
                                        } else if (row.canImport) {
                                          setSelectedQBIds(prev => {
                                            const next = new Set(prev);
                                            next.add(row.qbInvoiceId);
                                            return next;
                                          });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="h-7 w-[120px] text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="suggested">Suggested</SelectItem>
                                        <SelectItem value="historical">Historical</SelectItem>
                                        <SelectItem value="open_ar">Open A/R</SelectItem>
                                        <SelectItem value="skip">Skip</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {effectiveMode !== row.classification && effectiveMode !== 'skip' && (
                                      <div className="mt-1 text-[11px] text-amber-600">Overrides suggestion</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {row.alreadyImported
                                        ? <Badge variant="outline" className="text-xs">Imported</Badge>
                                        : row.canImport
                                          ? <Badge variant="secondary" className="text-xs">New</Badge>
                                          : <Badge variant="destructive" className="text-xs" title={row.cannotImportReason}>Excluded</Badge>
                                      }
                                      {effectiveMode === 'skip' && <Badge variant="outline" className="text-xs">Skip</Badge>}
                                      {hasDebug && (
                                        <button
                                          className="text-muted-foreground hover:text-foreground ml-1 text-xs"
                                          title={isExpanded ? 'Hide diagnostics' : 'Show QB field diagnostics'}
                                          onClick={() => setExpandedDebugIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(row.qbInvoiceId)) next.delete(row.qbInvoiceId);
                                            else next.add(row.qbInvoiceId);
                                            return next;
                                          })}
                                        >
                                          {isExpanded ? '▲' : '▼'}
                                        </button>
                                      )}
                                    </div>
                                    {(row.exclusionReasons?.length ?? 0) > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-0.5">
                                        {(row.exclusionReasons ?? []).map(r => (
                                          <span key={r} className="inline-block bg-destructive/10 text-destructive text-[10px] px-1 py-0.5 rounded">
                                            {EXCLUSION_REASON_LABELS[r] ?? r}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {(row.warningReasons?.length ?? 0) > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-0.5">
                                        {(row.warningReasons ?? []).map(r => (
                                          <span key={r} className="inline-block bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] px-1 py-0.5 rounded">
                                            {WARNING_REASON_LABELS[r] ?? r}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>

                                {/* Expandable diagnostic panel — only shown when debug data is present and row is expanded */}
                                {hasDebug && isExpanded && (row.referenceDebug || row.inspection) && (
                                  <TableRow key={`${row.qbInvoiceId}-debug`} className="bg-muted/30">
                                    <TableCell colSpan={colSpan} className="py-2 px-4">
                                      <div className="text-xs space-y-2">
                                        <p className="font-semibold text-amber-700 dark:text-amber-400">
                                          Diagnostic — QB reference fields (admin only, not stored)
                                        </p>

                                        {/* Custom fields */}
                                        <div>
                                          <span className="font-medium">Custom Fields: </span>
                                          {(row.referenceDebug?.customFields ?? []).length === 0
                                            ? <span className="text-muted-foreground italic">none</span>
                                            : (
                                              <span className="font-mono">
                                                {(row.referenceDebug?.customFields ?? []).map((f, i) => (
                                                  <span key={i} className="mr-3">
                                                    <span className="text-muted-foreground">[{f.name ?? '?'}{f.type ? ` (${f.type})` : ''}]</span>
                                                    {' '}{f.value ?? <span className="italic text-muted-foreground">empty</span>}
                                                  </span>
                                                ))}
                                              </span>
                                            )
                                          }
                                        </div>

                                        {/* Customer Memo */}
                                        <div>
                                          <span className="font-medium">Customer Memo: </span>
                                          {row.referenceDebug?.customerMemo
                                            ? <span className="font-mono">{row.referenceDebug.customerMemo}</span>
                                            : <span className="text-muted-foreground italic">empty</span>
                                          }
                                        </div>

                                        {/* Private Note */}
                                        <div>
                                          <span className="font-medium">Private Note: </span>
                                          {row.referenceDebug?.privateNote
                                            ? <span className="font-mono">{row.referenceDebug.privateNote}</span>
                                            : <span className="text-muted-foreground italic">empty</span>
                                          }
                                        </div>

                                        {/* Line descriptions */}
                                        <div>
                                          <span className="font-medium">Line Descriptions: </span>
                                          {(row.referenceDebug?.lineDescriptions ?? []).length === 0
                                            ? <span className="text-muted-foreground italic">none</span>
                                            : (
                                              <ul className="mt-0.5 ml-4 list-disc">
                                                {(row.referenceDebug?.lineDescriptions ?? []).map((d, i) => (
                                                  <li key={i} className="font-mono">{d}</li>
                                                ))}
                                              </ul>
                                            )
                                          }
                                        </div>

                                        {/* Detected PO summary */}
                                        {row.inspection && (
                                          <div className="grid gap-3 pt-2 md:grid-cols-2">
                                            <div className="rounded-md border bg-background p-2">
                                              <div className="mb-1 font-medium">Classification</div>
                                              <div className="text-muted-foreground">{row.inspection.classification.rationale}</div>
                                              <div className="mt-2 font-medium">Reasons</div>
                                              <div className="font-mono text-[11px] text-muted-foreground">
                                                Excluded: {row.inspection.exclusionReasons.length ? row.inspection.exclusionReasons.join(', ') : 'none'}<br />
                                                Warnings: {row.inspection.warningReasons.length ? row.inspection.warningReasons.join(', ') : 'none'}
                                              </div>
                                            </div>
                                            <div className="rounded-md border bg-background p-2">
                                              <div className="mb-1 font-medium">Mapping Coverage</div>
                                              <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
                                                <div>Mapped: {row.inspection.mappingCoverage.mapped.length}</div>
                                                <div>Ignored: {row.inspection.mappingCoverage.ignored.length}</div>
                                                <div>Empty: {row.inspection.mappingCoverage.empty.length}</div>
                                                <div>Unknown: {row.inspection.mappingCoverage.unknown.length}</div>
                                              </div>
                                              <div className="mt-2 text-[11px] text-muted-foreground">Unmapped: {row.inspection.unmappedFields.length ? row.inspection.unmappedFields.join(', ') : 'none'}</div>
                                            </div>
                                            <div className="rounded-md border bg-background p-2 md:col-span-2">
                                              <div className="mb-1 font-medium">PO-like Candidates</div>
                                              {row.inspection.poLikeCandidates.length === 0
                                                ? <div className="text-muted-foreground italic">none detected in memo, note, custom fields, or line descriptions</div>
                                                : row.inspection.poLikeCandidates.map((candidate, index) => (
                                                  <div key={`${candidate.qbField}-${index}`} className="font-mono text-[11px]">
                                                    <Badge variant={candidate.mapped ? 'default' : 'outline'} className="mr-2 text-[10px]">{candidate.mapped ? 'mapped' : 'unused'}</Badge>
                                                    {candidate.qbField}: {candidate.value}
                                                  </div>
                                                ))}
                                            </div>
                                            <div className="rounded-md border bg-background p-2 md:col-span-2">
                                              <div className="mb-1 font-medium">Mapping Diagnostics</div>
                                              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{JSON.stringify(row.inspection.mappingDiagnostics, null, 2)}</pre>
                                            </div>
                                            <div className="rounded-md border bg-background p-2 md:col-span-2">
                                              <div className="mb-1 font-medium">Mapped Printers Hero Invoice Draft</div>
                                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{JSON.stringify(row.inspection.mappedDraft, null, 2)}</pre>
                                            </div>
                                            <div className="rounded-md border bg-background p-2 md:col-span-2">
                                              <div className="mb-1 font-medium">Raw QB Invoice Payload</div>
                                              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{JSON.stringify(row.inspection.rawPayload, null, 2)}</pre>
                                            </div>
                                          </div>
                                        )}
                                        <div>
                                          <span className="font-medium">Detected PO: </span>
                                          {row.customerPoNumber
                                            ? <span className="font-mono text-green-700 dark:text-green-400">{row.customerPoNumber} <span className="text-muted-foreground">(source: {row.customerPoSource})</span></span>
                                            : <span className="text-muted-foreground italic">none — update extraction rules if a PO-like value appears above</span>
                                          }
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      "Import as Open A/R" or "Import as Historical" applies the chosen classification to all selected rows. Historical invoices are read-only records and do not trigger production workflows.
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              {/* Push to QuickBooks — unchanged */}
              <div>
                <h3 className="font-semibold mb-3">Push to QuickBooks</h3>
                <Button
                  onClick={() => handleSync('push', ['customers'])}
                  disabled={syncMutation.isPending || isSyncing || qbPushDisabled}
                  variant="outline"
                  title={qbPushDisabled ? 'Disabled by org syncPolicy=queue_only (use QuickBooks Sync Queue instead).' : undefined}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Push to QuickBooks
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  {qbPushDisabled
                    ? 'Disabled by org syncPolicy=queue_only (use QuickBooks Sync Queue / Sync now).'
                    : 'Send local customers to QuickBooks'}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => triggerMutation.mutate()}
                  disabled={triggerMutation.isPending}
                  variant="secondary"
                  size="sm"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${triggerMutation.isPending ? 'animate-spin' : ''}`} />
                  Run queue worker batch
                </Button>
                <Button
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  variant="destructive"
                  size="sm"
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {qbNeedsReauth ? (
                <div className="bg-destructive/10 border border-destructive/30 p-4 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                    <div>
                      <h4 className="font-semibold">Reconnect required</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        {qbStatus?.message || 'QuickBooks authorization expired. Reconnect to resume sync.'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="bg-muted p-4 rounded-lg">
                <h4 className="font-semibold mb-2">What gets synced?</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• <strong>Customers:</strong> Two-way sync of customer information</li>
                  <li>• <strong>Invoices:</strong> Pull invoices from QuickBooks, push local invoices</li>
                  <li>• <strong>Orders:</strong> Sync completed orders as Sales Receipts</li>
                </ul>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={handleConnect} className="w-full">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {qbNeedsReauth ? 'Reconnect to QuickBooks' : 'Connect to QuickBooks'}
                </Button>
                {qbNeedsReauth ? (
                  <Button
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    variant="outline"
                    className="w-full"
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                You'll be redirected to QuickBooks to authorize the connection
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mb-3">
        <h2 className="text-xl font-semibold">Payment Processors</h2>
        <p className="text-sm text-muted-foreground">
          Enabled processors can be configured here, but only the default processor is used automatically for hosted invoice payments. Manual payment recording stays separate.
        </p>
      </div>

      <PaymentProcessorSettingsCard
        processorName="Stripe"
        logoSrc={stripeLogoUrl}
        logoAlt="Stripe"
        description="Stripe Connect card payments for hosted invoice payment actions"
        status={stripeProcessorStatus}
        enabled={stripeEnabled}
        readinessLabel={stripeStatus?.data?.modeMismatch ? "Mode mismatch" : stripeReady ? (stripeStatus?.data?.readyForProductionPayments ? "Ready for live payments" : "Ready for test payments") : stripeEnabled ? "Needs setup" : "Disabled"}
        isDefault={stripeIsDefault}
        defaultExpanded={stripeIsDefault || !stripeStatus?.data?.stripeAccountId}
      >
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label htmlFor="stripe-enabled">Enable Stripe</Label>
                  <p className="text-xs text-muted-foreground">Make Stripe available for invoice card payments. Connection and onboarding are managed separately.</p>
                </div>
                <Switch id="stripe-enabled" checked={stripeEnabled} onCheckedChange={saveStripeEnablement} disabled={updatePaymentSettingsMutation.isPending} />
              </div>
              <div className="rounded-md border p-3">
                <Label>Default hosted processor</Label>
                <p className="mt-1 text-sm font-medium">
                  {stripeIsDefault ? "Stripe is the default processor" : epsIsDefault ? "EPS is the default processor" : "No default processor selected"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => savePaymentProviderDefault('stripe')} disabled={!stripeReady || stripeIsDefault || updatePaymentSettingsMutation.isPending}>
                    {stripeIsDefault ? 'Default processor' : 'Use Stripe as default'}
                  </Button>
                  {stripeIsDefault ? <Button type="button" size="sm" variant="ghost" onClick={() => savePaymentProviderDefault('none')} disabled={updatePaymentSettingsMutation.isPending}>Clear default</Button> : null}
                </div>
              </div>
            </div>
            {stripeStatus?.data?.lastError ? (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">
                <div className="font-semibold mb-1">Last error</div>
                <div className="break-words">{stripeStatus.data.lastError}</div>
              </div>
            ) : null}
            {stripeEnabled && !stripePlatformBrowserReady ? (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">
                <div className="font-semibold mb-1">Platform browser configuration unavailable</div>
                <div>Payments are blocked until the platform publishable key is configured on the server for the current Stripe mode.</div>
              </div>
            ) : null}

            {stripeStatus?.data?.stripeAccountId ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Stripe Account</p>
                  <p className="font-medium">{stripeStatus.data.stripeAccountId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Server mode</p>
                  <p className="font-medium">{String(stripeStatus.data.serverMode || stripeStatus.data.mode || 'unknown')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Charges Enabled</p>
                  <p className="font-medium">{stripeStatus.data.chargesEnabled ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Details Submitted</p>
                  <p className="font-medium">{stripeStatus.data.detailsSubmitted ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payouts Enabled</p>
                  <p className="font-medium">{stripeStatus.data.payoutsEnabled ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Card payments capability</p>
                  <p className="font-medium">{stripeStatus.data.cardPaymentsCapability || 'Unavailable'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Readiness</p>
                  <p className="font-medium">{stripeStatus.data.readyForProductionPayments ? 'Ready for live payments' : stripeStatus.data.readyForTestPayments ? 'Ready for test payments' : String(stripeStatus.data.status || 'Needs setup')}</p>
                </div>
              </div>
            ) : (
              <div className="bg-muted p-4 rounded-lg">
                <h4 className="font-semibold mb-2">What this enables</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Take card payments for invoices</li>
                  <li>• Each organization connects their own Stripe account</li>
                  <li>• No tenant secret keys stored in Printers Hero</li>
                </ul>
              </div>
            )}

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => stripeConnectMutation.mutate()}
                disabled={stripeConnectMutation.isPending}
                className="min-w-[220px]"
                variant="outline"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                {stripeStatus?.data?.stripeAccountId ? 'Continue Stripe Setup' : 'Connect Stripe'}
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/integrations/stripe/status'] })}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Status
              </Button>

              <Button
                onClick={() => stripeDisconnectMutation.mutate()}
                disabled={stripeDisconnectMutation.isPending}
                variant="destructive"
              >
                Disconnect
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              You’ll be redirected to Stripe to complete onboarding.
            </p>
        </div>
      </PaymentProcessorSettingsCard>

      <PaymentProcessorSettingsCard
        processorName="Enhanced Payment Systems"
        logoSrc={epsLogoUrl}
        logoAlt="Enhanced Payment Systems"
        description="EPS hosted payment configuration for invoice payment actions"
        status={epsProcessorStatus}
        enabled={epsEnabled}
        readinessLabel={epsEnabled ? (paymentSettings?.epsReady ? "Ready" : "Needs setup") : "Disabled"}
        isDefault={epsIsDefault}
        defaultExpanded={epsIsDefault || !paymentSettings?.epsReady}
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="eps-enabled">Enable EPS</Label>
                <p className="text-xs text-muted-foreground">Credentials make EPS available; default selection controls automatic use.</p>
              </div>
              <Switch id="eps-enabled" checked={epsEnabled} onCheckedChange={setEpsEnabled} />
            </div>

            <div className="rounded-md border p-3">
              <Label>Default hosted processor</Label>
              <p className="mt-1 text-sm font-medium">
                {epsIsDefault ? "EPS is the default processor" : stripeIsDefault ? "Stripe is the default processor" : "No default processor selected"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Only one default processor can be saved at a time.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => savePaymentProviderDefault('eps')} disabled={!epsEnabled || !paymentSettings?.epsReady || epsIsDefault || updatePaymentSettingsMutation.isPending}>
                  {epsIsDefault ? "Default processor" : "Use EPS as default"}
                </Button>
                {epsIsDefault ? <Button type="button" size="sm" variant="ghost" onClick={() => savePaymentProviderDefault('none')} disabled={updatePaymentSettingsMutation.isPending}>Clear default</Button> : null}
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Active EPS environment</Label>
              <div className="flex gap-2"><Button type="button" variant={epsMode === 'test' ? 'default' : 'outline'} onClick={() => setEpsMode('test')}>Test</Button><Button type="button" variant={epsMode === 'live' ? 'destructive' : 'outline'} onClick={() => setEpsMode('live')}>Live</Button></div>
              {epsMode === 'live' ? <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">LIVE MODE routes hosted payments to live EPS credentials.</p> : null}
            </div>
            <div className="space-y-2"><Label htmlFor="eps-test-account">Test account number</Label><Input id="eps-test-account" value={epsTestAccountNumber} onChange={(event) => setEpsTestAccountNumber(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="eps-test-api-key">Test API key</Label><Input id="eps-test-api-key" type="password" value={epsTestApiKey} onChange={(event) => setEpsTestApiKey(event.target.value)} placeholder={paymentSettings?.epsTestApiKeyConfigured ? "Configured. Enter a new key to replace." : "Required for test mode"} /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="eps-test-base">Test hosted base URL</Label><Input id="eps-test-base" value={epsTestBaseUrl} onChange={(event) => setEpsTestBaseUrl(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="eps-live-account">Live account number</Label><Input id="eps-live-account" value={epsLiveAccountNumber} onChange={(event) => setEpsLiveAccountNumber(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="eps-live-api-key">Live API key</Label><Input id="eps-live-api-key" type="password" value={epsLiveApiKey} onChange={(event) => setEpsLiveApiKey(event.target.value)} placeholder={paymentSettings?.epsLiveApiKeyConfigured ? "Configured. Enter a new key to replace." : "Required for live mode"} /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="eps-live-base">Live hosted base URL</Label><Input id="eps-live-base" value={epsLiveBaseUrl} onChange={(event) => setEpsLiveBaseUrl(event.target.value)} /></div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium">EPS capability status</h4>
              <p className="text-xs text-muted-foreground">
                Phase 1 is hosted-card-payment only. Other EPS actions are disabled server-side until certification and official status handling are complete.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {EPS_PHASE1_MODE_STATUS.map((mode) => (
                <div key={mode.label} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{mode.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{mode.description}</div>
                  </div>
                  <Badge variant={mode.status === "available" ? "default" : "outline"} className="shrink-0">
                    {mode.status === "available" ? "Available" : "Coming later"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {paymentSettings?.missing?.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              Missing: {paymentSettings.missing.join(", ")}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveEpsSettings} disabled={updatePaymentSettingsMutation.isPending}>
              {updatePaymentSettingsMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Save EPS Settings
            </Button>
          </div>
        </div>
      </PaymentProcessorSettingsCard>

      {/* Data Import / Export */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Data Import / Export
              </CardTitle>
              <CardDescription>
                CSV validate → apply workflow. Import apply modes control how QuickBooks field overrides are handled.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <a href="/api/customers/csv-template" target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Customer Template
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/customers/export" target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Export Customers
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/materials/csv-template" target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Material Template
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/materials/export" target="_blank" rel="noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Export Materials
              </a>
            </Button>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Resource</p>
              <Select value={importResource} onValueChange={(v: any) => setImportResource(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customers">Customers</SelectItem>
                  <SelectItem value="materials">Materials</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Apply Mode</p>
              <Select value={importApplyMode} onValueChange={(v: any) => setImportApplyMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MERGE_RESPECT_OVERRIDES">Merge (respect QB overrides)</SelectItem>
                  <SelectItem value="MERGE_AND_SET_OVERRIDES">Merge (set QB overrides)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                “Set overrides” marks imported fields as Titan-authoritative for future QuickBooks pulls.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">CSV File</p>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleImportFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {importFilename ? `Loaded: ${importFilename}` : 'Choose a CSV file to validate'}
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => validateImportMutation.mutate()}
              disabled={!importCsvText || validateImportMutation.isPending}
            >
              {validateImportMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Validate
            </Button>
            <Button
              variant="default"
              onClick={() => applyImportMutation.mutate()}
              disabled={!lastImportJobId || applyImportMutation.isPending}
            >
              {applyImportMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Apply
            </Button>
            {lastImportJobId ? (
              <Button variant="outline" asChild>
                <a href={`/api/import/jobs/${lastImportJobId}`} target="_blank" rel="noreferrer">
                  View Job JSON
                </a>
              </Button>
            ) : null}
          </div>

          {validateImportMutation.data?.data?.invalidPreview?.length ? (
            <div className="border rounded-md">
              <div className="px-4 py-3 border-b">
                <p className="font-medium">Validation Errors (preview)</p>
                <p className="text-sm text-muted-foreground">Showing up to 100 invalid rows</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validateImportMutation.data.data.invalidPreview.map((e: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono">{e.rowNumber}</TableCell>
                      <TableCell className="text-sm">{e.error}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Sync Job History */}
      {qbStatus?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Sync History</CardTitle>
            <CardDescription>Recent synchronization jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingJobs ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : jobsData?.jobs && jobsData.jobs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Results</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobsData.jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="capitalize">{job.resourceType}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {job.direction === 'pull' ? (
                            <Download className="w-3 h-3" />
                          ) : (
                            <Upload className="w-3 h-3" />
                          )}
                          <span className="capitalize">{job.direction}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(job.status)}</TableCell>
                      <TableCell>
                        {job.payloadJson ? (
                          <span className="text-sm">
                            {job.payloadJson.syncedCount || 0} synced
                            {job.payloadJson.errorCount ? `, ${job.payloadJson.errorCount} errors` : ''}
                          </span>
                        ) : job.error ? (
                          <span className="text-sm text-destructive flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {job.error.substring(0, 50)}...
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(job.createdAt), 'PPp')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No sync jobs yet</p>
                <p className="text-sm">Use the sync buttons above to get started</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* QB Customer Import Preview Dialog */}
      <Dialog open={showCustomerPreviewDialog} onOpenChange={setShowCustomerPreviewDialog}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>QuickBooks Customer Import Preview</DialogTitle>
            <DialogDescription>
              Review what will be imported before syncing. Contacts without a real person name
              will not be created — only the company record will be saved.
            </DialogDescription>
          </DialogHeader>

          {customerPreview && (() => {
            const total         = customerPreview.length;
            const willCreate    = customerPreview.filter(r => r.willCreateCompany).length;
            const willUpdate    = customerPreview.filter(r => r.willUpdateCompany).length;
            const withContact   = customerPreview.filter(r => r.willCreateContact).length;
            const needsReview   = customerPreview.filter(r => r.contactNeedsReview).length;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="rounded border p-2 text-center">
                    <div className="text-2xl font-bold">{total}</div>
                    <div className="text-muted-foreground">Total</div>
                  </div>
                  <div className="rounded border p-2 text-center">
                    <div className="text-2xl font-bold text-green-600">{willCreate}</div>
                    <div className="text-muted-foreground">New companies</div>
                  </div>
                  <div className="rounded border p-2 text-center">
                    <div className="text-2xl font-bold">{willUpdate}</div>
                    <div className="text-muted-foreground">Updates</div>
                  </div>
                  <div className="rounded border p-2 text-center">
                    <div className="text-2xl font-bold text-amber-600">{needsReview}</div>
                    <div className="text-muted-foreground">No contact name</div>
                  </div>
                </div>

                {needsReview > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium flex items-center gap-1 text-amber-700">
                      <AlertCircle className="w-4 h-4" />
                      {needsReview} record{needsReview !== 1 ? 's' : ''} will import company only (no contact created)
                    </p>
                  </div>
                )}

                <div className="rounded border overflow-hidden">
                  <div className="max-h-[420px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[90px]">QB ID</TableHead>
                          <TableHead>QuickBooks customer</TableHead>
                          <TableHead>Import status</TableHead>
                          <TableHead>Failure reason</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Local match</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customerPreview.map(row => (
                          <TableRow
                            key={row.qbCustomerId}
                            className="cursor-pointer hover:bg-muted/50"
                            tabIndex={0}
                            onClick={() => handleInspectQBCustomer(row)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleInspectQBCustomer(row);
                              }
                            }}
                          >
                            <TableCell className="font-mono text-xs">{row.qbCustomerId}</TableCell>
                            <TableCell>
                              <div className="space-y-0.5">
                                <div className="font-medium">{row.mappedCompanyName || row.qbDisplayName || '-'}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[260px]">
                                  QB display: {row.qbDisplayName || '-'}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={row.importStatus?.includes('only') ? 'secondary' : 'default'}>
                                {getCustomerImportStatusLabel(row.importStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className={row.failureReason ? 'text-amber-700 text-sm font-medium' : 'text-muted-foreground text-sm'}>
                                  {getCustomerFailureReasonLabel(row.failureReason)}
                                </span>
                                {row.suspiciousFields.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {row.suspiciousFields.map(field => (
                                      <Badge key={field} variant="outline" className="text-[10px]">
                                        {field}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">
                              <div className="space-y-0.5">
                                <div>
                                  {[row.mappedContactFirstName, row.mappedContactLastName].filter(Boolean).join(' ') || 'No contact'}
                                </div>
                                <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                  {row.email || row.phone || '-'}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 text-xs text-muted-foreground">
                                <div>{row.matchedExistingCustomerId ? 'Matched customer' : 'No customer match'}</div>
                                <div>{row.matchedExistingContactId ? 'Matched contact' : 'No contact match'}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleInspectQBCustomer(row);
                                }}
                              >
                                <ExternalLink className="w-3 h-3 mr-1" />
                                Inspect
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {withContact} contact{withContact !== 1 ? 's' : ''} will be created alongside their company.
                  Records with no person name will import as company-only — you can add contacts manually afterward.
                </p>
              </div>
            );
          })()}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCustomerPreviewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmCustomerSync} disabled={syncMutation.isPending || isSyncing}>
              {syncMutation.isPending || isSyncing
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing…</>
                : <><Download className="w-4 h-4 mr-2" />Proceed with Import</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
