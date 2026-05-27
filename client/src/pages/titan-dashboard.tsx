import ActivityFeedPanel from "@/components/dashboard/ActivityFeedPanel";
import CriticalAlertsRow from "@/components/dashboard/CriticalAlertsRow";
import DashboardDetailPanel from "@/components/dashboard/DashboardDetailPanel";
import FulfillmentFinanceCard from "@/components/dashboard/FulfillmentFinanceCard";
import OrdersPipelineCard from "@/components/dashboard/OrdersPipelineCard";
import ProductionJobsCard from "@/components/dashboard/ProductionJobsCard";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useDashboardSelection } from "@/hooks/useDashboardSelection";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { FilePlus2, ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function TitanDashboard() {
  const navigate = useNavigate();
  const { data: summary } = useDashboardSummary();
  const { selectedPanel, selectPanel } = useDashboardSelection();
  const [activeTab, setActiveTab] = useState<"my_work" | "details">("my_work");
  const [isActivityCollapsed, setIsActivityCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("titan:dashboard:activityFeedCollapsed") === "true";
    } catch {
      return false;
    }
  });

  const handleSelectPanel = (panel: Parameters<typeof selectPanel>[0]) => {
    selectPanel(panel);
    setActiveTab("details");
  };

  const handleTabChange = (tab: "my_work" | "details") => {
    setActiveTab(tab);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem("titan:dashboard:activityFeedCollapsed", isActivityCollapsed ? "true" : "false");
    } catch {
      // noop
    }
  }, [isActivityCollapsed]);

  const dashboardActions = (
    <>
      <Button onClick={() => navigate(ROUTES.quotes.new)}>
        <FilePlus2 className="h-4 w-4" />
        New Quote
      </Button>
      <Button variant="outline" onClick={() => navigate(ROUTES.orders.new)}>
        <ShoppingCart className="h-4 w-4" />
        New Order
      </Button>
    </>
  );

  return (
    <div className="w-full space-y-4 px-4 pb-4 pt-3 md:px-6 md:pb-6 md:pt-4">
      <CriticalAlertsRow
        {...summary?.criticalAlerts}
        selectedPanel={selectedPanel}
        onSelectPanel={handleSelectPanel}
        actions={dashboardActions}
      />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <OrdersPipelineCard {...summary?.ordersPipeline} selectedPanel={selectedPanel} onSelectPanel={handleSelectPanel} />
        <ProductionJobsCard {...summary?.productionJobs} />
        <FulfillmentFinanceCard {...summary?.fulfillmentFinance} selectedPanel={selectedPanel} onSelectPanel={handleSelectPanel} />
      </section>

      <section className="flex items-stretch gap-4">
        <div className="min-w-0 flex-1">
          <DashboardDetailPanel activeTab={activeTab} onTabChange={handleTabChange} selectedPanel={selectedPanel} />
        </div>

        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-[180ms] ease-in-out ${isActivityCollapsed ? "w-10" : "w-[360px]"}`}
        >
          <ActivityFeedPanel collapsed={isActivityCollapsed} onCollapsedChange={setIsActivityCollapsed} />
        </div>
      </section>
    </div>
  );
}
