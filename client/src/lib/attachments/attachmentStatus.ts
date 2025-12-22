/**
 * Attachment status helpers for bounded polling
 * Fail-soft: missing/undefined statuses treated as terminal to prevent runaway polling
 */

type ThumbStatus = 'uploaded' | 'thumb_pending' | 'thumb_ready' | 'thumb_failed';
type PageCountStatus = 'unknown' | 'detecting' | 'known' | 'failed' | 'failed_soft';

type AttachmentWithStatus = {
  thumbStatus?: ThumbStatus | string | null;
  pageCountStatus?: PageCountStatus | string | null;
  pageCount?: number | null;
  mimeType?: string | null;
  fileName?: string;
  pages?: Array<{ thumbStatus?: ThumbStatus | string | null }>;
};

/**
 * Check if thumbnail processing is complete (terminal state)
 * Terminal states: 'thumb_ready', 'thumb_failed', 'uploaded'
 * Non-terminal: 'thumb_pending'
 * Fail-soft: missing/undefined thumbStatus treated as terminal
 */
export function isThumbTerminal(att: AttachmentWithStatus | null | undefined): boolean {
  if (!att?.thumbStatus) return true; // Fail-soft: no status = terminal
  
  const status = att.thumbStatus;
  
  // Non-terminal: actively processing
  if (status === 'thumb_pending') return false;
  
  // Terminal: completed, failed, or initial uploaded state
  // (uploaded = non-PDF images that don't need thumb generation)
  return true;
}

/**
 * Check if page count detection is complete (terminal state)
 * Uses pageCountStatus field directly from API response:
 * - Non-terminal: 'detecting' (still processing)
 * - Terminal: 'known', 'failed', 'failed_soft', 'unknown'
 * 
 * Fail-soft: missing pageCountStatus treated as terminal to prevent runaway
 */
export function isPageCountTerminal(att: AttachmentWithStatus | null | undefined): boolean {
  if (!att) return true; // Fail-soft
  
  // Use pageCountStatus if present (API response includes this field)
  if (att.pageCountStatus) {
    const status = att.pageCountStatus;
    
    // Non-terminal: actively detecting page count
    if (status === 'detecting') return false;
    
    // Terminal: 'known', 'failed', 'failed_soft', 'unknown' all terminal
    return true;
  }
  
  // Fail-soft: if pageCountStatus missing/undefined, treat as terminal
  // (legacy safety for older attachments or API responses without status field)
  return true;
}

/**
 * Check if all per-page thumbnails are terminal (for multi-page PDFs)
 * Fail-soft: no pages array treated as terminal
 */
function arePageThumbsTerminal(att: AttachmentWithStatus | null | undefined): boolean {
  if (!att?.pages || att.pages.length === 0) return true; // Fail-soft
  
  return att.pages.every(page => {
    if (!page.thumbStatus) return true; // Fail-soft
    return page.thumbStatus !== 'thumb_pending';
  });
}

/**
 * Check if attachment has reached fully settled state
 * Returns true when:
 * - Both thumb and pageCount are terminal
 * - All per-page thumbs are terminal (for PDFs)
 * Fail-soft: missing fields treated as terminal
 */
export function isAttachmentSettled(att: AttachmentWithStatus | null | undefined): boolean {
  if (!att) return true; // Fail-soft
  
  const thumbDone = isThumbTerminal(att);
  const pageCountDone = isPageCountTerminal(att);
  const pageThumbsDone = arePageThumbsTerminal(att);
  
  return thumbDone && pageCountDone && pageThumbsDone;
}

/**
 * Check if ANY attachment in array is unsettled (needs polling)
 * Returns false if all attachments are terminal or array is empty
 */
export function hasAnyUnsettledAttachment(
  attachments: AttachmentWithStatus[] | null | undefined
): boolean {
  if (!attachments || attachments.length === 0) return false;
  
  return attachments.some(att => !isAttachmentSettled(att));
}
