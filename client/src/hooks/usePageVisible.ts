import { useState, useEffect } from "react";

/**
 * Returns true when the browser tab is currently visible.
 *
 * Re-renders the host component on visibilitychange so that refetchInterval
 * functions can re-evaluate and stop polling while the tab is hidden.
 *
 * Safe to call during SSR: defaults to true when document is unavailable.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visible;
}
