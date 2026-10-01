import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { claimedShippingDocumentSchema, type ClaimedShippingDocument } from "@shared/directPrintDocuments";
import { renderShippingDocumentHtml } from "@shared/shippingDocumentRendering";
import { apiFetch } from "@/lib/queryClient";

export default function DirectPrintShippingDocument() {
  const { jobId = "" } = useParams<{ jobId: string }>();
  const validId = /^[a-zA-Z0-9_-]{1,160}$/.test(jobId);
  const frame = useRef<HTMLIFrameElement>(null);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const [printMarkup, setPrintMarkup] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const query = useQuery<ClaimedShippingDocument>({ queryKey: ["claimed-shipping-document", jobId], enabled: validId, retry: false,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/local-bridge/direct-print/jobs/${encodeURIComponent(jobId)}/document`, { signal });
      if (!response.ok) throw new Error("Claimed shipping document unavailable");
      const data = claimedShippingDocumentSchema.parse((await response.json()).data);
      if (data.jobId !== jobId || (data.packageId && (data.documentType !== "package_ticket" || !data.source.packages.some((item) => item.id === data.packageId)))) throw new Error("Shipping print source does not match the claimed job");
      return data;
    },
  });
  useEffect(() => { generation.current += 1; setReady(false); setPrintMarkup(""); setRenderError(null); }, [jobId, query.data]);
  let html = "";
  let sourceError: string | null = null;
  try { if (query.data) html = renderShippingDocumentHtml(query.data.source, query.data.documentType, { packageId: query.data.packageId ?? undefined }); }
  catch { sourceError = "Shipping document rendering failed"; }
  async function loaded() {
    const current = generation.current;
    setReady(false);
    try {
      const document = frame.current?.contentDocument;
      if (!document?.body || !document.body.children.length) throw new Error("Shipping document pages are missing");
      await document.fonts?.ready;
      await Promise.all(Array.from(document.images).map((image) => new Promise<void>((resolve, reject) => {
        if (image.complete) return image.naturalWidth > 0 ? resolve() : reject(new Error("Shipping image failed"));
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("Shipping image failed")), { once: true });
      })));
      // Print top-level pages, not a viewport-clipped iframe. The iframe first
      // verifies the same trusted renderer's assets and complete document.
      const styles = Array.from(document.querySelectorAll("style")).map((style) => style.outerHTML).join("");
      if (current === generation.current) setPrintMarkup(styles + document.body.innerHTML);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (current === generation.current) setReady(true);
    } catch (error: any) { if (current === generation.current) setRenderError(error.message || "Shipping document assets failed"); }
  }
  const error = !validId || query.error || renderError || sourceError;
  return <main data-print-job-id={jobId} data-print-document-type={query.data?.documentType ?? ""} data-print-ready={ready && !error ? "true" : "false"} data-print-error={error ? "true" : "false"}>
    <style>{`html,body,#root,main{margin:0;padding:0;background:white}iframe{position:absolute;left:-10000px;width:816px;height:1056px;border:0}@media print{iframe{display:none}}`}</style>
    {error ? <p>Failed to load shipping print document.</p> : !html ? <p>Loading shipping print document...</p>
      : <><iframe key={jobId} ref={frame} title="Claimed shipping print document" srcDoc={html} onLoad={() => void loaded()} sandbox="allow-same-origin" /><div data-print-pages dangerouslySetInnerHTML={{ __html: printMarkup }} /></>}
  </main>;
}
