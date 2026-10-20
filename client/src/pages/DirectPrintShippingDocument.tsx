import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { claimedShippingDocumentSchema, claimedUpsLabelSchema, type ClaimedShippingDocument } from "@shared/directPrintDocuments";
import { renderShippingDocumentHtml } from "@shared/shippingDocumentRendering";
import { apiFetch } from "@/lib/queryClient";
import { z } from "zod";

const claimedProfileTestSchema = z.object({ jobId: z.string(), documentType: z.literal('profile_test'),
  profileName: z.string(), workstation: z.string(), queueName: z.string(), createdAt: z.string(),
  mediaKind: z.enum(['label', 'receipt', 'document']), receiptWidthMm: z.number() });

export default function DirectPrintShippingDocument() {
  const { jobId = "" } = useParams<{ jobId: string }>();
  const validId = /^[a-zA-Z0-9_-]{1,160}$/.test(jobId);
  const frame = useRef<HTMLIFrameElement>(null);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const [printMarkup, setPrintMarkup] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const query = useQuery<ClaimedShippingDocument | ReturnType<typeof claimedUpsLabelSchema.parse> | z.infer<typeof claimedProfileTestSchema>>({ queryKey: ["claimed-shipping-document", jobId], enabled: validId, retry: false,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/local-bridge/direct-print/jobs/${encodeURIComponent(jobId)}/document`, { signal });
      if (!response.ok) throw new Error("Claimed shipping document unavailable");
      const payload = (await response.json()).data;
      const data = payload?.documentType === 'profile_test' ? claimedProfileTestSchema.parse(payload)
        : payload?.documentType === 'ups_label' ? claimedUpsLabelSchema.parse(payload) : claimedShippingDocumentSchema.parse(payload);
      if (data.jobId !== jobId || (data.documentType !== 'ups_label' && data.documentType !== 'profile_test' && data.packageId &&
        (data.documentType !== "package_ticket" || !data.source.packages.some((item) => item.id === data.packageId))))
        throw new Error("Shipping print source does not match the claimed job");
      return data;
    },
  });
  useEffect(() => { generation.current += 1; setReady(false); setPrintMarkup(""); setRenderError(null); }, [jobId, query.data]);
  useEffect(() => { if (query.data?.documentType === 'profile_test') setReady(true); }, [query.data]);
  let html = "";
  let sourceError: string | null = null;
  try { if (query.data && query.data.documentType !== 'ups_label' && query.data.documentType !== 'profile_test') html = renderShippingDocumentHtml(query.data.source, query.data.documentType, { packageId: query.data.packageId ?? undefined }); }
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
    <style>{`html,body,#root,main{margin:0;padding:0;background:white}iframe{position:absolute;left:-10000px;width:816px;height:1056px;border:0}@media print{iframe{display:none}}${query.data?.documentType === 'ups_label' ? '@page{size:4in 6in;margin:0}.ups-print-label{display:block;width:4in;height:6in;object-fit:contain}' : ''}${query.data?.documentType === 'profile_test' && query.data.mediaKind === 'label' ? '@page{size:4in 6in;margin:0}' : ''}`}</style>
    {error ? <p>Failed to load shipping print document.</p> : query.data?.documentType === 'ups_label'
      ? <img className="ups-print-label" src={`data:image/gif;base64,${query.data.labelBase64}`} alt={`UPS label ${query.data.trackingNumber}`}
          onLoad={event => { if (event.currentTarget.naturalWidth > 0) setReady(true); else setRenderError('UPS label image is empty'); }}
          onError={() => setRenderError('UPS label image failed to render')} />
      : query.data?.documentType === 'profile_test'
      ? <div style={{ boxSizing: 'border-box', width: query.data.mediaKind === 'label' ? '4in' : query.data.mediaKind === 'receipt' ? `${Math.min(120, Math.max(40, query.data.receiptWidthMm))}mm` : 'auto',
        minHeight: query.data.mediaKind === 'label' ? '6in' : undefined, padding: '8mm', fontFamily: 'Arial, sans-serif', color: '#111' }}>
          <h1 style={{ fontSize: '18pt', margin: '0 0 6mm' }}>TEST PRINT · NOT A SHIPPING LABEL</h1>
          <div style={{ border: '2px solid black', padding: '4mm', fontSize: '11pt', overflowWrap: 'anywhere' }}>
            <p>Profile: {query.data.profileName}</p><p>Workstation: {query.data.workstation}</p>
            <p>Windows queue: {query.data.queueName}</p><p>Requested: {new Date(query.data.createdAt).toLocaleString()}</p>
          </div><div style={{ marginTop: '6mm', height: '12mm', border: '2px solid black', background: 'linear-gradient(to right, black 50%, white 50%)' }} />
          <p style={{ fontSize: '9pt' }}>Alignment sample · top, left, right, and bottom borders should be visible.</p>
        </div>
      : !html ? <p>Loading shipping print document...</p>
      : <><iframe key={jobId} ref={frame} title="Claimed shipping print document" srcDoc={html} onLoad={() => void loaded()} sandbox="allow-same-origin" /><div data-print-pages dangerouslySetInnerHTML={{ __html: printMarkup }} /></>}
  </main>;
}
