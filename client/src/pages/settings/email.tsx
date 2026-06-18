import { TitanCard } from "@/components/titan";
import { EmailSettingsTab } from "@/components/admin-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit, Mail, FileText, Plus, Inbox, PauseCircle, Trash2, Star } from "lucide-react";
import { useState, useEffect, type FormEvent } from "react";
import {
  useCreateInboundEmailIgnoreRule,
  useDeleteInboundEmailIgnoreRule,
  useDeleteInboundEmailMailbox,
  useInboundEmailIgnoreRules,
  useInboundEmailMailboxes,
  useSetDefaultInboundEmailMailbox,
  useStartInboundGmailMailboxOAuth,
  useUpdateInboundEmailIgnoreRule,
  useUpdateInboundEmailMailboxEnabled,
} from "@/hooks/useInboundEmailIntakeSettings";
import {
  defaultInboundEmailIntakeSettings,
  inboundEmailIntakeSettingsSchema,
  type InboundEmailIntakeSettings,
} from "@shared/inboundEmailIntakeSettings";
import type { InboundEmailIgnoreRuleTypeValue } from "@shared/inboundOrdersApi";

// Schema for email templates
const emailTemplatesSchema = z.object({
  replyToEmail: z.string().email("Must be a valid email").optional().or(z.literal("")),
  quoteEmailSubject: z.string().optional(),
  quoteEmailBody: z.string().optional(),
  invoiceEmailSubject: z.string().optional(),
  invoiceEmailBody: z.string().optional(),
});

type EmailTemplatesFormData = z.infer<typeof emailTemplatesSchema>;

function normalizeInboundEmailSettings(raw: unknown): InboundEmailIntakeSettings {
  const parsed = inboundEmailIntakeSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultInboundEmailIntakeSettings;
}

