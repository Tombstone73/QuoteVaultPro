import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { completeMatrixRows, MatrixPricing, updateMatrixPricingTier } from "./matrix-pricing";

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

const tierMarkup = renderToStaticMarkup(React.createElement(MatrixPricing, {
  matrix: {
    productId: "product-a", draftVersionId: "draft-a", draftUpdatedAt: "2026-08-23T00:00:00.000Z", lifecycle: "draft" as const, editable: true,
    active: true, matrixId: "matrix-a", pricingUnit: "per_piece" as const,
    availableDimensions: dimensions, dimensions: dimensions.slice(0, 1),
    rows: [{ rowId: "row-a", combination: { opt_thickness: "4mm" }, baseRateCents: 300, tierBasis: "quantity" as const, tiers: [{ tierId: "tier-a", minimum: 1, maximum: 24, perPieceCents: 300, perSqftCents: null, minimumChargeCents: 1500 }] }],
    warnings: [],
  },
  onChange: () => {},
}));
assert.match(tierMarkup, /Matrix tier minimum/);
assert.match(tierMarkup, /Matrix tier maximum/);
assert.match(tierMarkup, /Matrix tier minimum charge/);

const stagedMatrix: any = {
  ...existing[0],
  rows: [{ rowId: "row-a", combination: {}, baseRateCents: 300, tierBasis: "quantity", tiers: [
    { tierId: "tier-1", minimum: 1 },
    { tierId: "tier-2", minimum: 1 },
    { tierId: "tier-3", minimum: 1 },
  ] }],
};
const afterSecondTier = updateMatrixPricingTier(stagedMatrix, "row-a", 1, { minimum: 10 });
const afterThirdTier = updateMatrixPricingTier(afterSecondTier, "row-a", 2, { minimum: 51 });
assert.deepEqual(afterThirdTier.rows[0].tiers.map((tier: any) => tier.minimum), [1, 10, 51], "successive row edits retain previously staged tier values");

console.log("Product Builder N-dimensional Matrix authoring tests passed.");
