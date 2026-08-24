import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PricingPreviewRail } from "./pricing-preview";

const options: any[] = [
  { optionId: "pockets", selectionKey: "pockets", label: "Pole pockets", inputType: "select", required: true, defaultValue: null, choices: [{ choiceValue: "no", label: "No" }, { choiceValue: "yes", label: "Yes" }], canRemove: true },
  { optionId: "depth", selectionKey: "depth", label: "Pole pocket depth", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "standard", label: "Standard" }, { choiceValue: "custom", label: "Custom" }], canRemove: true },
];

const rules: any[] = [{
  id: "show-pocket-depth",
  when: { all: [{ optionGroup: "pockets", operator: "equals", value: "yes" }] },
  then: [{ action: "show", targetOptionGroup: "depth" }, { action: "require", targetOptionGroup: "depth" }],
  else: [{ action: "hide", targetOptionGroup: "depth" }, { action: "clear", targetOptionGroup: "depth" }],
}];

const confirmedServerResult: any = {
  quantity: 5,
  dimensions: { width: 24, height: 36, unit: "in", areaSquareFeet: 6 },
  calculatedUnitAmount: { cents: 1760, currency: "USD" },
  calculatedLineAmount: { cents: 8800, currency: "USD" },
  minimumChargeApplied: false,
  tier: { basis: "quantity", value: "5" },
  // The preview presents server-returned evidence; it must not calculate one.
  breakdown: [{ label: "Formula revision 1", cents: 8800, currency: "USD" }],
  explanation: {},
  warnings: [],
  configuration: {
    effectiveSelections: { pockets: "yes", depth: "standard" },
    visibleOptionSelectionKeys: ["pockets", "depth"], hiddenOptionSelectionKeys: [],
    disabledOptionSelectionKeys: [], requiredOptionSelectionKeys: ["pockets", "depth"],
    clearedOptionSelectionKeys: [], defaultedOptionSelectionKeys: [],
  },
};

const renderRail = (overrides: Record<string, unknown> = {}) => renderToStaticMarkup(<PricingPreviewRail
  productId="product-a"
  measurementMode="dimensions_required"
  options={options}
  rules={rules}
  selectionKeys={{ pockets: "pockets", depth: "depth" }}
  recipe={[{ materialId: "coroplast", materialName: "4mm Coroplast", quantity: 1, unit: "sheet" }] as any}
  production={{ rules: [{ key: "flatbed", side: "front" }] } as any}
  inputs={{ width: "24", height: "36", quantity: "5", selections: { pockets: "yes", depth: "standard" } }}
  onInputsChange={() => {}}
  result={confirmedServerResult}
  onPreview={() => {}}
  findings={[{ severity: "warning", code: "PRODUCT_WARNING", message: "Publish-only warning", section: "pricing" }]}
  {...overrides as any}
/>);

const primary = renderRail();
for (const text of ["Configuration preview", "Job inputs", "Product options", "Pricing result", "Confirmed price", "$88.00", "$17.60", "Formula revision 1", "Pricing tier", "Materials", "Production", "Weight", "Details &amp; diagnostics"]) {
  assert.match(primary, new RegExp(text.replace(/[.$]/g, "\\$&")));
}
assert.match(primary, /<details class="rounded-md border border-border">/);
assert.doesNotMatch(primary, /<details[^>]*\sopen(?:=|\s|>)/, "secondary diagnostics are collapsed by default");

const staleDuringUpdate = renderRail({ loading: true, stale: true });
assert.match(staleDuringUpdate, /Updating price…/);
assert.match(staleDuringUpdate, /Last confirmed price/);
assert.match(staleDuringUpdate, /\$88\.00/, "the confirmed server price remains visible while a newer request is loading");

const failedCurrentRequest = renderRail({ stale: true, error: "No matching matrix row", canRetry: true });
assert.match(failedCurrentRequest, /No matching matrix row/);
assert.match(failedCurrentRequest, /last confirmed result, not the current configuration/);
assert.match(failedCurrentRequest, />Retry</);
assert.match(failedCurrentRequest, /\$88\.00/, "server failures do not erase the last confirmed server result");

const hiddenChild = renderRail({
  result: null,
  inputs: { width: "24", height: "36", quantity: "5", selections: { pockets: "no", depth: "custom" } },
});
assert.match(hiddenChild, /Pole pockets/);
assert.doesNotMatch(hiddenChild, /Pole pocket depth/, "a rule-hidden option is not rendered in the preview");

const requiredChild = renderRail({
  result: null,
  inputs: { width: "24", height: "36", quantity: "5", selections: { pockets: "yes" } },
});
assert.match(requiredChild, /Pole pocket depth/);
assert.match(requiredChild, /Complete required information before pricing/);
assert.match(requiredChild, /Pole pocket depth/);

const quantityOnly = renderToStaticMarkup(<PricingPreviewRail
  productId="product-a" measurementMode="quantity_only" options={[]} rules={[]} selectionKeys={{}}
  recipe={[]} production={null} inputs={{ width: "", height: "", quantity: "2", selections: {} }}
  onInputsChange={() => {}} result={null} onPreview={() => {}} findings={[]}
/>);
assert.match(quantityOnly, /Qty/);
assert.doesNotMatch(quantityOnly, /Width|Height/, "quantity-only Products do not render irrelevant dimensions");

console.log("Product Builder compact pricing-preview rail tests passed.");
