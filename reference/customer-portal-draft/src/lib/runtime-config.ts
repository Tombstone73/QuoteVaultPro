/**
 * Runtime data-mode resolution. Pure helper — no React dependency.
 *
 * Resolution order:
 *   1. localStorage "titan_data_mode" override
 *   2. VITE_USE_MOCKS build flag
 *   3. default → "live_api"
 */

export type DataMode = "live_api" | "mock_demo";

const STORAGE_KEY = "titan_data_mode";

export function getDataMode(): DataMode {
  const override = localStorage.getItem(STORAGE_KEY);
  if (override === "mock_demo" || override === "live_api") return override;
  if (import.meta.env.VITE_USE_MOCKS === "true") return "mock_demo";
  return "live_api";
}

export function setDataMode(mode: DataMode | null): void {
  if (mode === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, mode);
  }
}

export function isMockMode(): boolean {
  return getDataMode() === "mock_demo";
}

/** Whether the demo panel should be visible at all */
export function isDemoPanelVisible(): boolean {
  return (
    import.meta.env.VITE_USE_MOCKS === "true" ||
    localStorage.getItem(STORAGE_KEY) !== null
  );
}
