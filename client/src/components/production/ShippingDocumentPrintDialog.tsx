import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ShippingDocumentType } from "@shared/shippingDocuments";
import type { ShippingPrintDestination } from "@shared/directPrintDocuments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/queryClient";
import { readShippingPrinterPreference, saveShippingPrinterPreference, resolveTravelerPrinterDestinationId } from "@/lib/shippingPrinterPreferences";

export type ShippingDocumentPrintDialogProps = { shipmentId: string; documentType: ShippingDocumentType; packageId?: string; label?: string };
const titles: Record<ShippingDocumentType, string> = { packing_slip: "Packing Slip", shipment_manifest: "Shipment Manifest", package_ticket: "Package Tickets" };

export function ShippingDocumentPrintDialog({ shipmentId, documentType, packageId, label }: ShippingDocumentPrintDialogProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [destinationId, setDestinationId] = useState("");
  const [copies, setCopies] = useState("1");
  const [saveDefault, setSaveDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const resolved = useRef(false);
  const query = useQuery<ShippingPrintDestination[]>({
    queryKey: ["shipping-print-destinations", user?.lastActiveOrgId, documentType], enabled: open,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timeout = window.setTimeout(abort, 10_000);
      signal.addEventListener("abort", abort, { once: true });
      try {
        const response = await apiFetch(`/api/fulfillment/shipping-print-destinations?documentType=${documentType}`, { signal: controller.signal, credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load print destinations");
        return body.data;
      } finally { window.clearTimeout(timeout); signal.removeEventListener("abort", abort); }
    },
  });
  const destinations = query.data ?? [];
  const selected = destinations.find((item) => item.id === destinationId);
  useEffect(() => {
    if (!open || !destinations.length || resolved.current) return;
    const preference = user?.id ? readShippingPrinterPreference(user.id, user.lastActiveOrgId, documentType) : null;
    const id = resolveTravelerPrinterDestinationId(destinations, preference?.defaultDestinationId);
    setDestinationId(id);
    setCopies(String(destinations.find((item) => item.id === id)?.defaultCopies ?? 1));
    resolved.current = true;
  }, [open, destinations, user?.id, user?.lastActiveOrgId, documentType]);
  useEffect(() => {
    requestKey.current = null; resolved.current = false; setError(null); setFeedback(null); setDestinationId("");
  }, [shipmentId, documentType, packageId, user?.id, user?.lastActiveOrgId]);
  const revise = () => { requestKey.current = null; setError(null); setFeedback(null); };
  async function submit() {
    const count = Number(copies);
    if (!selected?.available || !Number.isInteger(count) || count < 1 || count > 99 || submitting) return;
    const key = requestKey.current ?? crypto.randomUUID();
    requestKey.current = key; setSubmitting(true); setError(null);
    try {
      const response = await apiFetch(`/api/fulfillment/shipments/${encodeURIComponent(shipmentId)}/direct-print`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ documentType, printerProfileId: destinationId, copies: count, requestKey: key, ...(packageId ? { packageId } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not queue shipping document");
      if (saveDefault && user?.id) saveShippingPrinterPreference(user.id, user.lastActiveOrgId, documentType, destinationId);
      setFeedback(body.data.status === "submitted" ? "Submitted to Windows. Physical printing is not confirmed."
        : body.data.status === "failed" ? "The saved job failed. Check the printer before submitting a new print request."
        : "Durably queued for the Print Agent. This does not confirm physical printing.");
    } catch (failure: any) { setError(failure.message || "Could not queue shipping document"); }
    finally { setSubmitting(false); }
  }
  const previewQuery = new URLSearchParams({ documentType, ...(packageId ? { packageId } : {}) });
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{label ?? `Print ${titles[documentType]}`}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!submitting) { setOpen(value); if (!value && feedback) { requestKey.current = null; setFeedback(null); } } }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Print {titles[documentType]}</DialogTitle><DialogDescription>Print the saved shipment document without changing shipment or order state.</DialogDescription></DialogHeader>
        {query.isLoading ? <p>Loading print destinations...</p> : query.error ? <div><p role="alert">Could not load print destinations.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry destinations</Button></div>
          : <div className="space-y-4"><Label htmlFor="shipping-print-destination">Printer / Destination</Label>
            <select id="shipping-print-destination" className="w-full rounded border bg-background p-2" value={destinationId} disabled={submitting || !!feedback} onChange={(event) => { revise(); setDestinationId(event.target.value); setCopies(String(destinations.find((item) => item.id === event.target.value)?.defaultCopies ?? 1)); }}>
              <option value="">Select a destination</option>{destinations.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.displayName}{item.location ? ` (${item.location})` : ""}{item.available ? "" : item.unavailableReason === "PRINT_AGENT_UPDATE_REQUIRED" ? " - agent update required" : " - unavailable"}</option>)}
            </select>
            {!destinations.length && <p>No printers are configured for this document. Use browser preview or configure the profile's supported documents.</p>}
            {destinations.some((item) => item.unavailableReason === "PRINT_AGENT_UPDATE_REQUIRED") && <p>Shipping documents require Windows Print Agent 1.0.25 or newer. Older agents must be updated.</p>}
            <Button type="button" variant="outline" size="sm" disabled={query.isFetching || submitting} onClick={() => void query.refetch()}>Check Printers Again</Button>
            <div className="grid gap-2"><Label htmlFor="shipping-print-copies">Copies</Label><Input id="shipping-print-copies" type="number" min="1" max="99" value={copies} disabled={submitting || !!feedback} onChange={(event) => { revise(); setCopies(event.target.value); }} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saveDefault} onChange={(event) => setSaveDefault(event.target.checked)} />Remember my printer for this document</label>
          </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error} Retry uses the same request key to avoid duplicate jobs.</p>}
        {feedback && <p role="status" className="text-sm">{feedback}</p>}
        <DialogFooter><Button variant="outline" asChild><a href={`/fulfillment/shipments/${encodeURIComponent(shipmentId)}/manifest?${previewQuery}`} target="_blank" rel="noopener noreferrer">Browser Preview / Print</a></Button>
          <Button variant="outline" disabled={submitting} onClick={() => { setOpen(false); if (feedback) { requestKey.current = null; setFeedback(null); } }}>Close</Button>
          <Button disabled={submitting || !!feedback || !selected?.available || !Number.isInteger(Number(copies)) || Number(copies) < 1 || Number(copies) > 99} onClick={() => void submit()}>{submitting ? "Queueing..." : error ? "Retry Print" : "Queue Print"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
