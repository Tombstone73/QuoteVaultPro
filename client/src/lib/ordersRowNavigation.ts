export const ORDERS_ROW_NAVIGATION_EXCLUSION_SELECTOR = 'button, a, input, select, textarea, [data-stop-row-nav="true"]';

/** Returns true when a row click began inside an Orders-list interaction zone. */
export function isOrdersRowNavigationExcluded(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element
    ? Boolean(target.closest(ORDERS_ROW_NAVIGATION_EXCLUSION_SELECTOR))
    : false;
}
