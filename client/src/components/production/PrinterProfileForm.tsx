import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PrinterProfile,
  PrinterProfileInput,
  useCreatePrinterProfile,
  useUpdatePrinterProfile,
} from "@/hooks/usePrinterProfiles";

export const PRINTER_TYPE_LABELS: Record<PrinterProfileInput["printerType"], string> = {
  production_ticket: "Production Ticket",
  shipping_label: "Shipping Label",
  office_document: "Office Document",
  other: "Other",
};

type Props = {
  profile?: PrinterProfile | null;
  onSaved?: () => void;
  onCancel?: () => void;
  defaultType?: PrinterProfileInput["printerType"];
  compact?: boolean;
};

function toIntendedUse(type: PrinterProfileInput["printerType"]) {
  return type;
}

export function PrinterProfileForm({ profile, onSaved, onCancel, defaultType = "production_ticket", compact = false }: Props) {
  const createMutation = useCreatePrinterProfile();
  const updateMutation = useUpdatePrinterProfile(profile?.id || "");
  const [displayName, setDisplayName] = useState("");
  const [printerType, setPrinterType] = useState<PrinterProfileInput["printerType"]>(defaultType);
  const [stationRoute, setStationRoute] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setPrinterType(profile?.printerType ?? defaultType);
    setStationRoute(profile?.stationRoute ?? "");
    setIsActive(profile?.isActive ?? true);
    setIsDefault(profile?.isDefault ?? false);
  }, [defaultType, profile]);

  const saving = createMutation.isPending || updateMutation.isPending;
  const canSave = displayName.trim().length > 0 && !saving;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload: PrinterProfileInput = {
      displayName: displayName.trim(),
      printerType,
      intendedUse: toIntendedUse(printerType),
      stationRoute: stationRoute.trim() || null,
      scope: "organization",
      isActive,
      isDefault: isActive && isDefault,
    };
    if (profile) await updateMutation.mutateAsync(payload);
    else await createMutation.mutateAsync(payload);
    onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? "space-y-3" : "space-y-4"}>
      <div className={compact ? "grid gap-3" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Epson TM-L90 Ticket Printer" />
        </div>
        <div className="space-y-1.5">
          <Label>Printer type</Label>
          <Select value={printerType} onValueChange={(value) => setPrinterType(value as PrinterProfileInput["printerType"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PRINTER_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Intended station or route</Label>
          <Input value={stationRoute} onChange={(event) => setStationRoute(event.target.value)} placeholder="Flatbed, Roll, Shipping..." />
        </div>
        <div className="space-y-3 rounded-md border border-titan-border p-3">
          <div className="flex items-center justify-between gap-4">
            <Label>Active</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label>Default for this use</Label>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} disabled={!isActive} />
          </div>
        </div>
      </div>
      <p className="text-xs text-titan-text-secondary">
        Printer profiles are organization-wide routing labels. Printing still uses the browser print dialog; choose the matching physical printer there.
      </p>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" disabled={!canSave}>{saving ? "Saving..." : profile ? "Save Printer" : "Add Printer"}</Button>
      </div>
    </form>
  );
}
