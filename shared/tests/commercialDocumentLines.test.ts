import { describe, expect, test } from "@jest/globals";
import { projectCommercialDocumentLines } from "../commercialDocumentLines";

const lines = [
  { id: "a", description: "ACM", quantity: 2, width: 54.21, height: 47.5, cents: 22044, displayOrder: 0 },
  { id: "a1", parentLineItemId: "a", description: "Vinyl child", quantity: 9, width: 1, height: 1, cents: 10800, displayOrder: 1 },
  { id: "b", description: "Vinyl", quantity: 2, width: 27.8, height: 24, cents: 3000, displayOrder: 2 },
  { id: "b1", parentLineItemId: "b", description: "ACM child", quantity: 4, width: 27.39, height: 24, cents: 6613, displayOrder: 3 },
];
const project = (input: typeof lines) => projectCommercialDocumentLines(input, (line) => line.cents);

describe("customer commercial document projection", () => {
  test("reported example rolls up 328.44 + 96.13 = 424.57, preserving parent identity and every internal row", () => {
    const original = structuredClone(lines);
    const result = project(lines.map((line) => Object.freeze(line)));
    expect(result.map((row) => [row.line.id, row.totalCents])).toEqual([["a", 32844], ["b", 9613]]);
    expect(result.reduce((sum, row) => sum + row.totalCents, 0)).toBe(42457);
    expect(result[0].line).toEqual(lines[0]);
    expect(lines).toEqual(original);
    expect(lines).toHaveLength(4);
  });
  test("multiple children, nested valid descendants and standalone rows contribute exactly once", () => {
    const input = [...lines, { ...lines[1], id: "a2", cents: 99, displayOrder: 4 },
      { ...lines[1], id: "nested", parentLineItemId: "a2", cents: 101, displayOrder: 5 },
      { ...lines[0], id: "standalone", cents: 123, displayOrder: 6 }];
    const result = project(input);
    expect(result.map((row) => [row.line.id, row.totalCents])).toEqual([["a", 33044], ["b", 9613], ["standalone", 123]]);
  });
  test("synthetic sum/override bundle prices are already inclusive and never doubled", () => {
    for (const parentPriceMode of ["sum_children", "manual_override"]) {
      const input = [{ ...lines[0], lineItemRole: "parent", parentPriceMode, cents: 40000 }, lines[1]];
      expect(projectCommercialDocumentLines(input, (line) => line.cents)[0].totalCents).toBe(40000);
    }
  });
  test("uses explicit immutable Order lineage on invoice snapshots, not invoice row IDs", () => {
    const input = lines.map((line) => ({ ...line, orderLineItemId: line.id, id: `invoice-${line.id}`, sortOrder: line.displayOrder }));
    const result = projectCommercialDocumentLines(input, (line) => line.cents, { identity: "invoice" });
    expect(result.map((row) => row.totalCents)).toEqual([32844, 9613]);
    expect(result[0].line.id).toBe("invoice-a");
  });
  test("missing, ambiguous and cyclic historical linkage is never inferred", () => {
    expect(project(lines.map(({ parentLineItemId: _, ...line }) => line))).toHaveLength(4);
    const orphan = [{ ...lines[0], parentLineItemId: "missing" }, lines[2]];
    expect(project(orphan)).toHaveLength(2);
    const cycle = [{ ...lines[0], parentLineItemId: "b" }, { ...lines[2], parentLineItemId: "a" }];
    expect(project(cycle).map((row) => row.totalCents)).toEqual([22044, 3000]);
    const ambiguous = [lines[0], { ...lines[0] }, lines[1]];
    expect(project(ambiguous)).toHaveLength(3);
  });
  test("persisted order controls parent display; future expanded policy preserves economic sum", () => {
    const reordered = lines.map((line) => ({ ...line, displayOrder: line.id.startsWith("b") ? line.displayOrder - 2 : line.displayOrder + 2 }));
    expect(project(reordered).map((row) => row.line.id)).toEqual(["b", "a"]);
    const expanded = projectCommercialDocumentLines(lines, (line) => line.cents, { policy: "expanded" });
    expect(expanded).toHaveLength(4);
    expect(expanded.reduce((sum, row) => sum + row.totalCents, 0)).toBe(42457);
  });
});
