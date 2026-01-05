/**
 * Unified thumbnail source resolver for attachments/files across the app.
 * Returns the first available thumbnail-like URL, regardless of original file type.
 * 
 * Usage: const thumbSrc = getThumbSrc(attachment);
 *        if (thumbSrc) <img src={thumbSrc} /> else <FileIcon />
 */
export function getThumbSrc(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  
  // Check all possible thumbnail URL fields (server may use different names)
  const url = 
    obj.previewThumbnailUrl ?? 
    obj.thumbnailUrl ?? 
    obj.thumbUrl ?? 
    obj.previewUrl ?? 
    null;
  
  return typeof url === 'string' && url.length > 0 ? url : null;
}
