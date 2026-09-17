import { getPanelOpenTarget } from "./dashboardPanels";

describe("Dashboard due-date drilldown targets", () => {
  test("uses server-authoritative due windows instead of browser-generated date strings", () => {
    expect(getPanelOpenTarget("orders_due_today")).toEqual({
      label: "Open in Orders",
      href: "/orders?due=today",
    });
    expect(getPanelOpenTarget("orders_due_tomorrow")).toEqual({
      label: "Open in Orders",
      href: "/orders?due=tomorrow",
    });
  });

  test("opens overdue invoices through the canonical A/R overdue filter", () => {
    expect(getPanelOpenTarget("invoices_overdue")).toEqual({
      label: "Open Accounts Receivable",
      href: "/reports/accounts-receivable?overdue=true",
    });
  });
});
