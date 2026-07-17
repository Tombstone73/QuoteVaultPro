import { apiFetch } from "@/lib/queryClient";

const DEFAULT_OPEN_FEATURES = "noopener,noreferrer";
const DEFAULT_BLOB_REVOKE_DELAY_MS = 60_000;

async function readFileAccessError(response: Response): Promise<string> {
  const body = await response.clone().json().catch(() => null);
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown; error?: unknown }).message
      ?? (body as { message?: unknown; error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }

  const text = await response.text().catch(() => "");
  return text.trim() || `File request failed (${response.status})`;
}

async function fetchAuthenticatedFileObjectUrl(url: string): Promise<string> {
  const response = await apiFetch(url, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readFileAccessError(response));
  }

  return URL.createObjectURL(await response.blob());
}

export async function openAuthenticatedFile(
  url: string,
  options: { target?: string; features?: string; revokeDelayMs?: number } = {},
): Promise<void> {
  const objectUrl = await fetchAuthenticatedFileObjectUrl(url);
  try {
    const opened = window.open(
      objectUrl,
      options.target ?? "_blank",
      options.features ?? DEFAULT_OPEN_FEATURES,
    );
    if (!opened) throw new Error("File preview was blocked by the browser.");
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    options.revokeDelayMs ?? DEFAULT_BLOB_REVOKE_DELAY_MS,
  );
}

export async function downloadAuthenticatedFile(url: string, filename: string): Promise<void> {
  const objectUrl = await fetchAuthenticatedFileObjectUrl(url);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
