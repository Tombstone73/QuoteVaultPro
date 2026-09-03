import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

describe("Dashboard Order due-date contract", () => {
  test("shares one tenant-calendar predicate between dashboard counts and row drilldowns", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const summary = read("server/services/dashboardSummaryService.ts");
    const route = read("server/routes/orders.routes.ts");
    const repository = read("server/storage/orders.repo.ts");
    const details = read("client/src/components/dashboard/DashboardDetailsView.tsx");

    expect(summary).toContain('activeOrderDuePredicates("today", dueToday)');
    expect(summary).toContain('activeOrderDuePredicates("tomorrow", dueTomorrow)');
    expect(route).toContain("businessDateForOrderDueFilter(dueFilter");
    expect(repository).toContain("activeOrderDuePredicates(opts.dueFilter, opts.dueDatePart)");
    expect(details).toContain('due: dueFilter, page: 1');
    expect(details).not.toContain('case "orders_due_today":\n          return !!dueDate');
  });

  test("normalizes native Order writes and dashboard displays through the calendar-date helper", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const repository = read("server/storage/orders.repo.ts");
    const orderForm = read("client/src/components/order-form.tsx");
    const ordersList = read("client/src/pages/orders.tsx");
    const details = read("client/src/components/dashboard/DashboardDetailsView.tsx");

    expect(repository).toContain("serializeOrderBusinessDate(value)");
    expect(repository).toContain('"dueDate", "promisedDate", "requestedDueDate", "productionDueDate"');
    expect(orderForm).toContain("serializeOrderDateInput(dueDate)");
    expect(ordersList).toContain('formatOrderDate(row.dueDate, "short")');
    expect(ordersList).toContain("const isDashboardDueDrilldown = dueFilter !== undefined");
    expect(ordersList).toContain("orderStatusPillIdsForQuery(isDashboardDueDrilldown ? null : statusPillSelection");
    expect(details).toContain('formatOrderDate(o.dueDate, "short")');
  });
});
