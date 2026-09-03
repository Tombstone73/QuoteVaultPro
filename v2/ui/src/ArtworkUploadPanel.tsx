import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { artworkApi, newBusinessRequestId, type ArtworkOrderProjection } from "./api";
import { ArtworkAutoUploadDropzone } from "./ArtworkAutoUploadDropzone";

export type ArtworkUploadTarget = Readonly<{
  orderId: string;
  orderLineId: string;
  orderNumber: string;
  lineDescription: string;
}>;

type ArtworkUploadRequest = Readonly<{
  businessRequestId: string;
  file: File;
  purpose: ArtworkOrderProjection["assignment"]["purpose"];
  side: NonNullable<ArtworkOrderProjection["assignment"]["side"]>;
  supersedesArtworkAssignmentId?: string;
}>;

export const currentArtworkAssignmentId = (
  assignments: readonly ArtworkOrderProjection["assignment"][],
  purpose: ArtworkOrderProjection["assignment"]["purpose"],
  side: NonNullable<ArtworkOrderProjection["assignment"]["side"]>,
): string | undefined => assignments.find((assignment) => assignment.purpose === purpose && assignment.side === side)?.id;

/** Artwork owns binary intake; Sales supplies an already-authorized OrderLine target. */
export const ArtworkUploadPanel = ({ organizationId, target, currentAssignments = [], onUploaded }: Readonly<{ organizationId: string; target: ArtworkUploadTarget; currentAssignments?: readonly ArtworkOrderProjection["assignment"][]; onUploaded: () => void }>) => {
  const [request, setRequest] = useState<ArtworkUploadRequest | undefined>();
  const [purpose, setPurpose] = useState<"customer_supplied" | "production" | "proof" | "reference">("customer_supplied");
  const [side, setSide] = useState<"front" | "back">("front");
  const upload = useMutation({
    mutationFn: (pending: ArtworkUploadRequest) => artworkApi.upload(organizationId, pending.businessRequestId, { orderId: target.orderId, orderLineId: target.orderLineId, purpose: pending.purpose, side: pending.side, ...(pending.supersedesArtworkAssignmentId ? { supersedesArtworkAssignmentId: pending.supersedesArtworkAssignmentId } : {}), file: pending.file }),
    onSuccess: () => { setRequest(undefined); onUploaded(); },
  });
  const select = (file: File) => {
    const supersedesArtworkAssignmentId = currentArtworkAssignmentId(currentAssignments, purpose, side);
    const pending: ArtworkUploadRequest = { businessRequestId: newBusinessRequestId(), file, purpose, side, ...(supersedesArtworkAssignmentId ? { supersedesArtworkAssignmentId } : {}) };
    setRequest(pending);
    upload.mutate(pending);
  };
  return <section className="v2-artwork-upload" aria-labelledby="artwork-upload-heading">
    <header><div><p className="eyebrow">Order-line artwork</p><h2 id="artwork-upload-heading">Upload Artwork</h2><p>Upload a canonical PDF for this production line. Artwork owns the file and its assignment.</p></div><span>#{target.orderNumber}</span></header>
    <dl className="v2-artwork-upload-target"><div><dt>Order</dt><dd>#{target.orderNumber}</dd></div><div><dt>Line item</dt><dd>{target.lineDescription}</dd></div></dl>
    <div className="v2-artwork-upload-fields"><label>Purpose<select aria-label="Artwork purpose" disabled={upload.isPending} value={purpose} onChange={(event) => setPurpose(event.currentTarget.value as typeof purpose)}><option value="customer_supplied">Customer supplied</option><option value="production">Production</option><option value="proof">Proof</option><option value="reference">Reference</option></select></label><label>Side<select aria-label="Artwork side" disabled={upload.isPending} value={side} onChange={(event) => setSide(event.currentTarget.value as typeof side)}><option value="front">Front</option><option value="back">Back</option></select></label></div>
    <ArtworkAutoUploadDropzone label="Order artwork PDF" fileName={request?.file.name} isUploading={upload.isPending} isSuccess={upload.isSuccess} error={upload.error} onFileSelected={select} onRetry={request ? () => upload.mutate(request) : undefined} />
  </section>;
};
