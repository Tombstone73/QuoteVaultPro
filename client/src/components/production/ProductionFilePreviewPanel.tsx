import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadAuthenticatedFile, getProductionFileAccessMessage, openAuthenticatedFile } from "@/lib/authenticatedFileAccess";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import { apiFetch } from "@/lib/queryClient";
import { AuthenticatedArtworkThumbnail } from "@/components/artwork/AuthenticatedArtworkThumbnail";
import { useToast } from "@/hooks/use-toast";
import type { ProductionFileSummary } from "@/hooks/useProduction";
import { resolveProductionPreviewUrl } from "@shared/productionHydration";
import {
  getFilePreviewPollInterval,
  isFilePreviewProcessingTimedOut,
  type FilePreviewUiStatus,
} from "@/lib/filePreviewPolling";

export function resolveProductionFilePreviewImage(file: ProductionFileSummary | null | undefined): string | null {
  if (!file) return null;
  // Canonical images must be fetched with apiFetch before rendering, including
  // when Vercel and Railway use different origins. URLs here are legacy-only.
  if (file.fileRecordId) return null;
  const resolved = resolveProductionPreviewUrl({
    thumbnailUrl: file.thumbnailUrl,
    previewUrl: file.previewUrl,
    fileName: file.fileName,
    mimeType: file.mimeType,
  });
  return resolved ? resolveObjectsPublicUrl(resolved) : null;
}

function LegacyProductionFileImage({ src, alt, className, fallback, renderImage }: {
  src: string; alt: string; className?: string; fallback: ReactNode; renderImage?: (src: string) => ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return renderImage ? <>{renderImage(src)}</> : <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

export function ProductionFilePreviewImage({ file, variant = "thumbnail", className, fallback, renderImage }: {
  file: ProductionFileSummary;
  variant?: "thumbnail" | "preview";
  className?: string;
  fallback: ReactNode;
  renderImage?: (src: string) => ReactNode;
}) {
  if (file.fileRecordId) {
    const availableVariant = variant === "thumbnail" && !file.thumbnailUrl && file.previewUrl ? "preview" : variant;
    return <AuthenticatedArtworkThumbnail fileRecordId={file.fileRecordId} fileName={file.fileName} mimeType={file.mimeType}
      variant={availableVariant} alt={`Production file / sheet layout: ${file.fileName}`} className={className}
      previewStatus={file.previewAvailabilityStatus} fallback={fallback} renderImage={renderImage} />;
  }
  const src = resolveProductionFilePreviewImage(file);
  return src ? <LegacyProductionFileImage key={src} src={src} alt={`Production file / sheet layout: ${file.fileName}`}
    className={className} fallback={fallback} renderImage={renderImage} /> : <>{fallback}</>;
}

export function ProductionFilePreviewPanel({
  files,
  onPreview,
}: {
  files: ProductionFileSummary[] | null | undefined;
  onPreview: (file: ProductionFileSummary) => void;
}) {
  const { toast } = useToast();
  const primaryFile = files?.[0] ?? null;
  const hasPreviewMetadata = Boolean(primaryFile?.thumbnailUrl || primaryFile?.previewUrl);
  const { data: repairedPreview } = useQuery({
    queryKey: ["/api/prepress/files", primaryFile?.id, "thumbnail", "production"],
    queryFn: async () => {
      if (!primaryFile) return null;
      const response = await apiFetch(`/api/prepress/files/${primaryFile.id}/thumbnail`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Preview status failed (${response.status})`);
      const payload = await response.json() as {
        data?: {
          thumbnailUrl?: string | null;
          thumbnailStatus?: FilePreviewUiStatus;
          processingStartedAt?: string | null;
        };
      };
      return {
        thumbnailUrl: payload.data?.thumbnailUrl ?? null,
        status: payload.data?.thumbnailStatus ?? "missing",
        processingStartedAt: payload.data?.processingStartedAt ?? null,
      };
    },
    enabled: !!primaryFile && !hasPreviewMetadata && primaryFile.previewAvailabilityStatus !== "failed",
    refetchInterval: (query) => getFilePreviewPollInterval(
      query.state.data?.status,
      query.state.data?.processingStartedAt,
    ),
    refetchOnMount: "always",
    staleTime: 0,
    retry: 1,
  });
  const effectiveFile = useMemo(() => primaryFile ? {
    ...primaryFile,
    thumbnailUrl: primaryFile.thumbnailUrl ?? repairedPreview?.thumbnailUrl ?? null,
    previewAvailabilityStatus: repairedPreview?.status === "ready"
      ? "available"
      : repairedPreview?.status === "processing"
        ? "pending"
        : repairedPreview?.status ?? primaryFile.previewAvailabilityStatus,
  } : null, [primaryFile, repairedPreview]);
  const processingTimedOut = isFilePreviewProcessingTimedOut(
    repairedPreview?.status,
    repairedPreview?.processingStartedAt,
  );
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessPending, setAccessPending] = useState<"open" | "download" | null>(null);


  const accessFile = async (action: "open" | "download") => {
    if (!effectiveFile) return;
    setAccessError(null);
    setAccessPending(action);
    try {
      if (action === "open") {
        await openAuthenticatedFile(effectiveFile.openUrl);
      } else {
        await downloadAuthenticatedFile(effectiveFile.downloadUrl, effectiveFile.fileName);
      }
    } catch (error) {
      const message = getProductionFileAccessMessage(error, action);
      setAccessError(message);
      toast({ variant: "destructive", title: message });
    } finally {
      setAccessPending(null);
    }
  };
  const previewFallback = <div className="p-6 text-center text-titan-text-muted">
    <FileText className="mx-auto h-12 w-12" />
    <div className="mt-2 text-sm font-medium text-titan-text-primary">
      {!primaryFile ? "No final production file" : effectiveFile?.previewAvailabilityStatus === "pending"
        ? processingTimedOut ? "Preview still processing" : "Production file preview processing"
        : "Production file preview unavailable"}
    </div>
    <div className="mt-1 text-xs">{!primaryFile ? "Upload final output in Prepress before production release."
      : effectiveFile?.previewAvailabilityStatus === "pending"
        ? processingTimedOut ? "Preview still processing. Open or download remains available." : "Production file preview processing. Open or download remains available."
        : "The final file is available to open or download."}</div>
  </div>;

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
        onClick={() => effectiveFile && onPreview(effectiveFile)}
        disabled={!primaryFile}
        aria-label={primaryFile ? `Enlarge production file ${primaryFile.fileName}` : "No production file available"}
      >
        {effectiveFile ? <ProductionFilePreviewImage file={effectiveFile} className="h-full w-full object-contain" fallback={previewFallback} /> : previewFallback}
      </button>

      {primaryFile ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-titan-text-primary">{primaryFile.fileName}</div>
            <div className="text-[11px] text-titan-text-muted">
              {primaryFile.tag === "cut_file" ? "Cut file" : "Final production file"}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={accessPending !== null}
              onClick={() => void accessFile("open")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> {accessPending === "open" ? "Opening..." : "Open"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={accessPending !== null}
              onClick={() => void accessFile("download")}
            >
              <Download className="h-3.5 w-3.5" /> {accessPending === "download" ? "Downloading..." : "Download"}
            </Button>
          </div>
        </div>
      ) : null}
      {accessError ? <div role="alert" className="mt-2 text-xs text-red-600">{accessError}</div> : null}
    </div>
  );
}
