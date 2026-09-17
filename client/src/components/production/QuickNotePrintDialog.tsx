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
import { apiFetch } from "@/lib/queryClient";
import { apiUrl } from "@/lib/apiConfig";
import { persistQuickNotePrinterPreferences, readPersistedQuickNotePrinterPreferences, resolveTravelerPrinterDestinationId } from "@/lib/quickNotePrinterPreferences";

type Destination = { id: string; displayName: string; location: string | null; defaultCopies: number; isDefault: boolean; available: boolean; agentVersion?: string | null; quickNoteSupported?: boolean; unavailableReason?: string | null };
const DESTINATION_REQUEST_TIMEOUT_MS = 10_000;
const POST_DOWNLOAD_REFRESH_MS = 3_000;
const POST_DOWNLOAD_REFRESH_WINDOW_MS = 60_000;
const travelerAgentDownloadUrl = apiUrl("/api/local-bridge/admin/traveler-print-agent-package");

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export function QuickNotePrintDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [headline, setHeadline] = useState("");
  const [note, setNote] = useState("");
  const [copies, setCopies] = useState("1");
  const [destinationId, setDestinationId] = useState("");
  const [saveDefault, setSaveDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingAfterDownload, setRefreshingAfterDownload] = useState(false);
  const requestKey = useRef<string | null>(null);
  const resolved = useRef<string | null>(null);
  const scope = user?.id ? `${user.lastActiveOrgId ?? "unknown"}:${user.id}` : "anonymous";

  const query = useQuery<Destination[]>({
    queryKey: ["/api/direct-print/quick-note-destinations"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), DESTINATION_REQUEST_TIMEOUT_MS);
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const response = await apiFetch("/api/direct-print/quick-note-destinations", { credentials: "include", signal: controller.signal });
        const body = await readJson(response);
        if (!response.ok) throw new Error(body.error || "Could not load Quick Note destinations");
        return Array.isArray(body.data) ? body.data : [];
      } catch (error) {
        if (controller.signal.aborted) throw new Error("Could not load Quick Note destinations");
        throw error;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
  });

  const destinations = query.data ?? [];
  const selected = destinations.find((destination) => destination.id === destinationId);
  const updateRequiredDestination = selected?.unavailableReason === "PRINT_AGENT_UPDATE_REQUIRED"
    ? selected
    : !selected ? destinations.find((destination) => destination.unavailableReason === "PRINT_AGENT_UPDATE_REQUIRED") : undefined;
  const normalizeCopies = (value: number) => String(Math.min(25, Math.max(1, Number.isInteger(value) ? value : 1)));

  useEffect(() => {
    if (!open || !destinations.length || resolved.current === scope) return;
    const preferences = user?.id ? readPersistedQuickNotePrinterPreferences(user.id, user.lastActiveOrgId) : undefined;
    const id = resolveTravelerPrinterDestinationId(destinations, preferences?.defaultDestinationId);
    setDestinationId(id);
    const destination = destinations.find((item) => item.id === id);
    if (destination) setCopies(normalizeCopies(destination.defaultCopies));
    resolved.current = scope;
  }, [open, destinations, scope, user?.id, user?.lastActiveOrgId]);

  useEffect(() => {
    if (open) return;
    requestKey.current = null;
    resolved.current = null;
    setSaveDefault(false);
  }, [open]);

  useEffect(() => {
    if (!open || !refreshingAfterDownload) return;
    const timeout = window.setTimeout(() => setRefreshingAfterDownload(false), POST_DOWNLOAD_REFRESH_WINDOW_MS);
    const interval = window.setInterval(() => { void query.refetch(); }, POST_DOWNLOAD_REFRESH_MS);
    return () => { window.clearTimeout(timeout); window.clearInterval(interval); };
  }, [open, query.refetch, refreshingAfterDownload]);

  useEffect(() => {
    if (refreshingAfterDownload && !destinations.some((destination) => destination.unavailableReason === "PRINT_AGENT_UPDATE_REQUIRED")) setRefreshingAfterDownload(false);
  }, [destinations, refreshingAfterDownload]);

  const choose = (id: string) => {
    requestKey.current = null;
    setDestinationId(id);
    const destination = destinations.find((item) => item.id === id);
    if (destination) setCopies(normalizeCopies(destination.defaultCopies));
  };
  const checkAgain = () => { void query.refetch(); };
  const beginPostDownloadRefresh = () => { setRefreshingAfterDownload(true); void query.refetch(); };
  const hasContent = Boolean(headline.trim() || note.trim());

  async function submit() {
    const parsedCopies = Number(copies);
    if (!selected?.available || !Number.isInteger(parsedCopies) || parsedCopies < 1 || parsedCopies > 25 || !hasContent) {
      toast({ title: "Enter a note and select an available destination.", variant: "destructive" });
      return;
    }

    const key = requestKey.current ?? crypto.randomUUID();
    requestKey.current = key;
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/direct-print/quick-note", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ destinationId, copies: parsedCopies, headline, note, requestKey: key }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || "Quick Note could not be queued");
      if (saveDefault && user?.id) persistQuickNotePrinterPreferences(user.id, user.lastActiveOrgId, { version: 1, defaultDestinationId: selected.id });
      toast({ title: "Quick Note queued", description: `${parsedCopies} ${parsedCopies === 1 ? "copy" : "copies"} sent to ${selected.displayName}.` });
      requestKey.current = null;
      setHeadline("");
      setNote("");
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: "Quick Note printer is unavailable", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const revise = (set: (value: string) => void) => (value: string) => { requestKey.current = null; set(value); };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Quick Note</DialogTitle><DialogDescription>Print a short adhesive or receipt-style note without changing an order.</DialogDescription></DialogHeader>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading destinations…</p>
      : query.error ? <div className="space-y-3"><p className="text-sm text-destructive">Could not load Quick Note destinations.</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>
      : !destinations.length ? <div className="space-y-3"><p className="text-sm text-muted-foreground">No Quick Note destinations are configured.</p>{isAdmin ? <Button type="button" variant="outline" onClick={() => { window.location.href = "/settings/printers"; }}>Manage printer profiles</Button> : null}</div>
      : <div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="quick-note-headline">Headline <span className="text-muted-foreground">(optional)</span></Label><Input id="quick-note-headline" value={headline} maxLength={240} onChange={(event) => revise(setHeadline)(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="quick-note-body">Note <span className="text-muted-foreground">(optional)</span></Label><Textarea id="quick-note-body" value={note} maxLength={4000} onChange={(event) => revise(setNote)(event.target.value)} /></div><div className="space-y-1.5"><Label>Printer / Destination</Label><Select value={destinationId} onValueChange={choose}><SelectTrigger><SelectValue placeholder="Select a destination" /></SelectTrigger><SelectContent>{destinations.map((destination) => { const updateRequired = destination.unavailableReason === "PRINT_AGENT_UPDATE_REQUIRED"; return <SelectItem key={destination.id} value={destination.id} disabled={!destination.available && !updateRequired}>{destination.displayName}{destination.location ? ` — ${destination.location}` : ""}{destination.available ? "" : updateRequired ? " (Print Agent update required)" : " (offline)"}</SelectItem>; })}</SelectContent></Select>{updateRequiredDestination ? <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"><p className="font-medium">{updateRequiredDestination.displayName}: Print Agent update required</p><p className="mt-1">This printer's Windows Print Agent must be updated before it can print Quick Notes.</p><div className="mt-2 flex gap-2">{isAdmin ? <Button type="button" size="sm" variant="outline" asChild><a href={travelerAgentDownloadUrl} onClick={beginPostDownloadRefresh}>Download Print Agent Update</a></Button> : null}<Button type="button" size="sm" variant="outline" onClick={checkAgain}>Check Again</Button></div></div> : null}<div className="flex items-center gap-2 pt-1"><Checkbox id="set-default-quick-note-printer" checked={saveDefault} onCheckedChange={(value) => setSaveDefault(value === true)} /><Label htmlFor="set-default-quick-note-printer" className="cursor-pointer text-sm font-normal">Set as my default Quick Note printer</Label></div></div><div className="space-y-1.5"><Label htmlFor="quick-note-copies">Copies</Label><Input id="quick-note-copies" type="number" min="1" max="25" value={copies} onChange={(event) => { requestKey.current = null; setCopies(event.target.value); }} /></div></div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={query.isLoading || !!query.error || !destinations.length || submitting || !hasContent || !selected?.available}>{submitting ? "Queueing…" : "Print Note"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
