import assert from "node:assert/strict";
import { acceptsLivePreviewResponse, livePreviewFingerprint, prepareLivePreview, presentLivePreview } from "./livePricingPreview";

const configuration = { effectiveSelections: { finish: "matte", side: "front" }, requiredOptionSelectionKeys: ["finish"] } as const;
const ready = prepareLivePreview({ measurementMode: "dimensions_required", quantity: "5", width: "24", height: "36", configuration, optionLabels: { finish: "Finish" } });
assert.equal(ready.kind, "ready");
if (ready.kind === "ready") {
  assert.deepEqual(ready.request.payload, { quantity: 5, width: 24, height: 36, selections: { finish: "matte", side: "front" } });
  assert.equal(ready.request.fingerprint, livePreviewFingerprint({ quantity: 5, width: 24, height: 36, selections: { side: "front", finish: "matte" } }));
}

const missingOption = prepareLivePreview({ measurementMode: "dimensions_required", quantity: "5", width: "24", height: "36", configuration: { effectiveSelections: {}, requiredOptionSelectionKeys: ["finish"] }, optionLabels: { finish: "Finish" } });
assert.deepEqual(missingOption, { kind: "incomplete", reasons: ["Select required options: Finish."] });

const quantityOnly = prepareLivePreview({ measurementMode: "quantity_only", quantity: "2", width: "", height: "", configuration: { effectiveSelections: {}, requiredOptionSelectionKeys: [] }, optionLabels: {} });
assert.equal(quantityOnly.kind, "ready");
if (quantityOnly.kind === "ready") assert.deepEqual(quantityOnly.request.payload, { quantity: 2, selections: {} });

assert.equal(acceptsLivePreviewResponse("new-input", "old-input"), false);
assert.equal(acceptsLivePreviewResponse("current-input", "current-input"), true);

assert.equal(
  livePreviewFingerprint({ quantity: 1, selections: { substrate: { finish: "matte", colors: ["black", "white"] }, width: 24 } }),
  livePreviewFingerprint({ quantity: 1, selections: { width: 24, substrate: { colors: ["black", "white"], finish: "matte" } } }),
  "nested selection object order cannot change cache/request identity",
);

for (const input of [
  { quantity: "0", width: "24", height: "36" },
  { quantity: "5", width: "0", height: "36" },
  { quantity: "5", width: "24", height: "" },
]) {
  const invalid = prepareLivePreview({ measurementMode: "dimensions_required", ...input, configuration: { effectiveSelections: {}, requiredOptionSelectionKeys: [] }, optionLabels: {} });
  assert.equal(invalid.kind, "incomplete");
}

const ruleEffectivePayload = prepareLivePreview({
  measurementMode: "dimensions_required", quantity: "1", width: "24", height: "18",
  configuration: {
    // A resolver default is included; a resolver-cleared hidden field is not.
    effectiveSelections: { pole_pockets: "no", finish: "matte" },
    requiredOptionSelectionKeys: [],
  },
  optionLabels: {},
});
assert.equal(ruleEffectivePayload.kind, "ready");
if (ruleEffectivePayload.kind === "ready") assert.deepEqual(ruleEffectivePayload.request.payload.selections, { pole_pockets: "no", finish: "matte" });

/** Each settled pricing-relevant edit has a distinct canonical request
 * identity. ProductBuilderReference debounces these identities for 300ms;
 * this pure contract ensures the debounced request cannot reuse a prior
 * width, height, quantity, matrix option, or Formula input selection. */
const requestFor = (overrides: Partial<Parameters<typeof prepareLivePreview>[0]> = {}) => {
  const value = prepareLivePreview({
    measurementMode: "dimensions_required",
    quantity: "5",
    width: "24",
    height: "36",
    configuration: { effectiveSelections: { thickness: "4mm", formula_finish: "matte" }, requiredOptionSelectionKeys: [] },
    optionLabels: {},
    ...overrides,
  });
  assert.equal(value.kind, "ready");
  if (value.kind !== "ready") throw new Error("test fixture must be complete");
  return value.request;
};
const baselineRequest = requestFor();
const widthRequest = requestFor({ width: "30" });
const heightRequest = requestFor({ height: "48" });
const quantityRequest = requestFor({ quantity: "10" });
const matrixOptionRequest = requestFor({ configuration: { effectiveSelections: { thickness: "10mm", formula_finish: "matte" }, requiredOptionSelectionKeys: [] } });
const formulaInputRequest = requestFor({ configuration: { effectiveSelections: { thickness: "4mm", formula_finish: "gloss" }, requiredOptionSelectionKeys: [] } });
for (const request of [widthRequest, heightRequest, quantityRequest, matrixOptionRequest, formulaInputRequest]) {
  assert.notEqual(request.fingerprint, baselineRequest.fingerprint, "a pricing-relevant edit must schedule a new canonical preview");
}
assert.deepEqual(widthRequest.payload, { quantity: 5, width: 30, height: 36, selections: { thickness: "4mm", formula_finish: "matte" } });
assert.deepEqual(heightRequest.payload, { quantity: 5, width: 24, height: 48, selections: { thickness: "4mm", formula_finish: "matte" } });
assert.deepEqual(quantityRequest.payload, { quantity: 10, width: 24, height: 36, selections: { thickness: "4mm", formula_finish: "matte" } });
assert.deepEqual(matrixOptionRequest.payload.selections, { thickness: "10mm", formula_finish: "matte" });
assert.deepEqual(formulaInputRequest.payload.selections, { thickness: "4mm", formula_finish: "gloss" });

const confirmed = { fingerprint: "old", value: { totalCents: 8800 } } as const;
const updating = presentLivePreview({ currentFingerprint: "new", responseFingerprint: null, debouncing: true, fetching: false, confirmed });
assert.deepEqual(updating, { confirmed, updating: true, stale: true, error: null });
const staleResponse = presentLivePreview({ currentFingerprint: "new", responseFingerprint: "old", debouncing: false, fetching: false, serverError: "old request failed", confirmed });
assert.equal(staleResponse.error, null);
const currentFailure = presentLivePreview({ currentFingerprint: "new", responseFingerprint: "new", debouncing: false, fetching: false, serverError: "Unable to price", confirmed });
assert.deepEqual(currentFailure, { confirmed, updating: false, stale: true, error: "Unable to price" });
const fetchingCurrent = presentLivePreview({ currentFingerprint: "new", responseFingerprint: "new", debouncing: false, fetching: true, confirmed });
assert.deepEqual(fetchingCurrent, { confirmed, updating: true, stale: true, error: null });

console.log("Live pricing preview request tests passed.");
