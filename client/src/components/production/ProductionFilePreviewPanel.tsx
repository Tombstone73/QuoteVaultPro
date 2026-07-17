import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import type { ProductionFileSummary } from "@/hooks/useProduction";
import { resolveProductionPreviewUrl } from "@shared/productionHydration";

export function resolveProductionFilePreviewImage(file: ProductionFileSummary | null | undefined): string | null {
  if (!file) return null;
  const resolved = resolveProductionPreviewUrl({
    thumbnailUrl: file.thumbnailUrl,
    previewUrl: file.previewUrl,
    fileName: file.fileName,
    mimeType: file.mimeType,
  });
  return resolved ? resolveObjectsPublicUrl(resolved) : null;
}

export function ProductionFilePreviewPanel({
  files,
  onPreview,
}: {
  files: ProductionFileSummary[] | null | undefined;
  onPreview: (file: ProductionFileSummary) => void;
}) {
  const primaryFile = files?.[0] ?? null;
  const previewImage = useMemo(() => resolveProductionFilePreviewImage(primaryFile), [primaryFile]);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => setPreviewFailed(false), [primaryFile?.id, previewImage]);

  return (
    <div className="rounded-lg border border-titan-border-subtle bg-titan-bg-subtle p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-titan-text-primary">
            Production file / sheet layout
          </div>
          <div className="text-[11px] text-titan-text-muted">
            Final prepress output operators should print
          </div>
        </div>
        {files && files.length > 1 ? (
          <span className="text-[11px] text-titan-text-muted">{files.length} final files</span>
        ) : null}
      </div>

      <button
        type="button"
        className="relative flex h-56 w-full items-center justify-center overflow-hidden rounded-md border border-titan-border-subtle bg-titan-bg-card text-left transition-colors hover:border-blue-500 disabled:cursor-default"
        onClick={() => primaryFile && onPreview(primaryFile)}
        disabled={!primaryFile}
        aria-label={primaryFile ? `Enlarge production file ${primaryFile.fileName}` : "No production file available"}
      >
        {primaryFile && previewImage && !previewFailed ? (
          <img
            src={previewImage}
            alt={`Production file / sheet layout: ${primaryFile.fileName}`}
            className="h-full w-full object-contain"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="p-6 text-center text-titan-text-muted">
            <FileText className="mx-auto h-12 w-12" />
            <div className="mt-2 text-sm font-medium text-titan-text-primary">
              {primaryFile ? "Production file preview unavailable" : "No final production file"}
            </div>
            <div className="mt-1 text-xs">
              {primaryFile ? "The final file is available to open or download." : "Upload final output in Prepress before production release."}
            </div>
          </div>
        )}
      </button>

      {primaryFile ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-titan-text-primary">{primaryFile.fileName}</div>
            <div className="text-[11px] text-titan-text-muted">
              {primaryFile.tag === "cut_file" ? "Cut file" : "Final production file"}
              {previewImage && !previewFailed ? " · Click preview to enlarge" : ""}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={primaryFile.openUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </a>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={primaryFile.downloadUrl}>
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
