import { apiFetch } from "@/lib/queryClient";

export type ArtworkAccessVariant = "original" | "preview" | "thumbnail";

export function buildArtworkAccessUrl(fileRecordId: string | null | undefined, variant: ArtworkAccessVariant = "original"): string | null {
  const id = String(fileRecordId ?? "").trim();
  if (!id) return null;
  return `/api/artwork/file-records/${encodeURIComponent(id)}/content?variant=${variant}`;
}

/**
 * Resolve an artwork download through the tenant-authenticated canonical
 * reader whenever the record has a canonical file identity. Legacy rows can
 * still use their established URL only when no file record exists.
 */
export function resolveArtworkDownloadUrl(
  fileRecordId: string | null | undefined,
  ...legacyUrls: Array<string | null | undefined>
): string | null {
  const canonicalUrl = buildArtworkAccessUrl(fileRecordId, "original");
  if (canonicalUrl) return canonicalUrl;
  return legacyUrls.find((url): url is string => typeof url === "string" && url.trim().length > 0) ?? null;
}

async function fetchArtworkBlob(fileRecordId: string, variant: ArtworkAccessVariant): Promise<Blob> {
  const url = buildArtworkAccessUrl(fileRecordId, variant);
  if (!url) throw new Error("Artwork file is unavailable.");
  const response = await apiFetch(url, { method: "GET", credentials: "include", headers: { Accept: "*/*" } });
  if (!response.ok) throw new Error("Unable to access artwork. Confirm that it is still available.");
  return response.blob();
}

export async function openArtworkPreview(fileRecordId: string, mimeType?: string | null): Promise<void> {
  const blob = await fetchArtworkBlob(fileRecordId, "original");
  const objectUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mimeType || "application/octet-stream" }));
  try {
    if (!window.open(objectUrl, "_blank", "noopener,noreferrer")) throw new Error("Artwork preview was blocked by the browser.");
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function downloadArtwork(fileRecordId: string, filename: string): Promise<void> {
  const blob = await fetchArtworkBlob(fileRecordId, "original");
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || "artwork";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); URL.revokeObjectURL(objectUrl); }
}

export async function getArtworkThumbnailObjectUrl(fileRecordId: string): Promise<string> {
  return getArtworkObjectUrl(fileRecordId, "thumbnail");
}

export async function getArtworkObjectUrl(fileRecordId: string, variant: ArtworkAccessVariant = "thumbnail"): Promise<string> {
  return URL.createObjectURL(await fetchArtworkBlob(fileRecordId, variant));
}
