import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatrixPricing } from "./matrix-pricing";
import { OptionGroupsSection } from "./optionGroups";
import { OptionRulesSection } from "./option-rules";
import { ProductionUnits } from "./production-routing";
import { RecipeEditor } from "./recipe";

const options: any = [
  { optionId: "option-a", selectionKey: "size", label: "Size", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "small", label: "Small" }, { choiceValue: "large", label: "Large" }], canRemove: true },
  { optionId: "option-b", selectionKey: "finish", label: "Finish", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "matte", label: "Matte" }], canRemove: true },
];
const recipe: any = [
  { componentId: "recipe-a", materialId: "material-a", materialName: "Board", quantity: "1", unit: "sheet", quantityKind: "per_piece" },
  { componentId: "recipe-b", materialId: "material-b", materialName: "Ink", quantity: "1", unit: "each", quantityKind: "per_piece" },
];
const rules: any = [
  { id: "rule-a", enabled: true, when: { all: [{ optionGroup: "size", operator: "equals", value: "small" }] }, then: [{ action: "show", targetOptionGroup: "finish" }], else: [] },
  { id: "rule-b", enabled: true, when: { all: [] }, then: [], else: [] },
];
const dimensions: any = options.map((option: any) => ({ selectionKey: option.selectionKey, label: option.label, values: option.choices.map((choice: any) => ({ value: choice.choiceValue, label: choice.label })) }));
const markup = renderToStaticMarkup(<>
  <OptionGroupsSection options={options} onChange={() => {}} />
  <OptionRulesSection options={options} rules={rules} onChange={() => {}} />
  <RecipeEditor components={recipe} materials={[{ materialId: "material-a", name: "Board", sku: "BOARD", unit: "sheet" }, { materialId: "material-b", name: "Ink", sku: "INK", unit: "each" }] as any} options={options} onChange={() => {}} />
  <ProductionUnits specification={{ schemaVersion: 1, rules: [{ key: "front" }, { key: "back" }] } as any} options={options} onChange={() => {}} />
  <MatrixPricing matrix={{ productId: "product-a", draftVersionId: "draft-a", draftUpdatedAt: "2026-08-23T00:00:00.000Z", lifecycle: "draft", editable: true, active: true, matrixId: "matrix-a", pricingUnit: "per_piece", availableDimensions: dimensions, dimensions, rows: [{ rowId: "row-a", combination: { size: "small", finish: "matte" }, baseRateCents: 100, tierBasis: null, tiers: [] }, { rowId: "row-b", combination: { size: "large", finish: "matte" }, baseRateCents: 100, tierBasis: null, tiers: [] }], warnings: [] } as any} onChange={() => {}} />
</>);
assert.match(markup, /Move Size down/);
assert.match(markup, /Move Small down/);
assert.match(markup, /Move Board down/);
assert.match(markup, /Move front down/);
assert.match(markup, /Move rule 1 down/);
assert.match(markup, /Move Size dimension down/);

console.log("Product Builder ordering controls presentation tests passed.");
