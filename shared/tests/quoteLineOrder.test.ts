import { describe, expect, test } from "@jest/globals";
import { groupQuoteLines, moveQuoteLineGroup, validateQuoteLineOrder } from "../quoteLineOrder";
import { projectCommercialDocumentLines } from "../commercialDocumentLines";

const lines = [
  { id: "a", displayOrder: 0, cents: 22044, quantity: 2, productId: "acm", width: 54.21 },
  { id: "a1", parentLineItemId: "a", displayOrder: 1, cents: 10800 },
  { id: "a2", parentLineItemId: "a", displayOrder: 2, cents: 50 },
  { id: "b", displayOrder: 3, cents: 3000 },
  { id: "b1", parentLineItemId: "b", displayOrder: 4, cents: 6613 },
];
describe("Quote sequence and hierarchy", () => {
  test("moves complete groups without changing fields; projected parent order follows", () => {
    const moved = moveQuoteLineGroup(lines, "b", "a");
    expect(moved.map((line) => line.id)).toEqual(["b", "b1", "a", "a1", "a2"]);
    for (const line of moved) expect(line).toBe(lines.find((source) => source.id === line.id));
    const persisted = moved.map((line, displayOrder) => ({ ...line, displayOrder }));
    expect(projectCommercialDocumentLines(persisted, (line) => line.cents).map((row) => row.line.id)).toEqual(["b", "a"]);
    expect(() => validateQuoteLineOrder(lines, moved.map((line) => line.id), lines.map((line) => line.id))).not.toThrow();
  });
  test("standalone reorder and child reorder work, cross-parent dragging does not reparent", () => {
    expect(moveQuoteLineGroup([lines[0], lines[3]], "b", "a").map((line) => line.id)).toEqual(["b", "a"]);
    expect(moveQuoteLineGroup(lines, "a2", "a1").map((line) => line.id)).toEqual(["a", "a2", "a1", "b", "b1"]);
    expect(moveQuoteLineGroup(lines, "a1", "b1")).toEqual(lines);
  });
  test("supports existing nested links and moves descendants as a unit", () => {
    const nested = [...lines, { id: "nested", parentLineItemId: "a1", displayOrder: 5, cents: 1 }];
    expect(moveQuoteLineGroup(nested, "b", "a1").map((line) => line.id)).toEqual(["b", "b1", "a", "a1", "nested", "a2"]);
  });
  test("rejects stale sequence, missing/foreign/duplicate IDs, empty input and split groups", () => {
    const current = lines.map((line) => line.id);
    expect(() => validateQuoteLineOrder(lines, current, [...current].reverse())).toThrow("changed");
    for (const invalid of [[], ["foreign"], ["a", "a", "a2", "b", "b1"], ["a", "b", "a1", "a2", "b1"]]) {
      expect(() => validateQuoteLineOrder(lines, invalid, current)).toThrow();
    }
    expect(groupQuoteLines([])).toEqual([]);
  });
});
