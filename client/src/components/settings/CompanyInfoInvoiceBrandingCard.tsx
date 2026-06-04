import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ImageUp, Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Address = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

type RemittanceAddress = Address & {
  enabled?: boolean | null;
};

type CompanySettings = {
  id: string | null;
  companyDisplayName?: string | null;
  legalCompanyName?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  taxId?: string | null;
  physicalAddress?: Address | null;
  remittanceAddress?: RemittanceAddress | null;
  invoiceLogoUrl?: string | null;
  invoiceLogoAssetId?: string | null;
  invoicePaymentInstructions?: string | null;
  invoiceFooterNote?: string | null;
  checksPayableTo?: string | null;
};

const emptyAddress: Address = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
};

const emptySettings: CompanySettings = {
  id: null,
  companyDisplayName: "",
  legalCompanyName: "",
  phone: "",
  email: "",
  website: "",
  taxId: "",
  physicalAddress: emptyAddress,
  remittanceAddress: { ...emptyAddress, enabled: false },
  invoiceLogoUrl: "",
  invoiceLogoAssetId: "",
  invoicePaymentInstructions: "",
  invoiceFooterNote: "",
  checksPayableTo: "",
};

function normalizeAddress(address: Address | null | undefined): Address {
  return { ...emptyAddress, ...(address ?? {}) };
}

