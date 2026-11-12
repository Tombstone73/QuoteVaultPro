import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { checkProductionLabelLayout } from "@/lib/productionItemLabelBrowser";
import { renderProductionItemLabelsHtml } from "@shared/productionItemLabelRendering";
import {
  defaultProductionLabelMedia, productionLabelBatchCount, productionLabelConfirmationThreshold, productionLabelModeNames,
  productionLabelPreviewRequestSchema, type ProductionLabelDestination, type ProductionLabelDocument, type ProductionLabelOptions,
  type ProductionLabelSource, type ProductionLabelPreviewRequest, type summarizeProductionLabels,
} from "@shared/productionItemLabels";
import type { ItemTagScope } from "@/lib/itemTagPrint";

type Mode = ProductionLabelOptions["mode"];
type LineDraft = {
  panels: string; total: string; perBatch: string; showRanges: boolean; artworkReference: string;
  selection: "all" | "single" | "range"; start: string; end: string;
};
const newLineDraft = (quantity: number): LineDraft => ({
  panels: "", total: quantity > 0 ? String(quantity) : "", perBatch: "", showRanges: false, artworkReference: "",
  selection: "all", start: "", end: "",
});
type Preview = {
  document: ProductionLabelDocument;
  summary: ReturnType<typeof summarizeProductionLabels>;
  previewFingerprint: string;
  destination: ProductionLabelDestination | null;
};
type PrintJob = { id: string; status: string; labelCount: number; fingerprint: string; startedAt: number; requestKey: string };
type JobStatus = { id: string; status: string; lastError: string | null };
const isPositiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const selectStyle = "block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

async function labelApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error || "The production label service is unavailable. Try again.");
  return body.data;
}

function jobMessage(status: string, lastError: string | null) {
  if (status === "failed") return lastError || "The Print Agent reported a failure. Check the selected printer.";
  if (status === "submitted") return "Windows accepted the job. Check the printer for the labels.";
  if (status === "claimed" || status === "rendering") return "The Print Agent is preparing the job. Check the printer before resubmitting.";
  return "Queued for the selected Print Agent.";
}

function NumberSelection({ draft, mode, count, update }: {
  draft: LineDraft; mode: "panels" | "batches"; count: number | null; update: (change: Partial<LineDraft>) => void;
}) {
  const noun = mode === "panels" ? "panel" : "batch";
  return <div className="grid gap-2 sm:grid-cols-3">
    <label className="space-y-1 text-sm">Print selection
      <select className={selectStyle} aria-label={"Print " + noun + " selection"} value={draft.selection}
        onChange={event => update({ selection: event.target.value as LineDraft["selection"] })}>
        <option value="all">All {mode}</option><option value="single">Specific {noun}</option><option value="range">{mode === "panels" ? "Panel" : "Batch"} range</option>
      </select>
    </label>
    {draft.selection !== "all" && <label className="space-y-1 text-sm">
      {draft.selection === "single" ? (mode === "panels" ? "Panel number" : "Batch number") : "From " + noun}
      <Input type="number" min="1" max={count ?? undefined} step="1" value={draft.start} onChange={event => update({ start: event.target.value })} />
    </label>}
    {draft.selection === "range" && <label className="space-y-1 text-sm">Through {noun}
      <Input type="number" min="1" max={count ?? undefined} step="1" value={draft.end} onChange={event => update({ end: event.target.value })} />
    </label>}
  </div>;
}

