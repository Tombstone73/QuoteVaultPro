import { hasHorizontalOverflow, syncHorizontalScroll } from "./ordersHorizontalScroll";

describe("Orders persistent horizontal scrolling", () => {
  it("only renders a control when the real viewport overflows", () => {
    expect(hasHorizontalOverflow(1000, 1000)).toBe(false);
    expect(hasHorizontalOverflow(1001, 1000)).toBe(false);
    expect(hasHorizontalOverflow(1002, 1000)).toBe(true);
  });

  it("synchronizes in either direction without redundant writes", () => {
    const table = { scrollLeft: 280 };
    const bar = { scrollLeft: 0 };
    syncHorizontalScroll(table, bar);
    expect(bar.scrollLeft).toBe(280);
    syncHorizontalScroll(bar, table);
    expect(table.scrollLeft).toBe(280);
  });
});
