import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { artworkApi, newBusinessRequestId } from "./api";

export type ArtworkUploadTarget = Readonly<{
  orderId: string;
  orderLineId: string;
  orderNumber: string;
  lineDescription: string;
}>;

/** Artwork owns binary intake; Sales supplies an already-authorized OrderLine target. */
export const ArtworkUploadPanel = ({ organizationId, target, onUploaded }: Readonly<{ organizationId: string; target: ArtworkUploadTarget; onUploaded: () => void }>) => {
  const [file, setFile] = useState<File | undefined>();
  const [purpose, setPurpose] = useState<"customer_supplied" | "production" | "proof" | "reference">("customer_supplied");
  const [side, setSide] = useState<"front" | "back">("front");
  const upload = useMutation({
    mutationFn: () => artworkApi.upload(organizationId, newBusinessRequestId(), { orderId: target.orderId, orderLineId: target.orderLineId, purpose, side, file: file! }),
    onSuccess: () => { setFile(undefined); onUploaded(); },
  });
  return <section className="v2-artwork-upload" aria-labelledby="artwork-upload-heading">
    <header><div><p className="eyebrow">Order-line artwork</p><h2 id="artwork-upload-heading">Upload Artwork</h2><p>Upload a canonical PDF for this production line. Artwork owns the file and its assignment.</p></div><span>#{target.orderNumber}</span></header>
    <dl className="v2-artwork-upload-target"><div><dt>Order</dt><dd>#{target.orderNumber}</dd></div><div><dt>Line item</dt><dd>{target.lineDescription}</dd></div></dl>
    <div className="v2-artwork-upload-fields"><label className="v2-artwork-file-picker"><span>Artwork PDF</span><input aria-label="Artwork PDF" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.currentTarget.files?.[0])} /><b>{file ? "Change PDF" : "Choose PDF"}</b></label><p className="v2-artwork-selected-file" aria-live="polite">{file ? `Selected: ${file.name}` : "No PDF selected."}</p><label>Purpose<select aria-label="Artwork purpose" value={purpose} onChange={(event) => setPurpose(event.currentTarget.value as typeof purpose)}><option value="customer_supplied">Customer supplied</option><option value="production">Production</option><option value="proof">Proof</option><option value="reference">Reference</option></select></label><label>Side<select aria-label="Artwork side" value={side} onChange={(event) => setSide(event.currentTarget.value as typeof side)}><option value="front">Front</option><option value="back">Back</option></select></label></div>
    <button className="button" type="button" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Uploading…" : "Upload Artwork"}</button>
    {upload.isSuccess && <p className="v2-artwork-upload-success" role="status">Artwork uploaded and assigned to this line.</p>}
    {upload.isError && <p className="v2-product-version-message" role="alert">{(upload.error as Error).message}</p>}
  </section>;
};
