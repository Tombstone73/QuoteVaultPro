export const workspaceNavigationEvent = "v2:sales-workspace-before-navigation";

/** Reuse the active editor's leave decision before a shell mutates URL/state.
 * This does not block forced authentication or organization-scope teardown. */
export function canNavigateFromSalesWorkspace(): boolean {
  return typeof window === "undefined" || window.dispatchEvent(new window.Event(workspaceNavigationEvent, { cancelable: true }));
}