function normalizeSettings(settings: CompanySettings | null | undefined): CompanySettings {
  return {
    ...emptySettings,
    ...(settings ?? {}),
    physicalAddress: normalizeAddress(settings?.physicalAddress),
    remittanceAddress: {
      ...emptyAddress,
      ...(settings?.remittanceAddress ?? {}),
      enabled: settings?.remittanceAddress?.enabled === true,
    },
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function CompanyInfoInvoiceBrandingCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<CompanySettings>(emptySettings);

  const { data: settings, isLoading } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings"],
  });

  useEffect(() => {
    setDraft(normalizeSettings(settings));
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: CompanySettings) => {
      const payload = {
        companyDisplayName: data.companyDisplayName,
        legalCompanyName: data.legalCompanyName,
        phone: data.phone,
        email: data.email,
        website: data.website,
        taxId: data.taxId,
        physicalAddress: normalizeAddress(data.physicalAddress),
        remittanceAddress: {
          ...normalizeAddress(data.remittanceAddress),
          enabled: data.remittanceAddress?.enabled === true,
        },
        invoiceLogoUrl: data.invoiceLogoUrl,
        invoiceLogoAssetId: data.invoiceLogoAssetId,
        invoicePaymentInstructions: data.invoicePaymentInstructions,
        invoiceFooterNote: data.invoiceFooterNote,
        checksPayableTo: data.checksPayableTo,
      };
      const endpoint = data.id ? `/api/company-settings/${data.id}` : "/api/company-settings";
      const method = data.id ? "PATCH" : "POST";
      const response = await apiRequest(method, endpoint, payload);
      return response.json();
    },
    onSuccess: (saved) => {
      setDraft(normalizeSettings(saved));
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Company info saved", description: "Invoice branding settings are ready for generated invoices." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save company info", description: error.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!["image/png", "image/jpeg"].includes(file.type)) {
        throw new Error("Use a PNG or JPG logo.");
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new Error("Logo must be 2 MB or smaller.");
      }
      const dataBase64 = await fileToBase64(file);
      const response = await apiRequest("POST", "/api/company-settings/invoice-logo", {
        fileName: file.name,
        mimeType: file.type,
        dataBase64,
      });
      return response.json();
    },
    onSuccess: (uploaded) => {
      setDraft((current) => ({
        ...current,
        invoiceLogoUrl: uploaded.invoiceLogoUrl ?? uploaded.previewUrl ?? "",
        invoiceLogoAssetId: uploaded.invoiceLogoAssetId ?? uploaded.assetId ?? "",
      }));
      toast({ title: "Logo uploaded", description: "Save settings to use this logo on invoices." });
    },
    onError: (error: Error) => {
      toast({ title: "Logo upload failed", description: error.message, variant: "destructive" });
    },
  });

  const setField = <K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setAddressField = (scope: "physicalAddress" | "remittanceAddress", key: keyof Address, value: string) => {
    setDraft((current) => ({
      ...current,
      [scope]: {
        ...normalizeAddress(current[scope]),
        ...(scope === "remittanceAddress" ? { enabled: current.remittanceAddress?.enabled === true } : {}),
        [key]: value,
      },
    }));
  };

  const remittanceEnabled = draft.remittanceAddress?.enabled === true;
  const hasLogo = !!draft.invoiceLogoUrl;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Company Info & Branding
        </CardTitle>
        <CardDescription>
          Organization identity, logo, contact information, and invoice display details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading company info
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-base font-semibold">Company Info & Branding</h3>
              <p className="text-sm text-muted-foreground">
                These fields identify the organization on invoices and other generated documents.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-display-name">Display name</Label>
                <Input id="company-display-name" value={draft.companyDisplayName ?? ""} onChange={(event) => setField("companyDisplayName", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="legal-company-name">Legal name</Label>
                <Input id="legal-company-name" value={draft.legalCompanyName ?? ""} onChange={(event) => setField("legalCompanyName", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-phone">Phone</Label>
                <Input id="company-phone" value={draft.phone ?? ""} onChange={(event) => setField("phone", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-email">Email</Label>
                <Input id="company-email" type="email" value={draft.email ?? ""} onChange={(event) => setField("email", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-website">Website</Label>
                <Input id="company-website" value={draft.website ?? ""} onChange={(event) => setField("website", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-tax-id">Tax ID</Label>
                <Input id="company-tax-id" value={draft.taxId ?? ""} onChange={(event) => setField("taxId", event.target.value)} />
              </div>
            </div>

            <Separator />

            <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
              <div className="space-y-3">
                <Label>Invoice logo</Label>
                <div className="flex h-32 items-center justify-center rounded-md border bg-muted/30 p-3">
                  {hasLogo ? (
                    <img src={draft.invoiceLogoUrl ?? ""} alt="Invoice logo preview" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-sm text-muted-foreground">No logo selected</span>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadMutation.mutate(file);
                    event.currentTarget.value = "";
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                    {uploadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageUp className="mr-2 h-4 w-4" />}
                    {hasLogo ? "Replace" : "Upload"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!hasLogo}
                    onClick={() => setDraft((current) => ({ ...current, invoiceLogoUrl: "", invoiceLogoAssetId: "" }))}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Physical address</Label>
                  <Input value={draft.physicalAddress?.line1 ?? ""} placeholder="Line 1" onChange={(event) => setAddressField("physicalAddress", "line1", event.target.value)} />
                  <Input value={draft.physicalAddress?.line2 ?? ""} placeholder="Line 2" onChange={(event) => setAddressField("physicalAddress", "line2", event.target.value)} />
                </div>
                <Input value={draft.physicalAddress?.city ?? ""} placeholder="City" onChange={(event) => setAddressField("physicalAddress", "city", event.target.value)} />
                <Input value={draft.physicalAddress?.state ?? ""} placeholder="State" onChange={(event) => setAddressField("physicalAddress", "state", event.target.value)} />
                <Input value={draft.physicalAddress?.postalCode ?? ""} placeholder="Postal code" onChange={(event) => setAddressField("physicalAddress", "postalCode", event.target.value)} />
                <Input value={draft.physicalAddress?.country ?? ""} placeholder="Country" onChange={(event) => setAddressField("physicalAddress", "country", event.target.value)} />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">Invoice & Payment Details</h3>
                <p className="text-sm text-muted-foreground">
                  Payment mailing details and invoice-specific instructions shown on generated invoices.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label htmlFor="remittance-enabled">Use separate remittance address</Label>
                  <p className="text-xs text-muted-foreground">When off, invoices use the physical address for payment mailing display.</p>
                </div>
                <Switch
                  id="remittance-enabled"
                  checked={remittanceEnabled}
                  onCheckedChange={(enabled) => setDraft((current) => ({
                    ...current,
                    remittanceAddress: { ...normalizeAddress(current.remittanceAddress), enabled },
                  }))}
                />
              </div>

              {remittanceEnabled ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Send payments to</Label>
                    <Input value={draft.remittanceAddress?.line1 ?? ""} placeholder="Line 1" onChange={(event) => setAddressField("remittanceAddress", "line1", event.target.value)} />
                    <Input value={draft.remittanceAddress?.line2 ?? ""} placeholder="Line 2" onChange={(event) => setAddressField("remittanceAddress", "line2", event.target.value)} />
                  </div>
                  <Input value={draft.remittanceAddress?.city ?? ""} placeholder="City" onChange={(event) => setAddressField("remittanceAddress", "city", event.target.value)} />
                  <Input value={draft.remittanceAddress?.state ?? ""} placeholder="State" onChange={(event) => setAddressField("remittanceAddress", "state", event.target.value)} />
                  <Input value={draft.remittanceAddress?.postalCode ?? ""} placeholder="Postal code" onChange={(event) => setAddressField("remittanceAddress", "postalCode", event.target.value)} />
                  <Input value={draft.remittanceAddress?.country ?? ""} placeholder="Country" onChange={(event) => setAddressField("remittanceAddress", "country", event.target.value)} />
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="checks-payable-to">Checks payable to</Label>
                <Input id="checks-payable-to" value={draft.checksPayableTo ?? ""} onChange={(event) => setField("checksPayableTo", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-footer-note">Invoice footer note</Label>
                <Input id="invoice-footer-note" value={draft.invoiceFooterNote ?? ""} onChange={(event) => setField("invoiceFooterNote", event.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="invoice-payment-instructions">Payment instructions</Label>
                <Textarea
                  id="invoice-payment-instructions"
                  rows={3}
                  value={draft.invoicePaymentInstructions ?? ""}
                  onChange={(event) => setField("invoicePaymentInstructions", event.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Company Info
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
