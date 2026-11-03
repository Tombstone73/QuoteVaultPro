import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { readInboundPdfSizeAnalysis } from "@shared/inboundPdfSizeAnalysis";

type Props = {
  source: { uploadId: string } | { fileRecordId: string };
  filename: string;
  onApply?: (widthIn: number, heightIn: number) => void;
  unavailableReason?: string;
};

/** PDF metadata stays separate from ordered dimensions until staff explicitly applies it. */
export function ArtworkPdfDimensions({ source, filename, onApply, unavailableReason }: Props) {
  const identity = "uploadId" in source ? `upload:${source.uploadId}` : `file:${source.fileRecordId}`;
  // Key selection by identity so a newly attached file can never apply a previous file's page.
  const [selection, setSelection] = useState<{ identity: string; page: number } | null>(null);
  const query = useQuery({
    queryKey: ["artwork-pdf-dimensions", identity],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 20_000);
      try {
        const response = await fetch("/api/artwork/pdf-size", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(source), signal: controller.signal,
        });
        if (!response.ok) throw new Error("Dimensions unavailable.");
        return readInboundPdfSizeAnalysis((await response.json()).data?.analysis);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const analysis = query.data;
  const pages = analysis?.status === "succeeded" ? analysis.pages.filter(page => Number.isFinite(page.widthInches) && page.widthInches > 0 && Number.isFinite(page.heightInches) && page.heightInches > 0) : [];
  const selected = pages.find(page => selection?.identity === identity && page.pageNumber === selection.page) ?? pages[0];
  return <div className="mt-1 space-y-1 text-xs text-foreground" onClick={event => event.stopPropagation()}>
    {query.isPending ? <p role="status">Detecting PDF size…</p> : !selected ? <p role="status">Dimensions unavailable.</p> : <>
      <p>Detected PDF size: {selected.widthInches} × {selected.heightInches} inches{analysis?.uniformPageSize && pages.length > 1 ? ` · all ${pages.length} pages` : ""}</p>
      {!analysis?.uniformPageSize && pages.length > 1 && <select
        aria-label={`PDF page dimensions for ${filename}`}
        className="h-7 max-w-full rounded border border-input bg-background px-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={selected.pageNumber}
        onChange={event => setSelection({ identity, page: Number(event.target.value) })}
      >{pages.map(page => <option key={page.pageNumber} value={page.pageNumber}>Page {page.pageNumber}: {page.widthInches} × {page.heightInches} inches</option>)}</select>}
      <div><Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!onApply} onClick={() => onApply?.(selected.widthInches, selected.heightInches)}>Apply to Line Size</Button></div>
      <p className="text-muted-foreground">PDF page size may include bleed or crop marks. Finished size changes only when applied.</p>
      {!onApply && unavailableReason && <p className="text-muted-foreground">{unavailableReason}</p>}
    </>}
  </div>;
}
