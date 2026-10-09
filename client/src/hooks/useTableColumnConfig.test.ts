import { clampTableColumnWidth, mergeTableColumnConfig, type ColumnConfig } from "@/hooks/useTableColumnConfig";

const defaults: ColumnConfig[] = [
  { id: "invoice", label: "Invoice #", visible: true, order: 0, locked: true, width: 140, minWidth: 100 },
  { id: "total", label: "Total", visible: true, order: 1, width: 120, minWidth: 90, maxWidth: 300 },
  { id: "actions", label: "Actions", visible: true, order: 2, locked: true, width: 230, minWidth: 220 },
];

describe("table column configuration", () => {
  test("keeps required columns visible, ignores removed columns, and appends future columns", () => {
    const merged = mergeTableColumnConfig(defaults, [
      { id: "total", visible: false, order: 0 },
      { id: "invoice", visible: false, order: 1 },
      { id: "removed", visible: false, order: 2 },
    ]);

    expect(merged.map((column) => column.id)).toEqual(["total", "invoice", "actions"]);
    expect(merged.find((column) => column.id === "total")?.visible).toBe(false);
    expect(merged.find((column) => column.id === "invoice")?.visible).toBe(true);
    expect(merged.find((column) => column.id === "actions")?.visible).toBe(true);
  });

  test("preserves legacy visibility/order preferences and supplies default widths", () => {
    const merged = mergeTableColumnConfig(defaults, [
      { id: "total", visible: false, order: 0 },
      { id: "invoice", visible: false, order: 1 },
    ]);
    expect(merged.map(({ id, width }) => [id, width])).toEqual([
      ["total", 120], ["invoice", 140], ["actions", 230],
    ]);
    expect(merged.find((column) => column.id === "total")?.visible).toBe(false);
    expect(merged.find((column) => column.id === "invoice")?.visible).toBe(true);
  });

  test("restores persisted widths while clamping invalid or out-of-range values", () => {
    const merged = mergeTableColumnConfig(defaults, [
      { id: "invoice", width: 40, order: 0 },
      { id: "total", width: 450, order: 1 },
      { id: "actions", width: "broken", order: 2 },
    ]);
    expect(merged.map((column) => column.width)).toEqual([100, 300, 230]);
    expect(clampTableColumnWidth(defaults[1], 155.5)).toBe(156);
  });
});
