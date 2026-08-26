import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Download, Edit, Plus, Settings as SettingsIcon, Settings, Trash2, Upload, LayoutGrid, LayoutList, Users, Hash, X, Mail, Send, Link as LinkIcon, CheckCircle2, AlertCircle, RefreshCw, LogOut, WifiOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ObjectUploader } from "@/components/object-uploader";
import { MediaPicker } from "@/components/media-picker";
import UserManagement from "@/components/user-management";
import type {
  Product,
  InsertProduct,
  UpdateProduct,
  ProductOption,
  InsertProductOption,
  UpdateProductOption,
  ProductVariant,
  InsertProductVariant,
  UpdateProductVariant,
  GlobalVariable,
  InsertGlobalVariable,
  UpdateGlobalVariable,
  MediaAsset,
  FormulaTemplate,
  InsertFormulaTemplate,
  UpdateFormulaTemplate,
} from "@shared/schema";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  insertProductSchema,
  insertProductOptionSchema,
  insertProductVariantSchema,
  insertGlobalVariableSchema,
  insertFormulaTemplateSchema,
} from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { JobStatusSettings } from "@/components/job-status-settings";
import { useProductTypes } from "@/hooks/useProductTypes";

function SelectChoicesInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [newChoice, setNewChoice] = useState("");
  const choices = value?.split(",").map(s => s.trim()).filter(Boolean) || [];
  
  const addChoice = () => {
    const trimmed = newChoice.trim();
    if (trimmed && !choices.includes(trimmed)) {
      onChange([...choices, trimmed].join(","));
      setNewChoice("");
    }
  };
  
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Add a choice (e.g., Matte, Gloss)"
          value={newChoice}
          onChange={(e) => setNewChoice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addChoice();
            }
          }}
          data-testid="input-add-select-choice"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addChoice}
          data-testid="button-add-select-choice"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="gap-1"
            data-testid={`badge-choice-${index}`}
          >
            {choice}
            <button
              type="button"
              onClick={() => {
                const newChoices = choices.filter((_, i) => i !== index);
                onChange(newChoices.join(","));
              }}
              className="ml-1 hover:text-destructive"
              data-testid={`button-remove-choice-${index}`}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function MediaLibraryTab() {
  const { toast } = useToast();

  const { data: mediaAssets, isLoading } = useQuery<MediaAsset[]>({
    queryKey: ["/api/media"],
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/media/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Asset deleted",
        description: "Media asset has been removed from the library",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete asset",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveAssetMutation = useMutation({
    mutationFn: async (data: { filename: string; url: string; fileSize: number; mimeType: string }) => {
      return apiRequest("POST", "/api/media", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Image saved to library",
        description: "Your image is now available in the media library",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save image",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUploadChange = async (urls: string[]) => {
    const existingUrls = mediaAssets?.map(a => a.url) || [];
    const newUrls = urls.filter(url => !existingUrls.includes(url));
    
    console.log('handleUploadChange called', { allUrls: urls, existingUrls, newUrls });
    
    for (const url of newUrls) {
      const filename = url.split('/').pop() || 'unknown.jpg';
      const extension = filename.split('.').pop()?.toLowerCase() || 'jpg';
      
      const mimeTypes: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
      };
      
      const mimeType = mimeTypes[extension] || 'image/jpeg';
      
      console.log('Attempting to save asset:', { filename, url, mimeType });
      
      try {
        const result = await saveAssetMutation.mutateAsync({
          filename,
          url,
          fileSize: 0,
          mimeType,
        });
        console.log('Asset saved successfully:', result);
      } catch (error: any) {
        console.error('Failed to save asset - full error:', error);
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        toast({
          title: "Upload failed",
          description: `Failed to save ${filename}: ${errorMessage}`,
          variant: "destructive",
        });
      }
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: string | Date) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Store Item Image Cache</CardTitle>
          <CardDescription>
            Upload store item images so product thumbnails are available before customers browse the store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ObjectUploader
            value={mediaAssets?.map(a => a.url) || []}
            onChange={handleUploadChange}
            maxFiles={10}
            allowedFileTypes={["image/*"]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cached Store Images</CardTitle>
          <CardDescription>
            {mediaAssets?.length || 0} images cached for product thumbnails
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : mediaAssets && mediaAssets.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="media-library-grid">
              {mediaAssets.map((asset) => (
                <Card key={asset.id} className="overflow-hidden" data-testid={`media-asset-${asset.id}`}>
                  <div className="aspect-square relative bg-muted">
                    <img
                      src={asset.url}
                      alt={asset.filename}
                      className="w-full h-full object-cover"
                      data-testid={`media-image-${asset.id}`}
                    />
                  </div>
                  <CardContent className="p-3 space-y-2">
                    <div className="text-sm font-medium truncate" title={asset.filename}>
                      {asset.filename}
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{formatFileSize(asset.fileSize)}</span>
                      <span>{formatDate(asset.uploadedAt)}</span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full"
                          data-testid={`button-delete-asset-${asset.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Media Asset</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{asset.filename}"? This action cannot be undone.
                            Products using this image will no longer display it.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteAssetMutation.mutate(asset.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No cached store images yet. Upload your first product image to get started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gmail Connection Card — platform-managed OAuth flow
// ---------------------------------------------------------------------------

interface GmailConnectionData {
  status: 'not_connected' | 'connected' | 'disconnected' | 'token_exchange_failed' | 'revoked_or_invalid';
  connected: boolean;
  connectedEmail: string | null;
  fromName: string | null;
  settingsId: string | null;
  connectedAt: string | null;
  platformConfigured: boolean;
}

function StatusBadge({ status }: { status: GmailConnectionData['status'] }) {
  if (status === 'connected') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Connected
      </Badge>
    );
  }
  if (status === 'disconnected') {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <WifiOff className="w-3 h-3" />
        Disconnected
      </Badge>
    );
  }
  if (status === 'token_exchange_failed' || status === 'revoked_or_invalid') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="w-3 h-3" />
        Needs Reconnect
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <WifiOff className="w-3 h-3" />
      Not Connected
    </Badge>
  );
}

function GmailConnectionCard() {
  const { toast } = useToast();
  const [testEmail, setTestEmail] = useState("");
  const [editingFromName, setEditingFromName] = useState(false);
  const [fromNameValue, setFromNameValue] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  // Read ?connected=true or ?error=* from the URL after OAuth redirect.
  // Runs once on mount only — the toast reference changing between renders
  // must not re-trigger this, and the URL params are cleared immediately.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');

    if (connected === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      toastRef.current({ title: "Gmail connected", description: "Your Gmail account has been connected successfully." });
    } else if (error) {
      const messages: Record<string, string> = {
        cancelled: "Authorization was cancelled.",
        invalid_state: "Security check failed. Please try again.",
        no_refresh_token: "Google did not return a refresh token. Please try connecting again.",
        token_exchange_failed: "Failed to exchange the authorization code. Please try again.",
        profile_lookup_failed: "Could not retrieve your Gmail address from Google. Please try again.",
        storage_failed: "Failed to save the connection. Please try again.",
        platform_not_configured: "Gmail OAuth is not configured on this platform. Contact your administrator.",
        missing_code: "Authorization code missing. Please try again.",
      };
      window.history.replaceState({}, '', window.location.pathname);
      toastRef.current({
        title: "Gmail connection failed",
        description: messages[error] || `Unexpected error: ${error}`,
        variant: "destructive",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch current connection status
  const { data: connection, isLoading } = useQuery<GmailConnectionData>({
    queryKey: ["/api/email/connection"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/email/connection");
      return res.json();
    },
  });

  // Sync fromName into local edit state
  useEffect(() => {
    if (connection?.fromName && !editingFromName) {
      setFromNameValue(connection.fromName);
    }
  }, [connection?.fromName, editingFromName]);

  // Connect Gmail — gets OAuth URL and redirects the user
  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await apiRequest("GET", "/api/email/google/start");
      const { url } = await res.json();
      window.location.href = url;
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to start Gmail connection",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  // Disconnect Gmail
  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/email/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/connection"] });
      toast({ title: "Disconnected", description: "Gmail account has been disconnected." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to disconnect", variant: "destructive" });
    },
  });

  // Save From Name
  const saveFromNameMutation = useMutation({
    mutationFn: (name: string) => apiRequest("PATCH", "/api/email/from-name", { fromName: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/connection"] });
      toast({ title: "Saved", description: "Display name updated." });
      setEditingFromName(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to save", variant: "destructive" });
    },
  });

  // Send test email
  const testMutation = useMutation({
    mutationFn: (recipient: string) => apiRequest("POST", "/api/email/test", { recipientEmail: recipient }),
    onSuccess: () => {
      toast({ title: "Test sent", description: "Check your inbox for the test email." });
      setTestEmail("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to send test email", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Configuration</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const isConnected = connection?.connected ?? false;
  const needsReconnect = connection?.status === 'token_exchange_failed' || connection?.status === 'revoked_or_invalid';
  const platformConfigured = connection?.platformConfigured ?? false;

  return (
    <div className="space-y-4">
      {/* Main connection card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Gmail Connection
              </CardTitle>
              <CardDescription className="mt-1">
                Connect the Gmail account Printers Hero should use for quotes, proofs, invoices, and customer notifications.
              </CardDescription>
            </div>
            {connection && <StatusBadge status={connection.status} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!platformConfigured && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-amber-800">
                <strong>Platform not configured.</strong> GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are not set. Contact your administrator to enable the Gmail OAuth flow.
              </p>
            </div>
          )}

          {needsReconnect && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-red-800">
                <strong>Connection issue.</strong> The Gmail connection is no longer valid. Reconnect to restore email sending.
              </p>
            </div>
          )}

          {/* Show account info when connected, disconnected, or revoked — so the user always
               knows which Gmail address is (or was) in use and what action is needed. */}
          {connection?.connectedEmail && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {isConnected ? 'Connected Account' : 'Previously Connected Account'}
                </span>
                <span className="font-medium">{connection.connectedEmail}</span>
                {connection.connectedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Connected {new Date(connection.connectedAt).toLocaleDateString()}
                  </span>
                ) : connection.status === 'disconnected' ? (
                  <span className="text-xs text-muted-foreground">Disconnected</span>
                ) : null}
              </div>

              {/* Editable From Name — edit only available when connected */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Display Name</span>
                {isConnected && editingFromName ? (
                  <div className="flex gap-2">
                    <Input
                      value={fromNameValue}
                      onChange={(e) => setFromNameValue(e.target.value)}
                      placeholder="e.g. Titan Graphics"
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={saveFromNameMutation.isPending || !fromNameValue.trim()}
                      onClick={() => saveFromNameMutation.mutate(fromNameValue)}
                    >
                      {saveFromNameMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingFromName(false); setFromNameValue(connection.fromName || ""); }}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{connection.fromName || <span className="text-muted-foreground italic">Not set</span>}</span>
                    {isConnected && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingFromName(true)}>
                        <Edit className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                    )}
                  </div>
                )}
                <span className="text-xs text-muted-foreground">The name shown in the "From" field of sent emails.</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {!isConnected && !needsReconnect && (
              <Button onClick={handleConnect} disabled={isConnecting || !platformConfigured}>
                {isConnecting ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Connecting…</>
                ) : (
                  <><Mail className="w-4 h-4 mr-2" />Connect Gmail</>
                )}
              </Button>
            )}

            {(isConnected || needsReconnect) && (
              <Button variant="outline" onClick={handleConnect} disabled={isConnecting || !platformConfigured}>
                {isConnecting ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Connecting…</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-2" />Reconnect Gmail</>
                )}
              </Button>
            )}

            {isConnected && (
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <LogOut className="w-4 h-4 mr-2" />
                {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Test email — only shown when connected */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="w-4 h-4" />
              Send Test Email
            </CardTitle>
            <CardDescription>Verify that the connected Gmail account is working correctly.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                disabled={testMutation.isPending}
              />
              <Button
                onClick={() => testMutation.mutate(testEmail)}
                disabled={testMutation.isPending || !testEmail}
              >
                {testMutation.isPending ? "Sending…" : "Send Test"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Email Settings Tab Component (exported for use in settings page)
export function EmailSettingsTab() {
  return <GmailConnectionCard />;
}

// ---------------------------------------------------------------------------
// Invoice Reminders Tab
// ---------------------------------------------------------------------------

const reminderSettingsFormSchema = z.object({
  enabled: z.boolean().default(false),
  firstReminderDaysAfterDue: z.coerce.number().int().min(1).nullable().optional(),
  repeatIntervalDays: z.coerce.number().int().min(1).nullable().optional(),
  maxReminders: z.coerce.number().int().min(1).nullable().optional(),
  sendCopyToInternalEmail: z.boolean().default(false),
  internalCopyEmail: z.string().email().nullable().optional().or(z.literal("")),
  pauseForManualBillingCustomers: z.boolean().default(false),
});

type ReminderSettingsFormValues = z.infer<typeof reminderSettingsFormSchema>;

type ReminderEligibilityStatus =
  | "eligible"
  | "settings_disabled"
  | "not_billed"
  | "not_overdue"
  | "no_due_date"
  | "paid"
  | "void"
  | "max_reminders_reached"
  | "too_soon";

interface InvoiceReminderEligibility {
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  dueDate: string | null;
  daysOverdue: number | null;
  balanceDueCents: number;
  remindersSentCount: number;
  lastReminderSentAt: string | null;
  nextReminderDueAt: string | null;
  status: ReminderEligibilityStatus;
}

interface ReminderPreviewData {
  settings: ReminderSettingsFormValues | null;
  eligible: InvoiceReminderEligibility[];
  blocked: InvoiceReminderEligibility[];
}

function eligibilityStatusLabel(status: ReminderEligibilityStatus): string {
  switch (status) {
    case "eligible": return "Ready to send";
    case "settings_disabled": return "Reminders disabled";
    case "not_billed": return "Not yet billed";
    case "not_overdue": return "Not overdue";
    case "no_due_date": return "No due date";
    case "paid": return "Paid";
    case "void": return "Voided";
    case "max_reminders_reached": return "Max reminders reached";
    case "too_soon": return "Too soon to re-send";
  }
}

function ReminderPreviewPanel() {
  const { data: previewResp, isLoading, refetch } = useQuery<{ success: boolean; data: ReminderPreviewData }>({
    queryKey: ["/api/invoices/reminder-preview"],
    queryFn: () => apiRequest("GET", "/api/invoices/reminder-preview").then((r) => r.json()),
  });

  const preview = previewResp?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Eligibility Preview</h3>
          <p className="text-xs text-muted-foreground">
            Read-only. Shows which open invoices would receive a reminder right now.
            No emails are sent from this panel.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {!isLoading && preview && (
        <>
          {preview.eligible.length === 0 && preview.blocked.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No open overdue invoices found.
            </p>
          )}

          {preview.eligible.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-2">
                Would receive a reminder ({preview.eligible.length})
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead>Reminders Sent</TableHead>
                    <TableHead>Next Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.eligible.map((inv) => (
                    <TableRow key={inv.invoiceId}>
                      <TableCell>#{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell>{inv.daysOverdue ?? "—"}</TableCell>
                      <TableCell>{inv.remindersSentCount}</TableCell>
                      <TableCell>
                        {inv.nextReminderDueAt
                          ? new Date(inv.nextReminderDueAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {preview.blocked.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Skipped ({preview.blocked.length})
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.blocked.map((inv) => (
                    <TableRow key={inv.invoiceId} className="opacity-60">
                      <TableCell>#{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell>{inv.daysOverdue ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {eligibilityStatusLabel(inv.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function InvoiceRemindersTab() {
  const { toast } = useToast();

  const { data: settingsResp, isLoading } = useQuery<{ success: boolean; data: ReminderSettingsFormValues | null }>({
    queryKey: ["/api/invoices/reminder-settings"],
    queryFn: () => apiRequest("GET", "/api/invoices/reminder-settings").then((r) => r.json()),
  });

  const form = useForm<ReminderSettingsFormValues>({
    resolver: zodResolver(reminderSettingsFormSchema),
    defaultValues: {
      enabled: false,
      firstReminderDaysAfterDue: null,
      repeatIntervalDays: null,
      maxReminders: null,
      sendCopyToInternalEmail: false,
      internalCopyEmail: null,
      pauseForManualBillingCustomers: false,
    },
  });

  // Populate form once data loads
  const { reset } = form;
  const loadedSettings = settingsResp?.data;
  useState(() => {
    if (loadedSettings) reset(loadedSettings);
  });

  // Reset form when data is fetched
  const [initialized, setInitialized] = useState(false);
  if (!initialized && loadedSettings !== undefined) {
    if (loadedSettings) reset(loadedSettings);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: (values: ReminderSettingsFormValues) =>
      apiRequest("PUT", "/api/invoices/reminder-settings", values).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/invoices/reminder-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/invoices/reminder-preview"] });
        toast({ title: "Reminder settings saved" });
      } else {
        toast({ title: "Failed to save", description: data.error, variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Failed to save reminder settings", variant: "destructive" });
    },
  });

  const enabled = form.watch("enabled");
  const sendCopy = form.watch("sendCopyToInternalEmail");

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Invoice Reminder Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure automatic payment reminders for overdue invoices.{" "}
          <span className="font-medium text-amber-600">
            Automatic sending is not active yet — these settings will be used when the reminder
            job is enabled.
          </span>
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-6">
          {/* Enable toggle */}
          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <FormLabel className="text-base">Enable Reminders</FormLabel>
                  <FormDescription>
                    When enabled, qualifying overdue invoices will receive automated reminders.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          {/* Timing fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="firstReminderDaysAfterDue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Reminder (days after due)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 3"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : Number(e.target.value))
                      }
                      disabled={!enabled}
                    />
                  </FormControl>
                  <FormDescription>Days after due date to send the first reminder.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="repeatIntervalDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repeat Interval (days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 7"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : Number(e.target.value))
                      }
                      disabled={!enabled}
                    />
                  </FormControl>
                  <FormDescription>
                    How many days between follow-up reminders. Leave blank for no repeats.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxReminders"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Reminders</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 5"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? null : Number(e.target.value))
                      }
                      disabled={!enabled}
                    />
                  </FormControl>
                  <FormDescription>
                    Maximum reminders per invoice. Leave blank for unlimited.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Internal copy */}
          <div className="space-y-3 rounded-lg border p-4">
            <FormField
              control={form.control}
              name="sendCopyToInternalEmail"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!enabled}
                    />
                  </FormControl>
                  <div>
                    <FormLabel>Send copy to internal email</FormLabel>
                    <FormDescription>
                      CC an internal address on every reminder sent.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {sendCopy && (
              <FormField
                control={form.control}
                name="internalCopyEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Internal copy email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="billing@yourshop.com"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? null : e.target.value)
                        }
                        disabled={!enabled}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          {/* Pause for manual billing */}
          <FormField
            control={form.control}
            name="pauseForManualBillingCustomers"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <FormLabel>Pause for manual-billing customers</FormLabel>
                  <FormDescription>
                    Skip reminders for customers flagged as manual billing.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!enabled}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save Reminder Settings"}
          </Button>
        </form>
      </Form>

      <hr />

      <ReminderPreviewPanel />
    </div>
  );
}

// Helper: validate URL is a proper http(s) string
const isValidHttpUrl = (v: unknown): v is string =>
  typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"));

export default function AdminSettings() {
  const { toast } = useToast();
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<ProductOption | null>(null);
  const [isAddOptionDialogOpen, setIsAddOptionDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [isAddVariantDialogOpen, setIsAddVariantDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<GlobalVariable | null>(null);
  const [isAddVariableDialogOpen, setIsAddVariableDialogOpen] = useState(false);
  const [editingFormulaTemplate, setEditingFormulaTemplate] = useState<FormulaTemplate | null>(null);
  const [isAddFormulaTemplateDialogOpen, setIsAddFormulaTemplateDialogOpen] = useState(false);
  const [viewingTemplateProducts, setViewingTemplateProducts] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [templateSearchTerm, setTemplateSearchTerm] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [productStatusFilter, setProductStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<"add" | "edit">("add");
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productTypes } = useProductTypes();

  const invalidateProductQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products?activeOnly=true"] });
  };

  const addProductForm = useForm<InsertProduct>({
    resolver: zodResolver(insertProductSchema),
    defaultValues: {
      name: "",
      description: "",
      aiParsingDescription: null,
      aiParsingDescriptionLinkedToDescription: false,
      category: "",
      pricingFormula: "sqft * p * q",
      storeUrl: "",
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: {
        enabled: false,
        type: "quantity",
        tiers: [],
      },
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet",
      minPricePerItem: null,
      nestingVolumePricing: {
        enabled: false,
        tiers: [],
      },
      isActive: true,
    },
  });

  const editProductForm = useForm<UpdateProduct>({
    resolver: zodResolver(insertProductSchema.partial()),
  });

  const optionForm = useForm<Omit<InsertProductOption, "productId">>({
    resolver: zodResolver(insertProductOptionSchema.omit({ productId: true })),
    defaultValues: {
      name: "",
      description: "",
      type: "toggle",
      defaultValue: "false",
      defaultSelection: "",
      isDefaultEnabled: false,
      setupCost: 0,
      priceFormula: "0",
      parentOptionId: null,
      displayOrder: 0,
      isActive: true,
    },
  });

  const variantForm = useForm<Omit<InsertProductVariant, "productId">>({
    resolver: zodResolver(insertProductVariantSchema.omit({ productId: true })),
    defaultValues: {
      name: "",
      description: "",
      basePricePerSqft: 0,
      volumePricing: { enabled: false, tiers: [] },
      isDefault: false,
      displayOrder: 0,
      isActive: true,
    },
  });

  const editVariantForm = useForm<Omit<InsertProductVariant, "productId">>({
    resolver: zodResolver(insertProductVariantSchema.omit({ productId: true })),
  });

  const variableForm = useForm<InsertGlobalVariable>({
    resolver: zodResolver(insertGlobalVariableSchema),
    defaultValues: {
      name: "",
      value: "",
      description: "",
      category: "",
      isActive: true,
    },
  });

  const editVariableForm = useForm<InsertGlobalVariable>({
    resolver: zodResolver(insertGlobalVariableSchema),
  });

  const formulaTemplateForm = useForm<InsertFormulaTemplate>({
    resolver: zodResolver(insertFormulaTemplateSchema),
    defaultValues: {
      name: "",
      description: "",
      formula: "sqft * p * q",
      category: "",
      isActive: true,
    },
  });

  const editFormulaTemplateForm = useForm<InsertFormulaTemplate>({
    resolver: zodResolver(insertFormulaTemplateSchema),
  });

  const { data: formulaTemplates, isLoading: formulaTemplatesLoading } = useQuery<FormulaTemplate[]>({
    queryKey: ["/api/formula-templates"],
    queryFn: async () => {
      console.log("[DEBUG] Fetching formula templates...");
      const response = await fetch("/api/formula-templates", { credentials: "include" });
      console.log("[DEBUG] Response status:", response.status, response.statusText);
      const data = await response.json();
      console.log("[DEBUG] Response data:", data);
      return data;
    },
  });

  // Debug logging
  console.log("[DEBUG] Formula Templates:", {
    loading: formulaTemplatesLoading,
    data: formulaTemplates,
    count: formulaTemplates?.length || 0
  });

  const { data: templateProducts } = useQuery<Product[]>({
    queryKey: [`/api/formula-templates/${viewingTemplateProducts}/products`],
    enabled: !!viewingTemplateProducts,
  });

  const addProductMutation = useMutation({
    mutationFn: async (data: InsertProduct) => {
      return await apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      toast({
        title: "Product Added",
        description: "The product has been added successfully.",
      });
      invalidateProductQueries();
      setIsAddDialogOpen(false);
      addProductForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProduct }) => {
      return await apiRequest("PATCH", `/api/products/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Product Updated",
        description: "The product has been updated successfully.",
      });
      invalidateProductQueries();
      setEditingProduct(null);
      editProductForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Product Deleted",
        description: "The product has been deleted successfully.",
      });
      invalidateProductQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cloneProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/products/${id}/clone`);
    },
    onSuccess: () => {
      toast({
        title: "Product Cloned",
        description: "The product has been cloned successfully. You can now edit the name and pricing.",
      });
      invalidateProductQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importProductsMutation = useMutation({
    mutationFn: async (csvData: string) => {
      return await apiRequest("POST", "/api/products/import", { csvData });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Products Imported",
        description: `Successfully imported ${data.imported.products} products, ${data.imported.variants} variants, and ${data.imported.options} options.`,
      });
      invalidateProductQueries();
      setCsvFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCsvUpload = async () => {
    if (!csvFile) {
      toast({
        title: "No File Selected",
        description: "Please select a CSV file to upload.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvData = e.target?.result as string;
      importProductsMutation.mutate(csvData);
    };
    reader.readAsText(csvFile);
  };

  const handleExportProducts = async () => {
    try {
      const response = await fetch('/api/products/export', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to export products');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `products-export-${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export Successful",
        description: "Products exported to CSV successfully.",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export products to CSV.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/products/csv-template', {
        credentials: 'include',
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'product-import-template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download the CSV template.",
        variant: "destructive",
      });
    }
  };

  const { data: productOptions } = useQuery<ProductOption[]>({
    queryKey: ["/api/products", editingProduct?.id, "options"],
    enabled: !!editingProduct?.id,
  });

  const addOptionMutation = useMutation({
    mutationFn: async (data: Omit<InsertProductOption, "productId">) => {
      if (!editingProduct) throw new Error("No product selected");
      return await apiRequest("POST", `/api/products/${editingProduct.id}/options`, data);
    },
    onSuccess: () => {
      toast({
        title: "Option Added",
        description: "The product option has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
      setIsAddOptionDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateOptionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Omit<InsertProductOption, "productId"> }) => {
      if (!editingProduct) throw new Error("No product selected");
      const updateData: UpdateProductOption = { ...data, id, productId: editingProduct.id };
      return await apiRequest("PATCH", `/api/products/${editingProduct.id}/options/${id}`, updateData);
    },
    onSuccess: () => {
      toast({
        title: "Option Updated",
        description: "The product option has been updated successfully.",
      });
      // DON'T invalidate query - keeps product dialog open
      // User can close/reopen dialog to see changes
      setEditingOption(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteOptionMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!editingProduct) throw new Error("No product selected");
      return await apiRequest("DELETE", `/api/products/${editingProduct.id}/options/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Option Deleted",
        description: "The product option has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch all variants for all products
  const { data: allVariants, isLoading: variantsLoading } = useQuery<{ productId: string; productName: string; variants: ProductVariant[] }[]>({
    queryKey: ["/api/all-variants"],
    queryFn: async () => {
      if (!products) return [];
      const variantsData = await Promise.all(
        products.map(async (product) => {
          try {
            const response = await fetch(`/api/products/${product.id}/variants`);
            if (!response.ok) {
              console.error(`Failed to fetch variants for product ${product.id}:`, response.status);
              return {
                productId: product.id,
                productName: product.name,
                variants: [],
              };
            }
            const variants = await response.json();
            // Ensure variants is an array
            return {
              productId: product.id,
              productName: product.name,
              variants: Array.isArray(variants) ? variants : [],
            };
          } catch (error) {
            console.error(`Error fetching variants for product ${product.id}:`, error);
            return {
              productId: product.id,
              productName: product.name,
              variants: [],
            };
          }
        })
      );
      return variantsData;
    },
    enabled: !!products,
  });

  const addVariantMutation = useMutation({
    mutationFn: async ({ productId, data }: { productId: string; data: Omit<InsertProductVariant, "productId"> }) => {
      return await apiRequest("POST", `/api/products/${productId}/variants`, data);
    },
    onSuccess: async () => {
      toast({
        title: "Variant Added",
        description: "The product variant has been added successfully.",
      });
      // Invalidate and wait for refetch to complete
      await queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });
      // Close the add variant dialog
      setIsAddVariantDialogOpen(false);
      // Reset form
      variantForm.reset({
        name: "",
        description: "",
        basePricePerSqft: 0,
        isDefault: false,
        displayOrder: 0,
        isActive: true,
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

  const updateVariantMutation = useMutation({
    mutationFn: async ({ productId, id, data }: { productId: string; id: string; data: Omit<InsertProductVariant, "productId"> }) => {
      return await apiRequest("PATCH", `/api/products/${productId}/variants/${id}`, data);
    },
    onSuccess: async (updatedVariant, variables) => {
      toast({
        title: "Variant Updated",
        description: "The product variant has been updated successfully.",
      });

      // Invalidate to show updated variant immediately
      await queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });

      // Close the variant edit dialog
      setEditingVariant(null);
      editVariantForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVariantMutation = useMutation({
    mutationFn: async ({ productId, id }: { productId: string; id: string }) => {
      return await apiRequest("DELETE", `/api/products/${productId}/variants/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Variant Deleted",
        description: "The product variant has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: globalVariables, isLoading: variablesLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const addVariableMutation = useMutation({
    mutationFn: async (data: InsertGlobalVariable) => {
      return await apiRequest("POST", "/api/global-variables", data);
    },
    onSuccess: () => {
      toast({
        title: "Variable Added",
        description: "The global variable has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsAddVariableDialogOpen(false);
      variableForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateVariableMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertGlobalVariable }) => {
      return await apiRequest("PATCH", `/api/global-variables/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Variable Updated",
        description: "The global variable has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setEditingVariable(null);
      editVariableForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVariableMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/global-variables/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Variable Deleted",
        description: "The global variable has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleProductActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest("PATCH", `/api/products/${id}`, { isActive });
    },
    onSuccess: (_data, variables) => {
      toast({
        title: variables.isActive ? "Product Activated" : "Product Deactivated",
        description: variables.isActive
          ? "The product is now available for new quote and order selection."
          : "The product is now hidden from new quote and order selection.",
      });
      invalidateProductQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    // Reset dialog states when opening a product
    setIsAddVariantDialogOpen(false);
    setIsAddOptionDialogOpen(false);
    editProductForm.reset({
      name: product.name,
      description: product.description,
      aiParsingDescription: product.aiParsingDescription ?? null,
      aiParsingDescriptionLinkedToDescription: product.aiParsingDescriptionLinkedToDescription ?? false,
      category: product.category || "",
      pricingFormula: product.pricingFormula,
      storeUrl: product.storeUrl || "",
      showStoreLink: product.showStoreLink,
      useNestingCalculator: product.useNestingCalculator || false,
      sheetWidth: product.sheetWidth ? parseFloat(product.sheetWidth as any) : null,
      sheetHeight: product.sheetHeight ? parseFloat(product.sheetHeight as any) : null,
      materialType: product.materialType || "sheet",
      minPricePerItem: product.minPricePerItem ? parseFloat(product.minPricePerItem as any) : null,
      nestingVolumePricing: product.nestingVolumePricing || { enabled: false, tiers: [] },
      isActive: product.isActive,
    });
  };

  const handleEditVariant = (variant: ProductVariant, productId: string) => {
    setEditingVariant({ ...variant, productId } as any);
    editVariantForm.reset({
      name: variant.name,
      description: variant.description || "",
      basePricePerSqft: Number(variant.basePricePerSqft),
      volumePricing: variant.volumePricing || { enabled: false, tiers: [] },
      isDefault: variant.isDefault,
      displayOrder: variant.displayOrder,
      isActive: variant.isActive,
    });
  };

  const handleCloneVariant = (variant: ProductVariant, productId: string) => {
    // Get the highest display order from existing variants
    const existingVariants = allVariants?.find(pv => pv.productId === productId)?.variants || [];
    const maxDisplayOrder = existingVariants.length > 0
      ? Math.max(...existingVariants.map(v => v.displayOrder))
      : 0;

    // Pre-fill the add variant form with cloned data
    variantForm.reset({
      name: `${variant.name} (Copy)`,
      description: variant.description || "",
      basePricePerSqft: Number(variant.basePricePerSqft),
      volumePricing: variant.volumePricing || { enabled: false, tiers: [] },
      isDefault: false, // Don't clone the default status
      displayOrder: maxDisplayOrder + 1,
      isActive: variant.isActive,
    });

    // Open the add variant dialog
    setIsAddVariantDialogOpen(true);
  };

  const handleEditVariable = (variable: GlobalVariable) => {
    setEditingVariable(variable);
    editVariableForm.reset({
      name: variable.name,
      value: variable.value,
      description: variable.description || "",
      category: variable.category || "",
      isActive: variable.isActive,
    });
  };

  const handleEditFormulaTemplate = (template: FormulaTemplate) => {
    setEditingFormulaTemplate(template);
    editFormulaTemplateForm.reset({
      name: template.name,
      description: template.description || "",
      formula: template.formula,
      category: template.category || "",
      isActive: template.isActive,
    });
  };

  const addFormulaTemplateMutation = useMutation({
    mutationFn: async (data: InsertFormulaTemplate) => {
      console.log("[DEBUG] Creating formula template:", data);
      const result = await apiRequest("POST", "/api/formula-templates", data);
      console.log("[DEBUG] Formula template created:", result);
      return result;
    },
    onSuccess: (data) => {
      console.log("[DEBUG] onSuccess called with:", data);
      toast({
        title: "Formula Template Added",
        description: "The formula template has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/formula-templates"] });
      setIsAddFormulaTemplateDialogOpen(false);
      formulaTemplateForm.reset();
    },
    onError: (error: Error) => {
      console.error("[DEBUG] Error creating formula template:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateFormulaTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertFormulaTemplate }) => {
      return await apiRequest("PATCH", `/api/formula-templates/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Formula Template Updated",
        description: "The formula template has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/formula-templates"] });
      setEditingFormulaTemplate(null);
      editFormulaTemplateForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteFormulaTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/formula-templates/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Formula Template Deleted",
        description: "The formula template has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/formula-templates"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredVariables = globalVariables
    ?.filter((variable) => !['next_quote_number', 'next_order_number', 'next_invoice_number', 'next_job_number'].includes(variable.name))
    ?.filter((variable) =>
      variable.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variable.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variable.category?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const filteredProducts = products?.filter((product) => {
    if (productStatusFilter === "active") return product.isActive;
    if (productStatusFilter === "inactive") return !product.isActive;
    return true;
  });

  const renderProductStatusBadge = (product: Product) => (
    <Badge
      variant={product.isActive ? "default" : "secondary"}
      className={product.isActive ? "bg-green-600 hover:bg-green-600 text-white" : "text-muted-foreground"}
    >
      {product.isActive ? "Active" : "Inactive"}
    </Badge>
  );

  if (productsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Show user management if requested
  if (showUserManagement) {
    return (
      <div className="space-y-6">
        <UserManagement onClose={() => setShowUserManagement(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Access Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <Button
              onClick={() => setShowUserManagement(true)}
              className="w-full"
              variant="outline"
            >
              <Users className="w-4 h-4 mr-2" />
              Manage Users
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Integrations Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            Integrations
          </CardTitle>
          <CardDescription>
            Connect external services like QuickBooks Online
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/integrations">
            <Button variant="outline" className="w-full">
              <LinkIcon className="w-4 h-4 mr-2" />
              Manage Integrations
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card data-testid="card-admin-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Admin Configuration
          </CardTitle>
          <CardDescription>
            Manage products, pricing formulas, and system settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="products" data-testid="tabs-admin-settings">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
              <TabsTrigger value="media" data-testid="tab-media">Media Library</TabsTrigger>
              <TabsTrigger value="variables" data-testid="tab-variables">Pricing Variables</TabsTrigger>
              <TabsTrigger value="formulas" data-testid="tab-formulas">Formula Templates</TabsTrigger>
              <TabsTrigger value="email" data-testid="tab-email">Email Settings</TabsTrigger>
              <TabsTrigger value="workflow" data-testid="tab-workflow">Workflow</TabsTrigger>
              <TabsTrigger value="invoice-reminders" data-testid="tab-invoice-reminders">Invoice Reminders</TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Product Types</CardTitle>
                  <CardDescription>
                    Manage product categories (Roll, Sheet, Digital Print, etc.)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href="/settings/product-types">
                    <Button variant="outline" className="w-full">
                      <SettingsIcon className="w-4 h-4 mr-2" />
                      Manage Product Types
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Import Products from CSV</CardTitle>
                  <CardDescription>
                    Bulk import products with variants and options using a CSV file
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleDownloadTemplate}
                      data-testid="button-download-csv-template"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Template
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleExportProducts}
                      data-testid="button-export-csv"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export CSV
                    </Button>
                    <div className="flex-1 flex gap-2">
                      <Input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                        data-testid="input-csv-file"
                      />
                      <Button
                        onClick={handleCsvUpload}
                        disabled={!csvFile || importProductsMutation.isPending}
                        data-testid="button-upload-csv"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {importProductsMutation.isPending ? "Importing..." : "Import CSV"}
                      </Button>
                    </div>
                  </div>
                  {csvFile && (
                    <p className="text-sm text-muted-foreground" data-testid="text-selected-file">
                      Selected file: {csvFile.name}
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between items-center gap-4 flex-wrap">
                <h3 className="text-lg font-semibold">Product Management</h3>
                <div className="flex gap-2 flex-wrap justify-end">
                  <div className="flex border rounded-md">
                    <Button
                      variant={productStatusFilter === "all" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setProductStatusFilter("all")}
                      className="rounded-r-none"
                      data-testid="button-filter-products-all"
                    >
                      All
                    </Button>
                    <Button
                      variant={productStatusFilter === "active" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setProductStatusFilter("active")}
                      className="rounded-none border-x"
                      data-testid="button-filter-products-active"
                    >
                      Active
                    </Button>
                    <Button
                      variant={productStatusFilter === "inactive" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setProductStatusFilter("inactive")}
                      className="rounded-l-none"
                      data-testid="button-filter-products-inactive"
                    >
                      Inactive
                    </Button>
                  </div>

                  <div className="flex border rounded-md">
                    <Button
                      variant={viewMode === "table" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("table")}
                      className="rounded-r-none"
                      data-testid="button-view-table"
                    >
                      <LayoutList className="w-4 h-4" />
                    </Button>
                    <Button
                      variant={viewMode === "grid" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("grid")}
                      className="rounded-l-none"
                      data-testid="button-view-grid"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </Button>
                  </div>

                  <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-add-product">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Product
                      </Button>
                    </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-product">
                    <DialogHeader>
                      <DialogTitle>Add New Product</DialogTitle>
                      <DialogDescription>
                        Create a new product with pricing formula
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...addProductForm}>
                      <form onSubmit={addProductForm.handleSubmit((data) => {
                        const cleanData: any = {};
                        Object.entries(data).forEach(([k, v]) => {
                          // Convert empty strings to null, preserve null/undefined to let backend handle defaults
                          cleanData[k] = v === '' ? null : v;
                        });
                        addProductMutation.mutate(cleanData);
                      })} className="space-y-4">
                        <FormField
                          control={addProductForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-name">Product Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Business Cards" {...field} data-testid="input-product-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-description">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Professional business cards with custom designs..."
                                  {...field}
                                  data-testid="textarea-product-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-category">Category (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="flatbed, adhesive backed, paper, misc"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-category"
                                />
                              </FormControl>
                              <FormDescription>
                                Product category for filtering (e.g., flatbed, adhesive backed, paper, misc)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="productTypeId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Product Type</FormLabel>
                              <Select
                                value={field.value || undefined}
                                onValueChange={field.onChange}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select product type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {productTypes?.map((type: any) => (
                                    <SelectItem key={type.id} value={type.id}>
                                      {type.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                Categorize this product (e.g., Roll, Sheet, Digital Print)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="space-y-2">
                          <Label>Formula Template (Optional)</Label>
                          <Select
                            onValueChange={(value) => {
                              if (value) {
                                const template = formulaTemplates?.find(t => t.id === value);
                                if (template) {
                                  addProductForm.setValue("pricingFormula", template.formula);
                                }
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a formula template..." />
                            </SelectTrigger>
                            <SelectContent>
                              {formulaTemplates && formulaTemplates.length > 0 ? (
                                formulaTemplates.map((template) => (
                                  <SelectItem key={template.id} value={template.id}>
                                    <div className="flex flex-col">
                                      <span className="font-medium">{template.name}</span>
                                      {template.description && (
                                        <span className="text-xs text-muted-foreground">{template.description}</span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="none" disabled>No templates available</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Select a template to auto-fill the formula below, or write your own
                          </p>
                        </div>
                        {!addProductForm.watch("useNestingCalculator") && (
                          <FormField
                            control={addProductForm.control}
                            name="pricingFormula"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel data-testid="label-product-formula">Pricing Formula</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="sqft * p * q"
                                    {...field}
                                    value={field.value || ""}
                                    data-testid="input-product-formula"
                                  />
                                </FormControl>
                                <FormDescription>
                                  Use lowercase variables such as w, h, q, sqft, and base_price. Use functions like ceil(...), round(...), and max(...). Example: ceil((((w + 0.25) * (h + 0.25)) * q) / 144) * base_price
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <FormField
                          control={addProductForm.control}
                          name="variantLabel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-variant-label">Variant Label (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Material, Size, Type, etc. (default: Variant)"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-variant-label"
                                />
                              </FormControl>
                              <FormDescription>
                                Customize how variants are labeled (e.g., "Material", "Size", "Type")
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Nesting Calculator Section */}
                        <div className="space-y-4 border-t pt-4">
                          <FormField
                            control={addProductForm.control}
                            name="useNestingCalculator"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">Use Nesting Calculator</FormLabel>
                                  <FormDescription>
                                    Calculate optimal piece nesting on sheets instead of using formulas
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {addProductForm.watch("useNestingCalculator") && (
                            <>
                              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
                                <strong>⚠️ Required:</strong> Enter sheet dimensions below to use the nesting calculator. The pricing formula is not needed when nesting calculator is enabled.
                              </div>
                              <FormField
                                control={addProductForm.control}
                                name="materialType"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Material Type</FormLabel>
                                    <Select
                                      onValueChange={field.onChange}
                                      defaultValue={field.value || undefined}
                                    >
                                      <FormControl>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select material type" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="sheet">Sheet (e.g., foam board, coroplast)</SelectItem>
                                        <SelectItem value="roll">Roll (e.g., vinyl)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormDescription>
                                      Sheet materials use 2D nesting, rolls optimize for width only
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={addProductForm.control}
                                  name="sheetWidth"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>
                                        {addProductForm.watch("materialType") === "roll" ? "Roll Width" : "Sheet Width"} (inches)
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder={addProductForm.watch("materialType") === "roll" ? "Enter roll width" : "Enter sheet width"}
                                          {...field}
                                          value={field.value ?? ""}
                                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={addProductForm.control}
                                  name="sheetHeight"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>
                                        {addProductForm.watch("materialType") === "roll" ? "Roll Length" : "Sheet Height"} (inches)
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder={addProductForm.watch("materialType") === "roll" ? "Enter roll length" : "Enter sheet height"}
                                          {...field}
                                          value={field.value ?? ""}
                                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                        />
                                      </FormControl>
                                      <FormDescription>
                                        {addProductForm.watch("materialType") === "roll"
                                          ? "For 150' roll, enter 1800 inches"
                                          : "Example: 96 for 48×96 sheet"}
                                      </FormDescription>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <FormField
                                control={addProductForm.control}
                                name="minPricePerItem"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Minimum Price Per Item (Optional)</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="10.00"
                                        {...field}
                                        value={field.value ?? ""}
                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                      />
                                    </FormControl>
                                    <FormDescription>
                                      Ensures each piece meets a minimum price threshold
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className="space-y-4 rounded-md border p-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                    <p className="text-sm text-muted-foreground">
                                      Set different prices per sheet based on quantity
                                    </p>
                                  </div>
                                  <FormField
                                    control={addProductForm.control}
                                    name="nestingVolumePricing.enabled"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormControl>
                                          <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                </div>

                                {addProductForm.watch("nestingVolumePricing.enabled") && (
                                  <div className="space-y-3">
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                      {addProductForm.watch("nestingVolumePricing.tiers")?.map((tier: any, index: number) => (
                                        <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                          <div className="flex-1 grid grid-cols-3 gap-2">
                                            <div>
                                              <label className="text-xs text-muted-foreground">Min Sheets</label>
                                              <Input
                                                type="number"
                                                value={tier.minSheets}
                                                onChange={(e) => {
                                                  const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                  tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                  addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                }}
                                                className="h-8"
                                              />
                                            </div>
                                            <div>
                                              <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                              <Input
                                                type="number"
                                                value={tier.maxSheets || ""}
                                                onChange={(e) => {
                                                  const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                  tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                  addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                }}
                                                placeholder="No limit"
                                                className="h-8"
                                              />
                                            </div>
                                            <div>
                                              <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                              <Input
                                                type="number"
                                                step="0.01"
                                                value={tier.pricePerSheet}
                                                onChange={(e) => {
                                                  const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                  tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                  addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                }}
                                                className="h-8"
                                              />
                                            </div>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => {
                                              const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                              tiers.splice(index, 1);
                                              addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                            }}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                        const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                        const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                        tiers.push({ minSheets, pricePerSheet: 0 });
                                        addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                      }}
                                    >
                                      <Plus className="h-4 w-4 mr-1" />
                                      Add Tier
                                    </Button>
                                    <p className="text-xs text-muted-foreground">
                                      Example: 1-4 sheets @ $18, 5-9 sheets @ $16, 10+ sheets @ $14
                                    </p>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>

                        <FormField
                          control={addProductForm.control}
                          name="storeUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-url">Store URL (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="https://example.com/business-cards"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-url"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="showStoreLink"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base" data-testid="label-show-store-link">
                                  Show Store Link
                                </FormLabel>
                                <FormDescription>
                                  Display "View in Store" button in calculator
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-show-store-link"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="thumbnailUrls"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-thumbnails">
                                Product Thumbnails (Optional)
                              </FormLabel>
                              <div className="space-y-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setMediaPickerMode("add");
                                    setIsMediaPickerOpen(true);
                                  }}
                                  data-testid="button-select-from-library"
                                >
                                  <LayoutGrid className="w-4 h-4 mr-2" />
                                  Select from Library
                                </Button>
                                <FormControl>
                                  <ObjectUploader
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    maxFiles={5}
                                    allowedFileTypes={["image/*"]}
                                  />
                                </FormControl>
                              </div>
                              <FormDescription>
                                Upload up to 5 product images or select from your media library. Drag to reorder.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base" data-testid="label-product-active">
                                  Active
                                </FormLabel>
                                <FormDescription>
                                  Product will be available in the calculator
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-product-active"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={addProductMutation.isPending}
                            data-testid="button-submit-add-product"
                          >
                            {addProductMutation.isPending ? "Adding..." : "Add Product"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>

                <MediaPicker
                  value={addProductForm.watch("thumbnailUrls") ?? []}
                  onChange={(urls) => addProductForm.setValue("thumbnailUrls", urls)}
                  open={isMediaPickerOpen && mediaPickerMode === "add"}
                  onOpenChange={setIsMediaPickerOpen}
                />
              </div>
            </div>

            {viewMode === "table" ? (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-name">Name</TableHead>
                      <TableHead data-testid="header-description">Description</TableHead>
                      <TableHead data-testid="header-formula">Formula</TableHead>
                      <TableHead data-testid="header-status">Status</TableHead>
                      <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts && filteredProducts.length > 0 ? (
                      filteredProducts.map((product) => (
                        <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                          <TableCell className="font-medium" data-testid={`cell-name-${product.id}`}>
                            {product.name}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" data-testid={`cell-description-${product.id}`}>
                            {product.description}
                          </TableCell>
                          <TableCell className="font-mono text-sm" data-testid={`cell-formula-${product.id}`}>
                            {product.pricingFormula}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${product.id}`}>
                            {renderProductStatusBadge(product)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  toggleProductActiveMutation.mutate({
                                    id: product.id,
                                    isActive: !product.isActive,
                                  })
                                }
                                disabled={toggleProductActiveMutation.isPending}
                                data-testid={`button-toggle-product-${product.id}`}
                              >
                                {product.isActive ? "Deactivate" : "Activate"}
                              </Button>
                              <Dialog
                                open={editingProduct?.id === product.id}
                                onOpenChange={(open) => {
                                  if (!open) {
                                    setEditingProduct(null);
                                    setIsAddVariantDialogOpen(false);
                                    setIsAddOptionDialogOpen(false);
                                  }
                                }}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEditProduct(product)}
                                    data-testid={`button-edit-${product.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-edit-${product.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Product</DialogTitle>
                                    <DialogDescription>
                                      Update product details and pricing formula
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editProductForm}>
                                    <form
                                      onSubmit={editProductForm.handleSubmit(() => {
                                        // Get all form values, not just dirty fields
                                        const data = editProductForm.getValues();
                                        const cleanData: any = {};
                                        Object.entries(data).forEach(([k, v]) => {
                                          // Convert empty strings to null, preserve null/undefined to let backend handle defaults
                                          cleanData[k] = v === '' ? null : v;
                                        });
                                        updateProductMutation.mutate({ id: product.id, data: cleanData });
                                      })}
                                      className="space-y-4"
                                    >
                                      <FormField
                                        control={editProductForm.control}
                                        name="name"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Product Name</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-name-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="description"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Description</FormLabel>
                                            <FormControl>
                                              <Textarea {...field} data-testid={`textarea-edit-description-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="category"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category (Optional)</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                value={field.value || ""} 
                                                placeholder="flatbed, adhesive backed, paper, misc"
                                                data-testid={`input-edit-category-${product.id}`} 
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Product category for filtering
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="productTypeId"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Product Type</FormLabel>
                                            <Select
                                              value={field.value || undefined}
                                              onValueChange={field.onChange}
                                            >
                                              <FormControl>
                                                <SelectTrigger>
                                                  <SelectValue placeholder="Select product type" />
                                                </SelectTrigger>
                                              </FormControl>
                                              <SelectContent>
                                                {productTypes?.map((type: any) => (
                                                  <SelectItem key={type.id} value={type.id}>
                                                    {type.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                            <FormDescription>
                                              Categorize this product (e.g., Roll, Sheet, Digital Print)
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <div className="space-y-2">
                                        <Label>Formula Template (Optional)</Label>
                                        <Select
                                          onValueChange={(value) => {
                                            if (value) {
                                              const template = formulaTemplates?.find(t => t.id === value);
                                              if (template) {
                                                editProductForm.setValue("pricingFormula", template.formula);
                                              }
                                            }
                                          }}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select a formula template..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {formulaTemplates && formulaTemplates.length > 0 ? (
                                              formulaTemplates.map((template) => (
                                                <SelectItem key={template.id} value={template.id}>
                                                  <div className="flex flex-col">
                                                    <span className="font-medium">{template.name}</span>
                                                    {template.description && (
                                                      <span className="text-xs text-muted-foreground">{template.description}</span>
                                                    )}
                                                  </div>
                                                </SelectItem>
                                              ))
                                            ) : (
                                              <SelectItem value="none" disabled>No templates available</SelectItem>
                                            )}
                                          </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">
                                          Select a template to auto-fill the formula below
                                        </p>
                                      </div>
                                      {!editProductForm.watch("useNestingCalculator") && (
                                        <FormField
                                          control={editProductForm.control}
                                          name="pricingFormula"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Pricing Formula</FormLabel>
                                              <FormControl>
                                                <Input {...field} value={field.value || ""} data-testid={`input-edit-formula-${product.id}`} />
                                              </FormControl>
                                              <FormDescription>
                                                Use lowercase variables such as w, h, q, sqft, and base_price. Use functions like ceil(...), round(...), and max(...).
                                              </FormDescription>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                      )}
                                      <FormField
                                        control={editProductForm.control}
                                        name="variantLabel"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Variant Label (Optional)</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                value={field.value || ""} 
                                                placeholder="Material, Size, Type, etc. (default: Variant)"
                                                data-testid={`input-edit-variant-label-${product.id}`} 
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Customize how variants are labeled
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      {/* Nesting Calculator Section */}
                                      <div className="space-y-4 border-t pt-4">
                                        <FormField
                                          control={editProductForm.control}
                                          name="useNestingCalculator"
                                          render={({ field }) => (
                                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                              <div className="space-y-0.5">
                                                <FormLabel className="text-base">Use Nesting Calculator</FormLabel>
                                                <FormDescription>
                                                  Calculate optimal piece nesting on sheets instead of using formulas
                                                </FormDescription>
                                              </div>
                                              <FormControl>
                                                <Switch
                                                  checked={field.value}
                                                  onCheckedChange={field.onChange}
                                                />
                                              </FormControl>
                                            </FormItem>
                                          )}
                                        />

                                        {editProductForm.watch("useNestingCalculator") && (
                                          <>
                                            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
                                              <strong>⚠️ Required:</strong> Enter sheet dimensions below to use the nesting calculator. The pricing formula is not needed when nesting calculator is enabled.
                                            </div>
                                            <FormField
                                              control={editProductForm.control}
                                              name="materialType"
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel>Material Type</FormLabel>
                                                  <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value || undefined}
                                                  >
                                                    <FormControl>
                                                      <SelectTrigger>
                                                        <SelectValue placeholder="Select material type" />
                                                      </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                      <SelectItem value="sheet">Sheet (e.g., foam board, coroplast)</SelectItem>
                                                      <SelectItem value="roll">Roll (e.g., vinyl)</SelectItem>
                                                    </SelectContent>
                                                  </Select>
                                                  <FormDescription>
                                                    Sheet materials use 2D nesting, rolls optimize for width only
                                                  </FormDescription>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />

                                            <div className="grid grid-cols-2 gap-4">
                                              <FormField
                                                control={editProductForm.control}
                                                name="sheetWidth"
                                                render={({ field }) => (
                                                  <FormItem>
                                                    <FormLabel>
                                                      {editProductForm.watch("materialType") === "roll" ? "Roll Width" : "Sheet Width"} (inches)
                                                    </FormLabel>
                                                    <FormControl>
                                                      <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={editProductForm.watch("materialType") === "roll" ? "Enter roll width" : "Enter sheet width"}
                                                        {...field}
                                                        value={field.value ?? ""}
                                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                                      />
                                                    </FormControl>
                                                    <FormMessage />
                                                  </FormItem>
                                                )}
                                              />

                                              <FormField
                                                control={editProductForm.control}
                                                name="sheetHeight"
                                                render={({ field }) => (
                                                  <FormItem>
                                                    <FormLabel>
                                                      {editProductForm.watch("materialType") === "roll" ? "Roll Length" : "Sheet Height"} (inches)
                                                    </FormLabel>
                                                    <FormControl>
                                                      <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={editProductForm.watch("materialType") === "roll" ? "Enter roll length" : "Enter sheet height"}
                                                        {...field}
                                                        value={field.value ?? ""}
                                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                                      />
                                                    </FormControl>
                                                    <FormDescription>
                                                      {editProductForm.watch("materialType") === "roll"
                                                        ? "For 150' roll, enter 1800 inches"
                                                        : "Example: 96 for 48×96 sheet"}
                                                    </FormDescription>
                                                    <FormMessage />
                                                  </FormItem>
                                                )}
                                              />
                                            </div>

                                            <FormField
                                              control={editProductForm.control}
                                              name="minPricePerItem"
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel>Minimum Price Per Item (Optional)</FormLabel>
                                                  <FormControl>
                                                    <Input
                                                      type="number"
                                                      step="0.01"
                                                      placeholder="10.00"
                                                      {...field}
                                                      value={field.value ?? ""}
                                                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                                    />
                                                  </FormControl>
                                                  <FormDescription>
                                                    Ensures each piece meets a minimum price threshold
                                                  </FormDescription>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />

                                            <div className="space-y-4 rounded-md border p-4">
                                              <div className="flex items-center justify-between">
                                                <div>
                                                  <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                                  <p className="text-sm text-muted-foreground">
                                                    Set different prices per sheet based on quantity
                                                  </p>
                                                </div>
                                                <FormField
                                                  control={editProductForm.control}
                                                  name="nestingVolumePricing.enabled"
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormControl>
                                                        <Switch
                                                          checked={field.value}
                                                          onCheckedChange={field.onChange}
                                                        />
                                                      </FormControl>
                                                    </FormItem>
                                                  )}
                                                />
                                              </div>

                                              {editProductForm.watch("nestingVolumePricing.enabled") && (
                                                <div className="space-y-3">
                                                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                                    {editProductForm.watch("nestingVolumePricing.tiers")?.map((tier: any, index: number) => (
                                                      <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                                        <div className="flex-1 grid grid-cols-3 gap-2">
                                                          <div>
                                                            <label className="text-xs text-muted-foreground">Min Sheets</label>
                                                            <Input
                                                              type="number"
                                                              value={tier.minSheets}
                                                              onChange={(e) => {
                                                                const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                                tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                                editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                              }}
                                                              className="h-8"
                                                            />
                                                          </div>
                                                          <div>
                                                            <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                                            <Input
                                                              type="number"
                                                              value={tier.maxSheets || ""}
                                                              onChange={(e) => {
                                                                const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                                tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                                editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                              }}
                                                              placeholder="No limit"
                                                              className="h-8"
                                                            />
                                                          </div>
                                                          <div>
                                                            <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                                            <Input
                                                              type="number"
                                                              step="0.01"
                                                              value={tier.pricePerSheet}
                                                              onChange={(e) => {
                                                                const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                                tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                                editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                              }}
                                                              className="h-8"
                                                            />
                                                          </div>
                                                        </div>
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="icon"
                                                          className="h-8 w-8"
                                                          onClick={() => {
                                                            const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                            tiers.splice(index, 1);
                                                            editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                          }}
                                                        >
                                                          <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                      </div>
                                                    ))}
                                                  </div>
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                      const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                      const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                                      const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                                      tiers.push({ minSheets, pricePerSheet: 0 });
                                                      editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                    }}
                                                  >
                                                    <Plus className="h-4 w-4 mr-1" />
                                                    Add Tier
                                                  </Button>
                                                  <p className="text-xs text-muted-foreground">
                                                    Example: 1-4 sheets @ $18, 5-9 sheets @ $16, 10+ sheets @ $14
                                                  </p>
                                                </div>
                                              )}
                                            </div>
                                          </>
                                        )}
                                      </div>

                                      <FormField
                                        control={editProductForm.control}
                                        name="storeUrl"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Store URL (Optional)</FormLabel>
                                            <FormControl>
                                              <Input {...field} value={field.value || ""} data-testid={`input-edit-url-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="showStoreLink"
                                        render={({ field }) => (
                                          <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                            <div className="space-y-0.5">
                                              <FormLabel className="text-base">Show Store Link</FormLabel>
                                              <FormDescription>
                                                Display "View in Store" button in calculator
                                              </FormDescription>
                                            </div>
                                            <FormControl>
                                              <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                data-testid={`switch-edit-show-store-link-${product.id}`}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="thumbnailUrls"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel data-testid={`label-edit-thumbnails-${product.id}`}>
                                              Product Thumbnails (Optional)
                                            </FormLabel>
                                            <div className="space-y-2">
                                              <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => {
                                                  setMediaPickerMode("edit");
                                                  setIsMediaPickerOpen(true);
                                                }}
                                                data-testid={`button-select-from-library-edit-${product.id}`}
                                              >
                                                <LayoutGrid className="w-4 h-4 mr-2" />
                                                Select from Library
                                              </Button>
                                              <FormControl>
                                                <ObjectUploader
                                                  value={field.value || []}
                                                  onChange={field.onChange}
                                                  maxFiles={5}
                                                  allowedFileTypes={["image/*"]}
                                                />
                                              </FormControl>
                                            </div>
                                            <FormDescription>
                                              Upload up to 5 product images or select from your media library. Drag to reorder.
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="isActive"
                                        render={({ field }) => (
                                          <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                            <div className="space-y-0.5">
                                              <FormLabel className="text-base">Active</FormLabel>
                                              <FormDescription>
                                                Product will be available in the calculator
                                              </FormDescription>
                                            </div>
                                            <FormControl>
                                              <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                data-testid={`switch-edit-active-${product.id}`}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />

                                      {/* Product Variants Section */}
                                      <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <h3 className="text-lg font-semibold">
                                              {product.variantLabel ?? "Variant"}s
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                              Manage different {(product.variantLabel ?? "variant").toLowerCase()} options for this product
                                            </p>
                                          </div>
                                          <Dialog open={isAddVariantDialogOpen} onOpenChange={setIsAddVariantDialogOpen}>
                                            <DialogTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  variantForm.reset({
                                                    name: "",
                                                    description: "",
                                                    basePricePerSqft: 0,
                                                    isDefault: false,
                                                    displayOrder: 0,
                                                    isActive: true,
                                                  });
                                                }}
                                                data-testid={`button-add-variant-${product.id}`}
                                              >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add {product.variantLabel ?? "Variant"}
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-2xl" data-testid="dialog-add-variant-inline">
                                              <DialogHeader>
                                                <DialogTitle>Add {product.variantLabel ?? "Variant"}</DialogTitle>
                                                <DialogDescription>
                                                  Create a new {(product.variantLabel || "variant").toLowerCase()} option for {product.name}
                                                </DialogDescription>
                                              </DialogHeader>
                                              <Form {...variantForm}>
                                                <form onSubmit={variantForm.handleSubmit((data) => addVariantMutation.mutate({ productId: product.id, data }))} className="space-y-4">
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>{product.variantLabel ?? "Variant"} Name</FormLabel>
                                                        <FormControl>
                                                          <Input placeholder="13oz Vinyl" {...field} data-testid="input-variant-name-inline" />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="description"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Description (Optional)</FormLabel>
                                                        <FormControl>
                                                          <Textarea
                                                            placeholder="Standard vinyl banner material"
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="textarea-variant-description-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="basePricePerSqft"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Base Price per Square Foot</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            type="number"
                                                            step="0.0001"
                                                            {...field}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                            data-testid="input-variant-price-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="isDefault"
                                                    render={({ field }) => (
                                                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                        <div className="space-y-0.5">
                                                          <FormLabel className="text-base">Is Default {product.variantLabel ?? "Variant"}</FormLabel>
                                                          <FormDescription>
                                                            This {(product.variantLabel || "variant").toLowerCase()} will be pre-selected in the calculator
                                                          </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                          <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="checkbox-variant-default-inline"
                                                          />
                                                        </FormControl>
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="displayOrder"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Display Order</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            type="number"
                                                            {...field}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                            data-testid="input-variant-order-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />

                                                  {/* Volume Pricing for Nesting Calculator Products */}
                                                  {product.useNestingCalculator && (
                                                    <div className="space-y-4 rounded-md border p-4">
                                                      <div className="flex items-center justify-between">
                                                        <div>
                                                          <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                                          <p className="text-sm text-muted-foreground">
                                                            Set different prices per sheet based on quantity
                                                          </p>
                                                        </div>
                                                        <FormField
                                                          control={variantForm.control}
                                                          name="volumePricing.enabled"
                                                          render={({ field }) => (
                                                            <FormItem>
                                                              <FormControl>
                                                                <Switch
                                                                  checked={field.value}
                                                                  onCheckedChange={field.onChange}
                                                                />
                                                              </FormControl>
                                                            </FormItem>
                                                          )}
                                                        />
                                                      </div>

                                                      {variantForm.watch("volumePricing.enabled") && (
                                                        <div className="space-y-3">
                                                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                                            {variantForm.watch("volumePricing.tiers")?.map((tier: any, index: number) => (
                                                              <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                                                <div className="flex-1 grid grid-cols-3 gap-2">
                                                                  <div>
                                                                    <label className="text-xs text-muted-foreground">Min Sheets</label>
                                                                    <Input
                                                                      type="number"
                                                                      value={tier.minSheets}
                                                                      onChange={(e) => {
                                                                        const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                        tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                                        variantForm.setValue("volumePricing.tiers", tiers);
                                                                      }}
                                                                      className="h-8"
                                                                    />
                                                                  </div>
                                                                  <div>
                                                                    <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                                                    <Input
                                                                      type="number"
                                                                      value={tier.maxSheets || ""}
                                                                      onChange={(e) => {
                                                                        const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                        tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                                        variantForm.setValue("volumePricing.tiers", tiers);
                                                                      }}
                                                                      placeholder="No limit"
                                                                      className="h-8"
                                                                    />
                                                                  </div>
                                                                  <div>
                                                                    <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                                                    <Input
                                                                      type="number"
                                                                      step="0.01"
                                                                      value={tier.pricePerSheet}
                                                                      onChange={(e) => {
                                                                        const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                        tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                                        variantForm.setValue("volumePricing.tiers", tiers);
                                                                      }}
                                                                      className="h-8"
                                                                    />
                                                                  </div>
                                                                </div>
                                                                <Button
                                                                  type="button"
                                                                  variant="ghost"
                                                                  size="icon"
                                                                  className="h-8 w-8"
                                                                  onClick={() => {
                                                                    const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                    tiers.splice(index, 1);
                                                                    variantForm.setValue("volumePricing.tiers", tiers);
                                                                  }}
                                                                >
                                                                  <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                              </div>
                                                            ))}
                                                          </div>
                                                          <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                              const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                              const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                                              const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                                              tiers.push({ minSheets, pricePerSheet: 0 });
                                                              variantForm.setValue("volumePricing.tiers", tiers);
                                                            }}
                                                          >
                                                            <Plus className="h-4 w-4 mr-1" />
                                                            Add Tier
                                                          </Button>
                                                          <p className="text-xs text-muted-foreground">
                                                            Example: 1-9 sheets @ $70, 10+ sheets @ $60
                                                          </p>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}

                                                  <DialogFooter>
                                                    <Button
                                                      type="submit"
                                                      disabled={addVariantMutation.isPending}
                                                      data-testid="button-submit-add-variant-inline"
                                                    >
                                                      {addVariantMutation.isPending ? "Adding..." : `Add ${product.variantLabel ?? "Variant"}`}
                                                    </Button>
                                                  </DialogFooter>
                                                </form>
                                              </Form>
                                            </DialogContent>
                                          </Dialog>
                                        </div>

                                        {/* Variants List */}
                                        <div className="space-y-2">
                                          {allVariants?.find(pv => pv.productId === product.id)?.variants.length ? (
                                            allVariants
                                              .find(pv => pv.productId === product.id)
                                              ?.variants.sort((a, b) => a.displayOrder - b.displayOrder)
                                              .map((variant) => (
                                                <Card key={variant.id} data-testid={`card-variant-${variant.id}`}>
                                                  <CardContent className="p-4">
                                                    <div className="flex items-start justify-between gap-4">
                                                      <div className="flex-1 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                          <h4 className="font-semibold" data-testid={`text-variant-name-${variant.id}`}>
                                                            {variant.name}
                                                          </h4>
                                                          {variant.isDefault && (
                                                            <Badge variant="default" data-testid={`badge-default-variant-${variant.id}`}>Default</Badge>
                                                          )}
                                                          {!variant.isActive && (
                                                            <Badge variant="secondary">Inactive</Badge>
                                                          )}
                                                        </div>
                                                        {variant.description && (
                                                          <p className="text-sm text-muted-foreground" data-testid={`text-variant-description-${variant.id}`}>
                                                            {variant.description}
                                                          </p>
                                                        )}
                                                        <div className="text-sm font-mono" data-testid={`text-variant-price-${variant.id}`}>
                                                          Base Price: ${Number(variant.basePricePerSqft).toFixed(4)}/sqft
                                                        </div>
                                                      </div>
                                                      <div className="flex gap-2">
                                                        <Dialog
                                                          open={editingVariant?.id === variant.id}
                                                          onOpenChange={(open) => !open && setEditingVariant(null)}
                                                        >
                                                          <DialogTrigger asChild>
                                                            <Button
                                                              variant="outline"
                                                              size="icon"
                                                              onClick={() => handleEditVariant(variant, product.id)}
                                                              data-testid={`button-edit-variant-inline-${variant.id}`}
                                                            >
                                                              <Edit className="w-4 h-4" />
                                                            </Button>
                                                          </DialogTrigger>
                                                          <DialogContent className="max-w-2xl" data-testid={`dialog-edit-variant-inline-${variant.id}`}>
                                                            <DialogHeader>
                                                              <DialogTitle>Edit {product.variantLabel ?? "Variant"}</DialogTitle>
                                                              <DialogDescription>
                                                                Update {(product.variantLabel || "variant").toLowerCase()} details
                                                              </DialogDescription>
                                                            </DialogHeader>
                                                            <Form {...editVariantForm}>
                                                              <form onSubmit={(e) => {
                                                                e.stopPropagation();
                                                                editVariantForm.handleSubmit((data) => updateVariantMutation.mutate({ productId: product.id, id: variant.id, data }))(e);
                                                              }} className="space-y-4">
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="name"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>{product.variantLabel ?? "Variant"} Name</FormLabel>
                                                                      <FormControl>
                                                                        <Input {...field} data-testid={`input-edit-variant-name-${variant.id}`} />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="description"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Description (Optional)</FormLabel>
                                                                      <FormControl>
                                                                        <Textarea {...field} value={field.value || ""} data-testid={`textarea-edit-variant-description-${variant.id}`} />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="basePricePerSqft"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Base Price per Square Foot</FormLabel>
                                                                      <FormControl>
                                                                        <Input
                                                                          type="number"
                                                                          step="0.0001"
                                                                          {...field}
                                                                          onChange={(e) => field.onChange(Number(e.target.value))}
                                                                          data-testid={`input-edit-variant-price-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="isDefault"
                                                                  render={({ field }) => (
                                                                    <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                                      <div className="space-y-0.5">
                                                                        <FormLabel className="text-base">Is Default {product.variantLabel ?? "Variant"}</FormLabel>
                                                                        <FormDescription>
                                                                          This {(product.variantLabel || "variant").toLowerCase()} will be pre-selected
                                                                        </FormDescription>
                                                                      </div>
                                                                      <FormControl>
                                                                        <Switch
                                                                          checked={field.value}
                                                                          onCheckedChange={field.onChange}
                                                                          data-testid={`checkbox-edit-variant-default-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="displayOrder"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Display Order</FormLabel>
                                                                      <FormControl>
                                                                        <Input
                                                                          type="number"
                                                                          {...field}
                                                                          onChange={(e) => field.onChange(Number(e.target.value))}
                                                                          data-testid={`input-edit-variant-order-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />

                                                                {/* Volume Pricing for Nesting Calculator Products */}
                                                                {product.useNestingCalculator && (
                                                                  <div className="space-y-4 rounded-md border p-4">
                                                                    <div className="flex items-center justify-between">
                                                                      <div>
                                                                        <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                                                        <p className="text-sm text-muted-foreground">
                                                                          Set different prices per sheet based on quantity
                                                                        </p>
                                                                      </div>
                                                                      <FormField
                                                                        control={editVariantForm.control}
                                                                        name="volumePricing.enabled"
                                                                        render={({ field }) => (
                                                                          <FormItem>
                                                                            <FormControl>
                                                                              <Switch
                                                                                checked={field.value}
                                                                                onCheckedChange={field.onChange}
                                                                              />
                                                                            </FormControl>
                                                                          </FormItem>
                                                                        )}
                                                                      />
                                                                    </div>

                                                                    {editVariantForm.watch("volumePricing.enabled") && (
                                                                      <div className="space-y-3">
                                                                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                                                          {editVariantForm.watch("volumePricing.tiers")?.map((tier: any, index: number) => (
                                                                            <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                                                              <div className="flex-1 grid grid-cols-3 gap-2">
                                                                                <div>
                                                                                  <label className="text-xs text-muted-foreground">Min Sheets</label>
                                                                                  <Input
                                                                                    type="number"
                                                                                    value={tier.minSheets}
                                                                                    onChange={(e) => {
                                                                                      const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                      tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                                                      editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                    }}
                                                                                    className="h-8"
                                                                                  />
                                                                                </div>
                                                                                <div>
                                                                                  <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                                                                  <Input
                                                                                    type="number"
                                                                                    value={tier.maxSheets || ""}
                                                                                    onChange={(e) => {
                                                                                      const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                      tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                                                      editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                    }}
                                                                                    placeholder="No limit"
                                                                                    className="h-8"
                                                                                  />
                                                                                </div>
                                                                                <div>
                                                                                  <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                                                                  <Input
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    value={tier.pricePerSheet}
                                                                                    onChange={(e) => {
                                                                                      const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                      tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                                                      editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                    }}
                                                                                    className="h-8"
                                                                                  />
                                                                                </div>
                                                                              </div>
                                                                              <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-8 w-8"
                                                                                onClick={() => {
                                                                                  const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                  tiers.splice(index, 1);
                                                                                  editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                }}
                                                                              >
                                                                                <Trash2 className="h-4 w-4" />
                                                                              </Button>
                                                                            </div>
                                                                          ))}
                                                                        </div>
                                                                        <Button
                                                                          type="button"
                                                                          variant="outline"
                                                                          size="sm"
                                                                          onClick={() => {
                                                                            const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                            const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                                                            const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                                                            tiers.push({ minSheets, pricePerSheet: 0 });
                                                                            editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                          }}
                                                                        >
                                                                          <Plus className="h-4 w-4 mr-1" />
                                                                          Add Tier
                                                                        </Button>
                                                                        <p className="text-xs text-muted-foreground">
                                                                          Example: 1-9 sheets @ $70, 10+ sheets @ $60
                                                                        </p>
                                                                      </div>
                                                                    )}
                                                                  </div>
                                                                )}

                                                                <DialogFooter>
                                                                  <Button
                                                                    type="submit"
                                                                    disabled={updateVariantMutation.isPending}
                                                                    data-testid={`button-submit-edit-variant-${variant.id}`}
                                                                  >
                                                                    {updateVariantMutation.isPending ? "Updating..." : `Update ${product.variantLabel ?? "Variant"}`}
                                                                  </Button>
                                                                </DialogFooter>
                                                              </form>
                                                            </Form>
                                                          </DialogContent>
                                                        </Dialog>
                                                        <Button
                                                          type="button"
                                                          variant="outline"
                                                          size="icon"
                                                          onClick={() => handleCloneVariant(variant, product.id)}
                                                          data-testid={`button-clone-variant-${variant.id}`}
                                                          title="Clone variant"
                                                        >
                                                          <Copy className="w-4 h-4" />
                                                        </Button>
                                                        <AlertDialog>
                                                          <AlertDialogTrigger asChild>
                                                            <Button
                                                              variant="outline"
                                                              size="icon"
                                                              data-testid={`button-delete-variant-inline-${variant.id}`}
                                                            >
                                                              <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                          </AlertDialogTrigger>
                                                          <AlertDialogContent data-testid={`dialog-delete-variant-${variant.id}`}>
                                                            <AlertDialogHeader>
                                                              <AlertDialogTitle>Delete {product.variantLabel ?? "Variant"}?</AlertDialogTitle>
                                                              <AlertDialogDescription>
                                                                This will permanently delete "{variant.name}".
                                                              </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                              <AlertDialogCancel data-testid={`button-cancel-delete-variant-${variant.id}`}>
                                                                Cancel
                                                              </AlertDialogCancel>
                                                              <AlertDialogAction
                                                                onClick={() => deleteVariantMutation.mutate({ productId: product.id, id: variant.id })}
                                                                data-testid={`button-confirm-delete-variant-${variant.id}`}
                                                              >
                                                                Delete
                                                              </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                          </AlertDialogContent>
                                                        </AlertDialog>
                                                      </div>
                                                    </div>
                                                  </CardContent>
                                                </Card>
                                              ))
                                          ) : (
                                            <div className="text-center py-8 text-muted-foreground">
                                              No {(product.variantLabel || "variant").toLowerCase()}s configured yet
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Product Options Section */}
                                      <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <h3 className="text-lg font-semibold">Product Options</h3>
                                            <p className="text-sm text-muted-foreground">
                                              Configure add-on options with custom pricing formulas
                                            </p>
                                          </div>
                                          <Dialog 
                                            open={isAddOptionDialogOpen} 
                                            onOpenChange={(open) => {
                                              setIsAddOptionDialogOpen(open);
                                              if (!open) {
                                                setEditingOption(null);
                                                optionForm.reset({
                                                  name: "",
                                                  description: "",
                                                  type: "toggle",
                                                  defaultValue: "false",
                                                  isDefaultEnabled: false,
                                                  setupCost: 0,
                                                  priceFormula: "0",
                                                  parentOptionId: null,
                                                  displayOrder: 0,
                                                  isActive: true,
                                                });
                                              }
                                            }}
                                          >
                                            <DialogTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setEditingOption(null);
                                                  optionForm.reset({
                                                    name: "",
                                                    description: "",
                                                    type: "toggle",
                                                    defaultValue: "false",
                                                    isDefaultEnabled: false,
                                                    setupCost: 0,
                                                    priceFormula: "0",
                                                    parentOptionId: null,
                                                    displayOrder: 0,
                                                    isActive: true,
                                                  });
                                                }}
                                                data-testid={`button-add-option-${product.id}`}
                                              >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add Option
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-add-option-${product.id}`}>
                                              <DialogHeader>
                                                <DialogTitle>{editingOption ? "Edit Option" : "Add Option"}</DialogTitle>
                                                <DialogDescription>
                                                  Configure option details and pricing formula
                                                </DialogDescription>
                                              </DialogHeader>
                                              <Form {...optionForm}>
                                                <form
                                                  onSubmit={(e) => {
                                                    e.stopPropagation();
                                                    optionForm.handleSubmit((data) => {
                                                      if (editingOption) {
                                                        updateOptionMutation.mutate({ id: editingOption.id, data });
                                                      } else {
                                                        addOptionMutation.mutate(data);
                                                      }
                                                    })(e);
                                                  }}
                                                  className="space-y-4"
                                                >
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="name"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Option Name</FormLabel>
                                                          <FormControl>
                                                            <Input placeholder="Pole Pocket" {...field} data-testid="input-option-name" />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="type"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Type</FormLabel>
                                                          <Select onValueChange={field.onChange} value={field.value}>
                                                            <FormControl>
                                                              <SelectTrigger data-testid="select-option-type">
                                                                <SelectValue />
                                                              </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                              <SelectItem value="toggle">Toggle</SelectItem>
                                                              <SelectItem value="number">Number</SelectItem>
                                                              <SelectItem value="select">Select</SelectItem>
                                                            </SelectContent>
                                                          </Select>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="description"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Description</FormLabel>
                                                        <FormControl>
                                                          <Textarea
                                                            placeholder="Add a pole pocket for hanging..."
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="textarea-option-description"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="defaultValue"
                                                    render={({ field }) => {
                                                      const optionType = optionForm.watch("type");
                                                      
                                                      if (optionType === "select") {
                                                        return (
                                                          <FormItem className="col-span-2">
                                                            <FormLabel>Dropdown Choices</FormLabel>
                                                            <FormControl>
                                                              <SelectChoicesInput
                                                                value={field.value || ""}
                                                                onChange={field.onChange}
                                                              />
                                                            </FormControl>
                                                            <FormDescription className="text-xs">
                                                              Add dropdown choices for users to select from
                                                            </FormDescription>
                                                            <FormMessage />
                                                          </FormItem>
                                                        );
                                                      }
                                                      
                                                      return (
                                                        <FormItem>
                                                          <FormLabel>Default Value</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              placeholder={optionType === "toggle" ? "false" : "0"}
                                                              {...field}
                                                              value={field.value || ""}
                                                              data-testid="input-option-default-value"
                                                            />
                                                          </FormControl>
                                                          <FormDescription className="text-xs">
                                                            {optionType === "toggle" ? "Use 'true' or 'false'" : "Default numeric value"}
                                                          </FormDescription>
                                                          <FormMessage />
                                                        </FormItem>
                                                      );
                                                    }}
                                                  />
                                                  {optionForm.watch("type") === "select" && (
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="defaultSelection"
                                                      render={({ field }) => {
                                                        const choices = (optionForm.watch("defaultValue") || "")
                                                          .split(",")
                                                          .map(s => s.trim())
                                                          .filter(Boolean);
                                                        
                                                        return (
                                                          <FormItem>
                                                            <FormLabel>Default Selection</FormLabel>
                                                            <Select
                                                              onValueChange={(value) => {
                                                                field.onChange(value === "__none__" ? "" : value);
                                                              }}
                                                              value={field.value || "__none__"}
                                                            >
                                                              <FormControl>
                                                                <SelectTrigger data-testid="select-default-selection">
                                                                  <SelectValue placeholder="Select default choice (optional)" />
                                                                </SelectTrigger>
                                                              </FormControl>
                                                              <SelectContent>
                                                                {choices.length === 0 ? (
                                                                  <SelectItem value="__disabled__" disabled>
                                                                    Add choices first
                                                                  </SelectItem>
                                                                ) : (
                                                                  <>
                                                                    <SelectItem value="__none__">None (user must select)</SelectItem>
                                                                    {choices.map((choice) => (
                                                                      <SelectItem key={choice} value={choice}>
                                                                        {choice}
                                                                      </SelectItem>
                                                                    ))}
                                                                  </>
                                                                )}
                                                              </SelectContent>
                                                            </Select>
                                                            <FormDescription className="text-xs">
                                                              Which option should be selected by default
                                                            </FormDescription>
                                                            <FormMessage />
                                                          </FormItem>
                                                        );
                                                      }}
                                                    />
                                                  )}
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="setupCost"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Setup Cost ($)</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              type="number"
                                                              step="0.01"
                                                              placeholder="0.00"
                                                              {...field}
                                                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                              data-testid="input-option-setup-cost"
                                                            />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="priceFormula"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Price Formula</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            placeholder="width * 0.5"
                                                            className="font-mono"
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="input-option-formula"
                                                          />
                                                        </FormControl>
                                                        <FormDescription className="text-xs">
                                                          Formula expression. Available: w, h, q, sqft, total_sqft, base_price
                                                        </FormDescription>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="parentOptionId"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Parent Option (Optional)</FormLabel>
                                                          <Select
                                                            onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                                                            value={field.value || "none"}
                                                          >
                                                            <FormControl>
                                                              <SelectTrigger data-testid="select-option-parent">
                                                                <SelectValue placeholder="None (Top-level)" />
                                                              </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                              <SelectItem value="none">None (Top-level)</SelectItem>
                                                              {productOptions
                                                                ?.filter((opt) => !opt.parentOptionId && opt.id !== editingOption?.id)
                                                                .map((opt) => (
                                                                  <SelectItem key={opt.id} value={opt.id}>
                                                                    {opt.name}
                                                                  </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                          </Select>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="displayOrder"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Display Order</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              type="number"
                                                              {...field}
                                                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                                              data-testid="input-option-order"
                                                            />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  {optionForm.watch("type") === "toggle" && (
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="isDefaultEnabled"
                                                      render={({ field }) => (
                                                        <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                          <div className="space-y-0.5">
                                                            <FormLabel className="text-base">Default On</FormLabel>
                                                            <FormDescription>
                                                              Toggle will be enabled by default
                                                            </FormDescription>
                                                          </div>
                                                          <FormControl>
                                                            <Switch
                                                              checked={field.value}
                                                              onCheckedChange={field.onChange}
                                                              data-testid="switch-option-is-default"
                                                            />
                                                          </FormControl>
                                                        </FormItem>
                                                      )}
                                                    />
                                                  )}
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="isActive"
                                                    render={({ field }) => (
                                                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                        <div className="space-y-0.5">
                                                          <FormLabel className="text-base">Active</FormLabel>
                                                          <FormDescription>
                                                            Option will be available in the calculator
                                                          </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                          <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="switch-option-active"
                                                          />
                                                        </FormControl>
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <DialogFooter>
                                                    <Button
                                                      type="submit"
                                                      disabled={addOptionMutation.isPending || updateOptionMutation.isPending}
                                                      data-testid="button-submit-option"
                                                    >
                                                      {addOptionMutation.isPending || updateOptionMutation.isPending
                                                        ? editingOption ? "Updating..." : "Adding..."
                                                        : editingOption ? "Update Option" : "Add Option"}
                                                    </Button>
                                                  </DialogFooter>
                                                </form>
                                              </Form>
                                            </DialogContent>
                                          </Dialog>
                                        </div>

                                        {/* Options List */}
                                        <div className="space-y-2">
                                          {productOptions && productOptions.length > 0 ? (
                                            productOptions
                                              .filter((opt) => !opt.parentOptionId)
                                              .sort((a, b) => a.displayOrder - b.displayOrder)
                                              .map((parentOpt) => (
                                                <div key={parentOpt.id} className="space-y-2">
                                                  <Card data-testid={`card-option-${parentOpt.id}`}>
                                                    <CardContent className="p-4">
                                                      <div className="flex items-start justify-between gap-4">
                                                        <div className="flex-1 space-y-2">
                                                          <div className="flex items-center gap-2">
                                                            <h4 className="font-semibold" data-testid={`text-option-name-${parentOpt.id}`}>
                                                              {parentOpt.name}
                                                            </h4>
                                                            <Badge variant="outline" data-testid={`badge-option-type-${parentOpt.id}`}>
                                                              {parentOpt.type}
                                                            </Badge>
                                                            {!parentOpt.isActive && (
                                                              <Badge variant="secondary">Inactive</Badge>
                                                            )}
                                                          </div>
                                                          {parentOpt.description && (
                                                            <p className="text-sm text-muted-foreground" data-testid={`text-option-description-${parentOpt.id}`}>
                                                              {parentOpt.description}
                                                            </p>
                                                          )}
                                                          <div className="flex gap-4 text-xs text-muted-foreground">
                                                            {parseFloat(parentOpt.setupCost.toString()) > 0 && (
                                                              <span data-testid={`text-option-setup-${parentOpt.id}`}>
                                                                Setup: ${parentOpt.setupCost}
                                                              </span>
                                                            )}
                                                            <span className="font-mono" data-testid={`text-option-formula-${parentOpt.id}`}>
                                                              Formula: {parentOpt.priceFormula}
                                                            </span>
                                                          </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                          <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="icon"
                                                            onClick={() => {
                                                              setEditingOption(parentOpt);
                                                              optionForm.reset({
                                                                name: parentOpt.name,
                                                                description: parentOpt.description || "",
                                                                type: parentOpt.type,
                                                                defaultValue: parentOpt.defaultValue || "",
                                                                isDefaultEnabled: parentOpt.isDefaultEnabled,
                                                                setupCost: parseFloat(parentOpt.setupCost.toString()),
                                                                priceFormula: parentOpt.priceFormula || "0",
                                                                parentOptionId: parentOpt.parentOptionId,
                                                                displayOrder: parentOpt.displayOrder,
                                                                isActive: parentOpt.isActive,
                                                              });
                                                              setIsAddOptionDialogOpen(true);
                                                            }}
                                                            data-testid={`button-edit-option-${parentOpt.id}`}
                                                          >
                                                            <Edit className="w-4 h-4" />
                                                          </Button>
                                                          <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                              <Button
                                                                variant="outline"
                                                                size="icon"
                                                                data-testid={`button-delete-option-${parentOpt.id}`}
                                                              >
                                                                <Trash2 className="w-4 h-4" />
                                                              </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent data-testid={`dialog-delete-option-${parentOpt.id}`}>
                                                              <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Option?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                  This will permanently delete "{parentOpt.name}" and all its child options.
                                                                </AlertDialogDescription>
                                                              </AlertDialogHeader>
                                                              <AlertDialogFooter>
                                                                <AlertDialogCancel data-testid={`button-cancel-delete-option-${parentOpt.id}`}>
                                                                  Cancel
                                                                </AlertDialogCancel>
                                                                <AlertDialogAction
                                                                  onClick={() => deleteOptionMutation.mutate(parentOpt.id)}
                                                                  data-testid={`button-confirm-delete-option-${parentOpt.id}`}
                                                                >
                                                                  Delete
                                                                </AlertDialogAction>
                                                              </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                          </AlertDialog>
                                                        </div>
                                                      </div>
                                                    </CardContent>
                                                  </Card>

                                                  {/* Child Options */}
                                                  {productOptions
                                                    .filter((opt) => opt.parentOptionId === parentOpt.id)
                                                    .sort((a, b) => a.displayOrder - b.displayOrder)
                                                    .map((childOpt) => (
                                                      <Card
                                                        key={childOpt.id}
                                                        className="ml-6 border-l-4"
                                                        data-testid={`card-option-${childOpt.id}`}
                                                      >
                                                        <CardContent className="p-4">
                                                          <div className="flex items-start justify-between gap-4">
                                                            <div className="flex-1 space-y-2">
                                                              <div className="flex items-center gap-2">
                                                                <h4 className="font-semibold" data-testid={`text-option-name-${childOpt.id}`}>
                                                                  {childOpt.name}
                                                                </h4>
                                                                <Badge variant="outline" data-testid={`badge-option-type-${childOpt.id}`}>
                                                                  {childOpt.type}
                                                                </Badge>
                                                                {!childOpt.isActive && (
                                                                  <Badge variant="secondary">Inactive</Badge>
                                                                )}
                                                              </div>
                                                              {childOpt.description && (
                                                                <p className="text-sm text-muted-foreground" data-testid={`text-option-description-${childOpt.id}`}>
                                                                  {childOpt.description}
                                                                </p>
                                                              )}
                                                              <div className="flex gap-4 text-xs text-muted-foreground">
                                                                {parseFloat(childOpt.setupCost.toString()) > 0 && (
                                                                  <span data-testid={`text-option-setup-${childOpt.id}`}>
                                                                    Setup: ${childOpt.setupCost}
                                                                  </span>
                                                                )}
                                                                <span className="font-mono" data-testid={`text-option-formula-${childOpt.id}`}>
                                                                  Formula: {childOpt.priceFormula}
                                                                </span>
                                                              </div>
                                                            </div>
                                                            <div className="flex gap-2">
                                                              <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="icon"
                                                                onClick={() => {
                                                                  setEditingOption(childOpt);
                                                                  optionForm.reset({
                                                                    name: childOpt.name,
                                                                    description: childOpt.description || "",
                                                                    type: childOpt.type,
                                                                    defaultValue: childOpt.defaultValue || "",
                                                                    isDefaultEnabled: childOpt.isDefaultEnabled,
                                                                    setupCost: parseFloat(childOpt.setupCost.toString()),
                                                                    priceFormula: childOpt.priceFormula || "0",
                                                                    parentOptionId: childOpt.parentOptionId,
                                                                    displayOrder: childOpt.displayOrder,
                                                                    isActive: childOpt.isActive,
                                                                  });
                                                                  setIsAddOptionDialogOpen(true);
                                                                }}
                                                                data-testid={`button-edit-option-${childOpt.id}`}
                                                              >
                                                                <Edit className="w-4 h-4" />
                                                              </Button>
                                                              <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                  <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    data-testid={`button-delete-option-${childOpt.id}`}
                                                                  >
                                                                    <Trash2 className="w-4 h-4" />
                                                                  </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent data-testid={`dialog-delete-option-${childOpt.id}`}>
                                                                  <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete Option?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                      This will permanently delete "{childOpt.name}".
                                                                    </AlertDialogDescription>
                                                                  </AlertDialogHeader>
                                                                  <AlertDialogFooter>
                                                                    <AlertDialogCancel data-testid={`button-cancel-delete-option-${childOpt.id}`}>
                                                                      Cancel
                                                                    </AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                      onClick={() => deleteOptionMutation.mutate(childOpt.id)}
                                                                      data-testid={`button-confirm-delete-option-${childOpt.id}`}
                                                                    >
                                                                      Delete
                                                                    </AlertDialogAction>
                                                                  </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                              </AlertDialog>
                                                            </div>
                                                          </div>
                                                        </CardContent>
                                                      </Card>
                                                    ))}
                                                </div>
                                              ))
                                          ) : (
                                            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-options">
                                              No options configured yet. Click "Add Option" to get started.
                                            </p>
                                          )}
                                        </div>
                                      </div>

                                      <DialogFooter>
                                        <Button
                                          type="submit"
                                          disabled={updateProductMutation.isPending}
                                          data-testid={`button-submit-edit-${product.id}`}
                                        >
                                          {updateProductMutation.isPending ? "Updating..." : "Update Product"}
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>

                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => cloneProductMutation.mutate(product.id)}
                                disabled={cloneProductMutation.isPending}
                                data-testid={`button-clone-${product.id}`}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    data-testid={`button-delete-${product.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-${product.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete "{product.name}". This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-${product.id}`}>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteProductMutation.mutate(product.id)}
                                      data-testid={`button-confirm-delete-${product.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {products && products.length > 0
                            ? "No products match the current status filter."
                            : "No products yet. Add your first product to get started."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="products-grid">
                  {filteredProducts && filteredProducts.length > 0 ? (
                    filteredProducts.map((product) => {
                      const safeSrc = isValidHttpUrl(product.thumbnailUrls?.[0]) ? product.thumbnailUrls[0] : null;
                      const hasError = imageErrors.has(product.id);
                      
                      return (
                      <Card key={product.id} className="flex flex-col" data-testid={`card-product-${product.id}`}>
                        <div className="aspect-square relative bg-muted overflow-hidden rounded-t-md">
                          {safeSrc && !hasError ? (
                            <img
                              src={safeSrc}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={() => {
                                setImageErrors(prev => new Set(prev).add(product.id));
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                              No image
                            </div>
                          )}
                        </div>
                        <CardContent className="flex-1 p-4 space-y-2">
                          <h4 className="font-semibold truncate" data-testid={`text-product-name-${product.id}`}>
                            {product.name}
                          </h4>
                          {product.category && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-category-${product.id}`}>
                              {product.category}
                            </Badge>
                          )}
                          <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-description-${product.id}`}>
                            {product.description || "No description"}
                          </p>
                          <div className="flex items-center gap-2 pt-2">
                            <span data-testid={product.isActive ? `status-active-${product.id}` : `status-inactive-${product.id}`}>
                              {renderProductStatusBadge(product)}
                            </span>
                          </div>
                        </CardContent>
                        <div className="p-4 pt-0 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              toggleProductActiveMutation.mutate({
                                id: product.id,
                                isActive: !product.isActive,
                              })
                            }
                            disabled={toggleProductActiveMutation.isPending}
                            data-testid={`button-toggle-card-${product.id}`}
                          >
                            {product.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleEditProduct(product)}
                            data-testid={`button-edit-card-${product.id}`}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`button-delete-card-${product.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Product</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{product.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteProductMutation.mutate(product.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </Card>
                      );
                    })
                  ) : (
                    <div className="col-span-full text-center py-12 text-muted-foreground">
                      {products && products.length > 0
                        ? "No products match the current status filter."
                        : "No products yet. Add your first product to get started."}
                    </div>
                  )}
                </div>
              )}

              <MediaPicker
                value={editProductForm.watch("thumbnailUrls") ?? []}
                onChange={(urls) => editProductForm.setValue("thumbnailUrls", urls)}
                open={isMediaPickerOpen && mediaPickerMode === "edit"}
                onOpenChange={setIsMediaPickerOpen}
              />
            </TabsContent>

            <TabsContent value="media" className="space-y-4">
              <MediaLibraryTab />
            </TabsContent>

            <TabsContent value="variables" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Pricing Variables</h3>
                    <p className="text-sm text-muted-foreground">
                      Manage global variables for use in pricing formulas
                    </p>
                  </div>
                </div>

                <Card data-testid="card-formula-guide">
                  <CardHeader>
                    <CardTitle>How to Use Variables in Formulas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Built-in Variables:</h4>
                      <p className="text-sm text-muted-foreground mb-2">
                        These variables are automatically available in all formulas:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        <li><code className="bg-muted px-1 rounded">w</code> - Ordered width in inches</li>
                        <li><code className="bg-muted px-1 rounded">h</code> - Ordered height in inches</li>
                        <li><code className="bg-muted px-1 rounded">q</code> - Quantity</li>
                        <li><code className="bg-muted px-1 rounded">sqft</code> - Square feet per item</li>
                        <li><code className="bg-muted px-1 rounded">total_sqft</code> - Total square feet for the order</li>
                        <li><code className="bg-muted px-1 rounded">base_price</code> - Effective base price rate used by the evaluator</li>
                      </ul>
                      <p className="text-xs text-muted-foreground mt-2 italic">
                        💡 Tip: Use lowercase keys and formula functions such as <code className="bg-muted px-1 rounded">ceil(...)</code>, <code className="bg-muted px-1 rounded">round(...)</code>, and <code className="bg-muted px-1 rounded">max(...)</code>.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 font-semibold">
                        ⚠️ Note: Set price per sq ft in Product Variants, not in the formula!
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Your Custom Variables:</h4>
                      {globalVariables && globalVariables.length > 0 ? (
                        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                          {globalVariables
                            .filter(v => v.name !== 'next_quote_number' && v.name !== 'next_job_number')
                            .map(variable => (
                              <li key={variable.id}>
                                <code className="bg-muted px-1 rounded">{variable.name}</code> = {Number(variable.value).toFixed(4)}
                                {variable.description && <span className="ml-2">- {variable.description}</span>}
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">No custom variables yet. Add variables below to use them in formulas.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Example Formulas:</h4>
                      <div className="space-y-2 text-sm">
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">ceil((((w + 0.25) * (h + 0.25)) * q) / 144) * base_price</code>
                          <p className="text-muted-foreground mt-1">Finished-size billing with a 0.25&quot; trim allowance and whole-square-foot rounding.</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">sqft * base_price * q</code>
                          <p className="text-muted-foreground mt-1">Simple area pricing using lowercase evaluator variables.</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">max(25, sqft * base_price * q)</code>
                          <p className="text-muted-foreground mt-1">Minimum order price</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">round(sqft * base_price * q)</code>
                          <p className="text-muted-foreground mt-1">Round the evaluated total using supported formula functions.</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 max-w-md">
                  <Input
                    placeholder="Search variables..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    data-testid="input-search-variables"
                  />
                </div>
                <Dialog open={isAddVariableDialogOpen} onOpenChange={setIsAddVariableDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-variable">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Variable
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl" data-testid="dialog-add-variable">
                    <DialogHeader>
                      <DialogTitle>Add New Global Variable</DialogTitle>
                      <DialogDescription>
                        Create a new global variable for use in pricing calculations
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...variableForm}>
                      <form onSubmit={variableForm.handleSubmit((data) => addVariableMutation.mutate(data))} className="space-y-4">
                        <FormField
                          control={variableForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-name">Variable Name</FormLabel>
                              <FormControl>
                                <Input placeholder="BASE_COST" {...field} data-testid="input-variable-name" />
                              </FormControl>
                              <FormDescription>
                                Use a unique, descriptive name (e.g., BASE_COST, TAX_RATE)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="value"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-value">Value</FormLabel>
                              <FormControl>
                                <Input
                                  type="text"
                                  placeholder="0.05 or BASE_COST"
                                  {...field}
                                  data-testid="input-variable-value"
                                />
                              </FormControl>
                              <FormDescription>
                                Can be a number (e.g., 0.05) or a variable name (e.g., BASE_COST)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-description">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Description of what this variable is used for..."
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="textarea-variable-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-category">Category (Optional)</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="Costs" 
                                  {...field} 
                                  value={field.value || ""}
                                  data-testid="input-variable-category"
                                />
                              </FormControl>
                              <FormDescription>
                                Group related variables by category
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={addVariableMutation.isPending}
                            data-testid="button-submit-add-variable"
                          >
                            {addVariableMutation.isPending ? "Adding..." : "Add Variable"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-variable-name">Name</TableHead>
                      <TableHead data-testid="header-variable-value">Value</TableHead>
                      <TableHead data-testid="header-variable-description">Description</TableHead>
                      <TableHead data-testid="header-variable-category">Category</TableHead>
                      <TableHead data-testid="header-variable-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variablesLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : filteredVariables && filteredVariables.length > 0 ? (
                      filteredVariables.map((variable) => (
                        <TableRow key={variable.id} data-testid={`row-variable-${variable.id}`}>
                          <TableCell className="font-medium font-mono" data-testid={`cell-variable-name-${variable.id}`}>
                            {variable.name}
                          </TableCell>
                          <TableCell className="font-mono" data-testid={`cell-variable-value-${variable.id}`}>
                            {Number(variable.value).toFixed(4)}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" data-testid={`cell-variable-description-${variable.id}`}>
                            {variable.description || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell data-testid={`cell-variable-category-${variable.id}`}>
                            {variable.category ? (
                              <Badge variant="outline" data-testid={`badge-category-${variable.id}`}>{variable.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Dialog
                                open={editingVariable?.id === variable.id}
                                onOpenChange={(open) => !open && setEditingVariable(null)}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEditVariable(variable)}
                                    data-testid={`button-edit-variable-${variable.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl" data-testid={`dialog-edit-variable-${variable.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Global Variable</DialogTitle>
                                    <DialogDescription>
                                      Update variable details
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editVariableForm}>
                                    <form
                                      onSubmit={editVariableForm.handleSubmit((data) =>
                                        updateVariableMutation.mutate({ id: variable.id, data })
                                      )}
                                      className="space-y-4"
                                    >
                                      <FormField
                                        control={editVariableForm.control}
                                        name="name"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Variable Name</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-variable-name-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="value"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Value</FormLabel>
                                            <FormControl>
                                              <Input
                                                type="text"
                                                {...field}
                                                data-testid={`input-edit-variable-value-${variable.id}`}
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Can be a number (e.g., 0.05) or a variable name (e.g., BASE_COST)
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="description"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Description</FormLabel>
                                            <FormControl>
                                              <Textarea {...field} value={field.value || ""} data-testid={`textarea-edit-variable-description-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="category"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <FormControl>
                                              <Input {...field} value={field.value || ""} data-testid={`input-edit-variable-category-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <DialogFooter>
                                        <Button
                                          type="submit"
                                          disabled={updateVariableMutation.isPending}
                                          data-testid={`button-submit-edit-variable-${variable.id}`}
                                        >
                                          {updateVariableMutation.isPending ? "Updating..." : "Update Variable"}
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    data-testid={`button-delete-variable-${variable.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-variable-${variable.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Variable?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete "{variable.name}". This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-variable-${variable.id}`}>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteVariableMutation.mutate(variable.id)}
                                      data-testid={`button-confirm-delete-variable-${variable.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : searchTerm ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No variables match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No global variables yet. Add your first variable to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="formulas" className="space-y-4">
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 max-w-md">
                  <Input
                    placeholder="Search formula templates..."
                    value={templateSearchTerm}
                    onChange={(e) => setTemplateSearchTerm(e.target.value)}
                  />
                </div>
                <Dialog open={isAddFormulaTemplateDialogOpen} onOpenChange={setIsAddFormulaTemplateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Formula Template
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Add New Formula Template</DialogTitle>
                      <DialogDescription>
                        Create a reusable formula template for pricing calculations
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...formulaTemplateForm}>
                      <form onSubmit={formulaTemplateForm.handleSubmit((data) => addFormulaTemplateMutation.mutate(data))} className="space-y-4">
                        <FormField
                          control={formulaTemplateForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Template Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Area-based pricing" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={formulaTemplateForm.control}
                          name="formula"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Formula</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="sqft * p * q"
                                  {...field}
                                  className="font-mono"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={formulaTemplateForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Description of what this formula does..."
                                  {...field}
                                  value={field.value || ""}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={formulaTemplateForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <FormControl>
                                <Input placeholder="Standard" {...field} value={field.value || ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button type="submit" disabled={addFormulaTemplateMutation.isPending}>
                            {addFormulaTemplateMutation.isPending ? "Adding..." : "Add Template"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Formula</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formulaTemplatesLoading ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : formulaTemplates && formulaTemplates.length > 0 ? (
                      formulaTemplates
                        .filter(template =>
                          template.name.toLowerCase().includes(templateSearchTerm.toLowerCase()) ||
                          template.description?.toLowerCase().includes(templateSearchTerm.toLowerCase())
                        )
                        .map((template) => (
                          <TableRow key={template.id}>
                            <TableCell className="font-medium">{template.name}</TableCell>
                            <TableCell className="font-mono text-sm max-w-xs truncate">{template.formula}</TableCell>
                            <TableCell className="max-w-xs truncate">
                              {template.description || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {template.category ? (
                                <Badge variant="outline">{template.category}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewingTemplateProducts(template.id)}
                              >
                                View Products
                              </Button>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Dialog
                                  open={editingFormulaTemplate?.id === template.id}
                                  onOpenChange={(open) => !open && setEditingFormulaTemplate(null)}
                                >
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={() => handleEditFormulaTemplate(template)}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl">
                                    <DialogHeader>
                                      <DialogTitle>Edit Formula Template</DialogTitle>
                                    </DialogHeader>
                                    <Form {...editFormulaTemplateForm}>
                                      <form
                                        onSubmit={editFormulaTemplateForm.handleSubmit((data) =>
                                          updateFormulaTemplateMutation.mutate({ id: template.id, data })
                                        )}
                                        className="space-y-4"
                                      >
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="name"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Template Name</FormLabel>
                                              <FormControl>
                                                <Input {...field} />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="formula"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Formula</FormLabel>
                                              <FormControl>
                                                <Textarea {...field} className="font-mono" />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="description"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Description</FormLabel>
                                              <FormControl>
                                                <Textarea {...field} value={field.value || ""} />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="category"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Category</FormLabel>
                                              <FormControl>
                                                <Input {...field} value={field.value || ""} />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <DialogFooter>
                                          <Button type="submit" disabled={updateFormulaTemplateMutation.isPending}>
                                            {updateFormulaTemplateMutation.isPending ? "Updating..." : "Update Template"}
                                          </Button>
                                        </DialogFooter>
                                      </form>
                                    </Form>
                                  </DialogContent>
                                </Dialog>

                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="icon">
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Formula Template</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{template.name}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteFormulaTemplateMutation.mutate(template.id)}>
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No formula templates yet. Add your first template to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Products using this template dialog */}
              <Dialog open={!!viewingTemplateProducts} onOpenChange={(open) => !open && setViewingTemplateProducts(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Products Using This Formula</DialogTitle>
                    <DialogDescription>
                      These products are currently using this formula template
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    {templateProducts && templateProducts.length > 0 ? (
                      templateProducts.map((product) => (
                        <div key={product.id} className="p-3 border rounded-md">
                          <div className="font-medium">{product.name}</div>
                          <div className="text-sm text-muted-foreground">{product.description}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No products are currently using this formula template.
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </TabsContent>

            {/* Email Settings Tab */}
            <TabsContent value="email" className="space-y-4">
              <EmailSettingsTab />
            </TabsContent>
            <TabsContent value="workflow" className="space-y-4">
              <JobStatusSettings />
            </TabsContent>
            <TabsContent value="invoice-reminders" className="space-y-4">
              <InvoiceRemindersTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
