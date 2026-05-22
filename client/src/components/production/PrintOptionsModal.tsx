/**
 * PrintOptionsModal — advanced print options for a production ticket.
 *
 * The fast path ("Print Ticket") prints with defaults and no modal. This modal
 * is the "Print Options" path: it lets the operator set print-snapshot
 * overrides (destination, quantity display, note, station/route, fulfillment,
 * reason) for a single print run, then opens the ticket route with those
 * overrides as query params. Nothing here mutates the job/order.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROUTES } from "@/config/routes";
import { loadPrinterPrefs } from "@/lib/ticketSettings";
import {
  serializeTicketOverrides,
  type TicketPrintOverrides,
  type TicketReason,
} from "@/lib/ticketPrintOverrides";
import { Printer } from "lucide-react";

/** Built-in printer destination presets (operator picks the match in the OS dialog). */
const PRINTER_PRESETS = [
  "Default station printer",
  "Flatbed printer",
  "Roll printer",
  "Office printer",
];

const STATION_ROUTES = ["Prepress", "Flatbed", "Roll", "Finishing", "Shipping"];
const FULFILLMENT_OPTIONS = ["Pickup", "Delivery", "Shipping"];
const REASONS: { value: TicketReason; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "completion", label: "Completion" },
  { value: "partial", label: "Partial completion" },
  { value: "reprint", label: "Reprint" },
];

const NONE = "__none__";

interface PrintOptionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Production job to print a ticket for. */
  jobId: string;
  /** Actual job/line-item quantity — prefills the partial-quantity total. */
  jobQuantity?: number;
}

export function PrintOptionsModal({
  open,
  onOpenChange,
  jobId,
  jobQuantity,
}: PrintOptionsModalProps) {
  const [destination, setDestination] = useState<string>(PRINTER_PRESETS[0]);
  const [reason, setReason] = useState<TicketReason>("standard");
  const [partial, setPartial] = useState(false);
  const [quantityDone, setQuantityDone] = useState("");
  const [quantityTotal, setQuantityTotal] = useState(
    jobQuantity != null ? String(jobQuantity) : "",
  );
  const [note, setNote] = useState("");
  const [stationRoute, setStationRoute] = useState<string>(NONE);
  const [fulfillment, setFulfillment] = useState<string>(NONE);

  // Saved printer profiles from local ticket settings, merged with presets.
  const savedPrinters = loadPrinterPrefs().printers.filter((p) => !PRINTER_PRESETS.includes(p));
  const destinationOptions = [...PRINTER_PRESETS, ...savedPrinters];

  const handlePrint = () => {
    const overrides: TicketPrintOverrides = {
      reason,
      destination: destination || undefined,
      quantityMode: partial ? "partial" : "default",
      quantityDone: partial && quantityDone.trim() ? Number(quantityDone) : undefined,
      quantityTotal: partial && quantityTotal.trim() ? Number(quantityTotal) : undefined,
      note: note.trim() || undefined,
      stationRoute: stationRoute !== NONE ? stationRoute : undefined,
      fulfillment: fulfillment !== NONE ? fulfillment : undefined,
    };
    const query = serializeTicketOverrides(overrides);
    const url = ROUTES.production.jobTicket(jobId) + (query ? `?${query}` : "");
    window.open(url, "_blank");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Print Options</DialogTitle>
          <DialogDescription>
            Adjust ticket-specific values for this print run. These are print
            overrides only — they do not change the job or order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Destination */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Print destination</Label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {destinationOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Ticket reason / type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Ticket type</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as TicketReason)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity display */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="partial-qty"
                checked={partial}
                onCheckedChange={(v) => setPartial(Boolean(v))}
              />
              <Label htmlFor="partial-qty" className="text-xs font-medium cursor-pointer">
                Partial quantity (show "X of Y")
              </Label>
            </div>
            {partial && (
              <div className="flex items-center gap-2 pl-6">
                <Input
                  type="number"
                  value={quantityDone}
                  onChange={(e) => setQuantityDone(e.target.value)}
                  placeholder="Completed"
                  className="h-9"
                />
                <span className="text-xs text-muted-foreground">of</span>
                <Input
                  type="number"
                  value={quantityTotal}
                  onChange={(e) => setQuantityTotal(e.target.value)}
                  placeholder="Total"
                  className="h-9"
                />
              </div>
            )}
          </div>

          {/* Station / route override */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Station / route override</Label>
            <Select value={stationRoute} onValueChange={setStationRoute}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No override</SelectItem>
                {STATION_ROUTES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fulfillment override */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Fulfillment override</Label>
            <Select value={fulfillment} onValueChange={setFulfillment}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No override</SelectItem>
                {FULFILLMENT_OPTIONS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional ticket note */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Ticket note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='e.g. "Partial batch complete, remaining 50 still in production."'
              rows={2}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" /> Print Ticket
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
