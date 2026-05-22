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

export function currentBrowserPath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function recoverBrowserRouterMismatchSoon({
  targetPath,
  getReactRouterPath,
  delayMs = 150,
}: {
  targetPath: string;
  getReactRouterPath: () => string;
  delayMs?: number;
}): void {
  if (typeof window === "undefined") return;
  if (!targetPath.startsWith("/")) return;

  window.setTimeout(() => {
    const browserPath = currentBrowserPath();
    const reactRouterPath = getReactRouterPath();

    if (browserPath === targetPath && reactRouterPath !== targetPath) {
      console.warn("[BrowserRouterSync] URL/render mismatch detected; reloading target route", {
        browserPath,
        reactRouterPath,
        targetPath,
      });
      window.location.replace(targetPath);
    }
  }, delayMs);
}
