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
import { useState, useEffect } from "react";
import {
  useDeleteInboundEmailMailbox,
  useInboundEmailMailboxes,
  useSetDefaultInboundEmailMailbox,
  useStartInboundGmailMailboxOAuth,
  useUpdateInboundEmailMailboxEnabled,
} from "@/hooks/useInboundEmailIntakeSettings";
import {
  defaultInboundEmailIntakeSettings,
  inboundEmailIntakeSettingsSchema,
  type InboundEmailIntakeSettings,
} from "@shared/inboundEmailIntakeSettings";

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
          <EmailSettingsTab />
          <EmailTemplatesCard />
        </div>
      </div>
    </TitanCard>
  );
}

export default EmailSettings;
