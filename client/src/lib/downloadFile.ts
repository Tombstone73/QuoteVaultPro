type DownloadOptions = {
  /**
   * Use the legacy fetch->blob fallback.
   * Default false because many /objects/* URLs redirect cross-origin and will fail under fetch() due to CORS.
   */
  fallbackToBlob?: boolean;
  /** Use credentials for fetch() fallback. Ignored for anchor-based downloads. */
  credentials?: RequestCredentials;
  /** Optional target for the temporary anchor. Default undefined (no new tab). */
  target?: "_self" | "_blank";
};

const isLikelySameOrigin = (url: string): boolean => {
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
};

const sanitizeFilename = (filename: string): string => {
  return (filename || "download").replace(/[/\\?%*:|"<>]/g, "-");
};

/**
 * Anchor-based download/open.
 * This avoids fetch() entirely, which prevents CORS/credentials redirect failures (common for /objects/* -> Supabase).
 */
const downloadViaAnchor = (url: string, filename: string, target?: "_self" | "_blank") => {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = sanitizeFilename(filename);
  anchor.rel = "noopener";
  if (target) anchor.target = target;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

export async function downloadFileFromUrl(url: string, filename: string, opts?: DownloadOptions) {
  if (typeof url !== "string" || !url.length) return;

  // Primary approach: browser-native navigation with download attribute.
  // Works with redirects without CORS limitations (e.g. /objects/* -> Supabase signed URL).
  downloadViaAnchor(url, filename, opts?.target);

  // Optional fallback: fetch->blob only when explicitly requested.
  // Note: this will still fail for many redirecting cross-origin URLs.
  if (!opts?.fallbackToBlob) return;

  const safeFilename = sanitizeFilename(filename);
  const credentials: RequestCredentials =
    opts?.credentials ?? (isLikelySameOrigin(url) ? "include" : "omit");

  const res = await fetch(url, { credentials });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    downloadViaAnchor(blobUrl, safeFilename);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
