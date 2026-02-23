import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import MyWorkPanel from "@/components/dashboard/MyWorkPanel";
import DashboardDetailsView from "@/components/dashboard/DashboardDetailsView";
import type { DashboardPanel } from "@/components/dashboard/dashboardPanels";

type DashboardDetailPanelProps = {
  activeTab: "my_work" | "details";
  onTabChange: (tab: "my_work" | "details") => void;
  selectedPanel: DashboardPanel;
};

export default function DashboardDetailPanel({ activeTab, onTabChange, selectedPanel }: DashboardDetailPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={activeTab === "my_work" ? "default" : "outline"}
          onClick={() => onTabChange("my_work")}
        >
          My Work
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activeTab === "details" ? "default" : "outline"}
          onClick={() => onTabChange("details")}
        >
          Details
        </Button>
        {activeTab === "details" && selectedPanel !== "my_work" ? (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Live View
          </Badge>
        ) : null}
      </div>

      {activeTab === "my_work" ? <MyWorkPanel /> : <DashboardDetailsView panel={selectedPanel} />}
    </div>
  );
}
