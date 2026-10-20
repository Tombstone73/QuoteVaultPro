import { type FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { shippingDocumentTypes, type ShippingDocumentType } from "@shared/shippingDocuments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/queryClient";
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
  PrinterProfileApiError,
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

type PairedPrintAgent = {
  id: string;
  machineLabel: string | null;
  agentVersion: string | null;
  configuredTravelerPrinterName: string | null;
  lastSeenAt: string;
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
  const [printAgentId, setPrintAgentId] = useState<string | null>(null);
  const agents = useQuery<PairedPrintAgent[]>({
    queryKey: ["/api/local-bridge/admin/agents", "printer-profile"],
    queryFn: async () => {
      const response = await apiFetch("/api/local-bridge/admin/agents");
      if (!response.ok) throw new Error("Could not load paired Print Agents");
      const body = await response.json();
      return body.data;
    },
  });
  const [defaultCopies, setDefaultCopies] = useState("1");
  const [trailingFeedMm, setTrailingFeedMm] = useState("0");
  const [receiptWidthMm, setReceiptWidthMm] = useState("80");
  const [intendedUse, setIntendedUse] = useState("production_ticket");
  const [supportsTraveler, setSupportsTraveler] = useState(true);
  const [supportsQuickNote, setSupportsQuickNote] = useState(false);
  const [supportsUpsLabel, setSupportsUpsLabel] = useState(false);
  const [shippingDocuments, setShippingDocuments] = useState<ShippingDocumentType[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setPrinterType(profile?.printerType ?? defaultType);
    setStationRoute(profile?.stationRoute ?? "");
    setLocation(profile?.location ?? ""); setWindowsQueueName(profile?.windowsQueueName ?? "");
    setPrintAgentId(profile?.printAgentId ?? null);
    setDefaultCopies(String(profile?.defaultCopies ?? 1)); setTrailingFeedMm(String(profile?.trailingFeedMm ?? 0));
    setReceiptWidthMm(String((profile as any)?.receiptWidthMm ?? 80));
    setIntendedUse(profile?.intendedUse ?? toIntendedUse(profile?.printerType ?? defaultType));
    setSupportsTraveler(profile?.supportedDocuments?.includes("traveler") ?? (defaultType === 'production_ticket'));
    setSupportsQuickNote(profile?.supportedDocuments?.includes("quick_note") ?? false);
    setSupportsUpsLabel(profile?.supportedDocuments?.includes("ups_label") ?? (defaultType === 'shipping_label'));
    setShippingDocuments(shippingDocumentTypes.filter((type) => profile?.supportedDocuments?.includes(type)));
    setIsActive(profile?.isActive ?? true);
    setIsDefault(profile?.isDefault ?? false);
    setFieldErrors({}); setSaveError(null);
  }, [defaultType, profile]);

  const saving = createMutation.isPending || updateMutation.isPending;
  const canSave = displayName.trim().length > 0 && (supportsTraveler || supportsQuickNote || supportsUpsLabel || shippingDocuments.length > 0) && !saving;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({}); setSaveError(null);
    if (supportsUpsLabel && printerType !== 'shipping_label') {
      setFieldErrors({ printerType: 'UPS labels require a Shipping Label printer type.' }); return;
    }
    const payload: PrinterProfileInput = {
      displayName: displayName.trim(),
      printerType,
      intendedUse,
      stationRoute: stationRoute.trim() || null,
      location: location.trim() || null, windowsQueueName: windowsQueueName.trim() || null, printAgentId,
      supportedDocuments: [...([supportsTraveler && "traveler", supportsQuickNote && "quick_note", supportsUpsLabel && "ups_label"].filter(Boolean) as string[]), ...shippingDocuments], defaultCopies: Number(defaultCopies), trailingFeedMm: Number(trailingFeedMm), receiptWidthMm: Number(receiptWidthMm),
      scope: "organization",
      isActive,
      isDefault: isActive && isDefault,
    };
    try {
      if (profile) await updateMutation.mutateAsync(payload);
      else await createMutation.mutateAsync(payload);
      onSaved?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save printer profile.');
      if (error instanceof PrinterProfileApiError) setFieldErrors(Object.fromEntries(error.details
        .filter(detail => typeof detail.path[0] === 'string').map(detail => [String(detail.path[0]), detail.message])));
    }
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? "space-y-3" : "space-y-4"}>
      <div className={compact ? "grid gap-3" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Epson TM-L90 Ticket Printer" />
          {fieldErrors.displayName && <p role="alert" className="text-xs text-destructive">{fieldErrors.displayName}</p>}
        </div>
        <div className="space-y-1.5"><Label>Location</Label><Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Front Office" /></div>
        <div className="space-y-1.5"><Label>Windows printer queue</Label><Input value={windowsQueueName} onChange={(event) => setWindowsQueueName(event.target.value)} placeholder="Select from the paired agent inventory" />{fieldErrors.windowsQueueName && <p role="alert" className="text-xs text-destructive">{fieldErrors.windowsQueueName}</p>}</div>
        <div className="space-y-1.5">
          <Label>Paired Print Agent</Label>
          <Select value={printAgentId ?? "unpaired"} onValueChange={(value) => setPrintAgentId(value === "unpaired" ? null : value)}>
            <SelectTrigger aria-label="Paired Print Agent"><SelectValue placeholder="Select a paired workstation" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaired">Unpaired</SelectItem>
              {(agents.data ?? []).filter((agent) => agent.configuredTravelerPrinterName === windowsQueueName.trim()).map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.machineLabel || "Unnamed workstation"} · {agent.agentVersion || "Version unknown"} · last active {new Date(agent.lastSeenAt).toLocaleString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-titan-text-secondary">Choose the currently paired workstation for this exact Windows queue. This changes future jobs only; existing queued jobs remain with their original agent.</p>
          {agents.isError ? <p className="text-xs text-destructive">Paired agents could not be loaded. Retry by reopening this editor.</p> : null}
        </div>
        <div className="space-y-1.5"><Label>Default copies</Label><Input type="number" min="1" max="99" value={defaultCopies} onChange={(event) => setDefaultCopies(event.target.value)} /></div>
        {(printerType === 'production_ticket' || supportsQuickNote) && <><div className="space-y-1.5"><Label>Additional trailing feed (mm)</Label><Input type="number" min="0" max="100" step="0.1" value={trailingFeedMm} onChange={(event) => setTrailingFeedMm(event.target.value)} placeholder="12.7 for 0.5 in" /><p className="text-xs text-titan-text-secondary">Added after the standard 38.1 mm / 1.5 in tear-off space.</p></div>
        <div className="space-y-1.5"><Label>Receipt width (mm)</Label><Input type="number" min="40" max="120" step="0.1" value={receiptWidthMm} onChange={(event) => setReceiptWidthMm(event.target.value)} />{fieldErrors.receiptWidthMm && <p role="alert" className="text-xs text-destructive">{fieldErrors.receiptWidthMm}</p>}</div></>}
        <div className="space-y-1.5">
          <Label>Intended use</Label>
          <Input value={intendedUse} onChange={(event) => setIntendedUse(event.target.value)} placeholder="production_ticket or quick_note" />
          {supportsUpsLabel && intendedUse !== 'shipping_label' && <p className="text-xs text-amber-700">This label profile still uses the saved intended-use group “{intendedUse}”. Change it to shipping_label if this printer should be the shipping default.</p>}
        </div>
        <div className="space-y-2 rounded-md border border-titan-border p-3">
          <Label>Supported documents</Label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supportsTraveler} onChange={(event) => setSupportsTraveler(event.target.checked)} /> Traveler</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supportsQuickNote} onChange={(event) => setSupportsQuickNote(event.target.checked)} /> Quick Note</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={supportsUpsLabel} onChange={(event) => { setSupportsUpsLabel(event.target.checked); if (event.target.checked) { setPrinterType('shipping_label'); setIntendedUse('shipping_label'); setSupportsTraveler(false); } }} /> UPS shipping label (4 × 6 in GIF)</label>
          {shippingDocumentTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shippingDocuments.includes(type)} onChange={(event) => setShippingDocuments((current) => event.target.checked ? [...current, type] : current.filter((item) => item !== type))} />{type === "packing_slip" ? "Packing Slip" : type === "shipment_manifest" ? "Shipment Manifest" : "Package Ticket"}</label>)}
          <p className="text-xs text-titan-text-secondary">Shipping documents require Print Agent 1.0.25 or newer. Enable only documents suitable for this printer's paper.</p>
          {supportsUpsLabel && <p className="text-xs text-titan-text-secondary">UPS labels require Print Agent 1.0.26 or newer, a Windows queue set to 4 × 6 inch label stock, and a raster-capable driver. The agent does not send raw ZPL or change the queue's media/DPI settings.</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Printer type</Label>
          <Select value={printerType} onValueChange={(value) => { const next = value as PrinterProfileInput["printerType"]; setPrinterType(next); if (intendedUse === printerType) setIntendedUse(next); if (next !== 'shipping_label') setSupportsUpsLabel(false); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PRINTER_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.printerType && <p role="alert" className="text-xs text-destructive">{fieldErrors.printerType}</p>}
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
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" disabled={!canSave}>{saving ? "Saving..." : profile ? "Save Printer" : "Add Printer"}</Button>
      </div>
    </form>
  );
}
