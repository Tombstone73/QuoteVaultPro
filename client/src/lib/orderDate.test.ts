import { formatOrderDate, orderDateInputValue, serializeOrderDateInput } from "./orderDate";

describe("Order calendar dates", () => {
  test("round-trips a due date without shifting its calendar day", () => {
    const persisted = serializeOrderDateInput("2026-08-31");

    expect(persisted).toBe("2026-08-31T12:00:00.000Z");
    expect(orderDateInputValue(persisted)).toBe("2026-08-31");
    expect(formatOrderDate(persisted, "short")).toBe("Aug 31, 2026");
  });

  test("preserves existing midnight-UTC order dates as their stored calendar day", () => {
    expect(orderDateInputValue("2026-08-31T00:00:00.000Z")).toBe("2026-08-31");
    expect(formatOrderDate("2026-08-31T00:00:00.000Z", "numeric")).toBe("08/31/2026");
  });

  test("keeps clearing semantics and rejects invalid dates", () => {
    expect(serializeOrderDateInput("")).toBeNull();
    expect(serializeOrderDateInput("2026-02-30")).toBeNull();
  });
});
