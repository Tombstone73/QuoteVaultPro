import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ZoomIn } from "lucide-react";

import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import { cn } from "@/lib/utils";
import { getFilePreviewPollInterval, isFilePreviewProcessingTimedOut, type FilePreviewUiStatus } from "@/lib/filePreviewPolling";

export function PrepressFileThumbnail({
  fileId,
  filename,
  mimeType,
  thumbnailUrl,
  thumbnailAvailabilityStatus,
  compact = false,
}: {
  fileId?: string;
  filename: string;
  mimeType?: string;
  thumbnailUrl?: string;
  thumbnailAvailabilityStatus?: "available" | "pending" | "missing" | "failed";
  compact?: boolean;
}) {
  const isImage = !!mimeType?.startsWith("image/");
  const isPdf = !!mimeType?.includes("pdf") || filename.toLowerCase().endsWith(".pdf");
  const [providedThumbnailFailed, setProvidedThumbnailFailed] = useState(false);
  const [resolvedThumbnailFailed, setResolvedThumbnailFailed] = useState(false);

  const { data: resolvedThumbnail } = useQuery({
    queryKey: ["/api/prepress/files", fileId, "thumbnail"],
    queryFn: async () => {
      if (!fileId) return { url: null as string | null, status: "missing" as const };
      const res = await fetch(`/api/prepress/files/${fileId}/thumbnail`, { credentials: "include" });
      if (!res.ok) return { url: null as string | null, status: "missing" as const };
      const json = await res.json().catch(() => ({}));
      return {
        url: (json?.data?.thumbnailUrl as string | null) || null,
        status: (json?.data?.thumbnailStatus as FilePreviewUiStatus) || "missing",
        processingStartedAt: (json?.data?.processingStartedAt as string | null) || null,
      };
    },
    enabled: !!fileId && (isImage || isPdf) && (!thumbnailUrl || providedThumbnailFailed),
    refetchInterval: (query) => getFilePreviewPollInterval(
      query.state.data?.status,
      query.state.data?.processingStartedAt,
    ),
    refetchOnMount: "always",
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const normalizeThumbnailUrl = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    return resolveObjectsPublicUrl(value) ?? undefined;
  };
  const providedThumbnailUrl = normalizeThumbnailUrl(thumbnailUrl);
  const finalThumbnailUrl = (providedThumbnailFailed ? undefined : providedThumbnailUrl) || normalizeThumbnailUrl(resolvedThumbnail?.url);
  const resolvedStatus = resolvedThumbnail?.status
    ?? (thumbnailAvailabilityStatus === "available"
      ? "ready"
      : thumbnailAvailabilityStatus === "pending"
        ? "processing"
        : thumbnailAvailabilityStatus ?? "missing");
  const displayThumbnailUrl = resolvedThumbnailFailed ? undefined : finalThumbnailUrl;
  const processingTimedOut = isFilePreviewProcessingTimedOut(
    resolvedThumbnail?.status,
    resolvedThumbnail?.processingStartedAt,
  );
  const baseClass = compact ? "h-16 w-16" : "h-20 w-20";

  useEffect(() => {
    setProvidedThumbnailFailed(false);
    setResolvedThumbnailFailed(false);
  }, [fileId, thumbnailUrl]);

  return (
    <div className={cn("group relative flex items-center justify-center overflow-hidden rounded-lg border border-[#2d3748] bg-[#111921]", baseClass)}>
      {displayThumbnailUrl ? (
        <img
          src={displayThumbnailUrl}
          alt={filename}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => {
            if (!providedThumbnailFailed && displayThumbnailUrl === providedThumbnailUrl) {
              setProvidedThumbnailFailed(true);
            } else {
              setResolvedThumbnailFailed(true);
            }
          }}
        />
      ) : resolvedStatus === "processing" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-700/60 text-white">
          <Loader2 className={cn(compact ? "h-5 w-5" : "h-7 w-7", "animate-spin")} />
          <span className="px-1 text-center text-[9px] font-semibold uppercase">
            {processingTimedOut ? "Still processing" : "Preview processing"}
          </span>
        </div>
      ) : isPdf ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-700/60">
          <svg className={cn(compact ? "h-6 w-6" : "h-8 w-8", "text-white")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="absolute bottom-1 text-[9px] font-bold text-white/90">PDF</span>
        </div>
      ) : (
        <svg className={cn(compact ? "h-6 w-6" : "h-8 w-8", "text-slate-500")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <ZoomIn className="h-5 w-5 text-white" />
      </div>
    </div>
  );
}
