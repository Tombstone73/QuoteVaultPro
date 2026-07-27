export type ArtworkPreviewState =
  | "available"
  | "queued"
  | "processing"
  | "failed"
  | "timed_out"
  | "unsupported"
  | "source_unavailable";

export type ArtworkPreviewLifecycle = {
  state: ArtworkPreviewState;
  lastStateChangeAt: Date | null;
  retryAllowed: boolean;
  failureReason: string | null;
  staffMessage: string;
  retryAfterMs: number | null;
};

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const QUEUED_WINDOW_MS = 15 * 1000;

/**
 * Converts persisted derivative metadata into the staff-facing preview contract.
 * Missing data is deliberately not treated as active processing: only a durable
 * pending state may be queued/processing, and old pending work becomes timed_out.
 */
export function resolveArtworkPreviewLifecycle(input: {
  hasPreview: boolean;
  isSupported: boolean;
  sourceAvailable: boolean;
  pending: boolean;
  failed: boolean;
  error: string | null | undefined;
  updatedAt: Date | null | undefined;
  now?: Date;
}): ArtworkPreviewLifecycle {
  const updatedAt = input.updatedAt ?? null;
  const now = input.now ?? new Date();
  const ageMs = updatedAt ? Math.max(0, now.getTime() - updatedAt.getTime()) : null;

  if (input.hasPreview) {
    return { state: "available", lastStateChangeAt: updatedAt, retryAllowed: false, failureReason: null, staffMessage: "Preview available.", retryAfterMs: null };
  }
  if (!input.isSupported) {
    return { state: "unsupported", lastStateChangeAt: updatedAt, retryAllowed: false, failureReason: "unsupported_file_type", staffMessage: "This artwork type does not support image previews.", retryAfterMs: null };
  }
  if (!input.sourceAvailable) {
    return { state: "source_unavailable", lastStateChangeAt: updatedAt, retryAllowed: true, failureReason: "source_unavailable", staffMessage: "The artwork source is not currently available for preview generation.", retryAfterMs: null };
  }
  if (input.failed) {
    return { state: "failed", lastStateChangeAt: updatedAt, retryAllowed: true, failureReason: input.error || "preview_generation_failed", staffMessage: "Preview generation failed. Retry preview to try again.", retryAfterMs: null };
  }
  if (input.pending) {
    if (!updatedAt || (ageMs !== null && ageMs >= PROCESSING_TIMEOUT_MS)) {
      return { state: "timed_out", lastStateChangeAt: updatedAt, retryAllowed: true, failureReason: "preview_generation_timed_out", staffMessage: "Preview generation did not finish in time. Retry preview to start a new attempt.", retryAfterMs: null };
    }
    if (ageMs !== null && ageMs < QUEUED_WINDOW_MS) {
      return { state: "queued", lastStateChangeAt: updatedAt, retryAllowed: false, failureReason: null, staffMessage: "Preview generation is queued.", retryAfterMs: QUEUED_WINDOW_MS - ageMs };
    }
    return { state: "processing", lastStateChangeAt: updatedAt, retryAllowed: false, failureReason: null, staffMessage: "Preview generation is in progress.", retryAfterMs: 3_000 };
  }

  return { state: "queued", lastStateChangeAt: updatedAt, retryAllowed: false, failureReason: null, staffMessage: "Preview generation will start when this artwork is opened for proofing.", retryAfterMs: 0 };
}

export const artworkPreviewProcessingTimeoutMs = PROCESSING_TIMEOUT_MS;
