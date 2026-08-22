import assert from "node:assert/strict";
import { completeMatrixRows } from "./matrix-pricing";

const dimensions: any = [
  { selectionKey: "opt_thickness", label: "Thickness", values: [{ value: "4mm", label: "4mm" }, { value: "10mm", label: "10mm" }] },
  { selectionKey: "opt_sides", label: "Sides", values: [{ value: "single", label: "Single" }, { value: "double", label: "Double" }] },
  { selectionKey: "opt_finish", label: "Finish", values: [{ value: "standard", label: "Standard" }, { value: "premium", label: "Premium" }] },
];

const existing: any = [{ rowId: "matrix-existing", combination: { opt_thickness: "4mm", opt_sides: "single", opt_finish: "standard" }, baseRateCents: 300, tierBasis: null, tiers: [] }];
const rows = completeMatrixRows(dimensions, existing);

assert.equal(rows.length, 8, "three two-choice dimensions require the full canonical Cartesian matrix");
assert.equal(rows.find((row) => row.rowId === "matrix-existing")?.baseRateCents, 300, "existing canonical rows are preserved");
assert.ok(rows.every((row) => Object.keys(row.combination).length === 3), "each staged row retains every stable dimension key");
assert.ok(rows.filter((row) => row.rowId.startsWith("new:")).every((row) => row.baseRateCents === null), "new combinations remain visibly incomplete until an administrator supplies a rate");

console.log("Product Builder N-dimensional Matrix authoring tests passed.");
