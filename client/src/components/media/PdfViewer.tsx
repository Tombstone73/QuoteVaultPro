import { downloadFileFromUrl } from "@/lib/downloadFile";

type PdfViewerProps = {
  viewerUrl: string;
  downloadUrl?: string;
  filename?: string;
};

export function PdfViewer({ viewerUrl, downloadUrl, filename }: PdfViewerProps) {
  const resolvedFilename = (filename || "document.pdf").trim() || "document.pdf";
  const resolvedDownloadUrl = (downloadUrl || "").toString();

  // Embed-only URL: hide PDF chrome in the browser viewer.
  // IMPORTANT: this must never be used for downloads.
  const embedViewerUrl = (() => {
    const raw = (viewerUrl || "").toString();
    if (!raw) return raw;

    const hashIndex = raw.indexOf("#");
    const base = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : "";

    if (!fragment) return `${base}#toolbar=0&navpanes=0`;

    const parts = fragment.split("&").filter(Boolean);
    const hasToolbar = parts.some((p) => p.toLowerCase().startsWith("toolbar="));
    const hasNavpanes = parts.some((p) => p.toLowerCase().startsWith("navpanes="));
    if (hasToolbar && hasNavpanes) return raw;

    const nextParts = [...parts];
    if (!hasToolbar) nextParts.push("toolbar=0");
    if (!hasNavpanes) nextParts.push("navpanes=0");
    return `${base}#${nextParts.join("&")}`;
  })();

  return (
    <div className="w-full h-[60vh] rounded-md border border-border overflow-hidden bg-muted/30">
      {/*
        PDFs are intentionally NOT rendered via <iframe>.

        - Some Chrome flows show an "Open" button/interstitial instead of rendering the PDF inline,
          especially when the request/response ends up negotiated as HTML (e.g. the request includes
          `Accept: text/html` or a redirect lands on an HTML page).
        - Using <object type="application/pdf"> reliably embeds the browser's native PDF viewer and
          avoids the iframe-driven "Open" interstitial behavior.
      */}
      <object data={embedViewerUrl} type="application/pdf" width="100%" height="100%">
        <div className="p-4 text-sm text-muted-foreground">
          <div>PDF preview not available.</div>
          {downloadUrl ? (
            <a
              href={resolvedDownloadUrl}
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                void downloadFileFromUrl(resolvedDownloadUrl, resolvedFilename);
              }}
            >
              Download PDF
            </a>
          ) : null}
        </div>
      </object>
    </div>
  );
}
