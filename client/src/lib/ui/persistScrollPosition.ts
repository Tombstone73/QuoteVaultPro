/**
 * Persistence helper for scroll position across route transitions.
 * 
 * When a user triggers an action that causes quote creation and navigation
 * (e.g., clicking Upload Artwork on a temp line item), we want to preserve
 * their scroll position so they don't jump back to the top of the page.
 * 
 * Usage:
 * - Before triggering save/navigation: setPendingScrollPosition(window.scrollY)
 * - After quote loads in editor: check getPendingScrollPosition() and restore
 * - After restoration: clearPendingScrollPosition()
 */

const STORAGE_KEY = "qvpro:pendingScrollY";

/**
 * Set the scroll position that should be restored after next route transition.
 */
export function setPendingScrollPosition(scrollY: number): void {
    try {
        sessionStorage.setItem(STORAGE_KEY, String(scrollY));
    } catch (error) {
        console.warn("[persistScrollPosition] Failed to save to sessionStorage:", error);
    }
}

/**
 * Get the pending scroll position.
 * Returns null if none is pending or if sessionStorage is unavailable.
 */
export function getPendingScrollPosition(): number | null {
    try {
        const value = sessionStorage.getItem(STORAGE_KEY);
        if (value === null) return null;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
    } catch (error) {
        console.warn("[persistScrollPosition] Failed to read from sessionStorage:", error);
        return null;
    }
}

/**
 * Clear the pending scroll position.
 */
export function clearPendingScrollPosition(): void {
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.warn("[persistScrollPosition] Failed to clear sessionStorage:", error);
    }
}
