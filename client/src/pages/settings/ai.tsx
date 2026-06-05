import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { AiCapabilitiesDto, AiMode, AiProvider, SafeAiSettingsDto } from "@shared/aiFoundationContracts";

export type AiSettingsDraft = {
  mode: AiMode;
  provider: AiProvider | "none";
  model: string;
  apiKey: string;
  bugReviewEnabled: boolean;
  triageBriefEnabled: boolean;
  featureReviewEnabled: boolean;
  duplicateDetectionEnabled: boolean;
  orderParsingEnabled: boolean;
  monthlyUsageLimit: string;
};

async function fetchAiSettings(): Promise<SafeAiSettingsDto> {
  const response = await fetch("/api/ai/settings", { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to load AI settings");
  }
  const body = await response.json();
  return body.data as SafeAiSettingsDto;
}

async function fetchAiCapabilities(): Promise<AiCapabilitiesDto> {
  const response = await fetch("/api/ai/capabilities", { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to load AI capabilities");
  }
  const body = await response.json();
  return body.data as AiCapabilitiesDto;
}

export function buildAiSettingsPayload(draft: AiSettingsDraft) {
  return {
    mode: draft.mode,
    provider: draft.provider === "none" ? null : draft.provider,
    model: draft.model.trim() || null,
    apiKey: draft.apiKey.trim() || undefined,
    isEnabled: draft.mode !== "disabled",
    bugReviewEnabled: draft.mode !== "disabled" && draft.bugReviewEnabled,
    triageBriefEnabled: draft.mode !== "disabled" && draft.triageBriefEnabled,
    featureReviewEnabled: draft.mode !== "disabled" && draft.featureReviewEnabled,
    duplicateDetectionEnabled: draft.mode !== "disabled" && draft.duplicateDetectionEnabled,
    orderParsingEnabled: draft.mode !== "disabled" && draft.orderParsingEnabled,
    monthlyUsageLimit: draft.monthlyUsageLimit.trim() ? Number(draft.monthlyUsageLimit) : null,
  };
}

async function saveAiSettings(draft: AiSettingsDraft): Promise<SafeAiSettingsDto> {
  const payload = buildAiSettingsPayload(draft);

  const response = await fetch("/api/ai/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to save AI settings");
  }
  const body = await response.json();
  return body.data as SafeAiSettingsDto;
}

function draftFromSettings(settings: SafeAiSettingsDto | undefined): AiSettingsDraft {
  return {
    mode: settings?.mode ?? "disabled",
    provider: settings?.provider ?? "none",
    model: settings?.model ?? "",
    apiKey: "",
    bugReviewEnabled: settings?.features.bugReview ?? false,
    triageBriefEnabled: settings?.features.triageBrief ?? false,
    featureReviewEnabled: settings?.features.featureReview ?? false,
    duplicateDetectionEnabled: settings?.features.duplicateDetection ?? false,
    orderParsingEnabled: settings?.features.orderParsing ?? false,
    monthlyUsageLimit: settings?.monthlyUsageLimit == null ? "" : String(settings.monthlyUsageLimit),
  };
}

export default function AiSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["/api/ai/settings"], queryFn: fetchAiSettings });
  const capabilitiesQuery = useQuery({ queryKey: ["/api/ai/capabilities"], queryFn: fetchAiCapabilities });
  const [draft, setDraft] = React.useState<AiSettingsDraft>(() => draftFromSettings(undefined));

  React.useEffect(() => {
    setDraft(draftFromSettings(settingsQuery.data));
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveAiSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/capabilities"] });
      setDraft((current) => ({ ...current, apiKey: "" }));
      toast({ title: "AI settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save AI settings", description: error.message, variant: "destructive" });
    },
  });

  const settings = settingsQuery.data;
  const capabilities = capabilitiesQuery.data;
  const disabled = draft.mode === "disabled" || saveMutation.isPending;
  const byok = draft.mode === "bring_your_own";

  if (settingsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading AI settings...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" />
            AI Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={capabilities?.enabled ? "default" : "secondary"}>
              {capabilities?.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Badge variant="outline">{draft.mode.replace(/_/g, " ")}</Badge>
            {settings?.hasApiKey ? <Badge variant="outline">BYOK key saved</Badge> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={draft.mode}
                onValueChange={(mode) => setDraft((current) => ({ ...current, mode: mode as AiMode }))}
                disabled={saveMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="printershero_managed">Printers Hero Managed AI</SelectItem>
                  <SelectItem value="bring_your_own">Bring Your Own AI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={draft.provider}
                onValueChange={(provider) => setDraft((current) => ({ ...current, provider: provider as AiSettingsDraft["provider"] }))}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="future">Future provider</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={draft.model}
                onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                placeholder="Provider model name"
                disabled={disabled}
              />
            </div>
          </div>

          {byok ? (
            <div className="rounded-md border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                <div>
                  <p className="text-sm font-medium">Encrypted API Key</p>
                  <p className="text-xs text-muted-foreground">
                    Secrets are encrypted at rest and are never shown after saving.
                  </p>
                </div>
              </div>
              <Input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={settings?.hasApiKey ? "Saved key retained unless replaced" : "Paste provider API key"}
                disabled={saveMutation.isPending}
              />
            </div>
          ) : null}

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Feature Toggles</h3>
              <p className="text-xs text-muted-foreground">Enable AI capabilities that are available to this organization.</p>
            </div>
            <FeatureToggle
              label="Bug Review"
              checked={draft.bugReviewEnabled}
              disabled={disabled}
              onChange={(checked) => setDraft((current) => ({ ...current, bugReviewEnabled: checked }))}
            />
            <FeatureToggle
              label="AI Triage Brief"
              checked={draft.triageBriefEnabled}
              disabled={disabled}
              onChange={(checked) => setDraft((current) => ({ ...current, triageBriefEnabled: checked }))}
            />
            <FeatureToggle
              label="Product Planning / Feature Review"
              checked={draft.featureReviewEnabled}
              disabled={disabled}
              onChange={(checked) => setDraft((current) => ({ ...current, featureReviewEnabled: checked }))}
            />
            <FeatureToggle
              label="Duplicate Detection"
              checked={draft.duplicateDetectionEnabled}
              disabled={disabled}
              onChange={(checked) => setDraft((current) => ({ ...current, duplicateDetectionEnabled: checked }))}
            />
            <FeatureToggle
              label="Order Parsing"
              checked={draft.orderParsingEnabled}
              disabled={disabled}
              onChange={(checked) => setDraft((current) => ({ ...current, orderParsingEnabled: checked }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Monthly usage limit</Label>
              <Input
                type="number"
                min={1}
                value={draft.monthlyUsageLimit}
                onChange={(event) => setDraft((current) => ({ ...current, monthlyUsageLimit: event.target.value }))}
                placeholder="No limit"
                disabled={saveMutation.isPending}
              />
            </div>
            <div className="rounded-md border border-border p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4" />
                Capability Status
              </div>
              <p className="mt-2 text-muted-foreground">
                Bug review: {capabilities?.permissions.canRunBugReview ? "available to owner/admin users" : "not available"}
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => saveMutation.mutate(draft)}
            disabled={saveMutation.isPending}
            className="gap-2"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save AI Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureToggle({ label, checked, disabled, onChange }: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <Label className="text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
