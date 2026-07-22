import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReportDefinition } from "@shared/aiReportingContracts";
import { ReportRenderer } from "./ReportRenderer";

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Bar: () => null, Line: () => null,
}));

const definition: ReportDefinition = {
  version: "v1", title: "Product sales", audience: "private", timezone: "America/New_York", dataSnapshotAt: "2026-07-21T12:00:00.000Z", filters: {}, sources: [{ label: "Finalized invoices", count: 12, freshness: "2026-07-21T12:00:00.000Z" }],
  sections: [
    { kind: "executive_summary", text: "Revenue grew 12%." },
    { kind: "kpi_grid", title: "Highlights", items: [{ label: "Revenue", value: "$2,100", sensitive: false }, { label: "Margin", value: "$600", sensitive: true }] },
    { kind: "table", title: "Products", columns: [{ key: "product", label: "Product", sensitive: false }, { key: "revenue", label: "Revenue", sensitive: false }, { key: "margin", label: "Margin", sensitive: true }], rows: [{ product: "PVC banner", revenue: 2100, margin: 600 }] },
    { kind: "bar_chart", title: "Revenue by product", labelKey: "product", valueKey: "revenue", rows: [{ product: "PVC banner", revenue: 2100 }] },
    { kind: "ranked_list", title: "Key takeaways", items: [{ label: "PVC banner", value: "$2,100", detail: "Top product" }] },
  ],
};

function render(customerSafe = false) {
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  act(() => root.render(<ReportRenderer definition={definition} customerSafe={customerSafe} />));
  return { container, root };
}

describe("ReportRenderer", () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterEach(() => document.body.replaceChildren());
  it("renders validated narrative, KPI, table, ranking, and chart sections", () => { const view = render(); expect(view.container.textContent).toContain("Revenue grew 12%."); expect(view.container.textContent).toContain("PVC banner"); expect(view.container.querySelector('[data-testid="report-bar-chart"]')).toBeTruthy(); act(() => view.root.unmount()); });
  it("omits fields marked sensitive for customer-safe rendering", () => { const view = render(true); expect(view.container.textContent).not.toContain("Margin"); expect(view.container.textContent).toContain("Revenue"); act(() => view.root.unmount()); });
});
