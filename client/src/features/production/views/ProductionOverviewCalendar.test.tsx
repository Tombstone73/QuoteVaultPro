/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, it } from "@jest/globals";

import type { ProductionJobListItem } from "@/hooks/useProduction";
import { ProductionOverviewCalendar } from "./ProductionOverviewCalendar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function job(overrides: Partial<ProductionJobListItem> & { id: string }): ProductionJobListItem {
  const { id, ...rest } = overrides;
  return {
    id,
    view: "flatbed",
    stationKey: "flatbed",
    status: "queued",
    startedAt: null,
    completedAt: null,
    totalSeconds: 0,
    timer: { isRunning: false, runningSince: null, currentSeconds: 0 },
    reprintCount: 0,
    media: "ACM",
    createdAt: "2026-07-01T12:00:00",
    updatedAt: "2026-07-01T12:00:00",
    order: {
      id: "order-1",
      customerId: "customer-1",
      orderNumber: "20004",
      customerName: "Titan Customer",
      dueDate: null,
      priority: "normal",
    },
    ...rest,
  } as ProductionJobListItem;
}

describe("Production Overview calendar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders dated and no-date jobs, urgency states, and opens existing job detail", () => {
    const onOpenJob = jest.fn();
    const jobs = [
      job({ id: "today", lineNumber: 2, dueDate: "2026-07-20T15:00:00", order: { ...job({ id: "base" }).order, priority: "rush" } }),
      job({ id: "overdue", dueDate: "2026-07-19T15:00:00" }),
      job({ id: "none" }),
    ];
    act(() => root.render(
      <ProductionOverviewCalendar
        jobs={jobs}
        month={new Date("2026-07-15T12:00:00")}
        onMonthChange={jest.fn()}
        onOpenJob={onOpenJob}
        stationLabels={new Map([["flatbed", "Flatbed Printing"]])}
        documentNumberDisplayMode="full"
        now={new Date("2026-07-20T12:00:00")}
      />,
    ));

    const today = container.querySelector('[data-testid="production-calendar-job-today"]') as HTMLButtonElement;
    const overdue = container.querySelector('[data-testid="production-calendar-job-overdue"]') as HTMLButtonElement;
    const noDue = container.querySelector('[data-testid="production-calendar-no-due-date"]') as HTMLElement;
    expect(today.closest('[data-date="2026-07-20"]')).toBeTruthy();
    expect(today.dataset.urgency).toBe("today");
    expect(today.textContent).toContain("Line 2");
    expect(today.textContent).toContain("Flatbed Printing");
    expect(overdue.dataset.urgency).toBe("overdue");
    expect(noDue.textContent).toContain("No due date (1)");
    expect(noDue.textContent).toContain("Titan Customer");

    act(() => today.click());
    expect(onOpenJob).toHaveBeenCalledWith("today");
  });
});
