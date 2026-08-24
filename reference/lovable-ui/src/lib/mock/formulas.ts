/* ------------------------------------------------------------------
 * Formula Library (Pricing domain) — reference mock model.
 *
 * A Formula is a reusable pricing expression owned by the tenant.
 * Editing an active Formula creates a NEW revision; Products keep
 * referencing the revision they were published against.
 *
 * The production backend owns identities, immutable revisions,
 * validation and evaluation. Everything here is mock data used to
 * drive the reference UI only.
 * ------------------------------------------------------------------ */

export const FORMULA_STATUSES = ["Active", "Inactive", "Archived"] as const;
export type FormulaStatus = (typeof FORMULA_STATUSES)[number];

/**
 * Reusable-scope of a Formula identity. "Shared" is intentionally NOT a value
 * here — cross-organization sharing is a future capability, not a visibility.
 */
export const FORMULA_VISIBILITIES = ["Product-scoped", "In Library"] as const;
export type FormulaVisibility = (typeof FORMULA_VISIBILITIES)[number];

export const FORMULA_PURPOSES = [
  "Sheet consumption",
  "Roll / nesting",
  "Area pricing",
  "Per piece",
  "Finishing",
] as const;
export type FormulaPurpose = (typeof FORMULA_PURPOSES)[number];

export const FORMULA_INPUT_TYPES = ["Number", "Integer", "Boolean"] as const;
export type FormulaInputType = (typeof FORMULA_INPUT_TYPES)[number];

export interface FormulaInput {
  id: string;
  name: string;
  label: string;
  description: string;
  type: FormulaInputType;
  required: boolean;
  defaultValue: string;
  min: string;
  max: string;
  unit: string;
}

export interface FormulaRevision {
  rev: number;
  state: "Current" | "Superseded";
  created: string;
  createdBy: string;
  productsUsing: number;
  note: string;
  expression: string;
  inputs: FormulaInput[];
}

export interface FormulaUsageRow {
  productId: string;
  productName: string;
  productStatus: "Active" | "Draft" | "Inactive";
  revision: number;
  lifecycle: string;
}

export interface Formula {
  id: string;
  name: string;
  description: string;
  purpose: FormulaPurpose;
  status: FormulaStatus;
  visibility: FormulaVisibility;
  updated: string;
  updatedBy: string;
  expression: string;
  inputs: FormulaInput[];
  revisions: FormulaRevision[];
  usage: FormulaUsageRow[];
  /** Owning product when the formula is Product-scoped. */
  scopeProduct?: string;
  /** Reference-only cross-organization metadata (design examples). */
  sharedBy?: string;
  copies?: number;
}

let seq = 0;
export const fid = (p = "f") => `${p}${++seq}${Math.random().toString(36).slice(2, 5)}`;

export const input = (o: Partial<FormulaInput> & { name: string; label: string }): FormulaInput => ({
  id: fid("in"),
  description: "",
  type: "Number",
  required: true,
  defaultValue: "",
  min: "",
  max: "",
  unit: "",
  ...o,
});

export const currentRevision = (f: Formula) => f.revisions.find((r) => r.state === "Current") ?? f.revisions[0]!;
export const revisionNumber = (f: Formula) => currentRevision(f)?.rev ?? 1;
export const productsUsing = (f: Formula) => f.usage.length;

/* ----------------------------- fixtures ----------------------------- */

const sheetInputs: FormulaInput[] = [
  input({ name: "sheet_width", label: "Sheet width", description: "Parent sheet width as purchased.", unit: "in", defaultValue: "48", min: "1", max: "120" }),
  input({ name: "sheet_length", label: "Sheet length", description: "Parent sheet length as purchased.", unit: "in", defaultValue: "96", min: "1", max: "240" }),
  input({ name: "piece_allowance_x", label: "Piece allowance (width)", description: "Gutter added to each piece across the sheet.", unit: "in", defaultValue: "0.25", required: false }),
  input({ name: "piece_allowance_y", label: "Piece allowance (height)", description: "Gutter added to each piece down the sheet.", unit: "in", defaultValue: "0.25", required: false }),
  input({ name: "waste_allowance", label: "Waste allowance", description: "Extra sheets added for setup and spoilage.", type: "Number", unit: "%", defaultValue: "5", required: false, min: "0", max: "50" }),
  input({ name: "minimum_sheets", label: "Minimum sheets", description: "Never bill fewer than this many sheets.", type: "Integer", defaultValue: "1", required: false, min: "0" }),
];

