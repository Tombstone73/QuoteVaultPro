import { useState } from "react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export type CustomerUploadReviewAttachment = {
  id: string;
  fileName: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  createdAt: string;
  uploadedByName?: string | null;
  portalFileCategory?: string | null;
  customerUploadReviewStatus?: "pending_review" | "accepted" | "rejected" | null;
  customerUploadReviewNote?: string | null;
  isPrimary?: boolean | null;
};

function statusLabel(status: CustomerUploadReviewAttachment["customerUploadReviewStatus"]) {
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  return "Pending review";
}

export function CustomerUploadReviewPanel({
  entityLabel,
  reviewUrl,
  attachments,
  orderPromotionAllowed = false,
  onReviewed,
}: {
  entityLabel: "Quote" | "Order";
  reviewUrl: (attachmentId: string) => string;
  attachments: CustomerUploadReviewAttachment[];
  orderPromotionAllowed?: boolean;
  onReviewed: () => void;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState<CustomerUploadReviewAttachment | null>(null);
  const [decision, setDecision] = useState<"accepted" | "rejected">("accepted");
  const [promotion, setPromotion] = useState<"reference" | "artwork">("reference");
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const customerUploads = attachments.filter((attachment) => attachment.portalFileCategory === "customer_upload");
  if (customerUploads.length === 0) return null;

  const openReview = (attachment: CustomerUploadReviewAttachment, nextDecision: "accepted" | "rejected") => {
    setTarget(attachment);
    setDecision(nextDecision);
    setPromotion("reference");
    setReviewNote("");
  };

  const submitReview = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      const response = await fetch(reviewUrl(target.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: decision,
          ...(orderPromotionAllowed && decision === "accepted" ? { promotion } : {}),
          reviewNote: reviewNote.trim() || null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to review this customer upload.");
      }
      toast({
        title: decision === "accepted" ? "Customer upload accepted" : "Customer upload rejected",
        description: "No production, prepress, proof, or billing workflow was changed.",
      });
      setTarget(null);
      onReviewed();
    } catch (error: any) {
      toast({ title: "Review failed", description: error?.message || "Unable to review this customer upload.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div>
        <p className="text-sm font-medium">Customer uploads</p>
        <p className="text-xs text-muted-foreground">Review/reference files only. They are not final art and do not change workflow automatically.</p>
      </div>
      {customerUploads.map((attachment) => {
        const pending = attachment.customerUploadReviewStatus === "pending_review" || !attachment.customerUploadReviewStatus;
        const filename = attachment.originalFilename || attachment.fileName;
        return (
          <div key={attachment.id} className="rounded border bg-background p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium break-all">{filename}</span>
              <Badge variant={pending ? "secondary" : attachment.customerUploadReviewStatus === "rejected" ? "destructive" : "outline"}>{statusLabel(attachment.customerUploadReviewStatus)}</Badge>
              <Badge variant="outline">Not final art</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {entityLabel} attachment / Customer: {attachment.uploadedByName || "Customer"} / {attachment.mimeType || "File"} / {format(new Date(attachment.createdAt), "PP p")}
            </p>
            {attachment.customerUploadReviewNote ? <p className="mt-1 text-xs text-muted-foreground">Review note: {attachment.customerUploadReviewNote}</p> : null}
            {pending ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openReview(attachment, "accepted")}>Accept for review</Button>
                <Button size="sm" variant="outline" onClick={() => openReview(attachment, "rejected")}>Reject</Button>
              </div>
            ) : null}
          </div>
        );
      })}

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !submitting && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "accepted" ? "Accept customer upload" : "Reject customer upload"}</DialogTitle>
            <DialogDescription>
              This records a staff review only. It does not mark final art, complete prepress, approve a proof, or route production.
            </DialogDescription>
          </DialogHeader>
          {orderPromotionAllowed && decision === "accepted" ? (
            <div className="space-y-2">
              <Label htmlFor="customer-upload-promotion">Attachment classification</Label>
              <Select value={promotion} onValueChange={(value) => setPromotion(value as "reference" | "artwork")}>
                <SelectTrigger id="customer-upload-promotion"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">Approved reference (safe default)</SelectItem>
                  <SelectItem value="artwork">Artwork reference (not primary or final art)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="customer-upload-review-note">Customer-visible review note {decision === "rejected" ? "(recommended)" : "(optional)"}</Label>
            <Textarea id="customer-upload-review-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant={decision === "rejected" ? "destructive" : "default"} disabled={submitting} onClick={submitReview}>
              {submitting ? "Saving…" : decision === "accepted" ? "Accept upload" : "Reject upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
