import { apiFetch } from "./queryClient";
import { notifySessionExpired } from "./authUtils";

function getDownloadErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.error === "string") return parsed.error;
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // A non-JSON proxy error still receives a clear client-side message below.
  }
  return body || `Download failed (${status})`;
}

export function filenameFromContentDisposition(header: string | null, fallbackFilename: string): string {
  if (!header) return fallbackFilename;

  const encodedMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      // Use the ASCII fallback when an intermediary has malformed filename*.
    }
  }

  const quotedMatch = header.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const bareMatch = header.match(/filename\s*=\s*([^;\s]+)/i);
  return bareMatch?.[1] || fallbackFilename;
}

/**
 * Download a protected file through the application's normal credential-aware
 * fetch path. This avoids opening an API URL in a new tab, where a separate
 * navigation can lose the authenticated application session.
 */
export async function downloadAuthenticatedFile(url: string, fallbackFilename: string): Promise<void> {
  const response = await apiFetch(url, { method: "GET" });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired("file-download");
    throw new Error(getDownloadErrorMessage(response.status, await response.text()));
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filenameFromContentDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