const rollInputs: FormulaInput[] = [
  input({ name: "roll_width", label: "Roll width", description: "Usable printable width of the roll.", unit: "in", defaultValue: "54" }),
  input({ name: "usable_drop_min", label: "Minimum usable drop", description: "Smallest remnant that can still be sold.", unit: "in", defaultValue: "12", required: false }),
  input({ name: "billable_length_increment", label: "Billable length increment", description: "Round billable length up to this increment.", unit: "in", defaultValue: "6", required: false }),
  input({ name: "minimum_billable_sqft", label: "Minimum billable sq ft", description: "Floor applied to the billable area.", unit: "sq ft", defaultValue: "10", required: false }),
  input({ name: "waste_allowance", label: "Waste allowance", description: "Added to billable length for trim and setup.", unit: "%", defaultValue: "8", required: false }),
];

const areaInputs: FormulaInput[] = [
  input({ name: "minimum_billable_sqft", label: "Minimum billable sq ft", description: "Small jobs price at this area at minimum.", unit: "sq ft", defaultValue: "4", required: false }),
  input({ name: "setup_fee", label: "Setup fee", description: "Flat amount added once per line.", unit: "$", defaultValue: "0", required: false }),
];

const sheetExpr = `# billable sheets for a 4x8 style parent sheet
across = floor(sheet_width  / (w + piece_allowance_x))
down    = floor(sheet_length / (h + piece_allowance_y))
per_sheet = max(1, across * down)

sheets_raw = ceil(q / per_sheet)
sheets = max(minimum_sheets, ceil(sheets_raw * (1 + waste_allowance / 100)))

price = max(minimum_charge, sheets * sheet_rate)`;

const rollExpr = `# billable square feet from roll nesting
lanes = max(1, floor(roll_width / (w + 0.5)))
run_length = ceil(q / lanes) * (h + 0.5)
billable_length = ceil(run_length / billable_length_increment) * billable_length_increment
billable_length = billable_length * (1 + waste_allowance / 100)

billable_sqft = max(minimum_billable_sqft, (roll_width * billable_length) / 144)
price = billable_sqft * rate_per_sqft`;

const areaExpr = `sqft = (w * h) / 144
total_sqft = max(minimum_billable_sqft, sqft * q)
price = total_sqft * rate_per_sqft + setup_fee`;

const consumptionExpr = `# material consumption only — no price returned
across = floor(sheet_width / (w + piece_allowance_x))
down   = floor(sheet_length / (h + piece_allowance_y))
sheets = ceil(q / max(1, across * down))
consumed_sqft = sheets * (sheet_width * sheet_length) / 144`;

const rev = (o: Partial<FormulaRevision> & { rev: number; expression: string; inputs: FormulaInput[] }): FormulaRevision => ({
  state: "Superseded",
  created: "2026-05-02",
  createdBy: "Dale Hensley",
  productsUsing: 0,
  note: "",
  ...o,
});

