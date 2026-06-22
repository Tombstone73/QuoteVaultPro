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
import { AlertTriangle, ChevronDown, ChevronRight, Edit, Mail, FileText, Plus, Inbox, PauseCircle, RefreshCw, Search, Trash2, Star } from "lucide-react";
import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import {
  useCreateInboundEmailIgnoreRule,
  useCreateInboundEmailTrustRule,
  useDeleteInboundEmailIgnoreRule,
  useDeleteInboundEmailTrustRule,
  useDeleteInboundEmailMailbox,
  useInboundEmailIgnoreRules,
  useInboundEmailTrustRules,
  useInboundEmailPullDiagnostics,
  useInboundEmailMailboxes,
  useSetDefaultInboundEmailMailbox,
  useStartInboundGmailMailboxOAuth,
  useUpdateInboundEmailIgnoreRule,
  useUpdateInboundEmailTrustRule,
  useUpdateInboundEmailMailboxEnabled,
  useUpdateInboundEmailMailboxSettings,
} from "@/hooks/useInboundEmailIntakeSettings";
import {
  defaultInboundEmailIntakeSettings,
  inboundEmailIntakeSettingsSchema,
  type InboundEmailIntakeSettings,
} from "@shared/inboundEmailIntakeSettings";
import type { InboundEmailIgnoreRuleTypeValue, InboundEmailTrustRuleTypeValue } from "@shared/inboundOrdersApi";

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

