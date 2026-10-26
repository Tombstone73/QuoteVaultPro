import { describe, expect, test } from "@jest/globals";
import { projectDocumentLineGroups } from "../documentLinePresentation";

const source = [
  { id: "parent-a", sortOrder: 0, productName: "Vinyl", width: 144, height: 71.63, description: "Three layer translucent printing", selectedOptions: [{ optionId: "lamination", optionName: "Lamination", value: "UV overlaminate" }] },
  { id: "parent-b", sortOrder: 1, productName: "Vinyl", width: 144, height: 71.63 },
  { id: "child-b", parentLineItemId: "parent-b", sortOrder: 2, productName: "Polycarbonate Backer", width: 144, height: 71.63 },
  { id: "standalone", sortOrder: 3, productName: "Packing" },
  { id: "child-a2", parentLineItemId: "parent-a", sortOrder: 4, productName: "Second Backer" },
  { id: "child-a1", parentLineItemId: "parent-a", sortOrder: 5, productName: "First Backer" },
];

describe("saved document line presentation", () => {
  test("groups repeated products and sizes only by explicit Order IDs, with every child and standalone row", () => {
    const groups = projectDocumentLineGroups(source, "order");
    expect(groups.map((group) => group.rows.map((row) => row.line.id))).toEqual([
      ["parent-a", "child-a2", "child-a1"], ["parent-b", "child-b"], ["standalone"],
    ]);
    expect(groups[0].rows.map((row) => row.depth)).toEqual([0, 1, 1]);
    expect(groups[0].rows[0]).toMatchObject({ description: "Three layer translucent printing", dimensions: "144 x 71.63 in" });
    expect(groups[0].rows[0].customerOptions).toContain("Lamination: UV overlaminate");
  });

  test("Invoice groups use immutable source Order IDs, preserving snapshot-only details", () => {
    const invoice = source.map((line) => ({ ...line, id: `invoice-${line.id}`, orderLineItemId: line.id }));
    const groups = projectDocumentLineGroups(invoice, "invoice");
    expect(groups[0].rows.map((row) => row.line.id)).toEqual(["invoice-parent-a", "invoice-child-a2", "invoice-child-a1"]);
    expect(groups[1].rows.map((row) => row.line.id)).toEqual(["invoice-parent-b", "invoice-child-b"]);
  });

  test("missing, ambiguous, and cyclic lineage stays separate without guessing from adjacency", () => {
    const missing = projectDocumentLineGroups(source.map((line) => ({ ...line, parentLineItemId: null })), "order");
    expect(missing).toHaveLength(source.length);
    const ambiguous = projectDocumentLineGroups([source[0], { ...source[0] }, source[4]], "order");
    expect(ambiguous).toHaveLength(3);
    const cycle = projectDocumentLineGroups([
      { id: "x", parentLineItemId: "y", sortOrder: 0 },
      { id: "y", parentLineItemId: "x", sortOrder: 1 },
    ], "order");
    expect(cycle.map((group) => group.rows.length)).toEqual([1, 1]);
  });

  test("missing historical options stay empty and internal option labels stay off customer documents", () => {
    const [group] = projectDocumentLineGroups([{ id: "one", productName: "Board", optionSelectionsJson: { selected: { thickness: { value: "4mm", label: "4mm" } } },
      selectedOptions: [{ optionId: "machine", optionName: "Machine Routing", value: "Flatbed 2" }] }], "order");
    expect(group.rows[0].customerOptions).toContain("Thickness: 4mm");
    expect(group.rows[0].productionOptions).toContain("Machine Routing: Flatbed 2");
    expect(group.rows[0].customerOptions).not.toContain("Machine Routing: Flatbed 2");
    expect(projectDocumentLineGroups([{ id: "legacy" }], "order")[0].rows[0].customerOptions).toEqual([]);
  });
});