export const myFormulas: Formula[] = [
  {
    id: "fx-sheets",
    name: "4×8 Sheets with Rounding",
    description: "Nests finished pieces on a parent sheet, rounds up to whole sheets and adds a waste allowance before applying the sheet rate.",
    purpose: "Sheet consumption",
    status: "Active",
    visibility: "In Library",
    updated: "2026-08-11",
    updatedBy: "Dale Hensley",
    expression: sheetExpr,
    inputs: sheetInputs,
    revisions: [
      rev({ rev: 3, state: "Current", created: "2026-08-11", productsUsing: 2, note: "Added minimum_sheets and rotation input.", expression: sheetExpr, inputs: sheetInputs }),
      rev({ rev: 2, created: "2026-06-14", productsUsing: 2, note: "Waste allowance moved from flat sheets to a percentage.", expression: sheetExpr.replace("waste_allowance / 100", "waste_allowance"), inputs: sheetInputs.slice(0, 4) }),
      rev({ rev: 1, created: "2026-03-02", productsUsing: 0, note: "Initial formula.", expression: "sheets = ceil(q / 4)\nprice = sheets * sheet_rate", inputs: sheetInputs.slice(0, 2) }),
    ],
    usage: [
      { productId: "p2", productName: "Coroplast Yard Sign", productStatus: "Active", revision: 2, lifecycle: "Published v4" },
      { productId: "p5", productName: "ACM Panel", productStatus: "Active", revision: 3, lifecycle: "Published v2" },
      { productId: "p7", productName: "Foam Board Print", productStatus: "Draft", revision: 3, lifecycle: "Draft v1" },
      { productId: "p9", productName: "PVC Sign", productStatus: "Inactive", revision: 1, lifecycle: "Published v1" },
    ],
  },
  {
    id: "fx-roll",
    name: "Roll Nesting Billable Sq Ft",
    description: "Lanes finished pieces across roll width, rounds run length to a billable increment and enforces a minimum billable area.",
    purpose: "Roll / nesting",
    status: "Active",
    visibility: "In Library",
    updated: "2026-07-28",
    updatedBy: "Marta Reyes",
    expression: rollExpr,
    inputs: rollInputs,
    revisions: [
      rev({ rev: 2, state: "Current", created: "2026-07-28", createdBy: "Marta Reyes", productsUsing: 2, note: "Billable length increment added.", expression: rollExpr, inputs: rollInputs }),
      rev({ rev: 1, created: "2026-04-19", createdBy: "Marta Reyes", productsUsing: 1, note: "Initial formula.", expression: rollExpr.split("\n").slice(0, 4).join("\n"), inputs: rollInputs.slice(0, 3) }),
    ],
    usage: [
      { productId: "p1", productName: "13oz Vinyl Banner", productStatus: "Active", revision: 2, lifecycle: "Published v7" },
      { productId: "p3", productName: "Perforated Window Film", productStatus: "Active", revision: 2, lifecycle: "Published v3" },
    ],
  },
  {
    id: "fx-area",
    name: "Standard Area Pricing",
    description: "Plain square-foot pricing with a minimum billable area and an optional setup fee. Good default for flat goods.",
    purpose: "Area pricing",
    status: "Active",
    visibility: "In Library",
    updated: "2026-06-30",
    updatedBy: "Dale Hensley",
    expression: areaExpr,
    inputs: areaInputs,
    revisions: [
      rev({ rev: 1, state: "Current", created: "2026-06-30", productsUsing: 3, note: "Initial formula.", expression: areaExpr, inputs: areaInputs }),
    ],
    usage: [
      { productId: "p4", productName: "Cut Vinyl Decal", productStatus: "Active", revision: 1, lifecycle: "Published v2" },
      { productId: "p6", productName: "Window Cling", productStatus: "Active", revision: 1, lifecycle: "Published v1" },
      { productId: "p8", productName: "Poster", productStatus: "Draft", revision: 1, lifecycle: "Draft v3" },
    ],
  },
  {
    id: "fx-consume",
    name: "Sheet Consumption (material only)",
    description: "Returns consumed square feet for inventory draw-down. Used by the recipe, not by price.",
    purpose: "Sheet consumption",
    status: "Active",
    visibility: "Product-scoped",
    scopeProduct: "Coroplast Yard Sign",
    updated: "2026-08-04",
    updatedBy: "Dale Hensley",
    expression: consumptionExpr,
    inputs: sheetInputs.slice(0, 4),
    revisions: [
      rev({ rev: 1, state: "Current", created: "2026-08-04", productsUsing: 1, note: "Created while building Coroplast Yard Sign.", expression: consumptionExpr, inputs: sheetInputs.slice(0, 4) }),
    ],
    usage: [{ productId: "p2", productName: "Coroplast Yard Sign", productStatus: "Active", revision: 1, lifecycle: "Published v4" }],
  },
  {
    id: "fx-grommet",
    name: "Grommet & Hem Finishing",
    description: "Charges perimeter hemming plus grommets on a spacing interval. Pairs with banner area pricing.",
    purpose: "Finishing",
    status: "Inactive",
    visibility: "In Library",
    updated: "2026-02-17",
    updatedBy: "Marta Reyes",
    expression: `perimeter_ft = ((w + h) * 2) / 12\ngrommets = ceil(perimeter_ft * 12 / grommet_spacing)\nprice = perimeter_ft * hem_rate + grommets * grommet_rate`,
    inputs: [
      input({ name: "grommet_spacing", label: "Grommet spacing", unit: "in", defaultValue: "24", description: "Distance between grommets around the perimeter." }),
      input({ name: "hem_rate", label: "Hem rate", unit: "$/ft", defaultValue: "0.45", required: false, description: "Charged per linear foot of hem." }),
      input({ name: "grommet_rate", label: "Grommet rate", unit: "$ each", defaultValue: "0.35", required: false, description: "Charged per grommet." }),
    ],
    revisions: [
      rev({ rev: 2, state: "Current", created: "2026-02-17", createdBy: "Marta Reyes", productsUsing: 0, note: "Spacing made configurable.", expression: "perimeter_ft = ((w + h) * 2) / 12", inputs: [] }),
      rev({ rev: 1, created: "2025-11-05", createdBy: "Marta Reyes", productsUsing: 0, note: "Initial formula.", expression: "price = 12", inputs: [] }),
    ],
    usage: [],
  },
];

