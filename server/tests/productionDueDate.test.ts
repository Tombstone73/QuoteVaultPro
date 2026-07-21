import { describe, expect, it } from "@jest/globals";

import { resolveLineItemProductionDueDate } from "../services/productionDueDate";

describe("production line-item due date", () => {
  it("prefers explicit line-item and production due dates", () => {
    expect(resolveLineItemProductionDueDate({
      lineItemDueDate: "2026-07-10T12:00:00.000Z",
      dueDate: "2026-07-12T12:00:00.000Z",
    })).toBe("2026-07-10T12:00:00.000Z");
    expect(resolveLineItemProductionDueDate({
      productionDueDate: "2026-07-11T12:00:00.000Z",
      dueDate: "2026-07-12T12:00:00.000Z",
    })).toBe("2026-07-11T12:00:00.000Z");
  });

  it("returns null for missing or invalid spec values so the order date can be used", () => {
    expect(resolveLineItemProductionDueDate({ dueDate: "not-a-date" })).toBeNull();
    expect(resolveLineItemProductionDueDate(null)).toBeNull();
  });
});
