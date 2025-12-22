/**
 * Persistence helper for expanded line item state across route transitions.
 * 
 * When a user clicks "Upload Artwork" on a TEMP line item:
 * 1. The line item must be persisted (gets real id)
 * 2. If quote is also TEMP, it gets created (route changes /quotes/new → /quotes/:id)
 * 3. React remounts the editor, losing expansion state
 * 
 * This helper uses sessionStorage to preserve which line item should be expanded
 * after the route transition completes.
 * 
 * Usage:
 * - Before triggering save/navigation: setPendingExpandedLineItemId(currentLineItemKey)
 * - After quote loads in editor: check getPendingExpandedLineItemId() and restore
 * - After restoration: clearPendingExpandedLineItemId()
 */

const STORAGE_KEY = "qvpro:pendingExpandedLineItemId";
const STORAGE_INDEX_KEY = "qvpro:pendingExpandedLineItemIndex";

/**
 * Set the line item ID that should be expanded after next route transition.
 * Use the stable line item key (tempId || id).
 * Also stores the index as a fallback for first-save transitions where key may change.
 */
export function setPendingExpandedLineItemId(lineItemKey: string | null, index?: number): void {
    if (lineItemKey) {
        try {
            sessionStorage.setItem(STORAGE_KEY, lineItemKey);
            if (index !== undefined) {
                sessionStorage.setItem(STORAGE_INDEX_KEY, String(index));
            }
        } catch (error) {
            console.warn("[persistExpandedLineItem] Failed to save to sessionStorage:", error);
        }
    } else {
        clearPendingExpandedLineItemId();
    }
}

/**
 * Get the pending expanded line item ID and index.
 * Returns { key: null, index: null } if none is pending or if sessionStorage is unavailable.
 */
export function getPendingExpandedLineItemId(): { key: string | null; index: number | null } {
    try {
        const key = sessionStorage.getItem(STORAGE_KEY);
        const indexStr = sessionStorage.getItem(STORAGE_INDEX_KEY);
        const index = indexStr ? parseInt(indexStr, 10) : null;
        return { key, index: (index !== null && !isNaN(index)) ? index : null };
    } catch (error) {
        console.warn("[persistExpandedLineItem] Failed to read from sessionStorage:", error);
        return { key: null, index: null };
    }
}

/**
 * Clear the pending expanded line item ID.
 * Call this after successfully restoring expansion or when it's no longer needed.
 */
export function clearPendingExpandedLineItemId(): void {
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.warn("[persistExpandedLineItem] Failed to clear sessionStorage:", error);
    }
}