export const sharedFormulas: Formula[] = [
  {
    id: "sh-dtf",
    name: "DTF Gang Sheet Utilisation",
    description: "Packs transfers onto a gang sheet, bills by used length and applies a utilisation floor so short runs stay profitable.",
    purpose: "Roll / nesting",
    status: "Active",
    visibility: "In Library",
    updated: "2026-08-06",
    updatedBy: "Northline Graphics",
    sharedBy: "Northline Graphics",
    copies: 128,
    expression: `lanes = max(1, floor(gang_width / (w + gap)))\nrun_in = ceil(q / lanes) * (h + gap)\nbillable_in = max(min_length_in, ceil(run_in / length_increment) * length_increment)\nprice = (gang_width * billable_in / 144) * rate_per_sqft`,
    inputs: [
      input({ name: "gang_width", label: "Gang sheet width", unit: "in", defaultValue: "22" }),
      input({ name: "gap", label: "Gap between transfers", unit: "in", defaultValue: "0.375", required: false }),
      input({ name: "length_increment", label: "Length increment", unit: "in", defaultValue: "12", required: false }),
      input({ name: "min_length_in", label: "Minimum billable length", unit: "in", defaultValue: "12", required: false }),
    ],
    revisions: [rev({ rev: 4, state: "Current", created: "2026-08-06", createdBy: "Northline Graphics", note: "Utilisation floor added.", expression: "…", inputs: [] })],
    usage: [],
  },
  {
    id: "sh-wrap",
    name: "Vehicle Wrap Coverage Estimate",
    description: "Estimates wrap material from vehicle class and coverage percentage, including overlap and complexity factors.",
    purpose: "Area pricing",
    status: "Active",
    visibility: "In Library",
    updated: "2026-07-19",
    updatedBy: "Sierra Wrap Co.",
    sharedBy: "Sierra Wrap Co.",
    copies: 76,
    expression: `base_sqft = vehicle_sqft * (coverage_pct / 100)\nmaterial_sqft = base_sqft * (1 + overlap_pct / 100)\nprice = material_sqft * rate_per_sqft * complexity_factor`,
    inputs: [
      input({ name: "vehicle_sqft", label: "Vehicle surface area", unit: "sq ft", defaultValue: "260" }),
      input({ name: "coverage_pct", label: "Coverage", unit: "%", defaultValue: "75" }),
      input({ name: "overlap_pct", label: "Overlap allowance", unit: "%", defaultValue: "15", required: false }),
      input({ name: "complexity_factor", label: "Complexity factor", defaultValue: "1.2", required: false }),
    ],
    revisions: [rev({ rev: 2, state: "Current", created: "2026-07-19", createdBy: "Sierra Wrap Co.", note: "Complexity factor added.", expression: "…", inputs: [] })],
    usage: [],
  },
  {
    id: "sh-acrylic",
    name: "Rigid Sheet Yield with Kerf",
    description: "Sheet yield for routed rigid substrates. Accounts for bit kerf, edge clamp margin and minimum sheet charge.",
    purpose: "Sheet consumption",
    status: "Active",
    visibility: "In Library",
    updated: "2026-06-11",
    updatedBy: "Bayline Signworks",
    sharedBy: "Bayline Signworks",
    copies: 51,
    expression: `usable_w = sheet_width - (clamp_margin * 2)\nusable_l = sheet_length - (clamp_margin * 2)\nacross = floor(usable_w / (w + kerf))\ndown = floor(usable_l / (h + kerf))\nsheets = ceil(q / max(1, across * down))\nprice = max(min_sheet_charge, sheets * sheet_rate)`,
    inputs: [
      input({ name: "sheet_width", label: "Sheet width", unit: "in", defaultValue: "48" }),
      input({ name: "sheet_length", label: "Sheet length", unit: "in", defaultValue: "96" }),
      input({ name: "kerf", label: "Router kerf", unit: "in", defaultValue: "0.25", required: false }),
      input({ name: "clamp_margin", label: "Clamp margin", unit: "in", defaultValue: "0.5", required: false }),
      input({ name: "min_sheet_charge", label: "Minimum sheet charge", unit: "$", defaultValue: "45", required: false }),
    ],
    revisions: [rev({ rev: 5, state: "Current", created: "2026-06-11", createdBy: "Bayline Signworks", note: "Clamp margin added.", expression: "…", inputs: [] })],
    usage: [],
  },
  {
    id: "sh-linear",
    name: "Linear Foot Banner Pricing",
    description: "Simple linear-foot pricing for continuous banner runs with a minimum order length.",
    purpose: "Per piece",
    status: "Active",
    visibility: "In Library",
    updated: "2026-05-23",
    updatedBy: "Harbor Print Group",
    sharedBy: "Harbor Print Group",
    copies: 29,
    expression: `linear_ft = max(min_linear_ft, (h / 12) * q)\nprice = linear_ft * rate_per_linear_ft`,
    inputs: [
      input({ name: "rate_per_linear_ft", label: "Rate per linear foot", unit: "$", defaultValue: "6.5" }),
      input({ name: "min_linear_ft", label: "Minimum linear feet", unit: "ft", defaultValue: "3", required: false }),
    ],
    revisions: [rev({ rev: 1, state: "Current", created: "2026-05-23", createdBy: "Harbor Print Group", note: "Initial formula.", expression: "…", inputs: [] })],
    usage: [],
  },
];

