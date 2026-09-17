import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MAX_SALES_TAX_RATE, formatTaxRatePercent, taxRateDecimalFromPercent } from "@shared/salesTax";

type SalesTaxSettings = { taxEnabled: boolean; defaultTaxRate: number };

const emptySettings: SalesTaxSettings = { taxEnabled: true, defaultTaxRate: 0 };

export function SalesTaxSettingsCard() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [ratePercent, setRatePercent] = useState("0.00");
  const role = String(user?.role ?? "").toLowerCase();
  const canManage = isAdmin || role === "owner" || role === "admin";

  const { data, isLoading } = useQuery<SalesTaxSettings>({
    queryKey: ["/api/organization/tax-settings"],
    enabled: canManage,
  });

  useEffect(() => {
    const settings = data ?? emptySettings;
    setTaxEnabled(settings.taxEnabled !== false);
    setRatePercent(formatTaxRatePercent(settings.defaultTaxRate));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedPercent = Number(ratePercent);
      if (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > MAX_SALES_TAX_RATE * 100) {
        throw new Error("Default sales tax rate must be between 0 and 30%.");
      }
      const response = await apiRequest("PATCH", "/api/organization/tax-settings", {
        taxEnabled,
        defaultTaxRate: taxRateDecimalFromPercent(parsedPercent),
      });
      return response.json() as Promise<SalesTaxSettings>;
    },
    onSuccess: (saved) => {
      setTaxEnabled(saved.taxEnabled !== false);
      setRatePercent(formatTaxRatePercent(saved.defaultTaxRate));
      queryClient.setQueryData(["/api/organization/tax-settings"], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/organization/current"] });
      toast({ title: "Sales tax settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save sales tax settings", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card id="sales-tax" tabIndex={-1}>
      <CardHeader>
        <CardTitle>Sales Tax</CardTitle>
        <CardDescription>Configure the organization default used for taxable customer work.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="sales-tax-enabled">Enable sales tax</Label>
            <p className="mt-1 text-sm text-muted-foreground">Calculate tax for taxable products on new or repriced work.</p>
          </div>
          <Switch id="sales-tax-enabled" checked={taxEnabled} onCheckedChange={setTaxEnabled} disabled={!canManage || isLoading} />
        </div>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="default-sales-tax-rate">Default sales tax rate (%)</Label>
          <Input
            id="default-sales-tax-rate"
            type="number"
            inputMode="decimal"
            min="0"
            max="30"
            step="0.01"
            value={ratePercent}
            onChange={(event) => setRatePercent(event.target.value)}
            disabled={!canManage || isLoading}
          />
          <p className="text-sm text-muted-foreground">Used for taxable customers unless a customer or document-specific tax setting overrides it.</p>
        </div>
        {canManage && (
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}>
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save sales tax settings
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