function CollapsibleSettingsCard({
  title,
  description,
  icon,
  defaultExpanded,
  summary,
  actions,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  defaultExpanded: boolean;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <CardTitle className="flex items-center gap-2">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {icon}
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
            {summary ? <div className="mt-2 text-sm text-muted-foreground">{summary}</div> : null}
          </button>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      {expanded ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

function ruleMatchesSearch(rule: {
  ruleType: string;
  ruleValue: string;
  notes?: string | null;
  matchCount?: number;
  lastMatchedAt?: string | null;
}, search: string): boolean {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return [
    rule.ruleType,
    rule.ruleValue,
    rule.notes,
    `${rule.matchCount ?? 0} matches`,
    rule.lastMatchedAt,
  ].some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

function InboundEmailMailboxSettingsCard() {
  const { toast } = useToast();
  const mailboxesQuery = useInboundEmailMailboxes();
  const updateEnabled = useUpdateInboundEmailMailboxEnabled();
  const updateMailboxSettings = useUpdateInboundEmailMailboxSettings();
  const setDefault = useSetDefaultInboundEmailMailbox();
  const deleteMailbox = useDeleteInboundEmailMailbox();
  const startGmailOAuth = useStartInboundGmailMailboxOAuth();
  const isMutating = updateEnabled.isPending || updateMailboxSettings.isPending || setDefault.isPending || deleteMailbox.isPending || startGmailOAuth.isPending;
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

  const handleSavePullSettings = (mailboxId: string, form: HTMLFormElement) => {
    const data = new FormData(form);
    const labelText = String(data.get("labelIds") ?? "").trim();
    updateMailboxSettings.mutate({
      mailboxId,
      settings: {
        lookbackDays: Number(data.get("lookbackDays") ?? 14),
        maxMessages: Number(data.get("maxMessages") ?? 50),
        gmailQuery: String(data.get("gmailQuery") ?? "").trim() || null,
        labelIds: labelText ? labelText.split(",").map((value) => value.trim()).filter(Boolean) : [],
      },
    }, {
      onSuccess: () => {
        toast({
          title: "Inbound pull settings saved",
          description: "Future manual pulls will use the updated Gmail list coverage settings.",
        });
      },
      onError: (error: Error) => {
        toast({
          title: "Failed to save pull settings",
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
    <CollapsibleSettingsCard
      title="Inbound Email Mailboxes"
      description="Dedicated inbound mailbox configuration for creating TEMP_INBOUND review records."
      icon={<Mail className="h-5 w-5" />}
      defaultExpanded
      summary={`${mailboxes.length} mailbox${mailboxes.length === 1 ? "" : "es"} configured`}
      actions={
          <Button
            type="button"
            variant="outline"
            disabled={isMutating}
            onClick={() => handleConnect()}
          >
            <Plus className="mr-2 h-4 w-4" />
            {startGmailOAuth.isPending ? "Connecting..." : "Connect Gmail Inbound Mailbox"}
          </Button>
      }
    >
        <p className="text-sm text-muted-foreground">
          This creates a dedicated inbound Gmail mailbox and does not use the outbound Gmail sending connection.
        </p>
      <div className="mt-4">
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
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Email Address</th>
                  <th className="px-4 py-3 font-medium">Pull Coverage</th>
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
                    <td className="w-[340px] px-4 py-3">
                      <form
                        className="grid gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleSavePullSettings(mailbox.id, event.currentTarget);
                        }}
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-muted-foreground">
                            Lookback days
                            <Input
                              name="lookbackDays"
                              type="number"
                              min={1}
                              max={365}
                              defaultValue={mailbox.settings.lookbackDays}
                              disabled={isMutating}
                              className="mt-1 h-8"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Max messages
                            <Input
                              name="maxMessages"
                              type="number"
                              min={1}
                              max={100}
                              defaultValue={mailbox.settings.maxMessages}
                              disabled={isMutating}
                              className="mt-1 h-8"
                            />
                          </label>
                        </div>
                        <label className="text-xs text-muted-foreground">
                          Gmail query override
                          <Input
                            name="gmailQuery"
                            defaultValue={mailbox.settings.gmailQuery ?? ""}
                            placeholder="Defaults to newer_than:{lookbackDays}d"
                            disabled={isMutating}
                            className="mt-1 h-8"
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Label IDs
                          <Input
                            name="labelIds"
                            defaultValue={mailbox.settings.labelIds.join(", ")}
                            placeholder="INBOX, CATEGORY_PRIMARY"
                            disabled={isMutating}
                            className="mt-1 h-8"
                          />
                        </label>
                        <Button type="submit" size="sm" variant="outline" disabled={isMutating} className="justify-self-start">
                          Save Pull Settings
                        </Button>
                      </form>
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
      </div>
    </CollapsibleSettingsCard>
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
  const [ruleSearch, setRuleSearch] = useState("");
  const rules = rulesQuery.data?.rules ?? [];
  const filteredRules = rules.filter((rule) => ruleMatchesSearch(rule, ruleSearch));
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
    <CollapsibleSettingsCard
      title="Inbound Ignore Rules"
      description="Skip recurring non-order emails before they create TEMP_INBOUND review records."
      icon={<Inbox className="h-5 w-5" />}
      defaultExpanded={rules.length <= 10}
      summary={`${rules.length} rule${rules.length === 1 ? "" : "s"} configured`}
    >
      <div className="space-y-4">
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
        <Input
          value={ruleSearch}
          onChange={(event) => setRuleSearch(event.target.value)}
          placeholder="Search ignore rules by type, value, notes, or usage"
          aria-label="Search inbound ignore rules"
        />

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
        ) : filteredRules.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No ignore rules match this search.
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
                {filteredRules.map((rule) => (
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
      </div>
    </CollapsibleSettingsCard>
  );
}

const inboundTrustRuleTypeLabels: Record<InboundEmailTrustRuleTypeValue, string> = {
  sender_email_exact: "Sender email",
  sender_domain: "Sender domain",
  customer_contact_email: "Customer contact email",
  customer_domain: "Customer domain",
};

function InboundEmailTrustRulesCard() {
  const { toast } = useToast();
  const rulesQuery = useInboundEmailTrustRules();
  const createRule = useCreateInboundEmailTrustRule();
  const updateRule = useUpdateInboundEmailTrustRule();
  const deleteRule = useDeleteInboundEmailTrustRule();
  const [ruleType, setRuleType] = useState<InboundEmailTrustRuleTypeValue>("sender_email_exact");
  const [ruleValue, setRuleValue] = useState("");
  const [notes, setNotes] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useState("");
  const rules = rulesQuery.data?.rules ?? [];
  const filteredRules = rules.filter((rule) => ruleMatchesSearch(rule, ruleSearch));
  const isMutating = createRule.isPending || updateRule.isPending || deleteRule.isPending;
  const editingRule = rules.find((rule) => rule.id === editingRuleId) ?? null;

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
    const normalizedValue = ruleValue.trim().toLowerCase();
    if (!normalizedValue) {
      toast({ title: "Trust rule value is required", description: "Enter a sender email, sender domain, customer email, or customer domain.", variant: "destructive" });
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
          title: editingRuleId ? "Trusted inbound sender updated" : "Trusted inbound sender saved",
          description: "Future pulls can auto-download allowed attachment types for matching trusted senders.",
        });
      },
      onError: (error: Error) => {
        toast({ title: "Failed to save trust rule", description: error.message, variant: "destructive" });
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
        toast({ title: "Failed to update trust rule", description: error.message, variant: "destructive" });
      },
    });
  };

  const removeRule = (ruleId: string, label: string) => {
    if (!window.confirm(`Delete inbound trust rule for ${label}? Existing TEMP_INBOUND records and files will remain.`)) return;
    deleteRule.mutate(ruleId, {
      onSuccess: () => {
        toast({ title: "Inbound trust rule deleted", description: "Future email pulls will no longer use that trust rule." });
      },
      onError: (error: Error) => {
        toast({ title: "Failed to delete trust rule", description: error.message, variant: "destructive" });
      },
    });
  };

  return (
    <CollapsibleSettingsCard
      title="Trusted Inbound Senders"
      description="Allow matching trusted senders to auto-download safe inbound attachment types. Blocked file types are still never downloaded."
      icon={<Star className="h-5 w-5" />}
      defaultExpanded={rules.length <= 10}
      summary={`${rules.length} trusted rule${rules.length === 1 ? "" : "s"} configured`}
    >
      <div className="space-y-4">
        <form onSubmit={submitRule} className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={ruleType}
            onChange={(event) => setRuleType(event.target.value as InboundEmailTrustRuleTypeValue)}
            disabled={isMutating}
            aria-label="Trust rule type"
          >
            {Object.entries(inboundTrustRuleTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Input
            value={ruleValue}
            onChange={(event) => setRuleValue(event.target.value)}
            placeholder="orders@example.com or example.com"
            disabled={isMutating}
          />
          <Button type="submit" disabled={isMutating || !ruleValue.trim()}>
            {editingRule ? <Edit className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
            {editingRule ? "Save Rule" : "Add Rule"}
          </Button>
          <label className="flex items-center gap-2 text-sm text-foreground md:col-span-3">
            <Switch checked={enabled} disabled={isMutating} onCheckedChange={setEnabled} aria-label="Trust rule enabled" />
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

        <Input
          value={ruleSearch}
          onChange={(event) => setRuleSearch(event.target.value)}
          placeholder="Search trusted senders by type, value, notes, or usage"
          aria-label="Search trusted inbound senders"
        />

        {rulesQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rulesQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to load inbound trust rules.
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No trusted inbound sender rules are configured yet.
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
            No trusted sender rules match this search.
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
                {filteredRules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <Switch
                        checked={rule.enabled}
                        disabled={isMutating}
                        onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                        aria-label={`Enable trust rule ${rule.ruleValue}`}
                      />
                    </td>
                    <td className="px-4 py-3">{inboundTrustRuleTypeLabels[rule.ruleType]}</td>
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
                        <Button type="button" size="sm" variant="ghost" disabled={isMutating} onClick={() => beginEdit(rule)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={isMutating} onClick={() => removeRule(rule.id, rule.ruleValue)}>
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
      </div>
    </CollapsibleSettingsCard>
  );
}

function formatDiagnosticValue(value: unknown): string {
  if (value == null || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatDiagnosticHints(value: unknown): string {
  if (!value || typeof value !== "object") return "No attachment hints detected";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key.replace(/^mentions|^has/, "").replace(/([A-Z])/g, " $1").trim());
  return entries.length > 0 ? entries.join(", ") : "No attachment hints detected";
}

function AttachmentPipelineDiagnostics({ record }: { record: Record<string, unknown> }) {
  const pipeline = (record.attachmentPipelineDiagnostics ?? {}) as Record<string, any>;
  const failures = Array.isArray(pipeline.failures) ? pipeline.failures : [];
  const safetyDecisions = Array.isArray(pipeline.safetyDecisions) ? pipeline.safetyDecisions : [];
  const ingestionCallEvents = Array.isArray(pipeline.ingestionCallEvents) ? pipeline.ingestionCallEvents : [];
  return (
    <div className="mt-2 rounded-md border border-border bg-background/70 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attachment Diagnostics</div>
      <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground md:grid-cols-6">
        <div>
          <div className="font-semibold text-foreground">Message</div>
          <div>Gmail parts: {formatDiagnosticValue(pipeline.gmailPartsDiscovered)}</div>
          <div>IDs: {Array.isArray(pipeline.attachmentIdsDiscovered) && pipeline.attachmentIdsDiscovered.length > 0 ? pipeline.attachmentIdsDiscovered.join(", ") : "-"}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Attachment Candidates</div>
          <div>{formatDiagnosticValue(pipeline.attachmentCandidatesDiscovered)}</div>
          <div>Attempted: {formatDiagnosticValue(pipeline.attachmentPartsAttempted)}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Downloaded</div>
          <div>Attempts: {formatDiagnosticValue(pipeline.downloadAttempts)}</div>
          <div>Successes: {formatDiagnosticValue(pipeline.downloadSuccesses)}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Stored</div>
          <div>{formatDiagnosticValue(pipeline.storedFileRowsCreated)}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Metadata Only</div>
          <div>{formatDiagnosticValue(pipeline.metadataOnlyRowsCreated)}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Failed</div>
          <div>{formatDiagnosticValue(pipeline.downloadFailures)}</div>
          <div>Skipped: {formatDiagnosticValue(pipeline.skippedExistingProviderAttachments)}</div>
        </div>
      </div>
      {pipeline.skippedReason ? (
        <div className="mt-2 text-[11px] text-muted-foreground">Skipped reason: {formatDiagnosticValue(pipeline.skippedReason)}</div>
      ) : null}
      <div className="mt-2 text-[11px] text-muted-foreground">
        Ingestion call: {formatDiagnosticValue(pipeline.ingestionCallStatus)}
        {pipeline.ingestionCallError ? ` / Error: ${formatDiagnosticValue(pipeline.ingestionCallError)}` : ""}
      </div>
      {ingestionCallEvents.length > 0 ? (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ingestion Call Audit</div>
          {ingestionCallEvents.map((event: Record<string, any>, index: number) => {
            const metadata = event.metadataJson && typeof event.metadataJson === "object" ? event.metadataJson as Record<string, unknown> : {};
            const providerIdentifierDiagnostics = Array.isArray(metadata.providerIdentifierColumnDiagnostics)
              ? metadata.providerIdentifierColumnDiagnostics as Array<Record<string, unknown>>
              : [];
            return (
              <div key={`${event.eventId ?? event.eventType ?? "call"}-${index}`} className="rounded border border-border/70 bg-muted/30 p-1.5 text-[11px] text-muted-foreground">
                <div className="font-medium text-foreground">{formatDiagnosticValue(event.eventType)}</div>
                <div>Message: {formatDiagnosticValue(metadata.providerMessageId)} / Subject: {formatDiagnosticValue(metadata.subject)}</div>
                <div>Candidates: {formatDiagnosticValue(metadata.candidateCount)} / Trust: {formatDiagnosticValue(metadata.trustStatus)}</div>
                <div>Policy: {formatDiagnosticValue(metadata.attachmentPolicy)}</div>
                {metadata.errorMessage ? <div>Error: {formatDiagnosticValue(metadata.errorMessage)}</div> : null}
                {providerIdentifierDiagnostics.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {providerIdentifierDiagnostics.map((diagnostic, diagnosticIndex) => (
                      <div key={diagnosticIndex}>
                        Column: {formatDiagnosticValue(diagnostic.table)}.{formatDiagnosticValue(diagnostic.column)}
                        {" / "}Type: {formatDiagnosticValue(diagnostic.currentType)}
                        {" / "}Length: {formatDiagnosticValue(diagnostic.actualStringLength)}
                        {" / "}Gmail field: {formatDiagnosticValue(diagnostic.originatingGmailField)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {safetyDecisions.length > 0 ? (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Safety Decisions</div>
          {safetyDecisions.map((decision: Record<string, unknown>, index: number) => (
            <div key={index} className="rounded border border-border/70 bg-muted/30 p-1.5 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground">{formatDiagnosticValue(decision.filename ?? decision.providerAttachmentId ?? `Attachment ${index + 1}`)}</div>
              <div>Trust: {formatDiagnosticValue(decision.trusted)} / Source: {formatDiagnosticValue(decision.trustSource)}</div>
              <div>Extension: {formatDiagnosticValue(decision.extension)} / Blocked: {formatDiagnosticValue(decision.blocked)}</div>
              <div>Download allowed: {formatDiagnosticValue(decision.downloadAllowed)} / State: {formatDiagnosticValue(decision.attachmentState)}</div>
              <div>Reason: {formatDiagnosticValue(decision.reason)}</div>
            </div>
          ))}
        </div>
      ) : null}
      {failures.length > 0 ? (
        <div className="mt-2 space-y-1">
          {failures.map((failure: Record<string, unknown>, index: number) => (
            <div key={index} className="rounded border border-border/70 bg-muted/30 p-1.5 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground">{formatDiagnosticValue(failure.filename ?? failure.providerAttachmentId ?? `Failure ${index + 1}`)}</div>
              <div>Reason: {formatDiagnosticValue(failure.failureReason)}</div>
              {failure.gmailApiError ? <div>Gmail API error: {formatDiagnosticValue(failure.gmailApiError)}</div> : null}
              {failure.storageError ? <div>Storage error: {formatDiagnosticValue(failure.storageError)}</div> : null}
              {failure.unsupportedMimeReason ? <div>Unsupported MIME reason: {formatDiagnosticValue(failure.unsupportedMimeReason)}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GmailPayloadPartTree({ part, depth = 0 }: { part: Record<string, any>; depth?: number }) {
  const children = Array.isArray(part.childParts) ? part.childParts : [];
  return (
    <div className="rounded border border-border/70 bg-background/70 p-2 text-[11px] text-muted-foreground" style={{ marginLeft: depth ? 12 : 0 }}>
      <div className="font-medium text-foreground">
        {formatDiagnosticValue(part.partId ?? "root")} / {formatDiagnosticValue(part.mimeType)}
      </div>
      <div className="mt-1 grid gap-1 md:grid-cols-2">
        <div>Filename present: {formatDiagnosticValue(part.filenamePresent)}</div>
        <div>Filename: {formatDiagnosticValue(part.filename)}</div>
        <div>Attachment ID present: {formatDiagnosticValue(part.attachmentIdPresent)}</div>
        <div>Body size: {formatDiagnosticValue(part.bodySize)}</div>
        <div>Content-Type: {formatDiagnosticValue(part.headers?.contentType)}</div>
        <div>Content-Disposition: {formatDiagnosticValue(part.headers?.contentDisposition)}</div>
        <div>Content-ID: {formatDiagnosticValue(part.headers?.contentId)}</div>
      </div>
      {children.length > 0 ? (
        <div className="mt-2 space-y-2">
          {children.map((child: Record<string, any>, index: number) => (
            <GmailPayloadPartTree key={`${child.partId ?? "part"}-${index}`} part={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GmailPayloadDiagnosticsPanel({ diagnostics }: { diagnostics: Array<Record<string, unknown>> }) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="mt-4 rounded-md border border-border p-3">
      <h5 className="text-sm font-semibold text-foreground">Sanitized Gmail Payload Shape</h5>
      <div className="mt-2 space-y-3">
        {diagnostics.map((item, index) => {
          const payloadTree = item.payloadTree as Record<string, any> | null | undefined;
          return (
            <div key={`${formatDiagnosticValue(item.inboundRecordId)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
              <div className="font-medium text-foreground">{formatDiagnosticValue(item.subject ?? item.sourceMessageId)}</div>
              <div className="mt-1 text-muted-foreground">
                Message: {formatDiagnosticValue(item.sourceMessageId)} / Extracted attachments: {formatDiagnosticValue(item.extractedAttachmentCount)}
              </div>
              {item.diagnosticError ? (
                <div className="mt-2 text-destructive">{formatDiagnosticValue(item.diagnosticError)}</div>
              ) : payloadTree ? (
                <div className="mt-2">
                  <GmailPayloadPartTree part={payloadTree} />
                </div>
              ) : (
                <div className="mt-2 text-muted-foreground">No Gmail payload tree returned.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GmailProcessingOutcomeList({
  title,
  messages,
  emptyText,
}: {
  title: string;
  messages: Array<Record<string, unknown>>;
  emptyText: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="mt-2 space-y-2">
        {messages.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        ) : messages.map((message, index) => (
          <div key={`${formatDiagnosticValue(message.providerMessageId)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
            <div className="font-medium text-foreground">{formatDiagnosticValue(message.displaySubject ?? message.subject)}</div>
            <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-2">
              <div>Outcome: {formatDiagnosticValue(message.processingOutcome)}</div>
              <div>Reason: {formatDiagnosticValue(message.reason)}</div>
              <div>Classification: {formatDiagnosticValue(message.classificationOutcome)}</div>
              <div>Classification reason: {formatDiagnosticValue(message.classificationReason)}</div>
              <div className="md:col-span-2">CRM influence: {formatDiagnosticValue(message.crmInfluence)}</div>
              <div>Sender: {formatDiagnosticValue(message.senderEmail)}</div>
              <div>Received: {formatDiagnosticValue(message.receivedAt)}</div>
              <div>Message: {formatDiagnosticValue(message.providerMessageId)}</div>
              <div>Thread: {formatDiagnosticValue(message.threadId)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmailPullDiagnosticsPanel() {
  const [subjectInput, setSubjectInput] = useState("");
  const [subject, setSubject] = useState("");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [ignoreRulesExpanded, setIgnoreRulesExpanded] = useState(false);
  const diagnosticsQuery = useInboundEmailPullDiagnostics(subject);
  const diagnostics = diagnosticsQuery.data;
  const collapseIgnoreRulesByDefault = (diagnostics?.activeIgnoreRules.length ?? 0) > 3;

  useEffect(() => {
    if (diagnostics) setIgnoreRulesExpanded(!collapseIgnoreRulesByDefault);
  }, [collapseIgnoreRulesByDefault, diagnostics?.generatedAt]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubject(subjectInput.trim());
  };

  const clearSearch = () => {
    setSubjectInput("");
    setSubject("");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Email Pull Diagnostics
            </CardTitle>
            <CardDescription>
              Read-only visibility into the last inbound Gmail pull and recent TEMP_INBOUND email artifacts.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDetailsExpanded((value) => !value)}
              aria-expanded={detailsExpanded}
            >
              {detailsExpanded ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
              {detailsExpanded ? "Collapse Details" : "Expand Details"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={diagnosticsQuery.isFetching}
              onClick={() => diagnosticsQuery.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {diagnosticsQuery.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : diagnosticsQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to load email pull diagnostics.
          </div>
        ) : diagnostics ? (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Enabled Mailboxes</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{diagnostics.enabledMailboxCount}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Ignore Rules</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{diagnostics.ignoreRuleCount}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent Records</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{diagnostics.recentCreatedInboundRecords.length}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent Files</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{diagnostics.recentInboundFiles.length}</div>
              </div>
            </div>

            {diagnostics.mailboxes.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                No inbound mailboxes are configured for this organization.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Mailbox</th>
                      <th className="px-4 py-3 font-medium">Enabled</th>
                      <th className="px-4 py-3 font-medium">Last Pull</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Last Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.mailboxes.map((mailbox) => (
                      <tr key={mailbox.id} className="border-t border-border align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{mailbox.emailAddress}</div>
                          <div className="text-xs text-muted-foreground">{mailbox.name}</div>
                        </td>
                        <td className="px-4 py-3">{mailbox.enabled ? "Yes" : "No"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatMailboxDate(mailbox.lastPulledAt)}</td>
                        <td className="px-4 py-3">{mailbox.lastPullStatus || "None"}</td>
                        <td className="max-w-[320px] px-4 py-3 text-muted-foreground">
                          <span className="block whitespace-normal break-words">{mailbox.lastPullError || "None"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detailsExpanded && (
              <form onSubmit={submitSearch} className="flex flex-col gap-2 md:flex-row">
                <Input
                  value={subjectInput}
                  onChange={(event) => setSubjectInput(event.target.value)}
                  placeholder="Search subject, sender, domain, message id, thread id, body snippet, or no subject"
                  aria-label="Email diagnostics subject search"
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={diagnosticsQuery.isFetching}>
                    <Search className="mr-2 h-4 w-4" />
                    Search
                  </Button>
                  {subject && (
                    <Button type="button" variant="ghost" onClick={clearSearch} disabled={diagnosticsQuery.isFetching}>
                      Clear
                    </Button>
                  )}
                </div>
              </form>
            )}

            {detailsExpanded && diagnostics.subjectSearch.provided && (
              <div className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">Subject Search</h4>
                  <Badge variant={diagnostics.subjectSearch.found ? "secondary" : "outline"}>
                    {diagnostics.subjectSearch.found ? "Found" : "Not found"}
                  </Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{diagnostics.subject}</div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matching Records</div>
                    <div className="mt-2 space-y-2">
                      {diagnostics.subjectSearch.matchingRecords.length === 0 ? (
                        <div className="text-sm text-muted-foreground">None</div>
                      ) : diagnostics.subjectSearch.matchingRecords.map((record, index) => (
                        <div key={`${formatDiagnosticValue(record.id)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                          <div className="font-medium text-foreground">{formatDiagnosticValue(record.subject ?? record.externalReference ?? record.id)}</div>
                          <div className="text-muted-foreground">
                            {formatDiagnosticValue(record.status)} / {formatDiagnosticValue(record.reviewOutcome)}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Files: {formatDiagnosticValue(record.attachmentCount)} / Raw Gmail parts: {formatDiagnosticValue((record.rawGmailPayloadAttachmentIndicators as any)?.rawAttachmentCount)}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Trust: {formatDiagnosticValue(record.senderTrustStatus)} / Policy: {formatDiagnosticValue(record.attachmentDownloadPolicy)}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Message: {formatDiagnosticValue(record.sourceMessageId)} / Thread: {formatDiagnosticValue(record.sourceThreadId)}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Hints: {formatDiagnosticHints(record.attachmentHints)}
                          </div>
                          <AttachmentPipelineDiagnostics record={record} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matching Files</div>
                    <div className="mt-2 space-y-2">
                      {diagnostics.subjectSearch.matchingFiles.length === 0 ? (
                        <div className="text-sm text-muted-foreground">None</div>
                      ) : diagnostics.subjectSearch.matchingFiles.map((file, index) => (
                        <div key={`${formatDiagnosticValue(file.id)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                          <div className="font-medium text-foreground">{formatDiagnosticValue(file.sourceFilename ?? file.id)}</div>
                          <div className="text-muted-foreground">{formatDiagnosticValue(file.role)} / {formatDiagnosticValue(file.status)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matching Ignore Rules</div>
                    <div className="mt-2 space-y-2">
                      {diagnostics.subjectSearch.matchingIgnoreRules.length === 0 ? (
                        <div className="text-sm text-muted-foreground">None</div>
                      ) : diagnostics.subjectSearch.matchingIgnoreRules.map((rule, index) => (
                        <div key={`${formatDiagnosticValue(rule.id)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                          <div className="font-medium text-foreground">{formatDiagnosticValue(rule.ruleType)}</div>
                          <div className="text-muted-foreground">{formatDiagnosticValue(rule.ruleValuePreview)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matching Gmail Listed Messages</div>
                  {diagnostics.subjectSearch.gmailListMessage ? (
                    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800">
                      {diagnostics.subjectSearch.gmailListMessage}
                    </div>
                  ) : null}
                  <div className="mt-2 space-y-2">
                    {diagnostics.subjectSearch.matchingGmailListedMessages.length === 0 ? (
                      <div className="text-sm text-muted-foreground">None</div>
                    ) : diagnostics.subjectSearch.matchingGmailListedMessages.map((message, index) => (
                      <div key={`${formatDiagnosticValue(message.providerMessageId)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                        <div className="font-medium text-foreground">{formatDiagnosticValue(message.displaySubject ?? message.subject)}</div>
                        <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-2">
                          <div>Outcome: {formatDiagnosticValue(message.processingOutcome)}</div>
                          <div>Reason: {formatDiagnosticValue(message.reason)}</div>
                          <div>Classification: {formatDiagnosticValue(message.classificationOutcome)}</div>
                          <div>Classification reason: {formatDiagnosticValue(message.classificationReason)}</div>
                          <div className="md:col-span-2">CRM influence: {formatDiagnosticValue(message.crmInfluence)}</div>
                          <div>Sender: {formatDiagnosticValue(message.senderName)} &lt;{formatDiagnosticValue(message.senderEmail)}&gt;</div>
                          <div>Received: {formatDiagnosticValue(message.receivedAt)}</div>
                          <div>Mailbox: {formatDiagnosticValue(message.mailboxEmail)}</div>
                          <div>Query: {formatDiagnosticValue(message.query)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <GmailProcessingOutcomeList
                    title="Matching Processed Messages"
                    messages={diagnostics.subjectSearch.matchingProcessedMessages ?? []}
                    emptyText="No matching processed-message outcomes."
                  />
                  <GmailProcessingOutcomeList
                    title="Matching Skipped Messages"
                    messages={diagnostics.subjectSearch.matchingSkippedMessages ?? []}
                    emptyText="No matching skipped-message outcomes."
                  />
                  <GmailProcessingOutcomeList
                    title="Matching Ignored Messages"
                    messages={diagnostics.subjectSearch.matchingIgnoredMessages ?? []}
                    emptyText="No matching ignored-message outcomes."
                  />
                  <GmailProcessingOutcomeList
                    title="Matching Failed Messages"
                    messages={diagnostics.subjectSearch.matchingFailedMessages ?? []}
                    emptyText="No matching failed-message outcomes."
                  />
                </div>
                <GmailPayloadDiagnosticsPanel diagnostics={diagnostics.subjectSearch.gmailPayloadDiagnostics ?? []} />
              </div>
            )}

            {detailsExpanded && <div className="rounded-md border border-border p-3">
              <h4 className="text-sm font-semibold text-foreground">Recent Gmail Listed Messages</h4>
              <div className="mt-2 space-y-2">
                {diagnostics.recentGmailListedMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No recent Gmail list diagnostics found.</div>
                ) : diagnostics.recentGmailListedMessages.map((message, index) => (
                  <div key={`${formatDiagnosticValue(message.providerMessageId)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                    <div className="font-medium text-foreground">{formatDiagnosticValue(message.displaySubject ?? message.subject)}</div>
                    <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-2">
                      <div>Outcome: {formatDiagnosticValue(message.processingOutcome)}</div>
                      <div>Reason: {formatDiagnosticValue(message.reason)}</div>
                      <div>Classification: {formatDiagnosticValue(message.classificationOutcome)}</div>
                      <div>Classification reason: {formatDiagnosticValue(message.classificationReason)}</div>
                      <div className="md:col-span-2">CRM influence: {formatDiagnosticValue(message.crmInfluence)}</div>
                      <div>Sender: {formatDiagnosticValue(message.senderName)} &lt;{formatDiagnosticValue(message.senderEmail)}&gt;</div>
                      <div>Received: {formatDiagnosticValue(message.receivedAt)}</div>
                      <div>Message: {formatDiagnosticValue(message.providerMessageId)}</div>
                      <div>Thread: {formatDiagnosticValue(message.threadId)}</div>
                      <div>Mailbox: {formatDiagnosticValue(message.mailboxEmail)}</div>
                      <div>Query: {formatDiagnosticValue(message.query)}</div>
                      <div>Labels: {formatDiagnosticValue(message.labelIds)}</div>
                      <div>Pages: {formatDiagnosticValue(message.pageCount)} / Total listed: {formatDiagnosticValue(message.totalMessageIdsReturned)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>}

            {detailsExpanded && <div className="grid gap-4 xl:grid-cols-2">
              <GmailProcessingOutcomeList
                title="Recent Gmail Processed Messages"
                messages={diagnostics.recentGmailProcessedMessages ?? []}
                emptyText="No recent processed-message outcomes found."
              />
              <GmailProcessingOutcomeList
                title="Recent Gmail Skipped Messages"
                messages={diagnostics.recentGmailSkippedMessages ?? []}
                emptyText="No recent skipped-message outcomes found."
              />
              <GmailProcessingOutcomeList
                title="Recent Gmail Ignored Messages"
                messages={diagnostics.recentGmailIgnoredMessages ?? []}
                emptyText="No recent ignored-message outcomes found."
              />
              <GmailProcessingOutcomeList
                title="Recent Gmail Failed Messages"
                messages={diagnostics.recentGmailFailedMessages ?? []}
                emptyText="No recent failed-message outcomes found."
              />
            </div>}

            {detailsExpanded && <div className="rounded-md border border-border p-3">
              <h4 className="text-sm font-semibold text-foreground">Recent Email Records</h4>
              <div className="mt-2 space-y-2">
                {diagnostics.recentCreatedInboundRecords.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No recent email records found.</div>
                ) : diagnostics.recentCreatedInboundRecords.map((record, index) => (
                  <div key={`${formatDiagnosticValue(record.id)}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                    <div className="font-medium text-foreground">{formatDiagnosticValue(record.subject ?? record.externalReference ?? record.id)}</div>
                    <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-2">
                      <div>Sender: {formatDiagnosticValue(record.senderName)} &lt;{formatDiagnosticValue(record.senderEmail)}&gt;</div>
                      <div>Received: {formatDiagnosticValue(record.receivedAt)}</div>
                      <div>Message: {formatDiagnosticValue(record.sourceMessageId)}</div>
                      <div>Thread: {formatDiagnosticValue(record.sourceThreadId)}</div>
                      <div>Files: {formatDiagnosticValue(record.attachmentCount)}</div>
                      <div>Raw Gmail parts: {formatDiagnosticValue((record.rawGmailPayloadAttachmentIndicators as any)?.rawAttachmentCount)}</div>
                      <div>Trust: {formatDiagnosticValue(record.senderTrustStatus)}</div>
                      <div>Policy: {formatDiagnosticValue(record.attachmentDownloadPolicy)}</div>
                      <div>Status: {formatDiagnosticValue(record.status)}</div>
                      <div>Hints: {formatDiagnosticHints(record.attachmentHints)}</div>
                    </div>
                    <AttachmentPipelineDiagnostics record={record} />
                  </div>
                ))}
              </div>
            </div>}

            {detailsExpanded && <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <h4 className="text-sm font-semibold text-foreground">Recent Pull Diagnostics</h4>
                <div className="mt-2 space-y-2">
                  {[...diagnostics.recentPullMessageDiagnostics, ...diagnostics.recentFailedMessageDiagnostics].length === 0 ? (
                    <div className="text-sm text-muted-foreground">No durable pull diagnostics found.</div>
                  ) : [...diagnostics.recentPullMessageDiagnostics, ...diagnostics.recentFailedMessageDiagnostics].map((item, index) => (
                    <div key={index} className="rounded-md bg-muted/30 p-2 text-xs">
                      <div className="font-medium text-foreground">{formatDiagnosticValue(item.message ?? item.eventType ?? item.id)}</div>
                      <div className="text-muted-foreground">{formatDiagnosticValue(item.createdAt)}</div>
                      {item.metadataJson ? (
                        <div className="mt-1 text-muted-foreground">
                          {formatDiagnosticValue(item.metadataJson)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-border p-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setIgnoreRulesExpanded((value) => !value)}
                  aria-expanded={ignoreRulesExpanded}
                >
                  <h4 className="text-sm font-semibold text-foreground">Active Ignore Rules</h4>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {diagnostics.activeIgnoreRules.length}
                    {ignoreRulesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </button>
                {!ignoreRulesExpanded ? (
                  <div className="mt-2 text-sm text-muted-foreground">
                    {diagnostics.activeIgnoreRules.length} active ignore rules hidden.
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {diagnostics.activeIgnoreRules.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No active ignore rules.</div>
                    ) : diagnostics.activeIgnoreRules.map((rule) => (
                    <div key={rule.id} className="rounded-md bg-muted/30 p-2 text-xs">
                      <div className="font-medium text-foreground">{rule.ruleType}</div>
                      <div className="text-muted-foreground">{rule.ruleValuePreview}</div>
                    </div>
                    ))}
                  </div>
                )}
              </div>
            </div>}
          </div>
        ) : null}
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
          <InboundEmailTrustRulesCard />
          <EmailPullDiagnosticsPanel />
          <EmailSettingsTab />
          <EmailTemplatesCard />
        </div>
      </div>
    </TitanCard>
  );
}

export default EmailSettings;
