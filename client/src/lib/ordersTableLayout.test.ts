import { resolveOrdersColumnWidths, ORDERS_ACTIONS_WIDTH } from "./ordersTableLayout";
import type { ColumnDefinition, ColumnSettings } from "@/components/titan";

const columns: ColumnDefinition[] = [
  { key: "orderNumber", label: "Order", defaultWidth: 140, minWidth: 80 },
  { key: "customer", label: "Customer", defaultWidth: 240, minWidth: 120 },
  { key: "status", label: "Status", defaultWidth: 160, minWidth: 100 },
  { key: "actions", label: "Actions", defaultWidth: 200, minWidth: 150 },
];
const settings: ColumnSettings = Object.fromEntries(columns.map((column) => [column.key, { visible: true, width: column.defaultWidth! }]));

describe("resolveOrdersColumnWidths", () => {
  it("preserves manual widths", () => {
    expect(resolveOrdersColumnWidths(columns, settings, 600, false)).toEqual({ orderNumber: 140, customer: 240, status: 160, actions: ORDERS_ACTIONS_WIDTH });
  });

  it("reserves a compact pinned Actions strip and fits data columns", () => {
    const widths = resolveOrdersColumnWidths(columns, settings, 600, true);
    expect(widths.actions).toBe(ORDERS_ACTIONS_WIDTH);
    expect(Object.values(widths).reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(600);
    expect(widths.customer).toBeGreaterThanOrEqual(120);
  });

  it("does not shrink useful data columns below their minimums", () => {
    const widths = resolveOrdersColumnWidths(columns, settings, 250, true);
    expect(widths).toEqual({ orderNumber: 80, customer: 120, status: 100, actions: ORDERS_ACTIONS_WIDTH });
  });
});
