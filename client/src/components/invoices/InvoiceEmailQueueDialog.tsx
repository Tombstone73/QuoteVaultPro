import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/titan/StatusPill";
import { useCancelInvoiceEmailQueueJobs, useInvoiceEmailQueue, type InvoiceEmailQueueJob } from "@/hooks/useInvoices";
import { canCancelEmailQueueJob } from "@shared/emailQueueLifecycle";

const labels: Record<string, string> = { queued: "Waiting", processing: "Sending", retrying: "Retrying", failed: "Delivery Failed", needs_review: "Needs Review", sent: "Sent", canceled: "Canceled", superseded: "Superseded" };
type QueueView = "active" | "failed" | "sent" | "canceled" | "superseded" | "all";

export function InvoiceEmailQueueDialog({ open, onOpenChange, onOpenInvoice, onReview, view, setView, page, setPage }: {
  open: boolean; onOpenChange: (open: boolean) => void; onOpenInvoice: (id: string) => void;
  onReview: (job: InvoiceEmailQueueJob) => void;
  view: QueueView; setView: (view: QueueView) => void; page: number; setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmJobs, setConfirmJobs] = useState<InvoiceEmailQueueJob[]>([]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const queue = useInvoiceEmailQueue(open, view, page);
  const cancel = useCancelInvoiceEmailQueueJobs();
  const rows = queue.data?.items || [];
  const selectedRows = rows.filter(row => selected.includes(row.id));
  const eligible = confirmJobs.filter(job => canCancelEmailQueueJob(job.status));
  useEffect(() => { setSelected([]); }, [view, page, open]);
  const confirm = async () => {
    setError("");
    try {
      const result = await cancel.mutateAsync({ jobIds: confirmJobs.map(job => job.id), reason: reason.trim() || undefined });
      setNotice(`${result.canceled.length} canceled${result.alreadyCanceled.length ? `, ${result.alreadyCanceled.length} already canceled` : ""}${result.skipped.length ? `, ${result.skipped.length} skipped (${Array.from(new Set(result.skipped.map(job => job.status))).join(", ")})` : ""}.`);
      setConfirmJobs([]); setSelected([]); setReason("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to cancel email jobs"); }
  };
  const beginCancel = (jobs: InvoiceEmailQueueJob[]) => { setConfirmJobs(jobs); setReason(""); setError(""); };
  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Invoice Email Queue</DialogTitle><DialogDescription>Waiting emails are sent oldest first, about one per minute. Sent updates only after provider acceptance.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={view} onValueChange={value => { setView(value as QueueView); setPage(1); }}><SelectTrigger className="w-[170px]" aria-label="Invoice email queue filter"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="active">Waiting / Sending</SelectItem><SelectItem value="failed">Problems</SelectItem><SelectItem value="sent">Sent History</SelectItem><SelectItem value="canceled">Canceled</SelectItem><SelectItem value="superseded">Superseded</SelectItem><SelectItem value="all">All History</SelectItem>
          </SelectContent></Select>
          <span className="text-xs text-muted-foreground">{queue.data ? `${queue.data.counts.active} waiting or sending · ${queue.data.counts.failed} failed · ${queue.data.counts.needsReview} need review` : ""}</span>
          <Button type="button" variant="outline" size="sm" disabled={!selectedRows.some(row => canCancelEmailQueueJob(row.status))} onClick={() => beginCancel(selectedRows)}>Cancel selected ({selectedRows.filter(row => canCancelEmailQueueJob(row.status)).length} eligible)</Button>
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {queue.isError && <p role="alert" className="text-sm text-destructive">Unable to load queue. <Button variant="ghost" size="sm" onClick={() => void queue.refetch()}>Retry</Button></p>}
        <div className="min-h-0 flex-1 overflow-auto rounded border">
          <table className="w-full text-sm"><thead className="sticky top-0 bg-background"><tr className="border-b text-left">
            <th className="p-2"><Checkbox aria-label="Select visible queue jobs" checked={rows.length > 0 && rows.every(row => selected.includes(row.id))} onCheckedChange={checked => setSelected(checked ? rows.map(row => row.id) : [])} /></th>
            <th className="p-2">Invoice</th><th className="p-2">Recipient</th><th className="p-2">Queued</th><th className="p-2">Status</th><th className="p-2">Details</th><th className="p-2" />
          </tr></thead><tbody>
            {queue.isLoading ? <tr><td className="p-4" colSpan={7}>Loading queue…</td></tr> : rows.length ? rows.map(job => {
              const needsReview = job.status === "needs_review";
              const stale = job.status === "processing" && job.claimedAt && Date.now() - new Date(job.claimedAt).getTime() > (queue.data?.claimSeconds || 60) * 1000;
              const audit = job.metadata?.cancellation, replacement = job.metadata?.supersession;
              return <tr className="border-b align-top" key={job.id} data-testid={`email-queue-job-${job.id}`}>
                <td className="p-2"><Checkbox aria-label={`Select email job ${job.id}`} checked={selected.includes(job.id)} onCheckedChange={checked => setSelected(previous => checked ? [...previous, job.id] : previous.filter(id => id !== job.id))} /></td>
                <td className="p-2">{job.deliveryType === "customer_statement" ? `Statement${job.customerName ? ` · ${job.customerName}` : ""}` : job.invoiceNumber || job.legacyInvoiceNumber || "Invoice"}</td>
                <td className="p-2 break-all">{job.recipientEmail}</td><td className="p-2 text-xs">{format(new Date(job.queuedAt), "PP p")}</td>
                <td className="p-2"><StatusPill variant={job.status === "failed" ? "error" : needsReview || job.status === "processing" || job.status === "retrying" ? "warning" : job.status === "sent" ? "info" : "muted"}>{labels[job.status] || job.status}{stale ? " · Recovering" : ""}</StatusPill></td>
                <td className="max-w-[240px] break-words p-2 text-xs text-muted-foreground">
                  {job.status === "processing" ? "Processing — cannot safely cancel. " : job.status === "queued" ? `Scheduled for ${format(new Date(job.availableAt), "p")}. ` : job.status === "retrying" ? `Retry scheduled for ${format(new Date(job.availableAt), "p")}. ` : `Attempt ${job.attemptCount} of ${job.maxAttempts}. `}
                  {needsReview && "Delivery outcome uncertain. Retry blocked until reviewed. "}
                  {job.status === "failed" && "Terminal failure; a new send request is required. "}
                  {job.failureReason}
                  {audit && <><br />Canceled {format(new Date(audit.canceledAt), "PP p")}{audit.canceledByUserName ? ` by ${audit.canceledByUserName}` : ""}.{audit.reason ? ` Reason: ${audit.reason}` : ""}</>}
                  {replacement && <><br />Replaced by successful send <span className="break-all" title={replacement.evidence}>{replacement.replacementJobId}</span>.</>}
                  {job.metadata?.deliveryReview?.reviewedAt && <><br />Reviewed {format(new Date(job.metadata.deliveryReview.reviewedAt), "PP p")}{job.metadata.deliveryReview.reviewedByUserName ? ` by ${job.metadata.deliveryReview.reviewedByUserName}` : ""}.</>}
                </td>
                <td className="p-2"><div className="flex flex-wrap gap-1">
                  {canCancelEmailQueueJob(job.status) && <Button type="button" variant="outline" size="sm" onClick={() => beginCancel([job])}>Cancel</Button>}
                  {needsReview && job.invoiceId && job.deliveryType !== "customer_statement" && <Button variant="outline" size="sm" onClick={() => onReview(job)}>Review</Button>}
                  {job.invoiceId && <Button variant="ghost" size="sm" onClick={() => onOpenInvoice(job.invoiceId!)}>Open</Button>}
                </div></td>
              </tr>;
            }) : <tr><td className="p-4 text-muted-foreground" colSpan={7}>No matching email delivery jobs.</td></tr>}
          </tbody></table>
        </div>
        {queue.data && <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Page {queue.data.pagination.page} of {queue.data.pagination.totalPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(previous => previous - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= queue.data!.pagination.totalPages} onClick={() => setPage(previous => previous + 1)}>Next</Button></div></div>}
      </DialogContent>
    </Dialog>
    <Dialog open={confirmJobs.length > 0} onOpenChange={value => { if (!value && !cancel.isPending) setConfirmJobs([]); }}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Cancel queued email?</DialogTitle><DialogDescription>{eligible.length} of {confirmJobs.length} selected jobs are currently cancelable. Eligible jobs will not be sent or retried after cancellation. Any jobs that have started processing will be skipped.</DialogDescription></DialogHeader>
        {confirmJobs.some(job => job.status === "needs_review") && <p className="text-sm">An uncertain earlier delivery may already have reached the recipient. Cancellation stops future attempts; it cannot recall a submitted email.</p>}
        <label className="text-sm">Reason (optional)<Input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={cancel.isPending} onClick={() => setConfirmJobs([])}>Keep queued</Button><Button variant="destructive" disabled={cancel.isPending || !eligible.length} onClick={() => void confirm()}>{cancel.isPending ? "Canceling…" : "Confirm cancellation"}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
