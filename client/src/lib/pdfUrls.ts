/**
 * PDF URL builder utilities - Single source of truth for PDF preview/download URLs
 * PACK P6: Regression locks via pure functions
 */

/**
 * Build same-origin view URL for PDF iframe embedding
 */
export function buildPdfViewUrl(objectPath: string | null | undefined): string | null {
  if (!objectPath || typeof objectPath !== 'string' || !objectPath.length) {
    if (import.meta.env.DEV) {
      console.warn('[buildPdfViewUrl] Missing or invalid objectPath:', objectPath);
    }
    return null;
  }
  
  return `/objects/${encodeURIComponent(objectPath)}`;
}

/**
 * Build forced-download URL (Save-As with original filename)
 */
export function buildPdfDownloadUrl(
  objectPath: string | null | undefined,
  filename: string
): string | null {
  if (!objectPath || typeof objectPath !== 'string' || !objectPath.length) {
    if (import.meta.env.DEV) {
      console.warn('[buildPdfDownloadUrl] Missing or invalid objectPath:', objectPath);
    }
    return null;
  }
  
  return `/objects/${encodeURIComponent(objectPath)}?download=1&filename=${encodeURIComponent(filename)}`;
}

/**
 * Detect if attachment is a PDF
 */
export function isPdfFile(mimeType: string | null | undefined, filename: string): boolean {
  if (mimeType && typeof mimeType === 'string') {
    if (mimeType.toLowerCase().includes('pdf')) return true;
    if (mimeType === 'application/pdf') return true;
  }
  
  if (filename && typeof filename === 'string') {
    if (filename.toLowerCase().endsWith('.pdf')) return true;
  }
  
  return false;
}

/**
 * PACK P4: Lightweight reachability check for /objects URL
 * Returns true if URL is reachable, false otherwise
 */
export async function checkPdfUrlReachable(viewUrl: string): Promise<boolean> {
  if (!viewUrl) return false;
  
  try {
    const response = await fetch(viewUrl, {
      method: 'HEAD',
      credentials: 'include',
      signal: AbortSignal.timeout(3000), // 3s timeout
    });
    
    return response.ok; // 200-299 status codes
  } catch (error) {
    console.warn('[checkPdfUrlReachable] Failed to reach URL:', viewUrl, error);
    return false;
  }
}
