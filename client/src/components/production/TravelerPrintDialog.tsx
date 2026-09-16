import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  persistTravelerPrinterPreferences,
  readPersistedTravelerPrinterPreferences,
  resolveTravelerPrinterDestinationId,
} from "@/lib/travelerPrinterPreferences";
import { ROUTES } from "@/config/routes";

type Destination = {
  id: string;
  displayName: string;
  location: string | null;
  defaultCopies: number;
  isDefault: boolean;
  available: boolean;
};

export function travelerBrowserPrintUrl(orderId: string, printNote: string) {
  const note = printNote.trim();
  if (!note) return ROUTES.orders.traveler(orderId);
  return `${ROUTES.orders.traveler(orderId)}?${new URLSearchParams({ printNote: note }).toString()}`;
}

export function TravelerPrintDialog({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [destinationId, setDestinationId] = useState("");
  const [copies, setCopies] = useState("1");
  const [note, setNote] = useState("");
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pendingRequestKey = useRef<string | null>(null);
  const resolvedPreferenceScope = useRef<string | null>(null);
  const preferenceScope = user?.id ? `${user.lastActiveOrgId ?? "unknown"}:${user.id}` : "anonymous";

  const query = useQuery<Destination[]>({
    queryKey: ["/api/direct-print/traveler-destinations"],
    enabled: open,
    queryFn: async () => {
      const response = await fetch("/api/direct-print/traveler-destinations", { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load Traveler destinations");
      return body.data;
    },
  });

  const destinations = query.data ?? [];
  const selected = destinations.find((destination) => destination.id === destinationId);

  useEffect(() => {
    if (open) return;
    pendingRequestKey.current = null;
    resolvedPreferenceScope.current = null;
    setSetAsDefault(false);
  }, [open]);

  useEffect(() => {
    if (!open || !destinations.length || resolvedPreferenceScope.current === preferenceScope) return;

    const preferences = user?.id
      ? readPersistedTravelerPrinterPreferences(user.id, user.lastActiveOrgId)
      : undefined;
    const resolvedDestinationId = resolveTravelerPrinterDestinationId(destinations, preferences?.defaultDestinationId);
    const target = destinations.find((destination) => destination.id === resolvedDestinationId);

    setDestinationId(resolvedDestinationId);
    if (target) setCopies(String(target.defaultCopies || 1));
    resolvedPreferenceScope.current = preferenceScope;
  }, [destinations, open, preferenceScope, user?.id, user?.lastActiveOrgId]);

  function selectDestination(id: string) {
    setDestinationId(id);
    const destination = destinations.find((item) => item.id === id);
    if (destination) setCopies(String(destination.defaultCopies || 1));
  }

  async function submit() {
    const parsedCopies = Number(copies);
    if (!selected || !selected.available || !Number.isInteger(parsedCopies) || parsedCopies < 1 || parsedCopies > 99) {
      toast({ title: "Select an available destination and enter 1–99 copies.", variant: "destructive" });
      return;
    }

    const requestKey = pendingRequestKey.current ?? crypto.randomUUID();
    pendingRequestKey.current = requestKey;
    setSubmitting(true);

    try {
      const response = await fetch(`/api/orders/${orderId}/direct-print/traveler`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify({ destinationId, copies: parsedCopies, printNote: note, requestKey }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Direct print could not be queued");

      if (setAsDefault && user?.id) {
        persistTravelerPrinterPreferences(user.id, user.lastActiveOrgId, {
          version: 1,
          defaultDestinationId: selected.id,
        });
      }

      pendingRequestKey.current = null;
      toast({
        title: `Traveler sent to ${selected.displayName}`,
        description: `${parsedCopies} ${parsedCopies === 1 ? "copy" : "copies"} queued for the active Print Agent.`,
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Traveler printer is unavailable",
        description: `${error.message} Retry to reuse this print request, or use Browser Print.`,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Print Traveler</DialogTitle>
          <DialogDescription>Choose where this read-only Traveler print job goes.</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading destinations…</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Printer / Destination</Label>
              <Select value={destinationId} onValueChange={selectDestination}>
                <SelectTrigger><SelectValue placeholder="Select a destination" /></SelectTrigger>
                <SelectContent>
                  {destinations.map((destination) => (
                    <SelectItem value={destination.id} key={destination.id} disabled={!destination.available}>
                      {destination.displayName}
                      {destination.location ? ` — ${destination.location}` : ""}
                      {destination.available ? "" : " (offline)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="set-default-traveler-printer"
                  checked={setAsDefault}
                  onCheckedChange={(checked) => setSetAsDefault(checked === true)}
                />
                <Label htmlFor="set-default-traveler-printer" className="cursor-pointer text-sm font-normal">
                  Set as my default Traveler printer
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="traveler-copies">Copies</Label>
              <Input id="traveler-copies" type="number" min="1" max="99" step="1" value={copies} onChange={(event) => setCopies(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="traveler-print-note">Print Note <span className="text-muted-foreground">(optional, print-only)</span></Label>
              <Textarea id="traveler-print-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" onClick={() => window.open(travelerBrowserPrintUrl(orderId, note), "_blank")}>Open Browser Print</Button>
          <Button onClick={() => void submit()} disabled={query.isLoading || submitting || !selected?.available}>
            {submitting ? "Queueing…" : "Print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
