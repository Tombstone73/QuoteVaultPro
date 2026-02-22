import ActivityFeedPanel from "@/components/dashboard/ActivityFeedPanel";
import CriticalAlertsRow from "@/components/dashboard/CriticalAlertsRow";
import FulfillmentFinanceCard from "@/components/dashboard/FulfillmentFinanceCard";
import MyWorkPanel from "@/components/dashboard/MyWorkPanel";
import OrdersPipelineCard from "@/components/dashboard/OrdersPipelineCard";
import ProductionJobsCard from "@/components/dashboard/ProductionJobsCard";
import QuickActionsPanel from "@/components/dashboard/QuickActionsPanel";

export default function TitanDashboard() {
  return (
    <div className="w-full p-4 md:p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Titan Dashboard</h1>
        <p className="text-sm text-muted-foreground">Main dashboard layout ready for live data wiring.</p>
      </div>

      <CriticalAlertsRow />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <OrdersPipelineCard />
        <ProductionJobsCard />
        <FulfillmentFinanceCard />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <MyWorkPanel />
        </div>

        <div className="space-y-4 xl:col-span-1">
          <QuickActionsPanel />
          <ActivityFeedPanel />
        </div>
      </section>
    </div>
  );
}
