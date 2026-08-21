import { materials } from "./data";

/* ------------------------------------------------------------------
 * Product Editor model (prototype / mock).
 * Mirrors the legacy PBV2 product editor: basics, AI parsing hints,
 * pricing engine, material + weight, option groups → options → choices,
 * and plain-language option rules.
 * ------------------------------------------------------------------ */

export const PRODUCT_TYPES = ["Sheet", "Roll", "Garment", "Service"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const MEASUREMENTS = ["Dimensions required", "Quantity only"] as const;
export type Measurements = (typeof MEASUREMENTS)[number];

export const WORKFLOW_INTENTS = [
  "Standard production",
  "Fulfillment only",
  "Billing only",
] as const;
export type WorkflowIntent = (typeof WORKFLOW_INTENTS)[number];

export const INPUT_TYPES = [
  "Dropdown (Single Choice)",
  "Radio (Single Choice)",
  "Checkboxes (Multi)",
  "Number",
  "Text",
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const PRICING_OVERRIDES = ["None", "Replaces base rate", "Replaces minimum charge"] as const;
export const QUANTITY_BASES = ["Area (sqft)", "Per item", "Per linear ft", "Per sheet"] as const;
export const IMPACT_KINDS = ["Flat", "Per piece", "Per sq ft", "Percent of line"] as const;
export type ImpactKind = (typeof IMPACT_KINDS)[number];

export interface ChoiceImpact {
  id: string;
  kind: ImpactKind;
  amount: number;
}

export interface ChoiceMaterial {
  id: string;
  materialId: string;
  basis: (typeof QUANTITY_BASES)[number];
  perUnit: number;
}

export interface Choice {
  id: string;
  label: string;
  value: string;
  variantDefining: boolean;
  additiveModifier: boolean;
  pricingOverride: (typeof PRICING_OVERRIDES)[number];
  priceDelta: string;
  materialOverride?: string | undefined;
  tags: string;
  impacts: ChoiceImpact[];
  materials: ChoiceMaterial[];
}

export interface EditorOption {
  id: string;
  label: string;
  help: string;
  inputType: InputType;
  required: boolean;
  enabled: boolean;
  choices: Choice[];
}

export interface OptionGroup {
  id: string;
  name: string;
  description: string;
  required: boolean;
  multiSelect: boolean;
  options: EditorOption[];
}

export const RULE_EFFECTS = [
  { id: "show-require", label: "show and require", inverse: "hidden, optional and cleared" },
  { id: "show", label: "show (still optional)", inverse: "hidden and cleared" },
  { id: "hide", label: "hide and clear", inverse: "shown normally" },
  { id: "default", label: "preselect a default for", inverse: "left at its own default" },
] as const;
export type RuleEffect = (typeof RULE_EFFECTS)[number]["id"];

export interface RuleCard {
  id: string;
  enabled: boolean;
  label: string;
  sourceOptionId: string;
  operator: "is" | "is not";
  value: string;
  effect: RuleEffect;
  targetOptionIds: string[];
  defaultValue?: string | undefined;
}

export interface Tier {
  id: string;
  from: string;
  to: string;
  adjust: string;
}

export interface PricingConfig {
  mode: "Basic" | "Advanced";
  source: "library" | "profile" | "formula";
  library: string;
  profile: string;
  formula: string;
  ratePerSqFt: string;
  ratePerPiece: string;
  minimumCharge: string;
  tierBasis: "Computed Sheet Usage" | "Customer Quantity" | "Total Sq Ft";
  units: "Imperial" | "Metric";
  allowRotation: boolean;
  sheetWidth?: string | undefined;
  sheetLength?: string | undefined;
  qtyTiers: Tier[];
  sizeTiers: Tier[];
}

export interface MaterialConfig {
  primaryMaterialId: string;
  shippingPolicy: "Pickup only" | "Ships parcel" | "Freight only" | "Pickup or ship";
  configuredWeight?: string | undefined;
  fallbackWeight: string;
  fallbackUnit: "oz" | "lb" | "kg";
  weightBasis: "Per item" | "Per sheet" | "Per sq ft";
  trimW: string;
  trimH: string;
}

/* ------------------------- matrix pricing ------------------------- */

export const MATRIX_UNITS = ["per sq ft", "per piece", "flat per line"] as const;
export type MatrixUnit = (typeof MATRIX_UNITS)[number];

export const MATRIX_TIER_BASES = [
  "None",
  "Customer Quantity",
  "Computed Sheet Usage",
  "Total Sq Ft",
] as const;
export type MatrixTierBasis = (typeof MATRIX_TIER_BASES)[number];

export interface MatrixTier {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface MatrixConfig {
  enabled: boolean;
  /** Option ids whose choices form the matrix axes, in order. */
  dimensionOptionIds: string[];
  unit: MatrixUnit;
  tierBasis: MatrixTierBasis;
  tiers: MatrixTier[];
  /** key = tierId | choiceLabel per dimension, joined with "|" */
  cells: Record<string, string>;
}

export const matrixKey = (tierId: string, values: string[]) => [tierId, ...values].join("|");

/* --------------------------- recipe --------------------------- */

export const RECIPE_BASES = [
  "Per sq ft",
  "Per piece",
  "Per sheet",
  "Per linear ft",
  "Per order",
] as const;
export type RecipeBasis = (typeof RECIPE_BASES)[number];

export interface RecipeLine {
  id: string;
  materialId: string;
  basis: RecipeBasis;
  factor: string;
  unit: string;
  /** Empty condition = always consumed. */
  conditionOptionId?: string | undefined;
  conditionValue?: string | undefined;
  /** Replaces the primary material rather than adding to it. */
  replaces: boolean;
  normalize: boolean;
}

/* ------------------------ production units ------------------------ */

export interface ProductionUnitSpec {
  id: string;
  name: string;
  station: string;
  conditionOptionId?: string | undefined;
  conditionValue?: string | undefined;
  note: string;
}

/* ---------------------------- routing ---------------------------- */

export const ROUTE_POLICIES = ["Route required", "No route", "Unconfigured"] as const;
export type RoutePolicy = (typeof ROUTE_POLICIES)[number];

export interface RoutingConfig {
  policy: RoutePolicy;
  template: string;
  steps: string[];
}

export const ROUTE_TEMPLATES: Record<string, string[]> = {
  "Standard Production": ["Proofing", "Prepress", "Production", "Fulfillment"],
  "Print & Ship": ["Prepress", "Production", "Shipping"],
  "Design First": ["Design", "Proofing", "Prepress", "Production", "Fulfillment"],
  "Billing only": ["Invoice"],
};

/** Route Templates are owned by the Routing module; Product Builder only references them. */
export interface RouteTemplateRef {
  name: string;
  description: string;
  revision: number;
  status: "Active" | "Draft" | "Retired";
  owner: string;
  steps: string[];
}

export const ROUTE_TEMPLATE_CATALOG: RouteTemplateRef[] = [
  {
    name: "Standard Production",
    description:
      "Default path for printed goods that need a customer proof before the floor picks them up.",
    revision: 1,
    status: "Active",
    owner: "Routing module",
    steps: ROUTE_TEMPLATES["Standard Production"]!,
  },
  {
    name: "Print & Ship",
    description: "Reorders and approved-art jobs that skip proofing and ship directly.",
    revision: 3,
    status: "Active",
    owner: "Routing module",
    steps: ROUTE_TEMPLATES["Print & Ship"]!,
  },
  {
    name: "Design First",
    description: "Jobs that start at the design desk before proofing and production.",
    revision: 2,
    status: "Active",
    owner: "Routing module",
    steps: ROUTE_TEMPLATES["Design First"]!,
  },
  {
    name: "Billing only",
    description: "Service fees and billing-only products that never touch production.",
    revision: 1,
    status: "Active",
    owner: "Routing module",
    steps: ROUTE_TEMPLATES["Billing only"]!,
  },
];

export const findRouteTemplate = (name: string) =>
  ROUTE_TEMPLATE_CATALOG.find((t) => t.name === name);

export interface VersionInfo {
  draftVersion: string;
  activeVersion: string;
  lastPublished: string;
  changes: { section: string; label: string; from: string; to: string }[];
}

export interface ProductDraft {
  id: string;
  shopName: string;
  name: string;
  description: string;
  category: string;
  productType: ProductType;
  serviceFee: boolean;
  measurements: Measurements;
  workflowIntent: WorkflowIntent;
  active: boolean;
  aiUseDescription: boolean;
  aiDescription: string;
  pricing: PricingConfig;
  matrix: MatrixConfig;
  material: MaterialConfig;
  recipe: RecipeLine[];
  production: ProductionUnitSpec[];
  routing: RoutingConfig;
  version: VersionInfo;
  flags: { proof: boolean; productionJob: boolean; allowZero: boolean; taxable: boolean };
  groups: OptionGroup[];
  rules: RuleCard[];
}

export const CATEGORIES = ["Rigid", "Banners", "Decals", "Vehicle", "Apparel", "Hardware"] as const;

export const FORMULA_LIBRARY = [
  "4×8 Sheets with rounding (4X8_WITH_WASTE_CALCULATION)",
  "Roll media linear feet (ROLL_LINEAR_FT)",
  "Simple area × rate (AREA_RATE)",
  "Flat per piece (PER_PIECE)",
] as const;

export const PRICING_PROFILES = [
  "Default (Formula)",
  "Wholesale",
  "Contract — Municipal",
  "Rush",
] as const;

export const PRICING_VARIABLES = [
  ["w", "finished width in current units"],
  ["h", "finished height in current units"],
  ["q", "customer quantity"],
  ["sqft", "area of one piece"],
  ["total_sqft", "sqft × q"],
  ["base_price", "rate resolved before impacts"],
  ["sheet_width / sheet_length", "parent sheet dimensions"],
  ["usable_drop_min", "smallest usable remnant"],
] as const;

let seq = 0;
export const uid = (p = "x") => `${p}${++seq}${Math.random().toString(36).slice(2, 5)}`;

const choice = (o: Partial<Choice> & { label: string }): Choice => ({
  id: uid("c"),
  value: o.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
  variantDefining: false,
  additiveModifier: true,
  pricingOverride: "None",
  priceDelta: "",
  tags: "",
  impacts: [],
  materials: [],
  ...o,
});

const option = (o: Partial<EditorOption> & { id: string; label: string }): EditorOption => ({
  help: "",
  inputType: "Dropdown (Single Choice)",
  required: false,
  enabled: true,
  choices: [],
  ...o,
});

/* --------------------------- seeded drafts --------------------------- */

function coroplast(): ProductDraft {
  return {
    id: "p2",
    shopName: "Coro",
    name: "Coroplast",
    description:
      "Coroplast signage — durable corrugated plastic, printed full color, indoor/outdoor.",
    category: "Rigid",
    productType: "Sheet",
    serviceFee: false,
    measurements: "Dimensions required",
    workflowIntent: "Standard production",
    active: true,
    aiUseDescription: false,
    aiDescription:
      "Coroplast is a rigid sheet product commonly used for signage. Look for terms like 'Coroplast signage', 'plastic corrugated sheets', or 'corrugated plastic'. Key options include thickness (4mm or 10mm), print sides (single-sided or double-sided), grommet placement (none, corners, every 2 feet, custom), and contour cutting (yes or no). Do not confuse with similar products like foam board or PVC sheets unless explicitly mentioned.",
    pricing: {
      mode: "Advanced",
      source: "library",
      library: FORMULA_LIBRARY[0],
      profile: PRICING_PROFILES[0],
      formula:
        "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_len)",
      ratePerSqFt: "1.375",
      sheetWidth: "48",
      sheetLength: "96",
      ratePerPiece: "0.00",
      minimumCharge: "5.25",
      tierBasis: "Computed Sheet Usage",
      units: "Imperial",
      allowRotation: false,
      qtyTiers: [],
      sizeTiers: [],
    },
    material: {
      primaryMaterialId: "m1",
      shippingPolicy: "Pickup only",
      configuredWeight: "5.150000 lb / sheet",
      fallbackWeight: "0",
      fallbackUnit: "oz",
      weightBasis: "Per item",
      trimW: "0",
      trimH: "0",
    },
    matrix: {
      enabled: true,
      dimensionOptionIds: ["o-thick", "o-sides"],
      unit: "per sq ft",
      tierBasis: "Computed Sheet Usage",
      tiers: [
        { id: "mt1", label: "1–4 sheets", from: "1", to: "4" },
        { id: "mt2", label: "5–9 sheets", from: "5", to: "9" },
        { id: "mt3", label: "10–24 sheets", from: "10", to: "24" },
        { id: "mt4", label: "25+ sheets", from: "25", to: "" },
      ],
      cells: {
        "mt1|4mm|Single-sided": "1.72",
        "mt1|4mm|Double-sided": "2.38",
        "mt1|10mm|Single-sided": "2.15",
        "mt1|10mm|Double-sided": "2.94",
        "mt2|4mm|Single-sided": "1.58",
        "mt2|4mm|Double-sided": "2.19",
        "mt2|10mm|Single-sided": "1.98",
        "mt2|10mm|Double-sided": "2.71",
        "mt3|4mm|Single-sided": "1.44",
        "mt3|4mm|Double-sided": "2.02",
        "mt3|10mm|Single-sided": "1.82",
        "mt3|10mm|Double-sided": "2.49",
        "mt4|4mm|Single-sided": "1.31",
        "mt4|4mm|Double-sided": "1.85",
        "mt4|10mm|Single-sided": "1.67",
        "mt4|10mm|Double-sided": "2.28",
      },
    },
    recipe: [
      {
        id: "rc1",
        materialId: "m1",
        basis: "Per sheet",
        factor: "1",
        unit: "sheet",
        conditionOptionId: "o-thick",
        conditionValue: "4mm",
        replaces: true,
        normalize: true,
      },
      {
        id: "rc2",
        materialId: "m1",
        basis: "Per sheet",
        factor: "1",
        unit: "sheet",
        conditionOptionId: "o-thick",
        conditionValue: "10mm",
        replaces: true,
        normalize: true,
      },
      {
        id: "rc3",
        materialId: "m4",
        basis: "Per piece",
        factor: "4",
        unit: "grommet",
        conditionOptionId: "o-grom",
        conditionValue: "Corners",
        replaces: false,
        normalize: false,
      },
    ],
    production: [
      {
        id: "pu1",
        name: "Front",
        station: "Océ Arizona (Flatbed)",
        note: "Always produced.",
        conditionOptionId: undefined,
        conditionValue: undefined,
      },
      {
        id: "pu2",
        name: "Back",
        station: "Océ Arizona (Flatbed)",
        note: "Second pass on the same sheet.",
        conditionOptionId: "o-sides",
        conditionValue: "Double-sided",
      },
    ],
    routing: {
      policy: "Route required",
      template: "Standard Production",
      steps: ROUTE_TEMPLATES["Standard Production"]!,
    },
    version: {
      draftVersion: "v7 (draft)",
      activeVersion: "v6",
      lastPublished: "Aug 12, 2026",
      changes: [
        {
          section: "Pricing",
          label: "Rate — 4mm × Single-sided, 1–4 sheets",
          from: "$1.50 / sq ft",
          to: "$1.72 / sq ft",
        },
        { section: "Pricing", label: "Minimum charge", from: "$4.75", to: "$5.25" },
        { section: "Materials", label: "4mm Coroplast", from: "unchanged", to: "unchanged" },
        {
          section: "Production",
          label: "Conditional Back unit",
          from: "not present",
          to: "when Print Sides = Double-sided",
        },
      ],
    },
    flags: { proof: true, productionJob: true, allowZero: false, taxable: true },

    groups: [
      {
        id: "g-thick",
        name: "Thickness",
        description: "",
        required: true,
        multiSelect: false,
        options: [
          option({
            id: "o-thick",
            label: "Thickness",
            help: "",
            required: true,
            choices: [
              choice({
                label: "4mm",
                variantDefining: true,
                materialOverride: "4mm Coroplast 48x96",
                tags: "coro, rigid, thickness:4mm",
                materials: [{ id: uid("cm"), materialId: "m1", basis: "Area (sqft)", perUnit: 1 }],
              }),
              choice({
                label: "10mm",
                variantDefining: true,
                materialOverride: "4mm Coroplast 48x96",
                tags: "coro, rigid, thickness:10mm",
                impacts: [{ id: uid("i"), kind: "Per sq ft", amount: 0.45 }],
              }),
            ],
          }),
        ],
      },
      {
        id: "g-sides",
        name: "Double-Sided Printing",
        description: "",
        required: true,
        multiSelect: false,
        options: [
          option({
            id: "o-sides",
            label: "Print Sides",
            required: true,
            choices: [
              choice({ label: "Single-sided" }),
              choice({
                label: "Double-sided",
                impacts: [{ id: uid("i"), kind: "Percent of line", amount: 65 }],
              }),
            ],
          }),
        ],
      },
      {
        id: "g-grom",
        name: "Grommets",
        description: "",
        required: false,
        multiSelect: false,
        options: [
          option({
            id: "o-grom",
            label: "Grommet Placement",
            help: "Where grommets are punched on the finished sign.",
            choices: [
              choice({ label: "None" }),
              choice({
                label: "Corners",
                impacts: [{ id: uid("i"), kind: "Flat", amount: 1.4 }],
                materials: [{ id: uid("cm"), materialId: "m4", basis: "Per item", perUnit: 4 }],
              }),
              choice({
                label: "Every 2 feet",
                impacts: [{ id: uid("i"), kind: "Per piece", amount: 0.35 }],
              }),
              choice({ label: "Custom" }),
            ],
          }),
        ],
      },
      {
        id: "g-contour",
        name: "Contour Cutting",
        description: "",
        required: false,
        multiSelect: false,
        options: [
          option({
            id: "o-contour",
            label: "Contour Cutting",
            choices: [
              choice({ label: "No" }),
              choice({ label: "Yes", impacts: [{ id: uid("i"), kind: "Per piece", amount: 2.5 }] }),
            ],
          }),
        ],
      },
      {
        id: "g-gromdetail",
        name: "Custom Grommet Detail",
        description: "Only collected when grommet placement is custom.",
        required: false,
        multiSelect: false,
        options: [
          option({
            id: "o-gromnote",
            label: "Custom Grommet Instructions",
            inputType: "Text",
            help: "Describe the exact grommet layout.",
          }),
        ],
      },
    ],
    rules: [
      {
        id: uid("r"),
        enabled: true,
        label: "Custom grommet instructions",
        sourceOptionId: "o-grom",
        operator: "is",
        value: "Custom",
        effect: "show-require",
        targetOptionIds: ["o-gromnote"],
      },
    ],
  };
}

function banner(): ProductDraft {
  return {
    id: "p1",
    shopName: "Banner 13oz",
    name: "13oz Vinyl Banner",
    description: "Hemmed and grommeted 13oz scrim vinyl banner, printed full color.",
    category: "Banners",
    productType: "Roll",
    serviceFee: false,
    measurements: "Dimensions required",
    workflowIntent: "Standard production",
    active: true,
    aiUseDescription: true,
    aiDescription:
      "Vinyl banner on 13oz scrim. Look for 'banner', 'vinyl banner', 'mesh banner'. Key options: hem, grommet placement, pole pockets (with location and depth), and wind slits.",
    pricing: {
      mode: "Basic",
      source: "library",
      library: FORMULA_LIBRARY[1],
      profile: PRICING_PROFILES[0],
      formula: "max(min_charge, total_sqft * base_price)",
      ratePerSqFt: "4.75",
      ratePerPiece: "0.00",
      minimumCharge: "35",
      tierBasis: "Customer Quantity",
      units: "Imperial",
      allowRotation: true,
      qtyTiers: [
        { id: uid("t"), from: "1", to: "9", adjust: "0%" },
        { id: uid("t"), from: "10", to: "49", adjust: "-8%" },
        { id: uid("t"), from: "50", to: "199", adjust: "-14%" },
        { id: uid("t"), from: "200", to: "", adjust: "-21%" },
      ],
      sizeTiers: [],
    },
    material: {
      primaryMaterialId: "m2",
      shippingPolicy: "Pickup or ship",
      configuredWeight: "0.098000 lb / sq ft",
      fallbackWeight: "0",
      fallbackUnit: "oz",
      weightBasis: "Per sq ft",
      trimW: "0",
      trimH: "0",
    },
    matrix: {
      enabled: false,
      dimensionOptionIds: [],
      unit: "per sq ft",
      tierBasis: "None",
      tiers: [],
      cells: {},
    },
    recipe: [
      {
        id: "brc1",
        materialId: "m2",
        basis: "Per sq ft",
        factor: "1",
        unit: "sq ft",
        replaces: true,
        normalize: true,
        conditionOptionId: undefined,
        conditionValue: undefined,
      },
      {
        id: "brc2",
        materialId: "m4",
        basis: "Per piece",
        factor: "6",
        unit: "grommet",
        conditionOptionId: "bo-grom",
        conditionValue: "Every 24in",
        replaces: false,
        normalize: false,
      },
    ],
    production: [
      {
        id: "bpu1",
        name: "Front",
        station: "HP Latex 570 (Roll)",
        note: "Always produced.",
        conditionOptionId: undefined,
        conditionValue: undefined,
      },
    ],
    routing: {
      policy: "Route required",
      template: "Standard Production",
      steps: ROUTE_TEMPLATES["Standard Production"]!,
    },
    version: {
      draftVersion: "v3 (draft)",
      activeVersion: "v2",
      lastPublished: "Jul 30, 2026",
      changes: [
        { section: "Pricing", label: "Rate per sq ft", from: "$4.50", to: "$4.75" },
        {
          section: "Options",
          label: "Pole Pockets group",
          from: "not present",
          to: "added with location and depth",
        },
      ],
    },
    flags: { proof: true, productionJob: true, allowZero: false, taxable: true },

    groups: [
      {
        id: "bg-hem",
        name: "Hem",
        description: "",
        required: true,
        multiSelect: false,
        options: [
          option({
            id: "bo-hem",
            label: "Hem",
            required: true,
            choices: [
              choice({ label: "All sides" }),
              choice({ label: "Top & bottom" }),
              choice({ label: "None" }),
            ],
          }),
        ],
      },
      {
        id: "bg-grom",
        name: "Grommets",
        description: "",
        required: false,
        multiSelect: false,
        options: [
          option({
            id: "bo-grom",
            label: "Grommet Placement",
            choices: [
              choice({ label: "Every 24in" }),
              choice({ label: "Corners only" }),
              choice({ label: "None" }),
            ],
          }),
        ],
      },
      {
        id: "bg-pole",
        name: "Pole Pockets",
        description: "",
        required: false,
        multiSelect: false,
        options: [
          option({
            id: "bo-pole",
            label: "Pole Pockets",
            help: "Sewn sleeve for a pole or rod.",
            choices: [
              choice({ label: "No" }),
              choice({ label: "Yes", impacts: [{ id: uid("i"), kind: "Per piece", amount: 6 }] }),
            ],
          }),
          option({
            id: "bo-poleloc",
            label: "Pole Pocket Location",
            choices: [
              choice({ label: "Top" }),
              choice({ label: "Bottom" }),
              choice({ label: "Top & bottom" }),
              choice({ label: "Left & right" }),
            ],
          }),
          option({
            id: "bo-poledepth",
            label: "Pole Pocket Depth",
            choices: [
              choice({ label: '2"' }),
              choice({ label: '3"' }),
              choice({ label: '4"' }),
              choice({ label: "Custom" }),
            ],
          }),
          option({
            id: "bo-poledepthcustom",
            label: "Custom Pole Pocket Depth",
            inputType: "Text",
            help: "Finished sleeve depth in inches.",
          }),
        ],
      },
    ],
    rules: [
      {
        id: uid("r"),
        enabled: true,
        label: "Pole pocket child options",
        sourceOptionId: "bo-pole",
        operator: "is",
        value: "Yes",
        effect: "show-require",
        targetOptionIds: ["bo-poleloc", "bo-poledepth"],
      },
      {
        id: uid("r"),
        enabled: true,
        label: "Custom pole pocket depth text",
        sourceOptionId: "bo-poledepth",
        operator: "is",
        value: "Custom",
        effect: "show-require",
        targetOptionIds: ["bo-poledepthcustom"],
      },
    ],
  };
}

/** Fixtures keyed by catalog product id. */
export const productDrafts: Record<string, () => ProductDraft> = {
  p1: banner,
  p2: coroplast,
};

export const loadDraft = (productId?: string | undefined): ProductDraft =>
  (productDrafts[productId ?? "p2"] ?? coroplast)();

/* --------------------------- derived logic --------------------------- */

export interface OptionRef {
  group: OptionGroup;
  option: EditorOption;
}

export const allOptions = (d: ProductDraft): OptionRef[] =>
  d.groups.flatMap((group) => group.options.map((option) => ({ group, option })));

export const findOption = (d: ProductDraft, id: string) =>
  allOptions(d).find((r) => r.option.id === id);

export interface OptionState {
  visible: boolean;
  required: boolean;
  conditional: boolean;
  ruleIds: string[];
  forcedDefault?: string | undefined;
}

/** Resolve which options are visible/required given the current preview selections. */
export function evaluateRules(
  d: ProductDraft,
  sel: Record<string, string>,
): Record<string, OptionState> {
  const state: Record<string, OptionState> = {};
  for (const { group, option } of allOptions(d)) {
    state[option.id] = {
      visible: option.enabled,
      required: option.enabled && (option.required || group.required),
      conditional: false,
      ruleIds: [],
    };
  }
  const active = d.rules.filter((r) => r.enabled);
  // Options controlled by a show-style rule start hidden.
  for (const r of active) {
    if (r.effect !== "show-require" && r.effect !== "show") continue;
    for (const id of r.targetOptionIds) {
      const s = state[id];
      if (!s) continue;
      s.visible = false;
      s.required = false;
      s.conditional = true;
      s.ruleIds.push(r.id);
    }
  }
  for (const r of active) {
    const chosen = sel[r.sourceOptionId] ?? "";
    const matches = r.operator === "is" ? chosen === r.value : chosen !== "" && chosen !== r.value;
    for (const id of r.targetOptionIds) {
      const s = state[id];
      if (!s) continue;
      if (!s.ruleIds.includes(r.id)) {
        s.conditional = true;
        s.ruleIds.push(r.id);
      }
      if (r.effect === "hide") {
        if (matches) {
          s.visible = false;
          s.required = false;
        }
        continue;
      }
      if (r.effect === "default") {
        if (matches) s.forcedDefault = r.defaultValue;
        continue;
      }
      if (matches) {
        s.visible = true;
        s.required = r.effect === "show-require";
      }
    }
  }
  return state;
}

export interface Finding {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  section: string;
}

export function validateDraft(d: ProductDraft): Finding[] {
  const out: Finding[] = [];
  if (!d.material.configuredWeight && Number(d.material.fallbackWeight) <= 0) {
    out.push({
      code: "PBV2_W_WEIGHT_MISSING",
      severity: "warning",
      message:
        "Product has no weight defined (base weight and option weights are missing). Shipping weight will be 0.",
      section: "material",
    });
  }
  if (d.pricing.source === "formula" && !d.pricing.formula.trim()) {
    out.push({
      code: "PBV2_E_FORMULA_EMPTY",
      severity: "error",
      message: "Custom pricing formula is selected but empty.",
      section: "pricing",
    });
  }
  if (
    !d.matrix.enabled &&
    Number(d.pricing.ratePerSqFt) <= 0 &&
    Number(d.pricing.ratePerPiece) <= 0
  ) {
    out.push({
      code: "PBV2_E_NO_RATE",
      severity: "error",
      message:
        "No rate per sq ft or rate per piece is set — pricing resolves to the minimum charge only.",
      section: "pricing",
    });
  }
  if (d.matrix.enabled) {
    if (d.matrix.dimensionOptionIds.length === 0) {
      out.push({
        code: "PBV2_E_MATRIX_NO_DIM",
        severity: "error",
        message: "Matrix pricing is on but no option group is used as a pricing dimension.",
        section: "pricing",
      });
    } else {
      const missing = countMissingMatrixCells(d);
      if (missing > 0) {
        out.push({
          code: "PBV2_E_MATRIX_GAPS",
          severity: "error",
          message: `${missing} matrix cell${missing === 1 ? " is" : "s are"} empty — those combinations cannot be priced.`,
          section: "pricing",
        });
      }
    }
    if (d.matrix.tierBasis !== "None" && d.matrix.tiers.length === 0) {
      out.push({
        code: "PBV2_W_NO_TIERS",
        severity: "warning",
        message: "A tier basis is selected but no tiers are configured.",
        section: "pricing",
      });
    }
  } else if (d.pricing.qtyTiers.length === 0 && d.pricing.sizeTiers.length === 0) {
    out.push({
      code: "PBV2_I_NO_TIERS",
      severity: "info",
      message: "No quantity tiers configured — every quantity prices at list.",
      section: "pricing",
    });
  }
  for (const { group, option } of allOptions(d)) {
    if (option.inputType.includes("Choice") && option.choices.length === 0) {
      out.push({
        code: "PBV2_W_NO_CHOICES",
        severity: "warning",
        message: `“${group.name} → ${option.label}” is a choice option with no choices.`,
        section: "options",
      });
    }
  }
  for (const r of d.rules) {
    if (!findOption(d, r.sourceOptionId)) {
      out.push({
        code: "PBV2_E_RULE_SOURCE",
        severity: "error",
        message: `Rule “${r.label}” points at an option that no longer exists.`,
        section: "options",
      });
    }
  }
  if (!d.serviceFee && d.recipe.length === 0) {
    out.push({
      code: "PBV2_W_NO_RECIPE",
      severity: "warning",
      message: "No recipe lines — this product consumes no inventory.",
      section: "materials",
    });
  }
  for (const line of d.recipe) {
    if (line.conditionOptionId && !findOption(d, line.conditionOptionId)) {
      out.push({
        code: "PBV2_E_RECIPE_COND",
        severity: "error",
        message: "A recipe line is conditioned on an option that no longer exists.",
        section: "materials",
      });
    }
  }
  if (d.flags.productionJob && d.production.length === 0) {
    out.push({
      code: "PBV2_W_NO_UNITS",
      severity: "warning",
      message: "Product creates a production job but defines no production units.",
      section: "production",
    });
  }
  if (d.routing.policy === "Unconfigured") {
    out.push({
      code: "PBV2_W_ROUTE_UNSET",
      severity: "warning",
      message: "Routing policy is unconfigured — orders will need manual routing.",
      section: "routing",
    });
  }
  if (d.routing.policy === "Route required" && d.routing.steps.length === 0) {
    out.push({
      code: "PBV2_E_ROUTE_EMPTY",
      severity: "error",
      message: "A route is required but the selected template has no steps.",
      section: "routing",
    });
  }
  if (!d.aiUseDescription && !d.aiDescription.trim()) {
    out.push({
      code: "PBV2_I_AI_HINT",
      severity: "info",
      message: "No AI parsing description — inbound matching will rely on the product name only.",
      section: "basics",
    });
  }
  return out;
}

/** Empty cells across every tier × dimension combination. */
export function countMissingMatrixCells(d: ProductDraft): number {
  const dims = matrixDimensions(d);
  if (dims.length === 0) return 0;
  const combos = dims.reduce<string[][]>(
    (acc, { option }) => acc.flatMap((row) => option.choices.map((c) => [...row, c.label])),
    [[]],
  );
  const tiers = d.matrix.tiers.length
    ? d.matrix.tiers
    : [{ id: "t0", label: "All", from: "", to: "" }];
  let missing = 0;
  for (const t of tiers)
    for (const combo of combos) {
      const v = d.matrix.cells[matrixKey(t.id, combo)];
      if (v === undefined || v.trim() === "") missing += 1;
    }
  return missing;
}

export interface PreviewInputs {
  w: string;
  h: string;
  qty: string;
}

export interface PreviewResult {
  blockers: string[];
  sqft: number;
  sheets: number;
  perSheet: number;
  tier?: MatrixTier | undefined;
  matrixSelection?: string | undefined;
  rate?:
    { value: number; unit: MatrixUnit | "per sq ft" | "per piece"; source: string } | undefined;
  base: number;
  adders: { label: string; amount: number }[];
  minimum: number;
  minimumApplied: boolean;
  total: number;
  unitPrice: number;
  weight: { label: string; value: string }[];
  recipe: { label: string; detail: string; active: boolean }[];
  production: { name: string; required: boolean; station: string; reason: string }[];
}

/** Sheet yield for the current piece size — prototype math only. */
export function sheetMath(d: ProductDraft, w: number, h: number, qty: number) {
  const sw = Number(d.pricing.sheetWidth ?? 48) || 48;
  const sl = Number(d.pricing.sheetLength ?? 96) || 96;
  if (d.productType !== "Sheet" || !w || !h) return { perSheet: 0, sheets: 0, sw, sl };
  const normal = Math.floor(sw / w) * Math.floor(sl / h);
  const rotated = d.pricing.allowRotation ? Math.floor(sw / h) * Math.floor(sl / w) : 0;
  const perSheet = Math.max(normal, rotated);
  return { perSheet, sheets: perSheet > 0 ? Math.ceil(qty / perSheet) : qty, sw, sl };
}

/** Options currently used as matrix axes. */
export const matrixDimensions = (d: ProductDraft): OptionRef[] =>
  d.matrix.dimensionOptionIds.map((id) => findOption(d, id)).filter((r): r is OptionRef => !!r);

export function resolveTier(d: ProductDraft, basisValue: number): MatrixTier | undefined {
  return (
    d.matrix.tiers.find((t) => {
      const from = Number(t.from) || 0;
      const to = t.to.trim() === "" ? Infinity : Number(t.to);
      return basisValue >= from && basisValue <= to;
    }) ?? d.matrix.tiers[0]
  );
}

export function computePreview(
  d: ProductDraft,
  inputs: PreviewInputs,
  sel: Record<string, string>,
): PreviewResult {
  const state = evaluateRules(d, sel);
  const blockers: string[] = [];
  for (const { group, option } of allOptions(d)) {
    const s = state[option.id];
    if (s?.visible && s.required && !sel[option.id])
      blockers.push(group.name === option.label ? option.label : `${group.name}: ${option.label}`);
  }
  const needsDims = d.measurements === "Dimensions required";
  const qty = Math.max(1, Number(inputs.qty) || 0);
  const w = Number(inputs.w) || 0;
  const h = Number(inputs.h) || 0;
  if (needsDims && (!w || !h)) blockers.push("Width and height");

  const sqft = needsDims ? (w * h * qty) / 144 : 0;
  const { perSheet, sheets } = sheetMath(d, w, h, qty);

  // --- rate resolution: matrix first, then flat rates ---
  const dims = matrixDimensions(d);
  let tier: MatrixTier | undefined;
  let matrixSelection: string | undefined;
  let rate: PreviewResult["rate"];
  const matrixActive = d.matrix.enabled && dims.length > 0;
  if (matrixActive) {
    const basisValue =
      d.matrix.tierBasis === "Computed Sheet Usage"
        ? sheets
        : d.matrix.tierBasis === "Total Sq Ft"
          ? sqft
          : qty;
    tier = d.matrix.tierBasis === "None" ? d.matrix.tiers[0] : resolveTier(d, basisValue);
    const values = dims.map(({ option }) => sel[option.id] ?? "");
    matrixSelection = values.join(" × ");
    if (values.every(Boolean) && tier) {
      const cell = d.matrix.cells[matrixKey(tier.id, values)];
      if (cell !== undefined && cell !== "")
        rate = {
          value: Number(cell) || 0,
          unit: d.matrix.unit,
          source: `Matrix · ${matrixSelection}`,
        };
    }
    if (!rate) blockers.push("Matrix selection");
  }
  if (!rate) {
    const perSqFt = Number(d.pricing.ratePerSqFt) || 0;
    rate =
      perSqFt > 0
        ? { value: perSqFt, unit: "per sq ft", source: "Rate per sq ft" }
        : {
            value: Number(d.pricing.ratePerPiece) || 0,
            unit: "per piece",
            source: "Rate per piece",
          };
  }

  let base =
    rate.unit === "per sq ft"
      ? sqft * rate.value
      : rate.unit === "per piece"
        ? qty * rate.value
        : rate.value;
  if (rate.unit !== "per piece") base += qty * (Number(d.pricing.ratePerPiece) || 0);

  const dimIds = new Set(d.matrix.enabled ? d.matrix.dimensionOptionIds : []);
  const adders: { label: string; amount: number }[] = [];
  for (const { option } of allOptions(d)) {
    if (!state[option.id]?.visible || dimIds.has(option.id)) continue;
    const picked = option.choices.find((c) => c.label === sel[option.id]);
    if (!picked) continue;
    for (const im of picked.impacts) {
      const amount =
        im.kind === "Flat"
          ? im.amount
          : im.kind === "Per piece"
            ? im.amount * qty
            : im.kind === "Per sq ft"
              ? im.amount * sqft
              : (base * im.amount) / 100;
      adders.push({
        label: `${option.label}: ${picked.label} · ${im.kind}`,
        amount: Number(amount.toFixed(2)),
      });
    }
  }
  const min = Number(d.pricing.minimumCharge) || 0;
  const sum = base + adders.reduce((a, b) => a + b.amount, 0);
  const total = Math.max(min, sum);
  base = Number(base.toFixed(2));

  const mat = materials.find((m) => m.id === d.material.primaryMaterialId);
  const weight = [
    { label: "Material", value: mat?.name ?? "—" },
    { label: "Material weight", value: d.material.configuredWeight ?? "Not configured" },
    { label: "Weight basis", value: d.material.weightBasis },
    {
      label: "Computed weight",
      value: d.material.configuredWeight
        ? `${(qty * parseFloat(d.material.configuredWeight)).toFixed(2)} lb`
        : "0.00 lb",
    },
    { label: "Fallback used", value: d.material.configuredWeight ? "No" : "Yes" },
  ];

  const recipe = d.recipe.map((line) => {
    const m = materials.find((x) => x.id === line.materialId);
    const cond = line.conditionOptionId ? findOption(d, line.conditionOptionId) : undefined;
    const active = !line.conditionOptionId || sel[line.conditionOptionId] === line.conditionValue;
    const qtyOut =
      line.basis === "Per sheet"
        ? sheets * (Number(line.factor) || 0)
        : line.basis === "Per piece"
          ? qty * (Number(line.factor) || 0)
          : line.basis === "Per sq ft"
            ? sqft * (Number(line.factor) || 0)
            : Number(line.factor) || 0;
    return {
      label: m?.name ?? "Material",
      detail: active
        ? `${qtyOut.toFixed(qtyOut % 1 === 0 ? 0 : 2)} ${line.unit}`
        : `Not consumed — needs ${cond?.option.label ?? "condition"} = ${line.conditionValue}`,
      active,
    };
  });

  const production = d.production.map((u) => {
    const cond = u.conditionOptionId ? findOption(d, u.conditionOptionId) : undefined;
    const required = !u.conditionOptionId || sel[u.conditionOptionId] === u.conditionValue;
    return {
      name: u.name,
      required,
      station: u.station,
      reason: u.conditionOptionId
        ? `${cond?.option.label ?? "Option"} = ${u.conditionValue}`
        : "Always",
    };
  });

  return {
    blockers,
    sqft: Number(sqft.toFixed(2)),
    sheets,
    perSheet,
    tier,
    matrixSelection,
    rate,
    base,
    adders,
    minimum: min,
    minimumApplied: sum < min,
    total: Number(total.toFixed(2)),
    unitPrice: Number((total / qty).toFixed(2)),
    weight,
    recipe,
    production,
  };
}

/** Human sentence for a rule card, used in read-only summaries. */
export function ruleSentence(d: ProductDraft, r: RuleCard): string {
  const src = findOption(d, r.sourceOptionId)?.option.label ?? "(missing option)";
  const targets = r.targetOptionIds
    .map((id) => findOption(d, id)?.option.label ?? "(missing)")
    .join(", ");
  const eff = RULE_EFFECTS.find((e) => e.id === r.effect)!;
  return `When ${src} ${r.operator} “${r.value}”, ${eff.label} ${targets || "(no targets)"}.`;
}
