import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/queryClient";

export type InvoicePdfPreviewState = "idle" | "loading" | "ready" | "error";

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46;
}

async function readFirstPdfBytes(blob: Blob): Promise<Uint8Array> {
  const firstBytes = blob.slice(0, 4);
  if (typeof firstBytes.arrayBuffer === "function") {
    return new Uint8Array(await firstBytes.arrayBuffer());
  }

  // JSDOM and a few legacy browser implementations do not expose Blob.arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read PDF bytes"));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(firstBytes);
  });
}

/** Fetches an authenticated invoice PDF once and exposes a revocable browser Blob URL for inline preview. */
export function useInvoicePdfPreview(invoicePdfUrl: string, isOpen: boolean) {
  const [state, setState] = useState<InvoicePdfPreviewState>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    if (!isOpen) {
      setState("idle");
      setPreviewUrl(null);
      setError(null);
      return;
    }

    if (!invoicePdfUrl) {
      setState("error");
      setPreviewUrl(null);
      setError("PDF not available.");
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        setState("loading");
        setPreviewUrl(null);
        setError(null);

        // apiFetch resolves /api paths to the deployment's canonical Railway origin.
        const response = await apiFetch(invoicePdfUrl, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/pdf" },
        });
        if (!response.ok) throw new Error(`PDF request failed (${response.status})`);

        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (contentType && !contentType.includes("application/pdf")) {
          throw new Error("PDF response was not application/pdf");
        }

        const blob = await response.blob();
        const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
        const signature = await readFirstPdfBytes(pdfBlob);
        if (!hasPdfSignature(signature)) throw new Error("PDF signature check failed");

        objectUrl = URL.createObjectURL(pdfBlob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }

        setPreviewUrl(objectUrl);
        setState("ready");
      } catch (cause: any) {
        if (cancelled) return;
        setPreviewUrl(null);
        setState("error");
        setError(cause?.message || "Failed to load PDF");
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoicePdfUrl, isOpen, retryToken]);

  return { state, previewUrl, error, retry };
}
