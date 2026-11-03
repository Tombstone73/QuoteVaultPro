import { describe, expect, it } from "@jest/globals";

import {
  buildProductionCalendarDays,
  groupProductionJobsByDueDate,
  productionDueUrgency,
  productionOverviewDeadlineLabel,
  resolveProductionOverviewDueDate,
} from "./productionOverviewCalendarModel";

describe("Production Overview calendar model", () => {
  it('shows explicit EOD/time, keeps historical dates date-only, and respects independent line dates', () => {
    const accepted={date:'2026-11-10',kind:'time' as const,localTime:'16:15',timezone:'America/New_York',instant:'2026-11-10T21:15:00Z',sourceText:null};
    const job={id:'timed',dueDate:'2026-11-10T12:00:00Z',order:{dueDate:'2026-11-10T12:00:00Z',deadlineJson:{requested:null,accepted}}};
    expect(productionOverviewDeadlineLabel(job)).toContain('16:15 (America/New_York)');
    expect(productionOverviewDeadlineLabel({...job,order:{...job.order,deadlineJson:{requested:null,accepted:{...accepted,kind:'eod',localTime:null,instant:null}}}})).toContain('EOD');
    expect(productionOverviewDeadlineLabel({...job,lineItemDueDate:'2026-11-09T12:00:00Z'})).toBe('Nov 9, 2026');
    expect(productionOverviewDeadlineLabel({id:'historical',order:{dueDate:'2020-01-02T12:00:00Z'}})).toBe('Jan 2, 2020');
  });
  it("uses line-level due date before effective and order due dates", () => {
    expect(resolveProductionOverviewDueDate({
      id: "job-1",
      lineItemDueDate: "2026-07-12T12:00:00.000Z",
      dueDate: "2026-07-14T12:00:00.000Z",
      order: { dueDate: "2026-07-16T12:00:00.000Z" },
    })).toBe("2026-07-12T12:00:00.000Z");
  });

  it("groups jobs on their due dates and retains jobs without dates", () => {
    const grouped = groupProductionJobsByDueDate([
      { id: "dated", dueDate: "2026-07-20T12:00:00", order: { dueDate: null } },
      { id: "fallback", order: { dueDate: "2026-07-20T15:00:00" } },
      { id: "none", order: { dueDate: null } },
    ]);
    expect(grouped.byDate.get("2026-07-20")?.map((job) => job.id)).toEqual(["dated", "fallback"]);
    expect(grouped.noDueDate.map((job) => job.id)).toEqual(["none"]);
  });

  it("marks overdue and due-today dates clearly", () => {
    const now = new Date("2026-07-20T12:00:00");
    expect(productionDueUrgency("2026-07-19T12:00:00", now)).toBe("overdue");
    expect(productionDueUrgency("2026-07-20T23:00:00", now)).toBe("today");
    expect(productionDueUrgency("2026-07-21T12:00:00", now)).toBe("upcoming");
  });

  it("builds a complete Sunday-through-Saturday month grid", () => {
    const days = buildProductionCalendarDays(new Date("2026-07-15T12:00:00"));
    expect(days[0].getDay()).toBe(0);
    expect(days.at(-1)?.getDay()).toBe(6);
    expect(days.some((day) => day.getMonth() === 6 && day.getDate() === 31)).toBe(true);
  });
});
