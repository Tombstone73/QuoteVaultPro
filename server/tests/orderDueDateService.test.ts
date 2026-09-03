import { describe, expect, test } from "@jest/globals";
import {
  addBusinessCalendarDays,
  businessDateForOrderDueFilter,
  isOrderDueFilter,
  organizationBusinessToday,
  validOrganizationTimezone,
} from "../lib/orderDueDate";

describe("Order dashboard business-date contract", () => {
  test("uses the organization's calendar day rather than the server UTC day", () => {
    const instant = new Date("2026-09-04T02:30:00.000Z");

    expect(organizationBusinessToday(instant, "America/Indiana/Indianapolis")).toBe("2026-09-03");
    expect(businessDateForOrderDueFilter("today", instant, "America/Indiana/Indianapolis")).toBe("2026-09-03");
    expect(businessDateForOrderDueFilter("tomorrow", instant, "America/Indiana/Indianapolis")).toBe("2026-09-04");
  });

  test("advances calendar dates safely across DST and month boundaries", () => {
    expect(addBusinessCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addBusinessCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  test("accepts only explicit due window tokens and fails invalid timezones closed to UTC", () => {
    expect(isOrderDueFilter("today")).toBe(true);
    expect(isOrderDueFilter("tomorrow")).toBe(true);
    expect(isOrderDueFilter("yesterday")).toBe(false);
    expect(validOrganizationTimezone("not/a-real-timezone")).toBe("UTC");
  });
});
