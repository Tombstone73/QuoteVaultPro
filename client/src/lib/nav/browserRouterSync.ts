/**
 * BrowserRouter normally updates its internal location for navigations it owns.
 * If another history interceptor mutates window.location first, BrowserRouter
 * can be left rendering the previous route until refresh. A popstate signal
 * makes it reread the current URL without reloading the page.
 */
export function notifyBrowserRouterOfCurrentUrl(): void {
  if (typeof window === "undefined" || typeof PopStateEvent === "undefined") return;

  window.dispatchEvent(
    new PopStateEvent("popstate", {
      state: window.history.state,
    }),
  );
}

export function notifyBrowserRouterOfCurrentUrlSoon(): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => notifyBrowserRouterOfCurrentUrl(), 0);
}
