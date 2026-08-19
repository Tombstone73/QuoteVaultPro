import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { artworkApi, newBusinessRequestId } from "./api";

/** Artwork owns binary intake; Orders only deep-link here with record context. */
export const ArtworkUploadPanel = ({ organizationId, onUploaded }: Readonly<{ organizationId: string; onUploaded: () => void }>) => {
  const [file, setFile] = useState<File | undefined>();
  const [orderId, setOrderId] = useState("");
  const [orderLineId, setOrderLineId] = useState("");
  const [purpose, setPurpose] = useState<"customer_supplied" | "production" | "proof" | "reference">("customer_supplied");
  const [side, setSide] = useState<"front" | "back">("front");
  const upload = useMutation({ mutationFn: () => artworkApi.upload(organizationId, newBusinessRequestId(), { orderId, orderLineId, purpose, side, file: file! }), onSuccess: () => { setFile(undefined); onUploaded(); } });
  return <section className="v2-artwork-note"><h2>Upload Artwork</h2><p>Upload a canonical PDF and assign it to an Order line. Artwork owns the file and assignment; downstream work consumes that evidence.</p><label>Order ID<input aria-label="Artwork Order ID" value={orderId} onChange={(event) => setOrderId(event.currentTarget.value)} /></label><label>Order line ID<input aria-label="Artwork Order line ID" value={orderLineId} onChange={(event) => setOrderLineId(event.currentTarget.value)} /></label><label>Artwork PDF<input aria-label="Artwork PDF" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.currentTarget.files?.[0])} /></label><label>Purpose<select aria-label="Artwork purpose" value={purpose} onChange={(event) => setPurpose(event.currentTarget.value as typeof purpose)}><option value="customer_supplied">Customer supplied</option><option value="production">Production</option><option value="proof">Proof</option><option value="reference">Reference</option></select></label><label>Side<select aria-label="Artwork side" value={side} onChange={(event) => setSide(event.currentTarget.value as typeof side)}><option value="front">Front</option><option value="back">Back</option></select></label><button type="button" disabled={!file || !orderId.trim() || !orderLineId.trim() || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Uploading…" : "Upload and assign"}</button>{upload.isSuccess && <p>Artwork uploaded and assigned.</p>}{upload.isError && <p className="v2-product-version-message">{(upload.error as Error).message}</p>}</section>;
};
