import { evaluatePricingPreviewFromTree } from "../../PricingService";

export const COROPLAST_4X8_FORMULA =
  "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price";

export const COROPLAST_4X8_FORMULA_CONFIG = {
  variables: {
    sheet_width: 48,
    sheet_length: 96,
    usable_drop_min: 0,
    billable_length_increment: 1,
    minimum_billable_sqft: 32,
  },
};

export const COROPLAST_GOLDEN_TIERS = [
  { id: "sheet_1", label: "1+ sheet", minQty: 1, perSqftCents: 137.5 },
  { id: "sheet_10", label: "10+ sheets", minQty: 10, perSqftCents: 103 },
  { id: "sheet_51", label: "51+ sheets", minQty: 51, perSqftCents: 94 },
];

type GoldenTreeOptions = {
  allowRotationDefault?: boolean;
  includeAllowRotationOption?: boolean;
};

export function makeCoroplastGoldenTree(options: GoldenTreeOptions = {}) {
  const includeAllowRotationOption = options.includeAllowRotationOption ?? false;
  const rootNodeIds = includeAllowRotationOption ? ["rate", "allow_rotation"] : ["rate"];
  const nodes: Record<string, unknown> = {
    rate: {
      id: "rate",
      kind: "question",
      label: "Rate",
      input: { type: "select", selectionKey: "rate" },
      choices: [
        { value: "standard", label: "Standard" },
      ],
    },
  };

  if (includeAllowRotationOption) {
    nodes.allow_rotation = {
      id: "allow_rotation",
      kind: "question",
      label: "Allow Rotation",
      input: { type: "select", selectionKey: "allow_rotation" },
      choices: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    };
  }

  return {
    schemaVersion: 2,
    rootNodeIds,
    pricingMatrix: {
      dimensions: ["rate"],
      rows: [
        {
          id: "standard",
          when: { rate: "standard" },
          variables: { base_price: 0 },
          tierBasis: "computed_sheet_usage",
          qtyTiers: COROPLAST_GOLDEN_TIERS,
        },
      ],
    },
    nodes,
    meta: {
      pricingV2: { base: { perSqftCents: 0 } },
      formulaVariables: {
        allow_rotation: options.allowRotationDefault ?? false,
      },
    },
  };
}

export function evaluateCoroplastGoldenPreview(input: {
  widthIn: number;
  heightIn: number;
  quantity: number;
  allowRotationDefault?: boolean;
  allowRotationSelection?: "yes" | "no";
}) {
  return evaluatePricingPreviewFromTree({
    treeJson: makeCoroplastGoldenTree({
      allowRotationDefault: input.allowRotationDefault,
      includeAllowRotationOption: input.allowRotationSelection != null,
    }),
    widthIn: input.widthIn,
    heightIn: input.heightIn,
    quantity: input.quantity,
    pbv2ExplicitSelections: {
      rate: { value: "standard" },
      ...(input.allowRotationSelection
        ? { allow_rotation: { value: input.allowRotationSelection } }
        : {}),
    },
    formulaSourceMode: "library",
    pricingFormulaLibrary: {
      id: "formula_4x8",
      name: "4x8 Sheets with rounding",
      expression: COROPLAST_4X8_FORMULA,
      config: COROPLAST_4X8_FORMULA_CONFIG,
    },
    debug: true,
  });
}
