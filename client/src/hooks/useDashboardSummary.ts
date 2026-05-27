import { useQuery } from "@tanstack/react-query";

export type DashboardSummary = {
  criticalAlerts: {
    dueToday: number | null;
    dueTomorrow: number | null;
    lowInventoryItems: number | null;
    quotesPending: number | null;
    overdueInvoices: number | null;
  };
  ordersPipeline: {
    newOrders: number | null;
    scheduled: number | null;
    inProduction: number | null;
    readyForPickup: number | null;
    onHold: number | null;
    slaRisk: number | null;
  };
  productionJobs: {
    artworkPending: number | null;
    printing: number | null;
    finishing: number | null;
    qaInspection: number | null;
    unassignedJobs: number | null;
  };
  fulfillmentFinance: {
    readyToShip: number | null;
    shippedToday: number | null;
    invoicesUnpaid: number | null;
    overdueAmountCents: number | null;
    collectedTodayCents: number | null;
    collectedWeekCents: number | null;
  };
};

type DashboardSummaryResponse = {
  success: boolean;
  data: DashboardSummary;
  message?: string;
};

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboardSummary"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/summary", { credentials: "include" });
      const json = (await res.json()) as DashboardSummaryResponse;

      if (!res.ok || !json?.success) {
        throw new Error(json?.message || "Failed to fetch dashboard summary");
      }

      return json.data;
    },
    staleTime: 30_000,
  });
}
