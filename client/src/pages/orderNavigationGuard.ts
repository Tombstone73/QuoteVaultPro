/**
 * Pure factory for the order editor's navigation-guard callbacks.
 *
 * `isDirty` is the single canonical dirty value for order-detail (staged
 * order-level edits OR an unsaved line item). order-detail re-registers the
 * guard whenever `isDirty` changes, so the callbacks always reflect the
 * committed value — there is NO ref indirection or render-phase mutation that
 * could leave the guard reporting "blocked" after a save made the page clean.
 */

export const ORDER_UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave without saving?";

export type OrderNavigationGuard = {
  /** Returns a confirm message when navigation should be blocked, else false. */
  guard: (targetPath: string) => string | boolean;
  /** Whether navigation should currently be intercepted at all. */
  shouldBlock: () => boolean;
};

export function createOrderNavigationGuard(isDirty: boolean): OrderNavigationGuard {
  return {
    guard: () => (isDirty ? ORDER_UNSAVED_CHANGES_MESSAGE : false),
    shouldBlock: () => isDirty,
  };
}
