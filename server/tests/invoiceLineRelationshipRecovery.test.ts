import { describe, expect, test } from "@jest/globals";
import { projectStaffInvoiceLineHierarchy } from "../../shared/invoiceLinePresentation";
import { enrichInvoiceLineRelationships } from "../../shared/invoiceSnapshotPresentation";

describe("historical Invoice relationship presentation", () => {
  test("recovers seven saved Order pairs without touching Invoice snapshots or amounts", () => {
    const snapshots = Array.from({ length: 7 }, (_, index) => [
      { id: `invoice-parent-${index}`, orderLineItemId: `order-parent-${index}`, parentLineItemId: null, sortOrder: 0, width: 144, height: 71.63, totalPrice: "860.00" },
      { id: `invoice-child-${index}`, orderLineItemId: `order-child-${index}`, parentLineItemId: null, sortOrder: 0, width: 144, height: 71.63, totalPrice: "2020.00" },
    ]).flat();
    const sources = snapshots.map((line, index) => ({
      id: line.orderLineItemId, orderId: "saved-order", sortOrder: index,
      parentLineItemId: index % 2 ? `order-parent-${Math.floor(index / 2)}` : null,
    }));
    const before = structuredClone(snapshots);
    const presented = enrichInvoiceLineRelationships(snapshots, sources);
    const rows = projectStaffInvoiceLineHierarchy(presented);
    expect(rows.map((row) => row.line.id)).toEqual(snapshots.map((line) => line.id));
    expect(rows.filter((row) => row.parentLineNumber != null)).toHaveLength(7);
    expect(rows.filter((row) => row.childCount === 1)).toHaveLength(7);
    expect(presented.map((line) => line.totalPrice)).toEqual(snapshots.map((line) => line.totalPrice));
    expect(snapshots).toEqual(before);
  });

  test("preserves explicit snapshot links and leaves missing, duplicate, and foreign links separate", () => {
    const snapshots = [
      { id: "parent", orderLineItemId: "source-parent", parentLineItemId: null, sortOrder: 1 },
      { id: "explicit", orderLineItemId: "source-explicit", parentLineItemId: "source-parent", sortOrder: 2 },
      { id: "recover", orderLineItemId: "source-recover", parentLineItemId: null, sortOrder: 3 },
      { id: "foreign", orderLineItemId: "source-foreign", parentLineItemId: null, sortOrder: 4 },
      { id: "missing", orderLineItemId: "source-missing", parentLineItemId: null, sortOrder: 5 },
      { id: "duplicate-a", orderLineItemId: "source-duplicate", parentLineItemId: null, sortOrder: 6 },
      { id: "duplicate-b", orderLineItemId: "source-duplicate", parentLineItemId: null, sortOrder: 7 },
    ];
    const sources = [
      { id: "source-parent", orderId: "one", parentLineItemId: null },
      { id: "source-explicit", orderId: "one", parentLineItemId: "other-parent" },
      { id: "source-recover", orderId: "one", parentLineItemId: "source-parent" },
      { id: "source-foreign", orderId: "two", parentLineItemId: "source-parent" },
      { id: "source-missing", orderId: "one", parentLineItemId: "absent-parent" },
      { id: "source-duplicate", orderId: "one", parentLineItemId: "source-parent" },
    ];
    const presented = enrichInvoiceLineRelationships(snapshots, sources);
    expect(presented.map((line) => line.parentLineItemId)).toEqual([
      null, "source-parent", "source-parent", null, null, null, null,
    ]);
    expect(projectStaffInvoiceLineHierarchy(presented).map((row) => row.line.id)).toEqual([
      "parent", "explicit", "recover", "foreign", "missing", "duplicate-a", "duplicate-b",
    ]);
    const incompleteOrder = enrichInvoiceLineRelationships(
      [{ id: "older", orderLineItemId: null, sortOrder: 0 }, { id: "newer", orderLineItemId: "source-parent", sortOrder: 0 }],
      [{ id: "source-parent", orderId: "one", sortOrder: 4 }],
    );
    expect(incompleteOrder.every((line) => !("displayOrder" in line))).toBe(true);
  });
});
