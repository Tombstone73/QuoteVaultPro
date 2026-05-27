/// <reference types="jest" />

import { TextDecoder, TextEncoder } from "util";
import TitanDashboard from "./titan-dashboard";

Object.assign(globalThis, { TextDecoder, TextEncoder });

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock("@/hooks/useDashboardSelection", () => ({
  useDashboardSelection: () => ({
    selectedPanel: "orders_due_today",
    selectPanel: jest.fn(),
  }),
}));

jest.mock("@/hooks/useDashboardSummary", () => ({
  useDashboardSummary: () => ({
    data: {
      criticalAlerts: {
        dueToday: 2,
        dueTomorrow: 1,
        lowInventoryItems: 3,
        quotesPending: 4,
        overdueInvoices: 5,
      },
      ordersPipeline: {},
      productionJobs: {},
      fulfillmentFinance: {},
    },
  }),
}));

jest.mock("@/components/dashboard/OrdersPipelineCard", () => ({
  __esModule: true,
  default: () => <section>Orders pipeline</section>,
}));

jest.mock("@/components/dashboard/ProductionJobsCard", () => ({
  __esModule: true,
  default: () => <section>Production jobs</section>,
}));

jest.mock("@/components/dashboard/FulfillmentFinanceCard", () => ({
  __esModule: true,
  default: () => <section>Fulfillment finance</section>,
}));

jest.mock("@/components/dashboard/DashboardDetailPanel", () => ({
  __esModule: true,
  default: () => <section>Dashboard details</section>,
}));

jest.mock("@/components/dashboard/ActivityFeedPanel", () => ({
  __esModule: true,
  default: () => <aside>Activity feed</aside>,
}));

describe("TitanDashboard layout", () => {
  it("starts with operational content instead of the redundant page title block", () => {
    const markup = renderToStaticMarkup(<TitanDashboard />);

    expect(markup).not.toContain("Titan Dashboard");
    expect(markup).toContain("Critical Alerts");
    expect(markup).toContain("New Quote");
    expect(markup).toContain("New Order");
    expect(markup.indexOf("Critical Alerts")).toBeLessThan(markup.indexOf("Orders pipeline"));
  });
});
