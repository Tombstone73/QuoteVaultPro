export type DailyProductionDueState = "overdue" | "today" | "tomorrow" | "future" | "none";

export type DailyProductionDestination = "roll" | "flatbed" | "mixed" | "unclassified" | "none";

export type DailyProductionFulfillment = "Ship" | "Pickup" | "Delivery" | "Unknown";

export type DailyProductionReportRow = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  jobLabel: string | null;
  poNumber: string | null;
  dueDate: string | null;
  dueState: DailyProductionDueState;
  quantity: number;
  destination: DailyProductionDestination;
  fulfillment: DailyProductionFulfillment;
};

export type DailyProductionReport = {
  organizationName: string;
  asOf: string;
  timezone: string;
  summary: {
    open: number;
    dueToday: number;
    dueTomorrow: number;
    overdue: number;
    noDueDate: number;
  };
  overview: DailyProductionReportRow[];
  roll: DailyProductionReportRow[];
  flatbed: DailyProductionReportRow[];
  diagnostics: {
    unclassifiedProductionLines: number;
    mixedOrders: number;
    nonstandardFulfillmentOrders: number;
    activeOrdersOutsideReportStatus: number;
  };
};