export function ProductionItemLabelOptions({ orderId, lineItemId, scope, mode, onCancel }: {
  orderId: string; lineItemId: string; scope: ItemTagScope; mode: Mode; onCancel: () => void;
}) {
  const path = "/api/orders/" + encodeURIComponent(orderId) + "/production-item-labels";
  const { user } = useAuth();
  const data = useQuery<{ source: ProductionLabelSource; destinations: ProductionLabelDestination[] }>({
    queryKey: ["production-item-labels", user?.lastActiveOrgId, user?.id, orderId], queryFn: ({ signal }) => labelApi(path, { signal }),
    refetchOnMount: "always", retry: false,
  });
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [fields, setFields] = useState({ orderNumber: true, lineNumber: true, description: true, dimensions: true });
  const [partialQuantity, setPartialQuantity] = useState("");
  const [chosenDestination, setChosenDestination] = useState<string>();
  const [browserWidth, setBrowserWidth] = useState(String(defaultProductionLabelMedia.widthMm));
  const [browserHeight, setBrowserHeight] = useState(String(defaultProductionLabelMedia.heightMm));
  const [preview, setPreview] = useState<{ key: string; value: Preview }>();
  const [frameReady, setFrameReady] = useState(false);
  const [confirmedLargeJob, setConfirmedLargeJob] = useState(false);
  const [job, setJob] = useState<PrintJob>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const previewRequest = useRef(0);
  const inFlight = useRef(false);
  const attempts = useRef(new Map<string, string>());

  const source = data.data?.source;
  const destinations = data.data?.destinations ?? [];
  const available = destinations.filter(item => !item.unavailableReason);
  const destinationId = chosenDestination ?? available.find(item => item.isDefault)?.id ?? available[0]?.id ?? "browser";
  const destination = destinations.find(item => item.id === destinationId);
  const selected = source?.lines.filter(item => scope === "order" || item.id === lineItemId) ?? [];
  const draftKey = (id: string) => mode + ":" + id;
  const selectionFor = (draft: LineDraft) => draft.selection === "all" ? undefined :
    { start: Number(draft.start), end: Number(draft.selection === "single" ? draft.start : draft.end) };
  const rawOptions = {
    mode, scope, fields, partialQuantity: scope === "partial" ? Number(partialQuantity) : undefined,
    lines: selected.map(item => {
      const draft = drafts[draftKey(item.id)] ?? newLineDraft(item.quantity);
      const identity = { lineItemId: item.id };
      if (mode === "panels") return { ...identity, artworkReference: draft.artworkReference || undefined,
        panelCount: Number(draft.panels), selection: selectionFor(draft) };
      if (mode === "batches") return { ...identity, total: Number(scope === "partial" ? partialQuantity : draft.total),
        perBatch: Number(draft.perBatch), showRanges: draft.showRanges, selection: selectionFor(draft) };
      return identity;
    }),
  };
  const request = productionLabelPreviewRequestSchema.safeParse({
    options: rawOptions, destination: destinationId === "browser"
      ? { type: "browser", media: { widthMm: Number(browserWidth), heightMm: Number(browserHeight) } }
      : { type: "printer", id: destinationId },
  });
  const requestKey = request.success ? JSON.stringify(request.data) : "";
  const activePreview = preview?.key === requestKey ? preview?.value : undefined;
  const previewHtml = activePreview ? renderProductionItemLabelsHtml(activePreview.document) : "";
  const requiresConfirmation = Boolean(activePreview && activePreview.summary.labelCount > productionLabelConfirmationThreshold);
  const status = useQuery<JobStatus>({
    queryKey: ["production-item-label-print-status", user?.lastActiveOrgId, job?.id], enabled: Boolean(job), retry: false,
    queryFn: async ({ signal }) => {
      const rows = await labelApi<JobStatus[]>("/api/direct-print/jobs/status?ids=" + encodeURIComponent(job!.id), { signal });
      if (!rows[0] || rows[0].id !== job!.id) throw new Error("Print status is unavailable.");
      return rows[0];
    },
    refetchInterval: query => ["submitted", "failed"].includes(query.state.data?.status ?? "") ||
      Date.now() - (job?.startedAt ?? 0) > 120_000 ? false : 2000,
  });
  const currentJobStatus = status.data?.status ?? job?.status;
  const sameJob = Boolean(job && activePreview?.previewFingerprint === job.fingerprint);
  const pendingJob = sameJob && currentJobStatus !== "failed" && currentJobStatus !== "submitted";

  function editLine(id: string, quantity: number, change: Partial<LineDraft>) {
    const key = draftKey(id);
    setDrafts(current => ({ ...current, [key]: { ...(current[key] ?? newLineDraft(quantity)), ...change } }));
  }

  async function showPreview() {
    if (!request.success || previewing || submitting) return;
    const generation = ++previewRequest.current;
    setError("");
    setPreview(undefined);
    setFrameReady(false);
    setConfirmedLargeJob(false);
    setPreviewing(true);
    try {
      const result = await labelApi<Preview>(path + "/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.data),
      });
      if (generation === previewRequest.current) setPreview({ key: requestKey, value: result });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not preview labels.");
    } finally { setPreviewing(false); }
  }

  async function verifyFrame() {
    const document = frame.current?.contentDocument;
    if (!document || !activePreview) return;
    try {
      await document.fonts?.ready;
      if (document !== frame.current?.contentDocument) return;
      checkProductionLabelLayout(document, activePreview.summary.labelCount);
      setFrameReady(true);
    } catch (error) {
      setFrameReady(false);
      setError(error instanceof Error ? error.message : "The preview could not be rendered.");
    }
  }

  async function print() {
    if (!activePreview || !request.success || !frameReady || inFlight.current || pendingJob ||
        (requiresConfirmation && !confirmedLargeJob)) return;
    setError("");
    const document = frame.current?.contentDocument;
    try {
      if (!document) throw new Error("The preview is unavailable. Preview again.");
      checkProductionLabelLayout(document, activePreview.summary.labelCount);
      if (!activePreview.destination) {
        const target = frame.current?.contentWindow;
        if (!target) throw new Error("Browser Print is unavailable.");
        target.focus();
        target.print();
        return;
      }
      const fingerprint = activePreview.previewFingerprint;
      const lastAttempt = attempts.current.get(fingerprint);
      const idempotencyKey = lastAttempt && (!sameJob || job?.requestKey !== lastAttempt) ? lastAttempt : crypto.randomUUID();
      attempts.current.set(fingerprint, idempotencyKey);
      inFlight.current = true;
      setSubmitting(true);
      const input: ProductionLabelPreviewRequest = request.data;
      const response = await labelApi<Omit<PrintJob, "fingerprint" | "startedAt" | "requestKey">>(path + "/print", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ options: input.options, destinationId: activePreview.destination.id, previewFingerprint: fingerprint,
          confirmedLargeJob, requestKey: idempotencyKey }),
      });
      setJob({ ...response, fingerprint, requestKey: idempotencyKey, startedAt: Date.now() });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not confirm print submission. Retry using this preview.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return <div className="space-y-3">
    {data.isPending && <p role="status" className="text-sm">Loading saved Order lines and printers…</p>}
    {data.isError && <div className="flex flex-wrap items-center gap-2 text-sm"><p role="alert">Could not load the Order or printer options.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void data.refetch()}>Retry loading</Button>
    </div>}
    {source && !selected.length && <p role="alert" className="text-sm text-destructive">This saved line is unavailable for labels.</p>}
    {!!selected.length && <>
      <fieldset disabled={submitting || previewing} className="space-y-3">
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-sm font-medium">Include on label</legend>
          {([["orderNumber", "Order number"], ["lineNumber", "Line number"], ["description", "Description"], ["dimensions", "Dimensions"]] as const).map(([field, label]) =>
            <label key={field} className="flex items-center gap-2 text-sm"><Checkbox checked={fields[field]} onCheckedChange={checked =>
              setFields(current => ({ ...current, [field]: checked === true }))} />{label}</label>)}
        </fieldset>
        {scope === "partial" && <label className="block space-y-1 text-sm">
          Partial quantity (of {selected[0].quantity})
          <Input type="number" min="1" max={selected[0].quantity} step="1" value={partialQuantity} onChange={event => setPartialQuantity(event.target.value)} />
        </label>}
        {selected.map(item => {
          const draft = drafts[draftKey(item.id)] ?? newLineDraft(item.quantity);
          const update = (change: Partial<LineDraft>) => editLine(item.id, item.quantity, change);
          const total = Number(scope === "partial" ? partialQuantity : draft.total);
          const perBatch = Number(draft.perBatch);
          const count = mode === "panels" ? isPositiveInteger(Number(draft.panels)) ? Number(draft.panels) : null :
            isPositiveInteger(total) && isPositiveInteger(perBatch) ? productionLabelBatchCount(total, perBatch) : null;
          return <fieldset key={item.id} className="space-y-2 rounded-md border p-2.5">
            <legend className="max-w-full break-words px-1 text-sm font-medium">Line {item.number}{item.description ? " · " + item.description : ""}</legend>
            {mode === "panels" && <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-sm">Number of panels
                <Input type="number" min="1" step="1" value={draft.panels} onChange={event => update({ panels: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">Artwork reference (optional)
                <Input maxLength={120} value={draft.artworkReference} onChange={event => update({ artworkReference: event.target.value })} />
              </label>
            </div>}
            {mode === "batches" && <>
              <div className="grid gap-2 sm:grid-cols-2">
                {scope !== "partial" && <label className="space-y-1 text-sm">Total quantity
                  <Input type="number" min="1" step="1" value={draft.total} onChange={event => update({ total: event.target.value })} />
                </label>}
                <label className="space-y-1 text-sm">Quantity per batch
                  <Input type="number" min="1" step="1" value={draft.perBatch} onChange={event => update({ perBatch: event.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.showRanges} onCheckedChange={checked =>
                update({ showRanges: checked === true })} />Show quantity ranges</label>
              <p className="text-sm" aria-live="polite">Calculated labels: {count ?? "—"}</p>
            </>}
            {mode !== "description" && <NumberSelection draft={draft} mode={mode} count={count} update={update} />}
          </fieldset>;
        })}
        <label className="block space-y-1 text-sm font-medium">Printer destination
          <select className={selectStyle} aria-label="Printer destination" value={destinationId} onChange={event => setChosenDestination(event.target.value)}>
            {destinations.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.unavailableReason)}>{item.name}{item.unavailableReason ? " (unavailable)" : ""}</option>)}
            <option value="browser">Browser Print</option>
          </select>
        </label>
        {destinations.filter(item => item.unavailableReason).map(item =>
          <p key={item.id} className="text-xs text-muted-foreground">{item.name} · {item.unavailableReason}</p>)}
        {destinationId === "browser" ? <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-sm">Label width (mm)<Input type="number" min="40" max="120" step="0.01" value={browserWidth} onChange={event => setBrowserWidth(event.target.value)} /></label>
          <label className="space-y-1 text-sm">Label height (mm)<Input type="number" min="20" max="160" step="0.01" value={browserHeight} onChange={event => setBrowserHeight(event.target.value)} /></label>
        </div> : destination?.media && <p className="text-sm">{destination.media.widthMm} × {destination.media.heightMm} mm · {destination.queueName}</p>}
      </fieldset>
      {activePreview && <div className="space-y-2">
        <p className="text-sm font-medium">{productionLabelModeNames[activePreview.document.mode]} · {activePreview.summary.labelCount} physical labels · {activePreview.destination?.name ?? "Browser Print"} · {activePreview.document.media.widthMm} × {activePreview.document.media.heightMm} mm</p>
        <p className="text-xs text-muted-foreground">{activePreview.summary.lines.map(item => "Line " + item.lineNumber + " (" + item.labelCount + ")").join(" · ")}</p>
        <iframe key={activePreview.previewFingerprint} ref={frame} title="Production item label preview" srcDoc={previewHtml}
          sandbox="allow-same-origin allow-modals" className="h-52 w-full rounded-md border bg-white" onLoad={() => void verifyFrame()} />
        {!activePreview.destination && <p className="text-xs text-muted-foreground">Select matching media and actual size in the browser print dialog.</p>}
        {requiresConfirmation && <label className="flex items-center gap-2 text-sm"><Checkbox checked={confirmedLargeJob} onCheckedChange={checked =>
          setConfirmedLargeJob(checked === true)} />Confirm printing {activePreview.summary.labelCount} labels</label>}
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {job && <div className="space-y-1 text-sm" role="status">
      <p>{job.labelCount} labels · {jobMessage(currentJobStatus ?? "queued", status.data?.lastError ?? null)}</p>
      {(status.isError || pendingJob) && <Button size="sm" type="button" variant="outline" onClick={() => void status.refetch()}>Check print status</Button>}
    </div>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
      <Button type="button" variant="outline" disabled={!request.success || previewing || submitting || Boolean(destination?.unavailableReason)}
        onClick={() => void showPreview()}>{previewing ? "Preparing preview…" : "Preview"}</Button>
      <Button type="button" disabled={!activePreview || !frameReady || submitting || pendingJob || (requiresConfirmation && !confirmedLargeJob)}
        onClick={() => void print()}>
        {submitting ? "Submitting…" : sameJob && currentJobStatus === "failed" ? "Retry Print" :
          sameJob && currentJobStatus === "submitted" ? "Reprint selected labels" : destinationId === "browser" ? "Browser Print" : "Print"}
      </Button>
    </div>
  </div>;
}