/** Shared-formula entries are reference/demo records, not live tenant data. */
export const isReferenceShared = (f: Formula) => !!f.sharedBy;

export const allFormulas = () => [...myFormulas, ...sharedFormulas];
export const findFormula = (id: string) => allFormulas().find((f) => f.id === id);

export const cloneFormula = (f: Formula, name: string): Formula => ({
  ...structuredClone(f),
  id: fid("fx"),
  name,
  status: "Inactive",
  visibility: "In Library",
  updated: new Date().toISOString().slice(0, 10),
  usage: [],
  copies: undefined as unknown as number,
  sharedBy: undefined as unknown as string,
  revisions: [
    { rev: 1, state: "Current", created: new Date().toISOString().slice(0, 10), createdBy: "Dale Hensley", productsUsing: 0, note: `Duplicated from ${f.name}.`, expression: f.expression, inputs: structuredClone(f.inputs) },
  ],
});

/* --------------------------- mock tester --------------------------- */

export interface TesterJob { w: string; h: string; qty: string; unit: "in" | "cm" }

export interface TesterResult {
  ok: boolean;
  price: string;
  lines: { label: string; value: string; hint?: string }[];
  warnings: string[];
  errors: string[];
}

/**
 * Illustrative tester output only. The server performs the authoritative
 * evaluation; this shapes the diagnostics panel for the reference UI.
 */
