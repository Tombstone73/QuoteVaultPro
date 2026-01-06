/**
 * Returns a same-origin view URL suitable for iframe embedding.
 * 
 * CRITICAL RULE: For PDFs, this MUST return only /objects/... URLs.
 * Signed Supabase URLs are NEVER allowed for PDF iframe src.
 * 
 * Returns null if no suitable same-origin URL is available.
 */
export function viewUrlForIframe(attachment: any): string | null {
  if (!attachment || typeof attachment !== 'object') return null;

  const fileName = attachment.fileName ?? attachment.originalFilename ?? 'file';
  const objectPath = (attachment.objectPath as string | null | undefined) ?? null;
  
  // Determine if this is a PDF
  const isPdf = 
    (typeof attachment.mimeType === 'string' && attachment.mimeType.toLowerCase().includes('pdf')) ||
    (typeof fileName === 'string' && fileName.toLowerCase().endsWith('.pdf'));

  // For PDFs: ONLY accept /objects/... URLs (same-origin proxy)
  if (isPdf) {
    // Construct same-origin proxy URL from objectPath
    if (typeof objectPath === 'string' && objectPath.length > 0) {
      return `/objects/${objectPath}?filename=${encodeURIComponent(fileName)}`;
    }

    // If objectPath is missing, check if originalUrl is already a same-origin path
    const originalUrl = 
      attachment.originalUrl ?? 
      attachment.originalURL ?? 
      attachment.url ?? 
      attachment.fileUrl ?? 
      null;

    if (typeof originalUrl === 'string' && originalUrl.startsWith('/objects/')) {
      return originalUrl;
    }

    // NO fallback to external URLs for PDFs
    return null;
  }

  // For non-PDFs (images, etc.), existing behavior:
  // Accept previewUrl, originalUrl, or objectPath-derived URL
  const previewUrl = attachment.previewUrl ?? null;
  if (typeof previewUrl === 'string' && previewUrl.length > 0) {
    return previewUrl;
  }

  const originalUrl = 
    attachment.originalUrl ?? 
    attachment.originalURL ?? 
    attachment.url ?? 
    attachment.fileUrl ?? 
    null;

  if (typeof originalUrl === 'string' && originalUrl.length > 0) {
    return originalUrl;
  }

  // Fallback: construct from objectPath
  if (typeof objectPath === 'string' && objectPath.length > 0) {
    return `/objects/${objectPath}?filename=${encodeURIComponent(fileName)}`;
  }

  return null;
}
