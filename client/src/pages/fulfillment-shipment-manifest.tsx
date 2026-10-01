import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { shippingDocumentSourceSchema, shippingDocumentTypeSchema, type ShippingDocumentSource } from "@shared/shippingDocuments";
import { renderShippingDocumentHtml } from "@shared/shippingDocumentRendering";
import { apiFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

/** Preview and explicit browser printing share the same source and safe renderer. */
export default function FulfillmentShipmentManifestPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const [searchParams] = useSearchParams();
  const typeResult = shippingDocumentTypeSchema.safeParse(searchParams.get("documentType") ?? "shipment_manifest");
  const documentType = typeResult.success ? typeResult.data : null;
  const packageId = searchParams.get("packageId") || undefined;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const sourceQuery = useQuery<ShippingDocumentSource>({
    queryKey: ["fulfillment", "shipping-document", shipmentId, documentType, packageId],
    enabled: Boolean(shipmentId && documentType),
    retry: false,
    queryFn: async ({ signal }) => {
      const query = packageId ? `?packageId=${encodeURIComponent(packageId)}` : "";
      const response = await apiFetch(`/api/fulfillment/shipments/${encodeURIComponent(shipmentId!)}/documents/${documentType}${query}`, { signal });
      const body = await response.json();
      if (!response.ok || body.success === false) throw new Error(body.message ?? body.error ?? `Document preview failed (${response.status}).`);
      const parsed = shippingDocumentSourceSchema.safeParse(body.data);
      if (!parsed.success || parsed.data.shipmentId !== shipmentId) throw new Error("Shipping document source is invalid.");
      return parsed.data;
    },
  });
  const title = documentType === "packing_slip" ? "Packing Slip" : documentType === "package_ticket" ? "Package Tickets" : "Shipment Manifest";
  let html = "";
  let renderError: string | null = null;
  if (sourceQuery.data && documentType) {
    try { html = renderShippingDocumentHtml(sourceQuery.data, documentType, { packageId }); }
    catch (error) { renderError = error instanceof Error ? error.message : "Document preview is unavailable."; }
  }
  const previewKey = `${shipmentId}:${documentType}:${packageId ?? ""}:${sourceQuery.dataUpdatedAt}`;
  const error = !documentType ? "Unsupported shipping document type." : renderError ?? (sourceQuery.error instanceof Error ? sourceQuery.error.message : null);
  const print = () => {
    setPrintError(null);
    try {
      const frame = iframeRef.current?.contentWindow;
      if (!frame || readyKey !== previewKey) throw new Error("Wait for the document preview to finish loading.");
      frame.focus();
      frame.print();
    } catch (error) { setPrintError(error instanceof Error ? error.message : "Browser Print could not open."); }
  };
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">{title} Preview</h1><p className="text-sm text-muted-foreground">{sourceQuery.data?.basis === "shipped" ? "Saved historical shipping document." : "Current persisted draft allocations. Previewing or printing does not mark this shipment shipped."}</p></div><Button onClick={print} disabled={!html || Boolean(error) || readyKey !== previewKey}>Browser Print</Button></header>
    {error ? <div role="alert" className="rounded border border-destructive p-4 text-destructive">{error}</div> : null}
    {printError ? <div role="alert" className="text-destructive">{printError}</div> : null}
    {sourceQuery.isPending && documentType ? <p role="status">Loading shipping document preview...</p> : null}
    {html && !error ? <iframe key={previewKey} ref={iframeRef} title={`${title} document preview`} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={() => setReadyKey(previewKey)} className="min-h-[75vh] w-full rounded border bg-white" /> : null}
  </main>;
}
