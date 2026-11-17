import { useRef, useState, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/queryClient";
import {
  persistTravelerPrinterPreferences, readPersistedTravelerPrinterPreferences, resolveTravelerPrinterDestinationId,
} from "@/lib/travelerPrinterPreferences";
import { directPrintRecoveryGuidance, directPrintStatusLabel, type DirectPrintJobStatus } from "@shared/directPrintJobStatus";
import type { ItemTagDestination, ItemTagDirectPrintRequest, ItemTagPrintJob } from "@shared/itemTagDirectPrint";

type PrintMethod = "printer" | "browser";
const selectStyle = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

async function printApi<T>(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  init?.signal?.addEventListener("abort", cancel, { once: true });
  if (init?.signal?.aborted) cancel();
  const timer = window.setTimeout(cancel, 15_000);
  try {
    const response = await apiFetch(path, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      if (response.status === 401 || response.status === 403)
        throw new Error("Direct printing requires a staff session with access to this organization.");
      throw new Error(body?.error || "Could not reach the print service. Try again.");
    }
    return body.data as T;
  } finally {
    window.clearTimeout(timer);
    init?.signal?.removeEventListener("abort", cancel);
  }
}

export function StandardItemTagPrintActions({ orderId, selection, attempts, onBrowserPrint, onClose, onSubmissionChange }: {
  orderId: string;
  selection: ItemTagDirectPrintRequest["selection"] | null;
  attempts: MutableRefObject<Map<string, string>>;
  onBrowserPrint: () => void;
  onClose: () => void;
  onSubmissionChange: (submitting: boolean) => void;
}) {
  const { user } = useAuth();
  const orgId = user?.lastActiveOrgId;
  const [method, setMethod] = useState<PrintMethod>();
  const [destinationId, setDestinationId] = useState("");
  const inFlight = useRef(false);
  const accepted = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<ItemTagPrintJob & { destinationName: string; queuedAt: number }>();
  const query = useQuery({
    queryKey: ["item-tag-destinations", user?.id, orgId], refetchOnMount: "always", refetchOnWindowFocus: false, retry: false,
    queryFn: ({ signal }) => printApi<ItemTagDestination[]>("/api/direct-print/item-tag-destinations", { signal }),
  });
  const destinations = query.isError || query.isFetching ? [] : query.data ?? [];
  const preferred = user?.id && orgId
    ? readPersistedTravelerPrinterPreferences(user.id, orgId, undefined, "item-tag").defaultDestinationId : null;
  const defaultId = resolveTravelerPrinterDestinationId(destinations, preferred);
  const effectiveMethod = defaultId ? method ?? "printer" : "browser";
  const selected = destinations.find(printer => printer.id === (destinationId || defaultId));
  const statusQuery = useQuery({
    queryKey: ["item-tag-print-status", orgId, job?.id], enabled: Boolean(job), retry: false,
    queryFn: async ({ signal }) => {
      const rows = await printApi<DirectPrintJobStatus[]>("/api/direct-print/jobs/status?ids=" + encodeURIComponent(job!.id), { signal });
      const row = rows.find(item => item.id === job!.id);
      if (!row) throw new Error("Print status is unavailable.");
      return row;
    },
    refetchInterval: query => ["submitted", "failed"].includes(query.state.data?.status ?? job?.status ?? "") ||
      Date.now() - (job?.queuedAt ?? 0) > 120_000 ? false : 2000,
  });
  const status = statusQuery.data?.status ?? job?.status;

  async function submit() {
    if (!selection || !selected?.available || inFlight.current || accepted.current) return;
    const intent = JSON.stringify([orgId, user?.id, orderId, selected.id, selection]);
    const requestKey = attempts.current.get(intent) ?? crypto.randomUUID();
    attempts.current.set(intent, requestKey);
    inFlight.current = true;
    setSubmitting(true);
    onSubmissionChange(true);
    setError("");
    try {
      const data = await printApi<ItemTagPrintJob>(`/api/orders/${encodeURIComponent(orderId)}/direct-print/item-tag`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify({ destinationId: selected.id, selection, requestKey } satisfies ItemTagDirectPrintRequest),
      });
      accepted.current = true;
      attempts.current.delete(intent);
      setJob({ ...data, destinationName: selected.displayName, queuedAt: Date.now() });
      if (data.status !== "failed" && user?.id && orgId) {
        persistTravelerPrinterPreferences(user.id, orgId, { version: 1, defaultDestinationId: selected.id }, undefined, "item-tag");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm the print request. Retry from this dialog.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      onSubmissionChange(false);
    }
  }

  function close() {
    if (submitting) return;
    onClose();
  }

  return <>
    <fieldset disabled={submitting || Boolean(job)} className="space-y-3">
      <label className="block space-y-1 text-sm font-medium">Print Method
        <select className={selectStyle} value={effectiveMethod} onChange={event => setMethod(event.target.value === "printer" ? "printer" : "browser")}>
          <option value="printer" disabled={!defaultId}>PrintersHero Printer</option>
          <option value="browser">Browser Print</option>
        </select>
      </label>
      {effectiveMethod === "printer" && <label className="block space-y-1 text-sm font-medium">Printer
        <select className={selectStyle} value={selected?.id ?? ""} onChange={event => setDestinationId(event.target.value)}>
          <option value="" disabled>Select a printer</option>
          {destinations.map(printer => <option key={printer.id} value={printer.id} disabled={!printer.available}>
            {[printer.displayName, printer.location, printer.agentName, printer.available ? null : "Unavailable"].filter(Boolean).join(" · ")}
          </option>)}
        </select>
        {selected?.queueName && <span className="block text-xs text-muted-foreground">Windows queue {selected.queueName}</span>}
      </label>}
      {query.isFetching && <p role="status" className="text-sm text-muted-foreground">Checking configured printers…</p>}
      {!query.isFetching && (!defaultId || error || destinations.some(printer => !printer.available)) && <div className="space-y-1 text-sm text-muted-foreground">
        {query.isError ? <p role="alert">{query.error.message} Browser Print is available.</p>
          : !destinations.length ? <p>No active 80 mm Traveler printer is configured. Use Browser Print or ask an administrator to check Settings → Printers.</p>
          : <>
            {!defaultId && <p>No configured printer is currently available. Use Browser Print or refresh printers.</p>}
            {destinations.filter(printer => !printer.available).map(printer => <p key={printer.id}>{printer.displayName} · {printer.unavailableReason}</p>)}
          </>}
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Refresh printers</Button>
      </div>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error} Retrying unchanged options uses the same print request.</p>}
    {job && status && <div className="space-y-1 text-sm" role="status">
      <p>{job.destinationName} · {directPrintStatusLabel(status)}</p>
      <p>{statusQuery.data?.lastError ?? job.lastError ?? directPrintRecoveryGuidance(status)}</p>
      {status === "failed" && <p>Check the printer or try again without artwork thumbnails if an image could not be loaded.</p>}
      {statusQuery.isError && <Button type="button" size="sm" variant="outline" onClick={() => void statusQuery.refetch()}>Check print status</Button>}
    </div>}
    <DialogFooter>
      <Button type="button" variant="outline" disabled={submitting} onClick={close}>{job ? "Close" : "Cancel"}</Button>
      {!job && (effectiveMethod === "printer"
        ? <Button type="button" disabled={!selection || !selected?.available || submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : "Print to PrintersHero"}</Button>
        : <Button type="button" disabled={!selection} onClick={onBrowserPrint}>Open Browser Print</Button>)}
    </DialogFooter>
  </>;
}
