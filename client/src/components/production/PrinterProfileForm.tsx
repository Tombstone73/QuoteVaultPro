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
  const [location, setLocation] = useState("");
  const [windowsQueueName, setWindowsQueueName] = useState("");
  const [defaultCopies, setDefaultCopies] = useState("1");
  const [trailingFeedMm, setTrailingFeedMm] = useState("0");
  const [receiptWidthMm, setReceiptWidthMm] = useState("80");
  const [intendedUse, setIntendedUse] = useState("production_ticket");
  const [supportsTraveler, setSupportsTraveler] = useState(true);
  const [supportsQuickNote, setSupportsQuickNote] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setPrinterType(profile?.printerType ?? defaultType);
    setStationRoute(profile?.stationRoute ?? "");
    setLocation(profile?.location ?? ""); setWindowsQueueName(profile?.windowsQueueName ?? "");
    setDefaultCopies(String(profile?.defaultCopies ?? 1)); setTrailingFeedMm(String(profile?.trailingFeedMm ?? 0));
    setReceiptWidthMm(String((profile as any)?.receiptWidthMm ?? 80));
    setIntendedUse(profile?.intendedUse ?? toIntendedUse(profile?.printerType ?? defaultType));
    setSupportsTraveler(profile?.supportedDocuments?.includes("traveler") ?? true);
    setSupportsQuickNote(profile?.supportedDocuments?.includes("quick_note") ?? false);
    setIsActive(profile?.isActive ?? true);
    setIsDefault(profile?.isDefault ?? false);
  }, [defaultType, profile]);

  const saving = createMutation.isPending || updateMutation.isPending;
  const canSave = displayName.trim().length > 0 && (supportsTraveler || supportsQuickNote) && !saving;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload: PrinterProfileInput = {
      displayName: displayName.trim(),
      printerType,
      intendedUse,
      stationRoute: stationRoute.trim() || null,
      location: location.trim() || null, windowsQueueName: windowsQueueName.trim() || null,
      supportedDocuments: ([supportsTraveler && "traveler", supportsQuickNote && "quick_note"].filter(Boolean) as string[]), defaultCopies: Number(defaultCopies), trailingFeedMm: Number(trailingFeedMm), receiptWidthMm: Number(receiptWidthMm),
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
        <div className="space-y-1.5"><Label>Location</Label><Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Front Office" /></div>
        <div className="space-y-1.5"><Label>Windows printer queue</Label><Input value={windowsQueueName} onChange={(event) => setWindowsQueueName(event.target.value)} placeholder="Select from the paired agent inventory" /></div>
        <div className="space-y-1.5"><Label>Default copies</Label><Input type="number" min="1" max="99" value={defaultCopies} onChange={(event) => setDefaultCopies(event.target.value)} /></div>
        <div className="space-y-1.5"><Label>Additional trailing feed (mm)</Label><Input type="number" min="0" max="100" step="0.1" value={trailingFeedMm} onChange={(event) => setTrailingFeedMm(event.target.value)} placeholder="12.7 for 0.5 in" /><p className="text-xs text-titan-text-secondary">Added after the standard 38.1 mm / 1.5 in tear-off space.</p></div>
        <div className="space-y-1.5"><Label>Receipt width (mm)</Label><Input type="number" min="40" max="120" step="0.1" value={receiptWidthMm} onChange={(event) => setReceiptWidthMm(event.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Intended use</Label>
          <Input value={intendedUse} onChange={(event) => setIntendedUse(event.target.value)} placeholder="production_ticket or quick_note" />
        </div>
        <div className="space-y-2 rounded-md border border-titan-border p-3">
          <Label>Supported documents</Label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supportsTraveler} onChange={(event) => setSupportsTraveler(event.target.checked)} /> Traveler</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supportsQuickNote} onChange={(event) => setSupportsQuickNote(event.target.checked)} /> Quick Note</label>
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
        Direct-print destinations are mapped to a paired Windows Print Agent. Select at least one supported document; queue names are resolved server-side and are never supplied by an operator at print time.
      </p>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" disabled={!canSave}>{saving ? "Saving..." : profile ? "Save Printer" : "Add Printer"}</Button>
      </div>
    </form>
  );
}
