/**
 * Unified thumbnail source resolver for attachments/files across the app.
 * Returns the first available thumbnail-like URL, regardless of original file type.
 * 
 * PACK A: Normalized to always show thumbnails when available (no file-type gating)
 * Priority: previewThumbnailUrl > thumbnailUrl > thumbUrl > pages[0].thumbUrl > previewUrl
 * 
 * Usage: const thumbSrc = getThumbSrc(attachment);
 *        if (thumbSrc) <img src={thumbSrc} /> else <FileIcon />
 */
export function getThumbSrc(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  
  // Check all possible thumbnail URL fields in priority order
  const url = 
    obj.previewThumbnailUrl ?? 
    obj.thumbnailUrl ?? 
    obj.thumbUrl ?? 
    obj.pages?.[0]?.thumbUrl ??
    obj.previewUrl ?? 
    null;
  
  return typeof url === 'string' && url.length > 0 ? url : null;
}
