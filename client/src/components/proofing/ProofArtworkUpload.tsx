import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadAttachmentViaChunked } from "@/lib/uploads/chunkedAttachmentUpload";
import { boundedProofingRequest } from "@/lib/proofingRequest";

type Source = { canonicalArtworkId?: string | null; revisionRole?: string | null; fileName: string; allocatedQuantity: number | null; side: "front" | "back" | "both" | "na" };

/** Uses the same upload/link operation as Order entry; no new file owner or upload route. */
export function ProofArtworkUpload({ orderId, lineItemId, sources, onUploaded }: {
  orderId: string; lineItemId: string; sources: Source[]; onUploaded: () => Promise<void>;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [replacement, setReplacement] = useState("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const finalized = useRef<{ file: File; fileId: string } | null>(null);
  const linked = useRef<{ file: File; attachmentId: string } | null>(null);
  const currentSources = sources.filter((source) => source.canonicalArtworkId && source.revisionRole === "customer_source");
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setMessage(null);
    try {
      const source = currentSources.find((item) => item.canonicalArtworkId === replacement);
      if (!linked.current || linked.current.file !== file) {
        const result = await boundedProofingRequest((signal) => uploadAttachmentViaChunked({ file, signal,
          finalizedFileId: finalized.current?.file === file ? finalized.current.fileId : undefined,
          onFinalized: (fileId) => { finalized.current = { file, fileId }; },
          purpose: "order-attachment", parentId: orderId, linkUrl: `/api/orders/${orderId}/files`,
          linkBody: { orderLineItemId: lineItemId, role: "artwork", proofingEdit: true, side: source?.side ?? "na", replacesArtworkId: replacement || null,
            productionQuantity: quantity ? Number(quantity) : source?.allocatedQuantity ?? null },
        }));
        linked.current = { file, attachmentId: String(result.linkResponse?.data?.id ?? "") };
      }
      await boundedProofingRequest(() => onUploaded());
      setFile(null); setReplacement(""); linked.current = null;
      setMessage("Artwork saved. Review the selected files and create a new proof version; existing PDFs and responses are preserved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Artwork upload failed. The original files are preserved."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-2 rounded border border-border bg-background p-3 text-foreground" aria-label="Add or replace artwork">
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`${id}-revision`}>Artwork action</Label>
        <select id={`${id}-revision`} className="h-9 w-full rounded border border-input bg-background px-2 text-sm" value={replacement} disabled={busy} onChange={(event) => { setReplacement(event.target.value); linked.current = null; }}>
          <option value="">Add artwork to this line</option>
          {currentSources.map((source) => <option key={source.canonicalArtworkId} value={source.canonicalArtworkId!}>Replace {source.fileName} · {source.canonicalArtworkId}</option>)}
        </select>
      </div>
      <div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`${id}-file`}>{replacement ? "Replacement source artwork" : "New source artwork"}</Label>
        <Input id={`${id}-file`} type="file" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); linked.current = null; }} />
      </div>
      <div className="w-28 space-y-1"><Label htmlFor={`${id}-qty`}>Artwork quantity</Label><Input id={`${id}-qty`} type="number" min="1" step="1" value={quantity} disabled={busy} onChange={(event) => setQuantity(event.target.value)} /></div>
      <Button type="button" size="sm" disabled={!file || busy || (quantity !== "" && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1))} onClick={() => void upload()}>{busy ? "Saving artwork…" : replacement ? "Save Artwork Revision" : "Add Artwork"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Applies to this Order line only. Originals, proof history and production approval gates are retained.</p>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </section>;
}
