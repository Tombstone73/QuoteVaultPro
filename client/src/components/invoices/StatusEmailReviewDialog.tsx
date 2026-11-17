import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { InvoiceEmailQueueJob } from "@/hooks/useInvoices";
import { apiFetch } from "@/lib/queryClient";
import {
  statusEmailOutcomeLabels, statusEmailOutcomes,
  type StatusEmailOutcome, type StatusEmailReviewCommand, type StatusEmailReviewResult,
} from "@shared/statusEmailReview";

function time(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? format(date, "PP p") : "None recorded";
}

export function StatusEmailReviewDialog({ job, onClose }: { job: InvoiceEmailQueueJob; onClose: () => void }) {
  const [outcome, setOutcome] = useState<StatusEmailOutcome>("unresolved");
  const [evidence, setEvidence] = useState("");
  const [gmailMessageId, setGmailMessageId] = useState("");
  const [confirmResend, setConfirmResend] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const request = useRef<{ fingerprint: string; id: string }>();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (command: StatusEmailReviewCommand) => {
      const response = await apiFetch(`/api/invoices/email-queue/${encodeURIComponent(job.id)}/status-review`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error || "Unable to save the review. Try again.");
      return result.data as StatusEmailReviewResult;
    },
    onSuccess: () => {
      setConfirmResend(false);
      setAcknowledged(false);
      void queryClient.invalidateQueries({ queryKey: ["invoices", "email-queue"] });
    },
  });
  const review = mutation.data?.review ?? job.metadata.statusDeliveryReview;
  const latest = review?.entries.at(-1);
  const status = mutation.data?.status ?? job.status;
  const canResend = status === "failed" && latest?.outcome === "confirmed_not_sent" && !review?.replacement;
  const recordable = status === "needs_review" && !mutation.data;
  const orderLabel = `Order #${job.metadata.orderNumber ?? job.statusOrderId ?? "Unknown"}`;

  function record() {
    const notes = evidence.trim();
    if (!notes || mutation.isPending) return;
    const messageId = outcome === "confirmed_sent" ? gmailMessageId.trim() || undefined : undefined;
    const fingerprint = JSON.stringify([outcome, notes, messageId]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    mutation.mutate({ action: "record", requestId: request.current.id, outcome, evidence: notes, gmailMessageId: messageId });
  }

  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Review Order Status Email</DialogTitle>
        <DialogDescription>Record what you independently verified. A missing Gmail receipt does not prove an email was never sent.</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-x-4 gap-y-2 break-words text-sm sm:grid-cols-2">
        <div><dt className="font-medium">Order</dt><dd>{job.statusOrderId
          ? <a className="underline" href={`/orders/${encodeURIComponent(job.statusOrderId)}`} target="_blank" rel="noreferrer">{orderLabel}</a>
          : orderLabel}</dd></div>
        <div><dt className="font-medium">Triggering status</dt><dd>{job.metadata.statusLabel || "None recorded"}</dd></div>
        <div><dt className="font-medium">Intended recipient</dt><dd>{job.recipientEmail}</dd></div>
        <div><dt className="font-medium">Queue status</dt><dd>{latest && latest.outcome !== "unresolved"
          ? statusEmailOutcomeLabels[latest.outcome] : status === "needs_review" ? "Needs Review" : status}</dd></div>
        <div><dt className="font-medium">Scheduled for</dt><dd>{time(job.sendAfter ?? job.availableAt)}</dd></div>
        <div><dt className="font-medium">Delivery attempt claimed</dt><dd>{time(job.claimedAt)}</dd></div>
        <div><dt className="font-medium">Gmail submission started</dt><dd>{time(job.metadata.providerSubmissionStartedAt)}</dd></div>
        <div><dt className="font-medium">Gmail message ID</dt><dd>{job.providerMessageId ?? latest?.gmailMessageId ?? "None recorded"}</dd></div>
        <div className="sm:col-span-2"><dt className="font-medium">Failure reason</dt><dd className="whitespace-pre-wrap">{job.failureReason || "None recorded"}</dd></div>
        <div className="sm:col-span-2"><dt className="font-medium">Delivery evidence</dt><dd>
          Attempt {job.attemptCount} of {job.maxAttempts}
          {review?.attemptUpdatedAt && ` · Attempt last updated ${time(review.attemptUpdatedAt)}`}
          {job.metadata.queueStage ? ` · Queue stage ${job.metadata.queueStage.replace(/_/g, " ")}` : ""}
          {job.metadata.lastStage ? ` · Last recorded stage ${job.metadata.lastStage.replace(/_/g, " ")} (${time(job.metadata.lastStageAt)})` : ""}
          {job.sentAt ? ` · Queue recorded sent at ${time(job.sentAt)}` : ""}
        </dd></div>
        <div className="sm:col-span-2"><dt className="font-medium">Subject</dt><dd>{job.metadata.subject || "None recorded"}</dd></div>
        <div className="sm:col-span-2"><dt className="font-medium">Message</dt><dd className="max-h-36 overflow-auto whitespace-pre-wrap rounded border p-2">{job.metadata.body || "None recorded"}</dd></div>
      </dl>
      {!!review?.entries.length && <section className="space-y-2 text-sm" aria-label="Review history">
        <h3 className="font-medium">Review history</h3>
        {review.entries.map(entry => <div key={entry.requestId} className="rounded border p-2">
          <div className="font-medium">{statusEmailOutcomeLabels[entry.outcome]} · {entry.reviewerName || entry.reviewerId} · {time(entry.reviewedAt)}</div>
          <p className="whitespace-pre-wrap break-words">{entry.evidence}</p>
          {entry.gmailMessageId && <p className="break-all">Reviewer recorded Gmail message ID {entry.gmailMessageId}</p>}
        </div>)}
      </section>}
      {review?.replacement && <p role="status" className="text-sm">New delivery {review.replacement.jobId} was requested by {review.replacement.reviewerName || review.replacement.reviewerId} at {time(review.replacement.requestedAt)}. Check the queue for its delivery status.</p>}
      {recordable && <fieldset disabled={mutation.isPending} className="space-y-2 border-t pt-3">
        <label className="block text-sm font-medium">Review outcome
          <select value={outcome} onChange={event => { mutation.reset(); setOutcome(event.target.value as StatusEmailOutcome); }}
            className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2">
            {statusEmailOutcomes.map(value => <option key={value} value={value}>{statusEmailOutcomeLabels[value]}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm font-medium">Verification evidence
          <Textarea value={evidence} maxLength={2000} onChange={event => setEvidence(event.target.value)}
            placeholder={outcome === "unresolved" ? "Record what you checked and why the outcome is still uncertain."
              : "Describe the independent evidence supporting this outcome."} />
        </label>
        {outcome === "confirmed_sent" && <label className="block space-y-1 text-sm font-medium">Verified Gmail message ID (optional)
          <Input value={gmailMessageId} maxLength={255} onChange={event => setGmailMessageId(event.target.value)} />
        </label>}
        {outcome === "unresolved" && <p className="text-sm text-muted-foreground">The email stays blocked from automatic retries.</p>}
      </fieldset>}
      {confirmResend && <div className="space-y-2 rounded-md border border-amber-500/50 p-3 text-sm">
        <p>A previously accepted email cannot be recalled. Request a new send only if your independent verification confirms the original was never sent.</p>
        <label className="flex items-center gap-2"><Checkbox checked={acknowledged} disabled={mutation.isPending}
          onCheckedChange={checked => setAcknowledged(checked === true)} />I confirm that I want to queue a new delivery.</label>
      </div>}
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Close review</Button>
        {recordable && <Button type="button" disabled={mutation.isPending || !evidence.trim()} onClick={record}>Record review</Button>}
        {canResend && !confirmResend && <Button type="button" onClick={() => setConfirmResend(true)}>Request new send</Button>}
        {confirmResend && <Button type="button" disabled={mutation.isPending || !acknowledged}
          onClick={() => mutation.mutate({ action: "resend", confirmed: true })}>Queue new delivery</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
