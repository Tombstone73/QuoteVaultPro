import assert from "node:assert/strict";
import { previewSelectionKey } from "./pricing-preview";

assert.equal(previewSelectionKey("opt_internal", { opt_internal: "contour_cutting" }), "contour_cutting");
assert.equal(previewSelectionKey("opt_internal", {}), "opt_internal");

console.log("Product Builder preview selection-key tests passed.");