export function mockTest(f: Formula, job: TesterJob, values: Record<string, string>): TesterResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const i of f.inputs) {
    const raw = values[i.name] ?? i.defaultValue;
    if (i.required && String(raw).trim() === "") errors.push(`${i.label} is required.`);
    if (i.type !== "Boolean" && raw !== "" && Number.isNaN(Number(raw))) errors.push(`${i.label} must be a number.`);
    if (i.type === "Integer" && raw !== "" && Number(raw) % 1 !== 0) warnings.push(`${i.label} is not a whole number and will be rounded.`);
    if (i.min !== "" && Number(raw) < Number(i.min)) errors.push(`${i.label} is below the minimum of ${i.min}.`);
    if (i.max !== "" && Number(raw) > Number(i.max)) errors.push(`${i.label} is above the maximum of ${i.max}.`);
  }

  const w = Number(job.w) || 0;
  const h = Number(job.h) || 0;
  const q = Number(job.qty) || 0;
  if (w <= 0 || h <= 0) errors.push("Enter a width and height to test this formula.");
  if (q <= 0) errors.push("Enter a quantity to test this formula.");

  const num = (k: string, fb: number) => {
    const v = values[k] ?? f.inputs.find((i) => i.name === k)?.defaultValue ?? "";
    const n = Number(v);
    return Number.isFinite(n) && v !== "" ? n : fb;
  };

  const sheetW = num("sheet_width", 48);
  const sheetL = num("sheet_length", 96);
  const ax = num("piece_allowance_x", 0.25);
  const ay = num("piece_allowance_y", 0.25);
  const across = Math.max(1, Math.floor(sheetW / Math.max(1, w + ax)));
  const down = Math.max(1, Math.floor(sheetL / Math.max(1, h + ay)));
  const perSheet = across * down;
  const waste = num("waste_allowance", 5);
  const sheets = Math.max(num("minimum_sheets", 1), Math.ceil(Math.ceil(q / perSheet) * (1 + waste / 100)));
  const sqft = (w * h) / 144;
  const totalSqft = sqft * q;
  const billable = Math.max(num("minimum_billable_sqft", 0), totalSqft);
  const price = f.purpose === "Sheet consumption" ? sheets * 42 : billable * 4.25 + num("setup_fee", 0);

  if (errors.length === 0 && perSheet <= 1 && f.purpose === "Sheet consumption") {
    warnings.push("Only one piece fits per sheet at this size — check the piece allowances.");
  }
  if (errors.length === 0 && billable > totalSqft) {
    warnings.push("Minimum billable area is driving the result, not the job size.");
  }

  const money = (n: number) => `$${n.toFixed(2)}`;
  const lines: { label: string; value: string; hint?: string }[] =
    f.purpose === "Sheet consumption"
      ? [
          { label: "Pieces per sheet", value: `${perSheet}`, hint: `${across} across × ${down} down` },
          { label: "Sheets required", value: `${sheets}`, hint: `${waste}% waste allowance applied` },
          { label: "Consumed area", value: `${((sheets * sheetW * sheetL) / 144).toFixed(2)} sq ft` },
          { label: "Rate / basis", value: "$42.00 per sheet" },
        ]
      : [
          { label: "Area per piece", value: `${sqft.toFixed(2)} sq ft` },
          { label: "Billable area", value: `${billable.toFixed(2)} sq ft`, hint: `${totalSqft.toFixed(2)} sq ft before minimums` },
          { label: "Nesting", value: `${across} across on a ${sheetW}" span` },
          { label: "Rate / basis", value: "$4.25 per sq ft" },
        ];

  return { ok: errors.length === 0, price: errors.length ? "—" : money(price), lines, warnings, errors };
}
