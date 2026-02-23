import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { isDashboardPanel, type DashboardPanel } from "@/components/dashboard/dashboardPanels";

export function useDashboardSelection(defaultPanel: DashboardPanel = "my_work") {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get("panel");
  const selectedPanel: DashboardPanel = isDashboardPanel(raw) ? raw : defaultPanel;

  const selectPanel = useCallback((panel: DashboardPanel) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("panel", panel);
      return next;
    });
  }, [setSearchParams]);

  return {
    selectedPanel,
    selectPanel,
  };
}
