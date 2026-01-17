import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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
  CreditCard,
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
import { format } from "date-fns";

type QBConnectionStatus = {
  connected: boolean;
  companyId?: string;
  connectedAt?: string;
  expiresAt?: string;
  message?: string;
};

type QBSyncQueueEnvelope = {
  success: boolean;
  data?: {
    settleWindowMinutes: number;
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
    ignoreSettleWindow: boolean;
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
  status?: string;
  lastError?: string | null;
  chargesEnabled?: boolean;
  detailsSubmitted?: boolean;
};

type StripeStatusEnvelope = {
  success: boolean;
  data: StripeStatusData;
  error?: string;
};

export default function SettingsIntegrations() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [isSyncing, setIsSyncing] = useState(false);

  const [importResource, setImportResource] = useState<'customers' | 'materials'>('customers');
  const [importApplyMode, setImportApplyMode] = useState<'MERGE_RESPECT_OVERRIDES' | 'MERGE_AND_SET_OVERRIDES'>('MERGE_RESPECT_OVERRIDES');
  const [importCsvText, setImportCsvText] = useState<string>('');
  const [importFilename, setImportFilename] = useState<string>('');
  const [lastImportJobId, setLastImportJobId] = useState<string>('');

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

  const { data: qbQueue } = useQuery<QBSyncQueueEnvelope>({
    queryKey: ["/api/integrations/quickbooks/queue"],
    enabled: qbStatus?.connected === true,
    refetchInterval: 30000,
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

  const { data: stripeStatus, isLoading: isLoadingStripeStatus } = useQuery<StripeStatusEnvelope>({
    queryKey: ["/api/integrations/stripe/status"],
  });

  // Fetch sync jobs
  const { data: jobsData, isLoading: isLoadingJobs } = useQuery<{ jobs: SyncJob[] }>({
    queryKey: ["/api/integrations/quickbooks/jobs"],
    enabled: qbStatus?.connected === true,
    refetchInterval: (query) => {
      const data = query.state.data as { jobs: SyncJob[] } | undefined;
      const jobs = data?.jobs ?? [];
      const hasActiveJob = jobs.some((job) => job.status === 'pending' || job.status === 'processing');
      return hasActiveJob ? 3000 : 20000;
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
          description: "Stripe isn’t configured on the server yet. Add STRIPE_SECRET_KEY (sk_test_...) and restart the server.",
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
                      Settle window:{" "}
                      <span className="font-medium text-foreground">{qbQueue?.data?.settleWindowMinutes ?? 10} min</span>
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
                    Sync now ignores the settle window (operator override). Partial or multi-invoice payments are not supported in MVP.
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
        <p className="text-muted-foreground">Connect external services to QuoteVaultPro</p>
      </div>

      {/* QuickBooks Integration */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <img 
                  src="https://plugin.intuit.com/favicon.ico" 
                  alt="QuickBooks" 
                  className="w-6 h-6"
                />
                QuickBooks Online
              </CardTitle>
              <CardDescription>
                Sync customers, invoices, and orders with QuickBooks
              </CardDescription>
            </div>
            {isLoadingStatus ? (
              <Loader2 className="h-5 w-5 animate-spin" />
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
          </div>
        </CardHeader>
        <CardContent>
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

              {/* Sync Controls */}
              <div>
                <h3 className="font-semibold mb-3">Sync Data</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Button
                    onClick={() => handleSync('pull', ['customers', 'invoices', 'orders'])}
                    disabled={syncMutation.isPending || isSyncing}
                    variant="outline"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Pull from QuickBooks
                  </Button>
                  <Button
                    onClick={() => handleSync('push', ['customers'])}
                    disabled={syncMutation.isPending || isSyncing}
                    variant="outline"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Push to QuickBooks
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Pull: Import customers, invoices, and orders from QuickBooks<br />
                  Push: Send local customers to QuickBooks
                </p>
              </div>

              <Separator />

              <div className="flex gap-2">
                <Button
                  onClick={() => triggerMutation.mutate()}
                  disabled={triggerMutation.isPending}
                  variant="secondary"
                  size="sm"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${triggerMutation.isPending ? 'animate-spin' : ''}`} />
                  Process Pending Jobs
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
              <div className="bg-muted p-4 rounded-lg">
                <h4 className="font-semibold mb-2">What gets synced?</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• <strong>Customers:</strong> Two-way sync of customer information</li>
                  <li>• <strong>Invoices:</strong> Pull invoices from QuickBooks, push local invoices</li>
                  <li>• <strong>Orders:</strong> Sync completed orders as Sales Receipts</li>
                </ul>
              </div>
              <Button onClick={handleConnect} className="w-full">
                <ExternalLink className="w-4 h-4 mr-2" />
                Connect to QuickBooks
              </Button>
              <p className="text-xs text-muted-foreground">
                You'll be redirected to QuickBooks to authorize the connection
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stripe Integration */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Stripe (Connect)
              </CardTitle>
              <CardDescription>
                Accept card payments on behalf of each connected organization
              </CardDescription>
            </div>
            {isLoadingStripeStatus ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : stripeStatus?.data?.connected ? (
              <Badge className="bg-green-500">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Connected
              </Badge>
            ) : stripeStatus?.data?.stripeAccountId ? (
              <Badge variant="secondary">
                <AlertCircle className="w-3 h-3 mr-1" />
                Setup Required
              </Badge>
            ) : (
              <Badge variant="outline">
                <XCircle className="w-3 h-3 mr-1" />
                Not Connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stripeStatus?.data?.lastError ? (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 text-sm">
                <div className="font-semibold mb-1">Last error</div>
                <div className="break-words">{stripeStatus.data.lastError}</div>
              </div>
            ) : null}

            {stripeStatus?.data?.stripeAccountId ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Stripe Account</p>
                  <p className="font-medium">{stripeStatus.data.stripeAccountId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mode</p>
                  <p className="font-medium">{String(stripeStatus.data.mode || 'test')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Charges Enabled</p>
                  <p className="font-medium">{stripeStatus.data.chargesEnabled ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Details Submitted</p>
                  <p className="font-medium">{stripeStatus.data.detailsSubmitted ? 'Yes' : 'No'}</p>
                </div>
              </div>
            ) : (
              <div className="bg-muted p-4 rounded-lg">
                <h4 className="font-semibold mb-2">What this enables</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Take card payments for invoices</li>
                  <li>• Each organization connects their own Stripe account</li>
                  <li>• No tenant secret keys stored in QuoteVaultPro</li>
                </ul>
              </div>
            )}

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => stripeConnectMutation.mutate()}
                disabled={stripeConnectMutation.isPending}
                className="min-w-[220px]"
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
        </CardContent>
      </Card>

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
    </div>
  );
}
