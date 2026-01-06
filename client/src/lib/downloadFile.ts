type DownloadOptions = {
  /** Use credentials for same-origin fetch(). Default: include */
  credentials?: RequestCredentials;
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

const parseFilenameFromContentDisposition = (headerValue: string | null): string | null => {
  if (!headerValue) return null;

  // RFC 5987: filename*=UTF-8''encoded
  const filenameStarMatch = headerValue.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (filenameStarMatch) {
    const encoded = filenameStarMatch[2];
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  // Basic: filename="..." or filename=...
  const filenameMatch = headerValue.match(/filename\s*=\s*"([^"]+)"/i) || headerValue.match(/filename\s*=\s*([^;\s]+)/i);
  if (filenameMatch) return filenameMatch[1];

  return null;
};

const isNavigationSafe = (url: string): boolean => {
  // Only allow same-origin or relative navigation for last-resort fallback.
  if (url.startsWith("/")) return true;
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
};

const downloadViaBlob = async (url: string, preferredFilename: string, credentials: RequestCredentials) => {
  const res = await fetch(url, { credentials });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);

  const headerFilename = parseFilenameFromContentDisposition(res.headers.get("content-disposition"));
  const resolvedFilename = sanitizeFilename(preferredFilename || headerFilename || "download");

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    downloadViaAnchor(blobUrl, resolvedFilename);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};

/**
 * Force a browser-native download attempt using an anchor with the `download` attribute.
 *
 * - No fetch()
 * - No window.open
 * - No new tab
 */
export function forceDownloadFromUrl(url: string, filename: string) {
  if (typeof url !== "string" || !url.length) return;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilename(filename || "download");
  anchor.target = "_self";
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

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

export async function downloadFileFromUrl(url: string, filename?: string, opts?: DownloadOptions) {
  if (typeof url !== "string" || !url.length) return;

  const preferredFilenameRaw = typeof filename === "string" && filename.trim().length ? filename.trim() : "";
  const preferredFilename = preferredFilenameRaw ? sanitizeFilename(preferredFilenameRaw) : "";
  const fallbackFilename = sanitizeFilename(filename || "download");
  const sameOrigin = isLikelySameOrigin(url);

  // Requirement: same-origin downloads must always include credentials.
  const credentials: RequestCredentials = sameOrigin ? "include" : (opts?.credentials ?? "omit");

  // 1) Prefer fetch->blob for same-origin URLs (reliable forced-save).
  if (sameOrigin) {
    try {
      await downloadViaBlob(url, preferredFilename || fallbackFilename, credentials);
      return;
    } catch (error) {
      console.warn("[downloadFileFromUrl] Same-origin blob download failed; retrying once:", error);
    }

    // Retry once (still same options/credentials) to avoid transient network/stream issues.
    try {
      await downloadViaBlob(url, preferredFilename || fallbackFilename, credentials);
      return;
    } catch (error) {
      console.warn("[downloadFileFromUrl] Same-origin blob retry failed; falling back:", error);
    }
  }

  // 2) For cross-origin URLs, still attempt blob download first (may work if CORS allows it).
  try {
    await downloadViaBlob(url, preferredFilename || fallbackFilename, "omit");
    return;
  } catch (error) {
    console.warn(
      "[downloadFileFromUrl] Cross-origin blob download failed (likely CORS). Falling back to anchor; browser may ignore download attribute:",
      error
    );
  }

  // 3) Final fallback: anchor with download attr, same-tab.
  // Note: some browsers will ignore `download` for cross-origin URLs.
  try {
    downloadViaAnchor(url, preferredFilename || fallbackFilename, "_self");
  } catch (error) {
    console.warn("[downloadFileFromUrl] Anchor fallback failed:", error);
  }

  // 4) Final-final fallback: if it's safe (same-origin), navigate the current tab to the URL.
  // This can recover downloads even when fetch() fails, while avoiding window.open/new tabs.
  if (sameOrigin && isNavigationSafe(url)) {
    try {
      window.location.href = url;
    } catch (error) {
      console.warn("[downloadFileFromUrl] window.location fallback failed:", error);
    }
  }
}
