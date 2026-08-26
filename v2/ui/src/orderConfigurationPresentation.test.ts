import assert from "node:assert/strict";
import { orderConfigurationPresentation } from "./orderConfigurationPresentation";

const internal = /(?:\bopt_|\bchoice_|_import|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/iu;

const modern = orderConfigurationPresentation({
  dimensions: { width: "24", height: "18", unit: "in" },
  presentation: { dimensions: "24 × 18 in", selections: [
    { label: "Print sides", value: "Double-sided" },
    { label: "Grommets", value: "Every 2 feet" },
  ] },
  selections: { opt_old: "choice_old" },
});
assert.equal(modern, "24 × 18 in · Print sides: Double-sided · Grommets: Every 2 feet");

// The frozen snapshot is the historical authority. A newer catalog label is
// deliberately not an input to this formatter and cannot rewrite this result.
const historicalImmutableVersion = orderConfigurationPresentation({
  presentation: { selections: [{ label: "Historic finish", value: "Matte" }] },
  selections: { opt_finish: "choice_matte" },
});
assert.equal(historicalImmutableVersion, "Historic finish: Matte");
assert.doesNotMatch(historicalImmutableVersion, /Gloss/);

const ord1010Shape = orderConfigurationPresentation({
  dimensions: { width: 24, height: 18, unit: "in" },
  selections: {
    opt_42a2788f366145e3971edc4a7b41a3d4: "yes",
    print_sides__import_mpkksm20_ihq24nl: "double_sided",
    contour_cutting__import_mplxbzwi_lysi2go: "no",
    grommet_placement__import_mplxcqsr_y99io8z: "none",
    "opt_opt_c1857862-93e5-48ed-b197-01e3109f7b2b": "choice_1",
  },
});
assert.match(ord1010Shape, /Configuration label unavailable/);
assert.doesNotMatch(ord1010Shape, internal);

const multiple = orderConfigurationPresentation({
  selections: {
    Finish: "matte",
    "Customer note": "Use the client’s preferred red ink",
    opt_unknown: "choice_missing",
  },
});
assert.match(multiple, /Finish: matte/);
assert.match(multiple, /Customer note: Use the client’s preferred red ink/);
assert.match(multiple, /Configuration label unavailable/);
assert.doesNotMatch(multiple, internal);

assert.equal(orderConfigurationPresentation({ selections: {} }), "No additional configuration");
console.log("Order configuration presentation regression tests passed.");
