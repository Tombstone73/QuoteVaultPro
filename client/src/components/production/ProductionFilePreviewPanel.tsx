import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadAuthenticatedFile, getProductionFileAccessMessage, openAuthenticatedFile } from "@/lib/authenticatedFileAccess";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import { apiFetch } from "@/lib/queryClient";
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
  const { toast } = useToast();
  const primaryFile = files?.[0] ?? null;
  const initialPreviewImage = useMemo(() => resolveProductionFilePreviewImage(primaryFile), [primaryFile]);
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
    enabled: !!primaryFile && !initialPreviewImage && primaryFile.previewAvailabilityStatus !== "failed",
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
  const previewImage = useMemo(() => resolveProductionFilePreviewImage(effectiveFile), [effectiveFile]);
  const processingTimedOut = isFilePreviewProcessingTimedOut(
    repairedPreview?.status,
    repairedPreview?.processingStartedAt,
  );
  const [previewFailed, setPreviewFailed] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessPending, setAccessPending] = useState<"open" | "download" | null>(null);

  useEffect(() => setPreviewFailed(false), [effectiveFile?.id, previewImage]);

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
        {effectiveFile && previewImage && !previewFailed ? (
          <img
            src={previewImage}
            alt={`Production file / sheet layout: ${effectiveFile.fileName}`}
            className="h-full w-full object-contain"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="p-6 text-center text-titan-text-muted">
            <FileText className="mx-auto h-12 w-12" />
            <div className="mt-2 text-sm font-medium text-titan-text-primary">
              {primaryFile
                ? effectiveFile?.previewAvailabilityStatus === "pending"
                  ? processingTimedOut
                    ? "Preview still processing"
                    : "Production file preview processing"
                  : "Production file preview unavailable"
                : "No final production file"}
            </div>
            <div className="mt-1 text-xs">
              {primaryFile
                ? effectiveFile?.previewAvailabilityStatus === "pending"
                  ? processingTimedOut
                    ? "Preview still processing. Open or download remains available."
                    : "Production file preview processing. Open or download remains available."
                  : "The final file is available to open or download."
                : "Upload final output in Prepress before production release."}
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
