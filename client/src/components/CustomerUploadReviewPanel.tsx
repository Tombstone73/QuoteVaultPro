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
  customerUploadPromotionType?: "reference" | "artwork" | null;
  customerUploadAssignedToOrderLineItemId?: string | null;
  customerUploadAssignmentType?: "reference_for_line_item" | null;
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
  promotionUrl,
  assignmentUrl,
  orderId,
  orderLineItems = [],
  attachments,
  orderPromotionAllowed = false,
  onReviewed,
}: {
  entityLabel: "Quote" | "Order";
  reviewUrl: (attachmentId: string) => string;
  promotionUrl: (attachmentId: string) => string;
  assignmentUrl?: (attachmentId: string) => string;
  orderId?: string;
  orderLineItems?: Array<{ id: string; description: string; sortOrder?: number | null }>;
  attachments: CustomerUploadReviewAttachment[];
  orderPromotionAllowed?: boolean;
  onReviewed: () => void;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState<CustomerUploadReviewAttachment | null>(null);
  const [promotionTarget, setPromotionTarget] = useState<CustomerUploadReviewAttachment | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<CustomerUploadReviewAttachment | null>(null);
  const [decision, setDecision] = useState<"accepted" | "rejected">("accepted");
  const [promotion, setPromotion] = useState<"reference" | "artwork">("reference");
  const [reviewNote, setReviewNote] = useState("");
  const [assignmentLineItemId, setAssignmentLineItemId] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
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

  const submitAssignment = async () => {
    if (!assignmentTarget || !assignmentUrl || !orderId || !assignmentLineItemId) return;
    setSubmitting(true);
    try {
      const response = await fetch(assignmentUrl(assignmentTarget.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetOrderId: orderId,
          targetLineItemId: assignmentLineItemId,
          assignmentType: "reference_for_line_item",
          assignmentNote: assignmentNote.trim() || null,
          confirmAssignment: true,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to assign this customer upload.");
      }
      toast({
        title: "Customer upload assigned as line-item reference",
        description: "The file remains non-primary and not final art. No prepress, proof, production, or billing workflow changed.",
      });
      setAssignmentTarget(null);
      setAssignmentLineItemId("");
      setAssignmentNote("");
      onReviewed();
    } catch (error: any) {
      toast({ title: "Assignment failed", description: error?.message || "Unable to assign this customer upload.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const submitPromotion = async () => {
    if (!promotionTarget) return;
    setSubmitting(true);
    try {
      const response = await fetch(promotionUrl(promotionTarget.id), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promotion: orderPromotionAllowed ? promotion : "reference",
          confirmPromotion: true,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to promote this customer upload.");
      }
      toast({
        title: "Customer upload promoted",
        description: "The file remains non-primary and is not final art. No workflow state changed.",
      });
      setPromotionTarget(null);
      onReviewed();
    } catch (error: any) {
      toast({ title: "Promotion failed", description: error?.message || "Unable to promote this customer upload.", variant: "destructive" });
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
        const assignedLineItem = orderLineItems.find((lineItem) => lineItem.id === attachment.customerUploadAssignedToOrderLineItemId);
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
            {attachment.customerUploadPromotionType ? <p className="mt-1 text-xs text-muted-foreground">Promoted as {attachment.customerUploadPromotionType === "artwork" ? "artwork reference" : "approved reference"}; not primary or final art.</p> : null}
            {attachment.customerUploadAssignmentType ? <p className="mt-1 text-xs text-muted-foreground">Assigned as a reference for line item: {assignedLineItem?.description || attachment.customerUploadAssignedToOrderLineItemId}. It is not primary or final art.</p> : null}
            {pending ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openReview(attachment, "accepted")}>Accept for review</Button>
                <Button size="sm" variant="outline" onClick={() => openReview(attachment, "rejected")}>Reject</Button>
              </div>
            ) : null}
            {attachment.customerUploadReviewStatus === "accepted" && !attachment.customerUploadPromotionType ? (
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => { setPromotionTarget(attachment); setPromotion("reference"); }}>Promote for use</Button>
              </div>
            ) : null}
            {orderPromotionAllowed && attachment.customerUploadPromotionType === "artwork" && !attachment.customerUploadAssignmentType ? (
              <div className="mt-2">
                <Button size="sm" variant="outline" disabled={!assignmentUrl || !orderId || orderLineItems.length === 0} onClick={() => { setAssignmentTarget(attachment); setAssignmentLineItemId(""); setAssignmentNote(""); }}>Assign as line-item reference</Button>
                {orderLineItems.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Add an order line item before assigning this reference.</p> : null}
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

      <Dialog open={Boolean(assignmentTarget)} onOpenChange={(open) => !open && !submitting && setAssignmentTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm line-item reference assignment</DialogTitle>
            <DialogDescription>
              This links the promoted artwork reference to the selected line item for staff reference only. It does not assign primary or final art, complete prepress, approve proof, route production, or change billing or payments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Target order</Label>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">Current order: {orderId}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-upload-assignment-line-item">Target order line item</Label>
            <Select value={assignmentLineItemId} onValueChange={setAssignmentLineItemId}>
              <SelectTrigger id="customer-upload-assignment-line-item"><SelectValue placeholder="Select a line item" /></SelectTrigger>
              <SelectContent>
                {orderLineItems.map((lineItem, index) => <SelectItem key={lineItem.id} value={lineItem.id}>Line {lineItem.sortOrder ?? index + 1}: {lineItem.description}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Assignment type</Label>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">Reference for selected line item (safe only)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-upload-assignment-note">Internal assignment note (optional)</Label>
            <Textarea id="customer-upload-assignment-note" value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => setAssignmentTarget(null)}>Cancel</Button>
            <Button disabled={submitting || !assignmentLineItemId} onClick={submitAssignment}>{submitting ? "Assigningâ€¦" : "Confirm assignment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(promotionTarget)} onOpenChange={(open) => !open && !submitting && setPromotionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm customer upload promotion</DialogTitle>
            <DialogDescription>
              This explicit staff action makes the accepted upload usable as a safe reference. It does not mark final art, complete prepress, approve proof, route production, or change billing or payments.
            </DialogDescription>
          </DialogHeader>
          {orderPromotionAllowed ? (
            <div className="space-y-2">
              <Label htmlFor="customer-upload-promotion">Promotion type</Label>
              <Select value={promotion} onValueChange={(value) => setPromotion(value as "reference" | "artwork")}>
                <SelectTrigger id="customer-upload-promotion"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">Approved reference (safe default)</SelectItem>
                  <SelectItem value="artwork">Artwork reference (not primary or final art)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : <p className="text-sm text-muted-foreground">This quote upload will be promoted as an approved reference.</p>}
          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => setPromotionTarget(null)}>Cancel</Button>
            <Button disabled={submitting} onClick={submitPromotion}>{submitting ? "Promotingâ€¦" : "Confirm promotion"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
