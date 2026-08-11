import { apiFetch } from "@/lib/queryClient";

const DEFAULT_PREVIEW_FEATURES = "noopener,noreferrer";
const DEFAULT_BLOB_REVOKE_DELAY_MS = 60_000;

function getHeader(response: Response, name: string): string {
  return response.headers.get(name) ?? "";
}

async function readPdfErrorMessage(response: Response, fallback: string): Promise<string> {
  const jsonBody = await response
    .clone()
    .json()
    .catch(() => null);

  if (jsonBody && typeof jsonBody === "object") {
    const message = (jsonBody as { message?: unknown; error?: unknown }).message ?? (jsonBody as { message?: unknown; error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  const text = await response.text().catch(() => "");
  return text.trim() || fallback;
}

export async function openAuthenticatedPdfPreview(
  url: string,
  options: {
    target?: string;
    features?: string;
    revokeDelayMs?: number;
  } = {},
): Promise<void> {
  const objectUrl = await fetchAuthenticatedPdfObjectUrl(url);

  try {
    const opened = window.open(
      objectUrl,
      options.target ?? "_blank",
      options.features ?? DEFAULT_PREVIEW_FEATURES,
    );

    if (!opened) {
      throw new Error("PDF preview was blocked by the browser.");
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    options.revokeDelayMs ?? DEFAULT_BLOB_REVOKE_DELAY_MS,
  );
}

export async function openAuthenticatedImagePreview(url: string): Promise<void> {
  const response = await apiFetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "image/*" },
  });
  if (!response.ok) throw new Error(await readPdfErrorMessage(response, `Image request failed (${response.status})`));

  const contentType = getHeader(response, "content-type").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Image preview failed: server returned a non-image response.");
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    if (!window.open(objectUrl, "_blank", DEFAULT_PREVIEW_FEATURES)) throw new Error("Image preview was blocked by the browser.");
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), DEFAULT_BLOB_REVOKE_DELAY_MS);
}

async function fetchAuthenticatedPdfObjectUrl(url: string): Promise<string> {
  const response = await apiFetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/pdf",
    },
  });

  if (!response.ok) {
    const message = await readPdfErrorMessage(response, `PDF request failed (${response.status})`);
    throw new Error(message);
  }

  const contentType = getHeader(response, "content-type").toLowerCase();
  if (contentType && !contentType.includes("application/pdf")) {
    throw new Error("PDF preview failed: server returned a non-PDF response.");
  }

  const blob = await response.blob();
  const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  return URL.createObjectURL(pdfBlob);
}

export async function downloadAuthenticatedPdf(url: string, filename: string): Promise<void> {
  const objectUrl = await fetchAuthenticatedPdfObjectUrl(url);
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

export async function openAuthenticatedPdfForPrint(
  url: string,
  options: {
    target?: string;
    features?: string;
    revokeDelayMs?: number;
    printDelayMs?: number;
  } = {},
): Promise<void> {
  const objectUrl = await fetchAuthenticatedPdfObjectUrl(url);

  try {
    const opened = window.open(
      objectUrl,
      options.target ?? "_blank",
      options.features ?? DEFAULT_PREVIEW_FEATURES,
    );

    if (!opened) {
      throw new Error("PDF preview was blocked by the browser.");
    }

    window.setTimeout(() => {
      try {
        opened.focus?.();
        opened.print?.();
      } catch {
        // Some browsers disallow printing Blob tabs. The preview tab remains usable.
      }
    }, options.printDelayMs ?? 750);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  window.setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    options.revokeDelayMs ?? DEFAULT_BLOB_REVOKE_DELAY_MS,
  );
}
