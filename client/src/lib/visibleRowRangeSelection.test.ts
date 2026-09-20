import { applyVisibleRowSelection, getVisibleRowRangeIds } from "./visibleRowRangeSelection";

type Row = { id: string; selectable?: boolean };
const rows: Row[] = [
  { id: "invoice-1" },
  { id: "invoice-2" },
  { id: "invoice-3", selectable: false },
  { id: "invoice-4" },
  { id: "invoice-5" },
];
const isSelectable = (row: Row) => row.selectable !== false;

describe("visible row range selection", () => {
  test("normal click changes only the target and establishes its next anchor", () => {
    const result = applyVisibleRowSelection({
      currentSelection: new Set(["outside-page"]),
      rows,
      getId: (row) => row.id,
      anchorId: null,
      targetId: "invoice-2",
      checked: true,
      shiftKey: false,
      isSelectable,
    });

    expect([...result.selectedIds]).toEqual(["outside-page", "invoice-2"]);
    expect(result.nextAnchorId).toBe("invoice-2");
    expect(result.usedRange).toBe(false);
  });

  test("Shift click selects the contiguous visible range while preserving outside selections", () => {
    const result = applyVisibleRowSelection({
      currentSelection: new Set(["outside-page", "invoice-2"]),
      rows,
      getId: (row) => row.id,
      anchorId: "invoice-2",
      targetId: "invoice-5",
      checked: true,
      shiftKey: true,
      isSelectable,
    });

    expect([...result.selectedIds]).toEqual(["outside-page", "invoice-2", "invoice-4", "invoice-5"]);
    expect(result.nextAnchorId).toBe("invoice-5");
    expect(result.usedRange).toBe(true);
  });

  test("Shift click unselects only the contiguous selectable range", () => {
    const result = applyVisibleRowSelection({
      currentSelection: new Set(["outside-page", "invoice-1", "invoice-2", "invoice-4", "invoice-5"]),
      rows,
      getId: (row) => row.id,
      anchorId: "invoice-2",
      targetId: "invoice-5",
      checked: false,
      shiftKey: true,
      isSelectable,
    });

    expect([...result.selectedIds]).toEqual(["outside-page", "invoice-1"]);
  });

  test("uses the supplied sorted visible order rather than record identity order", () => {
    const sorted = [rows[4], rows[3], rows[1], rows[0]];
    expect(getVisibleRowRangeIds({
      rows: sorted,
      getId: (row) => row.id,
      anchorId: "invoice-5",
      targetId: "invoice-2",
      isSelectable,
    })).toEqual(["invoice-5", "invoice-4", "invoice-2"]);
  });

  test("cannot reach filtered or paginated rows when an anchor is no longer visible", () => {
    const currentPage = [rows[3], rows[4]];
    expect(getVisibleRowRangeIds({
      rows: currentPage,
      getId: (row) => row.id,
      anchorId: "invoice-2",
      targetId: "invoice-5",
      isSelectable,
    })).toBeNull();
  });
});
