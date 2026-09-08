import { mergeTableColumnConfig, type ColumnConfig } from "@/hooks/useTableColumnConfig";

const defaults: ColumnConfig[] = [
  { id: "invoice", label: "Invoice #", visible: true, order: 0, locked: true },
  { id: "total", label: "Total", visible: true, order: 1 },
  { id: "actions", label: "Actions", visible: true, order: 2, locked: true },
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
});
