export type ArtworkPreviewState = "available" | "queued" | "processing" | "failed" | "timed_out" | "unsupported" | "source_unavailable";

export function artworkPreviewLabel(state: ArtworkPreviewState, message?: string | null) {
  if (state === "available") return "Preview available";
  if (state === "queued") return "Preview queued";
  if (state === "processing") return "Preview generating";
  if (state === "failed") return message || "Preview generation failed";
  if (state === "timed_out") return "Preview generation timed out";
  if (state === "unsupported") return "Preview unavailable for this file type";
  return message || "Artwork source unavailable";
}

export function shouldPollArtworkPreview(state: ArtworkPreviewState) {
  return state === "queued" || state === "processing";
}
