export type FilePreviewUiStatus = "missing" | "processing" | "ready" | "failed";

export const FILE_PREVIEW_ACTIVE_POLL_MS = 1_500;
export const FILE_PREVIEW_SLOW_POLL_MS = 10_000;
export const FILE_PREVIEW_PROCESSING_TIMEOUT_MS = 30_000;

export function isFilePreviewProcessingTimedOut(
  status: FilePreviewUiStatus | undefined,
  processingStartedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (status !== "processing" || !processingStartedAt) return false;
  const startedAtMs = Date.parse(processingStartedAt);
  return Number.isFinite(startedAtMs) && nowMs - startedAtMs >= FILE_PREVIEW_PROCESSING_TIMEOUT_MS;
}

export function getFilePreviewPollInterval(
  status: FilePreviewUiStatus | undefined,
  processingStartedAt: string | null | undefined,
  nowMs = Date.now(),
): number | false {
  if (status !== "processing") return false;
  return isFilePreviewProcessingTimedOut(status, processingStartedAt, nowMs)
    ? FILE_PREVIEW_SLOW_POLL_MS
    : FILE_PREVIEW_ACTIVE_POLL_MS;
}