function InboundEmailIntakeControls() {
  const { toast } = useToast();

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["/api/organization/preferences"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/organization/preferences");
      return await response.json();
    },
  });

  const settings = normalizeInboundEmailSettings((preferences as any)?.inboundEmail);
  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<InboundEmailIntakeSettings>) => {
      const response = await apiRequest("PATCH", "/api/organization/preferences/inbound-email-intake", patch);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/preferences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email-settings"] });
      toast({
        title: "Inbound email settings updated",
        description: "Feature controls have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update inbound email settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inbound Email Intake</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-5 w-5" />
              Inbound Email Intake
            </CardTitle>
            <CardDescription>
              Control email-based TEMP_INBOUND intake without deleting existing review records.
            </CardDescription>
          </div>
          {!settings.inboundEmailIntakeEnabled ? (
            <Badge variant="destructive">Disabled</Badge>
          ) : settings.inboundEmailPullPaused ? (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Pulling Paused</Badge>
          ) : (
            <Badge variant="secondary">Enabled</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              Enable Inbound Email Intake
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              When disabled, manual and scheduled email pulls are stopped and the Inbound Orders navigation is hidden.
            </p>
          </div>
          <Switch
            checked={settings.inboundEmailIntakeEnabled}
            disabled={updateMutation.isPending}
            onCheckedChange={(checked) => updateMutation.mutate({ inboundEmailIntakeEnabled: checked })}
            aria-label="Enable Inbound Email Intake"
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <PauseCircle className="h-4 w-4 text-muted-foreground" />
              Pause Email Pulling
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Temporarily stops new email pulls while keeping existing inbound records available for review.
            </p>
          </div>
          <Switch
            checked={settings.inboundEmailPullPaused}
            disabled={updateMutation.isPending || !settings.inboundEmailIntakeEnabled}
            onCheckedChange={(checked) => updateMutation.mutate({ inboundEmailPullPaused: checked })}
            aria-label="Pause Email Pulling"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function formatMailboxDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function InboundEmailMailboxSettingsCard() {
  const { toast } = useToast();
  const mailboxesQuery = useInboundEmailMailboxes();
  const updateEnabled = useUpdateInboundEmailMailboxEnabled();
  const setDefault = useSetDefaultInboundEmailMailbox();
  const deleteMailbox = useDeleteInboundEmailMailbox();
  const startGmailOAuth = useStartInboundGmailMailboxOAuth();
  const isMutating = updateEnabled.isPending || setDefault.isPending || deleteMailbox.isPending || startGmailOAuth.isPending;
  const mailboxes = mailboxesQuery.data?.mailboxes ?? [];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("inboundGmailConnected");
    const error = params.get("inboundGmailError");

    if (connected === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/mailboxes"] });
      toast({
        title: "Inbound Gmail mailbox connected",
        description: "The mailbox is ready for manual inbound email pulls.",
      });
    } else if (error) {
      const messages: Record<string, string> = {
        cancelled: "Authorization was cancelled.",
        duplicate_email: "Another inbound mailbox is already connected for that Gmail address.",
        invalid_state: "Security check failed. Please try again.",
        mailbox_not_found: "The mailbox selected for reconnect was not found.",
        missing_code: "Authorization code missing. Please try again.",
        no_refresh_token: "Google did not return a refresh token. Please try connecting again.",
        platform_not_configured: "Inbound Gmail OAuth is not configured on this platform.",
        profile_lookup_failed: "Could not retrieve a verified Gmail address from Google.",
        storage_failed: "Failed to save the inbound mailbox connection.",
        token_exchange_failed: "Failed to exchange the authorization code. Please try again.",
      };
      window.history.replaceState({}, "", window.location.pathname);
      toast({
        title: "Inbound Gmail connection failed",
        description: messages[error] || `Unexpected error: ${error}`,
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleDelete = (mailboxId: string, label: string) => {
    if (!window.confirm(`Delete inbound mailbox configuration for ${label}? Existing TEMP_INBOUND records will remain.`)) {
      return;
    }
    deleteMailbox.mutate(mailboxId, {
      onSuccess: () => {
        toast({
          title: "Inbound mailbox deleted",
          description: "Mailbox configuration was removed. Existing inbound records were not deleted.",
        });
      },
      onError: (error: Error) => {
        toast({
          title: "Failed to delete inbound mailbox",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const handleEnabledChange = (mailboxId: string, enabled: boolean) => {
    updateEnabled.mutate({ mailboxId, enabled }, {
      onSuccess: () => {
        toast({
          title: enabled ? "Inbound mailbox enabled" : "Inbound mailbox disabled",
          description: enabled ? "This mailbox can be used by manual email pulls." : "Manual email pulls will skip this mailbox.",
        });
      },
      onError: (error: Error) => {
        toast({
          title: "Failed to update inbound mailbox",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const handleSetDefault = (mailboxId: string) => {
    setDefault.mutate(mailboxId, {
      onSuccess: () => {
        toast({
          title: "Default inbound mailbox updated",
          description: "Manual email pull defaults have been saved.",
        });
      },
      onError: (error: Error) => {
        toast({
          title: "Failed to set default inbound mailbox",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const handleConnect = (mailboxId?: string) => {
    startGmailOAuth.mutate(mailboxId ?? null, {
      onSuccess: (url) => {
        window.location.href = url;
      },
      onError: (error: Error) => {
        toast({
          title: "Failed to start inbound Gmail connection",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Inbound Email Mailboxes
            </CardTitle>
            <CardDescription>
              Dedicated inbound mailbox configuration for creating TEMP_INBOUND review records.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={isMutating}
            onClick={() => handleConnect()}
          >
            <Plus className="mr-2 h-4 w-4" />
            {startGmailOAuth.isPending ? "Connecting..." : "Connect Gmail Inbound Mailbox"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          This creates a dedicated inbound Gmail mailbox and does not use the outbound Gmail sending connection.
        </p>
      </CardHeader>
      <CardContent>
        {mailboxesQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : mailboxesQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to load inbound mailbox settings.
          </div>
        ) : mailboxes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No inbound mailboxes are configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Email Address</th>
                  <th className="px-4 py-3 font-medium">Enabled</th>
                  <th className="px-4 py-3 font-medium">Default</th>
                  <th className="px-4 py-3 font-medium">Last Pull</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last Error</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mailboxes.map((mailbox) => (
                  <tr key={mailbox.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="capitalize">{mailbox.provider}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{mailbox.emailAddress}</div>
                      <div className="text-xs text-muted-foreground">{mailbox.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={mailbox.enabled}
                          disabled={isMutating}
                          onCheckedChange={(checked) => handleEnabledChange(mailbox.id, checked)}
                          aria-label={`Enable inbound mailbox ${mailbox.emailAddress}`}
                        />
                        <span className="text-xs text-muted-foreground">{mailbox.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {mailbox.isDefault ? (
                        <Badge>Default</Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isMutating}
                          onClick={() => handleSetDefault(mailbox.id)}
                        >
                          <Star className="mr-2 h-3.5 w-3.5" />
                          Set Default
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMailboxDate(mailbox.lastPulledAt)}</td>
                    <td className="px-4 py-3">
                      {mailbox.lastPullStatus ? (
                        <Badge variant={mailbox.lastPullStatus === "success" ? "secondary" : "outline"}>
                          {mailbox.lastPullStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-muted-foreground">
                      <span className="block whitespace-normal break-words">{mailbox.lastPullError || "None"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isMutating}
                          onClick={() => handleConnect(mailbox.id)}
                        >
                          Reconnect
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isMutating}
                          onClick={() => handleDelete(mailbox.id, mailbox.emailAddress)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const inboundIgnoreRuleTypeLabels: Record<InboundEmailIgnoreRuleTypeValue, string> = {
  sender_email_exact: "Sender email",
  sender_domain: "Sender domain",
  subject_exact: "Subject exact",
  subject_contains: "Subject contains",
};

function InboundEmailIgnoreRulesCard() {
  const { toast } = useToast();
  const rulesQuery = useInboundEmailIgnoreRules();
  const createRule = useCreateInboundEmailIgnoreRule();
  const updateRule = useUpdateInboundEmailIgnoreRule();
  const deleteRule = useDeleteInboundEmailIgnoreRule();
  const [ruleType, setRuleType] = useState<InboundEmailIgnoreRuleTypeValue>("sender_email_exact");
  const [ruleValue, setRuleValue] = useState("");
  const [notes, setNotes] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const rules = rulesQuery.data?.rules ?? [];
  const isMutating = createRule.isPending || updateRule.isPending || deleteRule.isPending;
  const editingRule = rules.find((rule) => rule.id === editingRuleId) ?? null;

  const normalizeRuleValue = (type: InboundEmailIgnoreRuleTypeValue, value: string) => (
    type === "sender_email_exact" || type === "sender_domain" ? value.trim().toLowerCase() : value.trim()
  );

  const resetForm = () => {
    setRuleType("sender_email_exact");
    setRuleValue("");
    setNotes("");
    setEnabled(true);
    setEditingRuleId(null);
  };

  const beginEdit = (rule: typeof rules[number]) => {
    setEditingRuleId(rule.id);
    setRuleType(rule.ruleType);
    setRuleValue(rule.ruleValue);
    setNotes(rule.notes ?? "");
    setEnabled(rule.enabled);
  };

  const submitRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedValue = normalizeRuleValue(ruleType, ruleValue);
    if (!normalizedValue) {
      toast({ title: "Rule value is required", description: "Enter an email, domain, exact subject, or subject fragment.", variant: "destructive" });
      return;
    }
    const duplicate = rules.find((rule) => (
      rule.id !== editingRuleId
      && rule.enabled
      && enabled
      && rule.ruleType === ruleType
      && rule.ruleValue === normalizedValue
    ));
    if (duplicate) {
      toast({ title: "Duplicate ignore rule", description: "An enabled rule already exists for this type and value.", variant: "destructive" });
      return;
    }
    const payload = {
      ruleType,
      ruleValue: normalizedValue,
      notes: notes.trim() || null,
      enabled,
    };
    const mutationOptions = {
      onSuccess: () => {
        resetForm();
        toast({
          title: editingRuleId ? "Inbound ignore rule updated" : "Inbound ignore rule saved",
          description: "Future matching emails will be skipped before TEMP_INBOUND records are created.",
        });
      },
      onError: (error: Error) => {
        toast({ title: "Failed to save ignore rule", description: error.message, variant: "destructive" });
      },
    };
    if (editingRuleId) {
      updateRule.mutate({ ruleId: editingRuleId, ...payload }, mutationOptions);
    } else {
      createRule.mutate(payload, mutationOptions);
    }
  };

  const toggleRule = (ruleId: string, enabled: boolean) => {
    updateRule.mutate({ ruleId, enabled }, {
      onError: (error: Error) => {
        toast({ title: "Failed to update ignore rule", description: error.message, variant: "destructive" });
      },
    });
  };

  const removeRule = (ruleId: string, label: string) => {
    if (!window.confirm(`Delete inbound ignore rule for ${label}? Source emails and existing records will not be deleted.`)) return;
    deleteRule.mutate(ruleId, {
      onSuccess: () => {
        toast({ title: "Inbound ignore rule deleted", description: "Future email pulls will no longer use that rule." });
      },
      onError: (error: Error) => {
        toast({ title: "Failed to delete ignore rule", description: error.message, variant: "destructive" });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="h-5 w-5" />
          Inbound Ignore Rules
        </CardTitle>
        <CardDescription>
          Skip recurring non-order emails before they create TEMP_INBOUND review records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={resetForm} disabled={isMutating && !editingRuleId}>
            <Plus className="mr-2 h-4 w-4" />
            Add Ignore Rule
          </Button>
        </div>
        <form onSubmit={submitRule} className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={ruleType}
            onChange={(event) => setRuleType(event.target.value as InboundEmailIgnoreRuleTypeValue)}
            disabled={isMutating}
            aria-label="Ignore rule type"
          >
            {Object.entries(inboundIgnoreRuleTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Input
            value={ruleValue}
            onChange={(event) => setRuleValue(event.target.value)}
            placeholder="notifications@example.com, example.com, Payment Received..."
            disabled={isMutating}
          />
          <Button type="submit" disabled={isMutating || !ruleValue.trim()}>
            {editingRule ? <Edit className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
            {editingRule ? "Save Rule" : "Add Rule"}
          </Button>
          <label className="flex items-center gap-2 text-sm text-foreground md:col-span-3">
            <Switch checked={enabled} disabled={isMutating} onCheckedChange={setEnabled} aria-label="Ignore rule enabled" />
            Enabled
          </label>
          <Textarea
            className="md:col-span-3"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional notes"
            rows={2}
            disabled={isMutating}
          />
          {editingRule && (
            <div className="md:col-span-3">
              <Button type="button" size="sm" variant="ghost" onClick={resetForm} disabled={isMutating}>
                Cancel edit
              </Button>
            </div>
          )}
        </form>

        {rulesQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rulesQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to load inbound ignore rules.
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No inbound ignore rules are configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Enabled</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Usage</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <Switch
                        checked={rule.enabled}
                        disabled={isMutating}
                        onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                        aria-label={`Enable ignore rule ${rule.ruleValue}`}
                      />
                    </td>
                    <td className="px-4 py-3">{inboundIgnoreRuleTypeLabels[rule.ruleType]}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{rule.ruleValue}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>{rule.matchCount} match{rule.matchCount === 1 ? "" : "es"}</div>
                      <div className="text-xs">{rule.lastMatchedAt ? formatMailboxDate(rule.lastMatchedAt) : "Never matched"}</div>
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-muted-foreground">
                      <span className="block whitespace-normal break-words">{rule.notes || "-"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isMutating}
                          onClick={() => beginEdit(rule)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isMutating}
                          onClick={() => removeRule(rule.id, rule.ruleValue)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Available template variables
const QUOTE_VARIABLES = [
  { label: "Quote Number", value: "{quoteNumber}" },
  { label: "Company Name", value: "{companyName}" },
  { label: "Customer Name", value: "{customerName}" },
];

const INVOICE_VARIABLES = [
  { label: "Invoice Number", value: "{invoiceNumber}" },
  { label: "Company Name", value: "{companyName}" },
  { label: "Customer Name", value: "{customerName}" },
];

function EmailTemplatesCard() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("quote");

  // Fetch organization preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ["/api/organization/preferences"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/organization/preferences");
      return await response.json();
    },
  });

  const form = useForm<EmailTemplatesFormData>({
    resolver: zodResolver(emailTemplatesSchema),
    defaultValues: {
      replyToEmail: "",
      quoteEmailSubject: "Quote #{quoteNumber} from {companyName}",
      quoteEmailBody: "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
      invoiceEmailSubject: "Invoice #{invoiceNumber} from {companyName}",
      invoiceEmailBody: "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
    },
  });

  // Load existing templates when data arrives
  useEffect(() => {
    if (preferences?.emailTemplates) {
      form.reset({
        replyToEmail: preferences.emailTemplates.replyToEmail || "",
        quoteEmailSubject: preferences.emailTemplates.quoteEmailSubject || "Quote #{quoteNumber} from {companyName}",
        quoteEmailBody: preferences.emailTemplates.quoteEmailBody || "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
        invoiceEmailSubject: preferences.emailTemplates.invoiceEmailSubject || "Invoice #{invoiceNumber} from {companyName}",
        invoiceEmailBody: preferences.emailTemplates.invoiceEmailBody || "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
      });
    }
  }, [preferences, form]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: EmailTemplatesFormData) => {
      return apiRequest("PUT", "/api/organization/preferences", {
        emailTemplates: data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/preferences"] });
      toast({
        title: "Success",
        description: "Email templates saved successfully",
      });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save email templates",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EmailTemplatesFormData) => {
    saveMutation.mutate(data);
  };

  // Helper to insert variable into field at cursor position
  const insertVariable = (fieldName: keyof EmailTemplatesFormData, variable: string) => {
    const currentValue = form.getValues(fieldName) || "";
    const textarea = document.querySelector(`textarea[name="${fieldName}"]`) as HTMLTextAreaElement;
    const input = document.querySelector(`input[name="${fieldName}"]`) as HTMLInputElement;
    const element = textarea || input;
    
    if (element) {
      const start = element.selectionStart || currentValue.length;
      const end = element.selectionEnd || currentValue.length;
      const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
      form.setValue(fieldName, newValue);
      
      // Set cursor position after inserted variable
      setTimeout(() => {
        element.focus();
        element.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else {
      // Fallback: append to end
      form.setValue(fieldName, currentValue + variable);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Templates</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Email Templates
        </CardTitle>
        <CardDescription>
          Customize email content for quotes and invoices
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Reply-To Email */}
            <FormField
              control={form.control}
              name="replyToEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reply-To Email Address</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="replies@your-company.com"
                      disabled={!isEditing}
                    />
                  </FormControl>
                  <FormDescription>
                    Email address where customer replies will be sent (optional)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tabbed Templates */}
            <div className="border-t pt-4">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="quote">Quote Template</TabsTrigger>
                  <TabsTrigger value="invoice">Invoice Template</TabsTrigger>
                </TabsList>

                {/* Quote Template Tab */}
                <TabsContent value="quote" className="space-y-4 mt-4">
                  {/* Variable Buttons */}
                  {isEditing && (
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <p className="text-sm font-medium mb-2">Insert Variables:</p>
                      <div className="flex flex-wrap gap-2">
                        {QUOTE_VARIABLES.map((variable) => (
                          <Badge
                            key={variable.value}
                            variant="secondary"
                            className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                            onClick={() => {
                              const focusedElement = document.activeElement;
                              const fieldName = focusedElement?.getAttribute("name");
                              if (fieldName === "quoteEmailSubject" || fieldName === "quoteEmailBody") {
                                insertVariable(fieldName as keyof EmailTemplatesFormData, variable.value);
                              } else {
                                insertVariable("quoteEmailBody", variable.value);
                              }
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            {variable.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Click a variable to insert it at the cursor position
                      </p>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="quoteEmailSubject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject Line</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            name="quoteEmailSubject"
                            placeholder="Quote #{quoteNumber} from {companyName}"
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="quoteEmailBody"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Body</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            name="quoteEmailBody"
                            placeholder="Hello,&#10;&#10;Please find your quote #{quoteNumber} attached.&#10;&#10;Thank you for your business!"
                            rows={8}
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormDescription>
                          Plain text email body for quote emails
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                {/* Invoice Template Tab */}
                <TabsContent value="invoice" className="space-y-4 mt-4">
                  {/* Variable Buttons */}
                  {isEditing && (
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <p className="text-sm font-medium mb-2">Insert Variables:</p>
                      <div className="flex flex-wrap gap-2">
                        {INVOICE_VARIABLES.map((variable) => (
                          <Badge
                            key={variable.value}
                            variant="secondary"
                            className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                            onClick={() => {
                              const focusedElement = document.activeElement;
                              const fieldName = focusedElement?.getAttribute("name");
                              if (fieldName === "invoiceEmailSubject" || fieldName === "invoiceEmailBody") {
                                insertVariable(fieldName as keyof EmailTemplatesFormData, variable.value);
                              } else {
                                insertVariable("invoiceEmailBody", variable.value);
                              }
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            {variable.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Click a variable to insert it at the cursor position
                      </p>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="invoiceEmailSubject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject Line</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            name="invoiceEmailSubject"
                            placeholder="Invoice #{invoiceNumber} from {companyName}"
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="invoiceEmailBody"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Body</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            name="invoiceEmailBody"
                            placeholder="Hello,&#10;&#10;Please find your invoice #{invoiceNumber} attached.&#10;&#10;Thank you for your business!"
                            rows={8}
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormDescription>
                          Plain text email body for invoice emails
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              {isEditing ? (
                <>
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : "Save Templates"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      if (preferences?.emailTemplates) {
                        form.reset({
                          replyToEmail: preferences.emailTemplates.replyToEmail || "",
                          quoteEmailSubject: preferences.emailTemplates.quoteEmailSubject || "Quote #{quoteNumber} from {companyName}",
                          quoteEmailBody: preferences.emailTemplates.quoteEmailBody || "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
                          invoiceEmailSubject: preferences.emailTemplates.invoiceEmailSubject || "Invoice #{invoiceNumber} from {companyName}",
                          invoiceEmailBody: preferences.emailTemplates.invoiceEmailBody || "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
                        });
                      }
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => setIsEditing(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Templates
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function EmailSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Email Settings</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure email for sending invoices and quotes
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <InboundEmailIntakeControls />
          <InboundEmailMailboxSettingsCard />
          <InboundEmailIgnoreRulesCard />
          <EmailSettingsTab />
          <EmailTemplatesCard />
        </div>
      </div>
    </TitanCard>
  );
}

export default EmailSettings;
