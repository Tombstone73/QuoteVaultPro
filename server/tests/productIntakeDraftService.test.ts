import { describe, expect, test } from "@jest/globals";
import { validateOptionTreeV2 } from "../../shared/optionTreeV2";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "../../shared/pbv2/validator";
import { validateTreeHasBasePrice } from "../../shared/pbv2/validator/validateBasePrice";
import { getPbv2FixedDimensions } from "../../shared/pbv2/fixedDimensions";
import type { ProductIntakeBrief } from "../../shared/productIntakeWizardSchemas";
import {
  buildProductIntakeDraftTree,
  buildProductIntakeProductValues,
  validateProductIntakeCustomOptions,
} from "../services/productIntakeWizard/productIntakeDraftService";
import { evaluatePricingPreviewFromTree } from "../services/pricing/PricingService";

function brief(overrides: Partial<ProductIntakeBrief> = {}): ProductIntakeBrief {
  return {
    workflowState: "REVIEW_READY",
    source: "live_ai",
    fallbackReason: null,
    productIdentity: {
      likelyProductName: { value: "13oz Banner", confidence: 92, evidence: [] },
      category: { value: "Banners", confidence: 88, evidence: [] },
      productType: { value: "Banner", confidence: 84, evidence: [] },
    },
    materialAnalysis: {
      detectedMaterialReferences: ["13oz banner"],
      likelyMaterialMatches: [{ materialId: "mat_banner", sku: "BAN13", name: "13oz Banner", confidence: 91, evidence: [] }],
      confidence: 91,
      evidence: [],
    },
    sizeBehavior: { behavior: "custom_size", confidence: 90, evidence: [] },
    quantityBehavior: { behavior: "quantity_based", confidence: 90, evidence: [] },
    pricingAnalysis: { behavior: "square_foot", confidence: 90, evidence: [] },
    requiredOptions: [
      {
        label: "Printed Sides",
        normalizedGroup: "printed_sides",
        required: true,
        confidence: 90,
        sampleValues: ["Single Sided", "Double Sided"],
        sourcePaths: ["$.form_fields[0]"],
        templateMatches: [],
        evidence: [],
      },
    ],
    optionalOptions: [
      {
        label: "Grommets",
        normalizedGroup: "grommets",
        required: false,
        confidence: 85,
        sampleValues: ["None", "Corners"],
        sourcePaths: ["$.form_fields[1]"],
        templateMatches: [],
        evidence: [],
      },
    ],
    templateMatches: [],
    missingDecisions: [],
    redundantFields: [],
    draftWarnings: [],
    sourceEvidence: [{ sourcePath: "$.Products[0].Name", label: "Name", value: "13oz Banner", reason: "source product" }],
    overallConfidence: 90,
    ...overrides,
  };
}

function option(label: string, overrides: Partial<ProductIntakeBrief["requiredOptions"][number]> = {}): ProductIntakeBrief["requiredOptions"][number] {
  return {
    label,
    normalizedGroup: label,
    required: true,
    confidence: 90,
    sampleValues: [],
    sourcePaths: [`$.${label}`],
    templateMatches: [],
    evidence: [],
    ...overrides,
  };
}

function nodes(tree: any) {
  return Object.values(tree.nodes) as any[];
}

function inputNode(tree: any, selectionKey: string) {
  return nodes(tree).find((node) => node.input?.selectionKey === selectionKey);
}

function expectNoGeneratedSizeOption(tree: any) {
  expect(inputNode(tree, "size")).toBeUndefined();
  expect(nodes(tree).some((node) => node.input?.selectionKey === "size")).toBe(false);
  expect(groupLabels(tree)).not.toContain("Size & Quantity");
}

function groupLabels(tree: any) {
  return nodes(tree)
    .filter((node) => String(node.type ?? "").toUpperCase() === "GROUP")
    .map((node) => node.label);
}

function expectNoQuantityOption(tree: any) {
  const quantityNodes = nodes(tree).filter((node) => {
    if (!node.input) return false;
    const text = `${node.key ?? ""} ${node.label ?? ""} ${node.input?.selectionKey ?? ""}`.toLowerCase();
    return /\bquantity\b|\bqty\b/.test(text);
  });
  expect(quantityNodes).toEqual([]);
}

function expectNoGroupRoots(tree: any) {
  for (const rootId of tree.rootNodeIds) {
    expect(String(tree.nodes[rootId]?.type ?? "").toUpperCase()).not.toBe("GROUP");
  }
}

function expectNoRuntimeArchitectureErrors(tree: any) {
  expect(validateOptionTreeV2(tree).ok).toBe(true);
  expectNoGroupRoots(tree);
  const publishValidation = validateTreeForPublish(tree, DEFAULT_VALIDATE_OPTS);
  const blockedCodes = new Set([
    "PBV2_E_TREE_NO_ROOTS",
    "PBV2_E_TREE_ROOT_INVALID",
    "PBV2_E_REQUIRED_INPUT_UNREACHABLE",
  ]);
  expect(publishValidation.errors.filter((finding) => blockedCodes.has(finding.code))).toEqual([]);
  const baseValidation = validateTreeHasBasePrice(tree);
  expect(baseValidation.errors.map((finding) => finding.code)).toContain("PBV2_E_BASE_PRICE_MISSING");
}

function expectNoPricingMatrixValidationErrors(tree: any) {
  const publishValidation = validateTreeForPublish(tree, DEFAULT_VALIDATE_OPTS);
  expect(publishValidation.errors.filter((finding) => finding.code.startsWith("PBV2_E_PRICING_MATRIX"))).toEqual([]);
}

function expectGeneratedDraftShape(tree: any) {
  expectNoRuntimeArchitectureErrors(tree);
  expectNoQuantityOption(tree);
  expect(tree.meta?.productIntake?.quantity?.customerFacingOptionGenerated).toBe(false);
  expect(tree.meta?.productIntake?.quantityWarnings?.[0]).toContain("Quantity behavior found in intake");
}

describe("Product Intake draft service", () => {
  test("builds inactive product values without assigning an active PBV2 tree", () => {
    const values = buildProductIntakeProductValues({
      organizationId: "org_1",
      productId: "prod_1",
      brief: brief(),
      productTypeId: "ptype_banner",
    });

    expect(values).toMatchObject({
      id: "prod_1",
      organizationId: "org_1",
      name: "13oz Banner",
      productTypeId: "ptype_banner",
      category: "Banners",
      pricingMode: "area",
      pricingEngine: "pricingProfile",
      pricingProfileKey: "default",
      primaryMaterialId: "mat_banner",
      isActive: false,
      optionTreeJson: null,
      pbv2ActiveTreeVersionId: null,
    });
  });

  test("persists explicit sheet dimensions and allow-rotation settings for inactive nesting drafts", () => {
    const values = buildProductIntakeProductValues({
      organizationId: "org_1", productId: "prod_rotation", brief: brief(), productTypeId: "ptype_rigid",
      sourceText: "3mm PVC, 48x96 sheets, allow rotation, flatbed route.",
    });
    expect(values.pricingProfileConfig).toMatchObject({
      sheetWidth: 48, sheetHeight: 96, materialType: "sheet", allowRotation: true,
    });
    expect(values.isActive).toBe(false);
    expect(values.pbv2ActiveTreeVersionId).toBeNull();
  });

  test("lets an explicit Product Intake correction clear earlier sheet and rotation settings", () => {
    const sourceText = [
      "3mm PVC, 48x96 sheets, allow rotation, flatbed route, $3.00 per square foot with $10 minimum charge.",
      "Explicit Product Intake correction (new explicit values override all prior assumptions):",
      "Set the price to $2.00 per square foot with a $25.00 minimum charge. Leave production routing, sheet settings, and rotation unset.",
    ].join("\n\n");
    const correctedBrief = brief({ pricingAnalysis: { behavior: "square_foot", confidence: 100, notes: "$2.00 per square foot; minimum charge $25.00", evidence: [] } });
    const values = buildProductIntakeProductValues({ organizationId: "org_1", productId: "prod_correction", brief: correctedBrief, productTypeId: "ptype_rigid", sourceText });
    const tree = buildProductIntakeDraftTree({ brief: correctedBrief, sessionId: "sess_correction", productName: "13oz Banner", userId: "user_1", sourceText });

    expect(values.pricingProfileConfig).toBeNull();
    expect(tree.meta?.pricingV2?.base).toMatchObject({ perSqftCents: 200, minimumChargeCents: 2500 });
  });

  test("keeps explicit quantity-only service requests out of dimensioned production", () => {
    const values = buildProductIntakeProductValues({
      organizationId: "org_1", productId: "prod_service", brief: brief(), productTypeId: null,
      sourceText: "Create an inactive service product priced at $20 per piece. This is a quantity-only service fee and requires proof approval.",
    });
    expect(values).toMatchObject({
      measurementMode: "quantity_only",
      workflowIntent: "service_fee",
      isService: true,
      requiresProductionJob: false,
      requiresProofApproval: true,
      isActive: false,
      pbv2ActiveTreeVersionId: null,
    });
  });

  test("builds a quantity-only service fee with arbitrary line-item quantities at the stated per-piece rate", () => {
    const sourceText = "Create an inactive quantity-only service fee at $20 per piece. It must not create production work.";
    const canonicalBrief = brief({
      sizeBehavior: { behavior: "none", confidence: 100, evidence: [] },
      quantityBehavior: { behavior: "per_piece", confidence: 100, evidence: [] },
      pricingAnalysis: { behavior: "per_piece", confidence: 100, notes: "$20 per piece", evidence: [] },
      workflowIntent: "service_fee",
      requiresProductionJob: false,
    } as any);
    const tree = buildProductIntakeDraftTree({ brief: canonicalBrief, sessionId: "sess_service_fee", productName: "Service Fee", userId: "user_1", sourceText });
    const values = buildProductIntakeProductValues({ organizationId: "org_1", productId: "prod_service_fee", brief: canonicalBrief, productTypeId: null, sourceText });
    expect(tree.meta).toMatchObject({ pricingProfileKey: "qty_only", requiresDimensions: false, pricingV2: { tierBasis: "line_item_quantity", base: { perPieceCents: 2000 } } });
    expect(values).toMatchObject({ measurementMode: "quantity_only", workflowIntent: "service_fee", requiresProductionJob: false, pricingProfileKey: "qty_only", pricingFormula: null, pricingFormulaId: null, pricingProfileConfig: null, primaryMaterialId: null, isActive: false });
    expect(nodes(tree).some((node) => /review required/i.test(String(node.label)))).toBe(false);
    for (const [quantity, total] of [[1, 20], [2, 40], [10, 200]] as const) {
      expect(evaluatePricingPreviewFromTree({ treeJson: tree, widthIn: undefined as unknown as number, heightIn: undefined as unknown as number, quantity }).totalPrice).toBeCloseTo(total, 2);
    }
  });

  test("does not add dimension requirements to an explicit quantity-only service PBV2 draft", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief(), sessionId: "sess_service", productName: "Service Fee", userId: "user_1",
      sourceText: "Create a quantity-only service product priced at $20 per piece.",
    });
    expect(tree.meta?.requiresDimensions).toBe(false);
    expect(tree.meta?.productIntake?.quantity).toMatchObject({ quantityOnly: true });
  });

  test("builds a quantity-only per-piece tier draft without dimension, formula, production, or review defaults", () => {
    const quantityTierBrief = brief({
      productIdentity: {
        likelyProductName: { value: "Sticker Packs", confidence: 95, evidence: [] },
        category: { value: "Stickers", confidence: 90, evidence: [] },
        productType: { value: "Sticker", confidence: 88, evidence: [] },
      },
      sizeBehavior: { behavior: "none", confidence: 96, notes: "Quantity only", evidence: [] },
      quantityBehavior: { behavior: "quantity_tiers", confidence: 94, evidence: [] },
      pricingAnalysis: { behavior: "per_piece", confidence: 94, evidence: [] },
      requiredOptions: [],
      optionalOptions: [],
    });
    const sourceText = [
      "Create an inactive quantity-only Sticker Packs product.",
      "1-24 stickers are $3 each; 25-49 are $2.50 each; 50+ are $2 each.",
    ].join(" ");
    const tree = buildProductIntakeDraftTree({
      brief: quantityTierBrief, sessionId: "sess_quantity_tiers", productName: "Sticker Packs", userId: "user_1", sourceText,
    });
    const values = buildProductIntakeProductValues({
      organizationId: "org_1", productId: "prod_quantity_tiers", brief: quantityTierBrief, productTypeId: null, sourceText,
      formulaAssignment: {
        code: "STALE_SQFT", name: "Stale square foot formula", pricingProfileKey: "default", expression: "total_sqft * p", config: {},
      },
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expect(tree.meta).toMatchObject({ pricingProfileKey: "qty_only", requiresDimensions: false });
    expect(tree.meta?.pricingFormula).toBeUndefined();
    expect(tree.meta?.pricingV2).toMatchObject({ tierBasis: "line_item_quantity", base: {} });
    expect(tree.meta?.pricingV2?.qtyTiers).toEqual([
      { id: "qty_1", label: "1-24", minQty: 1, perPieceCents: 300 },
      { id: "qty_25", label: "25-49", minQty: 25, perPieceCents: 250 },
      { id: "qty_50", label: "50+", minQty: 50, perPieceCents: 200 },
    ]);
    expect(tree.meta?.pricingV2?.qtyTiers?.every((tier) => tier.perSqftCents === undefined)).toBe(true);
    expect(nodes(tree).filter((node) => node.type === "INPUT")).toEqual([]);
    expect(nodes(tree).some((node) => /review required/i.test(String(node.label)))).toBe(false);
    expect(values).toMatchObject({
      measurementMode: "quantity_only", pricingEngine: "pricingProfile", pricingProfileKey: "qty_only",
      pricingFormula: null, pricingFormulaId: null, requiresProductionJob: false, isActive: false,
    });
    expect(values.pricingProfileConfig).toBeNull();
  });

  test.each([
    [1, 3], [24, 72], [25, 62.5], [49, 122.5], [50, 100], [100, 200],
  ])("evaluates quantity-only tier pricing for quantity %i without dimensions", (quantity, expectedTotal) => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        sizeBehavior: { behavior: "none", confidence: 96, notes: "Quantity only", evidence: [] },
        quantityBehavior: { behavior: "quantity_tiers", confidence: 94, evidence: [] },
        pricingAnalysis: { behavior: "per_piece", confidence: 94, evidence: [] },
        requiredOptions: [], optionalOptions: [],
      }),
      sessionId: "sess_quantity_preview", productName: "Sticker Packs", userId: "user_1",
      sourceText: "Quantity-only product: 1-24 at $3 each, 25-49 at $2.50 each, and 50+ at $2 each.",
    });
    const preview = evaluatePricingPreviewFromTree({
      treeJson: tree,
      widthIn: undefined as unknown as number,
      heightIn: undefined as unknown as number,
      quantity,
    });
    expect(preview.totalPrice).toBeCloseTo(expectedTotal, 2);
  });

  test("honors an explicit production-job request for a quantity-only product", () => {
    const values = buildProductIntakeProductValues({
      organizationId: "org_1", productId: "prod_quantity_production", productTypeId: null,
      brief: brief({ sizeBehavior: { behavior: "none", confidence: 96, evidence: [] } }),
      sourceText: "Create a quantity-only product that requires a production job.",
    });
    expect(values.requiresProductionJob).toBe(true);
  });

  test("stores an explicit fixed-size request as fixed PBV2 metadata", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief(), sessionId: "sess_fixed", productName: "Yard Sign", userId: "user_1",
      sourceText: "Create a 24 by 18 yard sign product that does not ask for dimensions.",
    });
    expect(tree.meta?.requiresDimensions).toBe(false);
    expect(tree.meta?.fixedDimensions).toMatchObject({ widthIn: 24, heightIn: 18 });
  });

  test("builds a valid PBV2 DRAFT tree from intake options and behaviors", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief(),
      sessionId: "sess_1",
      productName: "13oz Banner",
      userId: "user_1",
      now: new Date("2026-06-08T12:00:00.000Z"),
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectGeneratedDraftShape(tree);
    expect(tree.schemaVersion).toBe(2);
    expect(tree.meta?.requiresDimensions).toBe(true);
    expect(tree.meta?.notes).toContain("Product Intake session sess_1");
    expect(tree.meta?.productIntake?.draftQuality?.label).toMatch(/Excellent|Good|Needs Review/);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Print Setup", "Finishing"]));
    expectNoGeneratedSizeOption(tree);
    expect(tree.meta?.productIntake?.size).toMatchObject({
      behavior: "custom_dimensions",
      customerFacingOptionGenerated: false,
    });
    expect(inputNode(tree, "quantity")).toBeUndefined();
    expect(inputNode(tree, "printed_sides")?.input?.required).toBe(true);
    expect(inputNode(tree, "grommets")?.input?.required).toBe(false);
  });

  test("unresolved material is stored as review metadata without blocking draft artifacts", () => {
    const unresolvedBrief = brief({
      materialAnalysis: {
        detectedMaterialReferences: ["Mystery vinyl"],
        likelyMaterialMatches: [
          { materialId: "mat_candidate", sku: "MYST", name: "Mystery Candidate", confidence: 45, evidence: [] },
        ],
        confidence: 45,
        evidence: [],
      },
    });
    const tree = buildProductIntakeDraftTree({
      brief: unresolvedBrief,
      sessionId: "sess_unresolved_material",
      productName: "Mystery Vinyl Sign",
      userId: "user_1",
    });
    const productValues = buildProductIntakeProductValues({
      organizationId: "org_1",
      productId: "prod_unresolved",
      brief: unresolvedBrief,
      productTypeId: "ptype_banner",
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expect(productValues.primaryMaterialId).toBeNull();
    expect(productValues.isActive).toBe(false);
    expect(tree.meta?.productIntake?.materialMatchStatus).toBe("review_required");
    expect(tree.meta?.productIntake?.materialAssociationRequired).toBe(true);
    expect(tree.meta?.productIntake?.sourceMaterialText).toBe("Mystery vinyl");
    expect(tree.meta?.productIntake?.materialCandidateMatches).toEqual([
      { materialId: "mat_candidate", sku: "MYST", name: "Mystery Candidate", confidence: 45 },
    ]);
    expect(tree.meta?.productIntake?.materialWarnings).toEqual(["Material association required."]);
    expect(tree.meta?.productIntake?.draftQuality?.warnings).toEqual(expect.arrayContaining(["Material match needs review."]));
  });

  test("preserves explicit unset material and workflow gates in the inactive draft", () => {
    const correctedBrief = brief({
      materialSelection: "unset",
      requiresProofApproval: true,
      requiresProductionJob: true,
      productionRoute: "Flatbed",
      minimumChargeExplicitlyUnset: true,
      requiredOptions: [],
      optionalOptions: [],
      pricingAnalysis: { behavior: "square_foot", confidence: 100, notes: "$5.00 per square foot", evidence: [] },
    });
    const tree = buildProductIntakeDraftTree({
      brief: correctedBrief,
      sessionId: "sess_explicit_workflow",
      productName: "Flatbed Proof Product",
      userId: "user_1",
      sourceText: "Original request had a $25 minimum. Explicit Product Intake correction (new explicit values override all prior assumptions): Do not select a material. Leave material unset. Require customer proof approval. Require a production job and route it to Flatbed. Leave sheet settings, rotation, and minimum charge unset. Keep pricing at $5 per square foot.",
    });
    const productValues = buildProductIntakeProductValues({ organizationId: "org_1", productId: "prod_explicit_workflow", brief: correctedBrief, productTypeId: "ptype_banner" });

    expect(productValues).toMatchObject({ primaryMaterialId: null, requiresProofApproval: true, requiresProductionJob: true, isActive: false });
    expect(tree.meta?.pricingV2?.base).toEqual({ perSqftCents: 500 });
    expect(tree.meta?.productIntake).toMatchObject({ materialSelection: "unset", materialMatch: null, materialAssociationRequired: false, requiresProofApproval: true, requiresProductionJob: true, productionRoute: "Flatbed" });
    expect(validateOptionTreeV2(tree).ok).toBe(true);
  });

  test("extracts explicit source pricing into PBV2 base pricing metadata", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        pricingAnalysis: {
          behavior: "square_foot",
          confidence: 90,
          notes: "Base price is $5.00 per sqft with minimum charge $25.",
          evidence: [{ sourcePath: "$.description.pricing", label: "Pricing", value: "$5.00 per sqft, minimum charge $25", reason: "source pricing" }],
        },
      }),
      sessionId: "sess_priced",
      productName: "13oz Banner",
      userId: "user_1",
      sourceText: "13oz banner $5.00 per sqft minimum charge $25",
    });

    expect(tree.meta?.pricingV2?.base).toMatchObject({ perSqftCents: 500, minimumChargeCents: 2500 });
    expect(tree.meta?.productIntake?.pricingReadiness?.basePricingConfigured).toBe(true);
    expect(tree.meta?.productIntake?.pricingWarnings ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/Base pricing was not found/)]));
    expect(validateTreeHasBasePrice(tree).errors).toEqual([]);
    expectNoQuantityOption(tree);
  });

  test("applies Product Intake pricing answers during draft generation", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({ pricingAnalysis: { behavior: "manual_quote", confidence: 70, evidence: [] } }),
      sessionId: "sess_answered_pricing",
      productName: "13oz Banner",
      userId: "user_1",
      answers: [
        { questionKey: "base-price-per-piece", answer: 12.5 },
        { questionKey: "minimum-charge", answer: "25" },
      ],
    });

    expect(tree.meta?.pricingV2?.base).toMatchObject({ perPieceCents: 1250, minimumChargeCents: 2500 });
    expect(tree.meta?.productIntake?.pricingReadiness?.sources).toEqual(expect.arrayContaining([
      "Product Intake answer: base price per piece",
      "Product Intake answer: minimum charge",
    ]));
    expect(validateTreeHasBasePrice(tree).errors).toEqual([]);
  });

  test("leaves publish-blocking base pricing empty and flags likely matrix pricing when source pricing is missing", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "Yard Signs", confidence: 92, evidence: [] },
          category: { value: "Yard Signs", confidence: 88, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 82, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 90, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 90, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 80, notes: "size x quantity price grid", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["18x24", "24x36"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
      }),
      sessionId: "sess_matrix",
      productName: "Yard Signs",
      userId: "user_1",
      sourceText: "Yard signs use a size x quantity price grid. Prices not provided.",
    });

    expect(tree.meta?.pricingV2?.base).toEqual({});
    expect(tree).not.toHaveProperty("pricingMatrix");
    expect(tree.meta?.productIntake?.pricingReadiness).toMatchObject({
      basePricingConfigured: false,
      likelyMatrixPricing: true,
      candidateDimensions: expect.arrayContaining(["size", "quantity"]),
      matrixType: expect.any(String),
      matrixConfidence: expect.any(Number),
    });
    expect(tree.meta?.productIntake?.matrixReadiness).toMatchObject({
      required: true,
      noMatrixRowsGenerated: true,
      matrixDimensions: expect.arrayContaining(["size", "quantity"]),
      recommendedSetup: expect.stringMatching(/PBV2 pricing matrix|quantity tiers/i),
    });
    expect(tree.meta?.productIntake?.pricingWarnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/Base pricing was not found/),
      expect.stringMatching(/Likely matrix pricing detected/),
    ]));
    expect(tree.meta?.productIntake?.draftQuality?.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/without generating matrix rows/),
    ]));
    expect(validateTreeHasBasePrice(tree).errors.map((finding) => finding.code)).toContain("PBV2_E_BASE_PRICE_MISSING");
    expectNoQuantityOption(tree);
  });

  test.each([
    {
      label: "4mm Coroplast Yard Signs",
      expectedDimension: "printed_sides",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "24x18 Coroplast Yard Sign", confidence: 94, evidence: [] },
          category: { value: "Yard Signs", confidence: 90, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 92, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 92, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 90, notes: "printed sides x quantity price table", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["24x18"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
        optionalOptions: [],
      },
      sourceText: [
        "24x18 Coroplast Yard Sign",
        "Printed Sides: Single Sided, Double Sided",
        "Quantity Tiers: 1-100, 101-500, 501+",
        "Pricing:",
        "Single Sided:",
        "1-100 = 4.40",
        "101-500 = 3.30",
        "501+ = 3.00",
        "Double Sided:",
        "1-100 = 5.50",
        "101-500 = 4.40",
        "501+ = 4.00",
      ].join("\n"),
      expectedFirstTierCents: 440,
    },
    {
      label: "Business Cards",
      expectedDimension: "stock",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "Business Cards", confidence: 94, evidence: [] },
          category: { value: "Business Cards", confidence: 90, evidence: [] },
          productType: { value: "Flat Print", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size", confidence: 80, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 92, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 90, notes: "stock x quantity price table", evidence: [] },
        requiredOptions: [option("Stock", { normalizedGroup: "stock", sampleValues: ["14pt", "16pt"] })],
        optionalOptions: [],
      },
      sourceText: [
        "Business Cards",
        "Stock: 14pt, 16pt",
        "Quantity: 250, 500, 1000",
        "Prices:",
        "14pt: 250 = 35.00, 500 = 55.00, 1000 = 90.00",
        "16pt: 250 = 40.00, 500 = 65.00, 1000 = 110.00",
      ].join("\n"),
      expectedFirstTierCents: 3500,
    },
    {
      label: "Postcards",
      expectedDimension: "size",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "Postcards", confidence: 94, evidence: [] },
          category: { value: "Postcards", confidence: 90, evidence: [] },
          productType: { value: "Flat Print", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 92, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 92, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 90, notes: "size x quantity price table", evidence: [] },
        requiredOptions: [option("Size", { normalizedGroup: "size", sampleValues: ["4x6", "5x7"] })],
        optionalOptions: [],
      },
      sourceText: [
        "Postcards",
        "Size: 4x6, 5x7",
        "Quantity: 100, 250, 500",
        "4x6: 100 = 30.00, 250 = 55.00, 500 = 90.00",
        "5x7: 100 = 40.00, 250 = 70.00, 500 = 120.00",
      ].join("\n"),
      expectedFirstTierCents: 3000,
    },
    {
      label: "Contour-Cut Stickers",
      expectedDimension: "cut_type",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "Contour-Cut Stickers", confidence: 94, evidence: [] },
          category: { value: "Stickers", confidence: 90, evidence: [] },
          productType: { value: "Sticker", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "custom_width_height", confidence: 90, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 92, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 90, notes: "cut type x quantity price table", evidence: [] },
        requiredOptions: [option("Cut Type", { normalizedGroup: "cut_type", sampleValues: ["Kiss Cut", "Die Cut"] })],
        optionalOptions: [],
      },
      sourceText: [
        "Contour-Cut Stickers",
        "Quantity: 25, 50, 100",
        "Kiss Cut: 25 = 18.00, 50 = 30.00, 100 = 48.00",
        "Die Cut: 25 = 22.00, 50 = 36.00, 100 = 58.00",
      ].join("\n"),
      expectedFirstTierCents: 1800,
    },
    {
      label: "13oz Banner",
      expectedDimension: "printed_sides",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "13oz Banner", confidence: 94, evidence: [] },
          category: { value: "Banners", confidence: 90, evidence: [] },
          productType: { value: "Banner", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "custom_size", confidence: 92, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 92, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 90, notes: "printed sides x quantity price table", evidence: [] },
        requiredOptions: [option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] })],
        optionalOptions: [],
      },
      sourceText: [
        "13oz Banner printed sides quantity price table.",
        "Quantity: 1, 5, 10",
        "Single Sided: 1 = 45.00, 5 = 40.00, 10 = 35.00",
        "Double Sided: 1 = 65.00, 5 = 60.00, 10 = 55.00",
      ].join("\n"),
      expectedFirstTierCents: 4500,
    },
    {
      label: ".040 Styrene Signs",
      expectedDimension: "size",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: ".040 Styrene Signs", confidence: 94, evidence: [] },
          category: { value: "Rigid Signs", confidence: 90, evidence: [] },
          productType: { value: "Styrene", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 92, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 92, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 90, notes: "size x quantity price table", evidence: [] },
        requiredOptions: [option("Size", { normalizedGroup: "size", sampleValues: ["12x18", "18x24"] })],
        optionalOptions: [],
      },
      sourceText: [
        ".040 Styrene Signs",
        "Quantity: 1, 10, 25",
        "12x18: 1 = 20.00, 10 = 18.00, 25 = 15.00",
        "18x24: 1 = 30.00, 10 = 26.00, 25 = 22.00",
      ].join("\n"),
      expectedFirstTierCents: 2000,
    },
  ])("generates high-confidence AI matrix draft for $label", ({ label, expectedDimension, briefOverrides, sourceText, expectedFirstTierCents }) => {
    const tree = buildProductIntakeDraftTree({
      brief: brief(briefOverrides as Partial<ProductIntakeBrief>),
      sessionId: `sess_matrix_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      productName: label,
      userId: "user_1",
      sourceText,
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoQuantityOption(tree);
    expectNoRuntimeArchitectureErrors(tree);
    expectNoPricingMatrixValidationErrors(tree);
    expect((tree as any).pricingMatrix).toMatchObject({
      dimensions: [expectedDimension],
      rows: expect.any(Array),
    });
    expect((tree as any).pricingMatrix.rows).toHaveLength(2);
    expect((tree as any).pricingMatrix.rows[0]).toMatchObject({
      when: { [expectedDimension]: expect.any(String) },
      tierBasis: "line_item_quantity",
    });
    expect((tree as any).pricingMatrix.rows[0].qtyTiers[0]).toMatchObject({
      minQty: expect.any(Number),
      perPieceCents: expectedFirstTierCents,
    });
    expect(tree.meta?.productIntake?.matrixReadiness).toMatchObject({
      required: true,
      noMatrixRowsGenerated: false,
      matrixConfidence: expect.any(Number),
    });
    expect(tree.meta?.productIntake?.matrixReadiness?.matrixConfidence).toBeGreaterThanOrEqual(85);
    expect(tree.meta?.productIntake?.matrixDraft).toMatchObject({
      generatedByAI: true,
      reviewRequired: true,
      dimensions: [expectedDimension],
      rows: expect.any(Array),
    });
    expect(tree.meta?.productIntake?.draftQuality?.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/pricing matrix draft was generated/i),
    ]));
  });

  test("generates PBV2 pricing matrix draft from exact 4mm Coroplast yard sign source", () => {
    const sourceText = [
      "4mm Coroplast Yard Signs",
      "",
      "This is a fixed-size yard sign product.",
      "",
      "Finished size:",
      '24" wide x 18" high',
      "",
      "Material:",
      "4mm white coroplast",
      "",
      "Production:",
      "Flatbed printed",
      "",
      "Proof approval:",
      "Required",
      "",
      "Customer options:",
      "Printed Sides:",
      "- Single Sided",
      "- Double Sided",
      "",
      "Optional add-on:",
      "- H-Wire Stakes",
      "",
      "Pricing type:",
      "PBV2 pricing matrix",
      "",
      "Matrix dimensions:",
      "- Printed Sides",
      "- Quantity Tier",
      "",
      "Important:",
      "Quantity is the quote/order line item quantity. Do not create Quantity as a product option.",
      'Size is fixed at 24" x 18". Do not create a Size option.',
      "",
      "Pricing matrix:",
      "",
      "Single Sided:",
      "1-100 signs = $4.40 each",
      "101-500 signs = $3.30 each",
      "501+ signs = $3.00 each",
      "",
      "Double Sided:",
      "1-100 signs = $5.50 each",
      "101-500 signs = $4.40 each",
      "501+ signs = $4.00 each",
    ].join("\n");
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "4mm Coroplast Yard Signs", confidence: 94, evidence: [] },
          category: { value: "Yard Signs", confidence: 90, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 85, evidence: [] },
        },
        materialAnalysis: {
          detectedMaterialReferences: ["4mm white coroplast"],
          likelyMaterialMatches: [{ materialId: "mat_coro", sku: "CORO4", name: "4mm White Coroplast", confidence: 90, evidence: [] }],
          confidence: 90,
          evidence: [],
        },
        sizeBehavior: { behavior: "fixed_size", confidence: 95, notes: '24" wide x 18" high', evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 95, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 92, notes: "PBV2 pricing matrix by printed sides and quantity tier", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ['24" x 18"'] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
        optionalOptions: [
          option("H-Wire Stakes", { normalizedGroup: "h_wire_stakes", required: false, sampleValues: ["No Stakes", "Include H-Wire Stakes"] }),
        ],
      }),
      sessionId: "sess_exact_yard_sign",
      productName: "4mm Coroplast Yard Signs",
      userId: "user_1",
      sourceText,
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoQuantityOption(tree);
    expect(inputNode(tree, "size")).toBeUndefined();
    expect(tree.meta?.requiresDimensions).toBe(false);
    expect(getPbv2FixedDimensions(tree)).toMatchObject({
      widthIn: 24,
      heightIn: 18,
      unit: "in",
      source: "product_intake",
    });
    expect(tree.meta?.productIntake?.size).toMatchObject({
      behavior: "fixed_dimensions",
      customerFacingOptionGenerated: false,
      fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" },
    });
    expect(inputNode(tree, "printed_sides")).toBeTruthy();
    expect(inputNode(tree, "h_wire_stakes")).toBeTruthy();
    expect(tree.meta?.productIntake?.matrixReadiness?.matrixConfidence).toBeGreaterThanOrEqual(85);
    expect(tree.meta?.productIntake?.matrixReadiness?.noMatrixRowsGenerated).toBe(false);
    expect(tree.meta?.productIntake?.matrixReadiness?.detectedQuantityBreaks).toEqual(expect.arrayContaining([1, 101, 501]));

    const matrix = (tree as any).pricingMatrix;
    expect(matrix).toMatchObject({ dimensions: ["printed_sides"] });
    expect(matrix.rows).toHaveLength(2);
    const single = matrix.rows.find((row: any) => row.when?.printed_sides === "single_sided");
    const double = matrix.rows.find((row: any) => row.when?.printed_sides === "double_sided");
    expect(single).toBeTruthy();
    expect(double).toBeTruthy();
    expect(single.qtyTiers.map((tier: any) => [tier.label, tier.perPieceCents])).toEqual([
      ["1-100", 440],
      ["101-500", 330],
      ["501+", 300],
    ]);
    expect(double.qtyTiers.map((tier: any) => [tier.label, tier.perPieceCents])).toEqual([
      ["1-100", 550],
      ["101-500", 440],
      ["501+", 400],
    ]);
    expect(tree.meta?.productIntake?.matrixDraft?.rows.map((row: any) => row.label)).toEqual(["Single Sided", "Double Sided"]);
  });

  test("generates selected matrix dimensions and rows for thickness plus printed sides", () => {
    const sourceText = [
      "4mm and 10mm Coroplast Yard Signs",
      "",
      "This is a fixed-size manufactured print product.",
      "",
      "Finished size:",
      '24" wide x 18" high',
      "",
      "Material:",
      "White coroplast",
      "",
      "Available thickness options:",
      "- 4mm Coroplast",
      "- 10mm Coroplast",
      "",
      "Customer options:",
      "Printed Sides:",
      "- Single Sided",
      "- Double Sided",
      "",
      "Material Thickness:",
      "- 4mm Coroplast",
      "- 10mm Coroplast",
      "",
      "Optional Add-On:",
      "- H-Wire Stakes",
      "",
      "Pricing type:",
      "PBV2 pricing matrix",
      "",
      "Matrix dimensions:",
      "- Printed Sides",
      "- Material Thickness",
      "- Quantity Tier",
      "",
      "Important rules:",
      "Quantity belongs on the quote/order line item. Do not create Quantity as a product option.",
      'Size is fixed at 24" x 18". Do not create a Size option.',
      "Do not ask for width or height during quote/order entry.",
      "H-Wire Stakes is an optional add-on and should not be part of the pricing matrix unless pricing varies by H-Wire Stakes.",
      "",
      "Pricing matrix:",
      "",
      "4mm Coroplast, Single Sided:",
      "1-100 signs = $4.40 each",
      "101-500 signs = $3.30 each",
      "501+ signs = $3.00 each",
      "",
      "4mm Coroplast, Double Sided:",
      "1-100 signs = $5.50 each",
      "101-500 signs = $4.40 each",
      "501+ signs = $4.00 each",
      "",
      "10mm Coroplast, Single Sided:",
      "1-100 signs = $8.40 each",
      "101-500 signs = $7.30 each",
      "501+ signs = $7.00 each",
      "",
      "10mm Coroplast, Double Sided:",
      "1-100 signs = $9.50 each",
      "101-500 signs = $8.40 each",
      "501+ signs = $8.00 each",
    ].join("\n");

    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "4mm and 10mm Coroplast Yard Signs", confidence: 94, evidence: [] },
          category: { value: "Yard Signs", confidence: 90, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size", confidence: 95, notes: '24" wide x 18" high', evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 95, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 94, notes: "PBV2 pricing matrix by material thickness, printed sides, and quantity tier", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ['24" x 18"'] }),
          option("Material Thickness", { normalizedGroup: "material_thickness", sampleValues: ["4mm Coroplast", "10mm Coroplast"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
        optionalOptions: [
          option("H-Wire Stakes", { normalizedGroup: "h_wire_stakes", required: false, sampleValues: ["No Stakes", "Include H-Wire Stakes"] }),
        ],
      }),
      sessionId: "sess_thickness_sides_yard_sign",
      productName: "4mm and 10mm Coroplast Yard Signs",
      userId: "user_1",
      sourceText,
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoQuantityOption(tree);
    expect(inputNode(tree, "size")).toBeUndefined();
    expect(inputNode(tree, "material_thickness")).toBeTruthy();
    expect(inputNode(tree, "printed_sides")).toBeTruthy();
    expect(inputNode(tree, "h_wire_stakes")).toBeTruthy();
    expect(getPbv2FixedDimensions(tree)).toMatchObject({ widthIn: 24, heightIn: 18, unit: "in" });

    const matrix = (tree as any).pricingMatrix;
    expect(matrix?.dimensions).toEqual(["material_thickness", "printed_sides"]);
    expect(matrix.dimensions).not.toContain("h_wire_stakes");
    expect(matrix.rows).toHaveLength(4);

    const rowFor = (thickness: string, sides: string) =>
      matrix.rows.find((row: any) => row.when?.material_thickness === thickness && row.when?.printed_sides === sides);

    expect(rowFor("4mm_coroplast", "single_sided").qtyTiers.map((tier: any) => tier.perPieceCents)).toEqual([440, 330, 300]);
    expect(rowFor("4mm_coroplast", "double_sided").qtyTiers.map((tier: any) => tier.perPieceCents)).toEqual([550, 440, 400]);
    expect(rowFor("10mm_coroplast", "single_sided").qtyTiers.map((tier: any) => tier.perPieceCents)).toEqual([840, 730, 700]);
    expect(rowFor("10mm_coroplast", "double_sided").qtyTiers.map((tier: any) => tier.perPieceCents)).toEqual([950, 840, 800]);
    expect(tree.meta?.productIntake?.matrixDraft?.dimensions).toEqual(["material_thickness", "printed_sides"]);
    expect(tree.meta?.productIntake?.matrixDraft?.rows.map((row: any) => row.label)).toEqual([
      "4mm Coroplast + Single Sided",
      "4mm Coroplast + Double Sided",
      "10mm Coroplast + Single Sided",
      "10mm Coroplast + Double Sided",
    ]);
  });

  test("generates formula product behavior for A1 Vinyl Stickers", () => {
    const sourceText = [
      "A1 Vinyl Stickers",
      "",
      "This is a custom-size roll-printed sticker and decal product.",
      "",
      "Material:",
      "A1 Vinyl",
      "",
      "Production Method:",
      "Roll Printing",
      "",
      "Artwork:",
      "Required",
      "",
      "Proof Approval:",
      "Required",
      "",
      "Size Configuration:",
      "Custom Width and Height",
      "",
      "Pricing Type:",
      "Formula Product",
      "",
      "Pricing Formula:",
      "",
      "Add 0.25 inches to the entered width.",
      "Add 0.25 inches to the entered height.",
      "",
      "Calculate square footage from the adjusted dimensions.",
      "",
      "Round the resulting square footage up to the next whole square foot.",
      "",
      "Use the rounded square footage for pricing.",
      "",
      "Formula equivalent:",
      "",
      "rounded_sqft =",
      "ceil(",
      "((width + 0.25)",
      "*",
      "(height + 0.25))",
      "/ 144",
      ")",
      "",
      "Customer Options:",
      "",
      "Laminate:",
      "- Glossy",
      "- Matte",
      "",
      "Contour Cutting:",
      "- No",
      "- Yes",
      "",
      "Pricing Impact:",
      "If Contour Cutting = Yes",
      "Add 10% to the base product price.",
      "",
      "Weed and Tape:",
      "- No",
      "- Yes",
      "",
      "Pricing Impact:",
      "If Weed and Tape = Yes",
      "Add 25% to the base product price.",
      "",
      "Business Rule:",
      "",
      "Weed and Tape is only available when Contour Cutting = Yes.",
      "",
      "If Contour Cutting = No:",
      "Hide Weed and Tape.",
      "",
      "If Contour Cutting = Yes:",
      "Show Weed and Tape.",
      "",
      "Important:",
      "",
      "This is NOT a pricing matrix product.",
      "",
      "Do not generate a pricing matrix.",
      "",
      "Do not generate matrix dimensions.",
      "",
      "Do not generate matrix rows.",
      "",
      "Use the PBV2 formula library.",
      "",
      "Generate pricing impacts for Contour Cutting and Weed and Tape.",
      "",
      "Generate the option rule that requires Contour Cutting before Weed and Tape can be selected.",
      "",
      "Quantity belongs on the quote/order line item.",
      "",
      "Do not create Quantity as a customer-facing option.",
      "",
      "Width and Height should be customer-entered dimensions.",
    ].join("\n");

    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "A1 Vinyl Stickers", confidence: 94, evidence: [] },
          category: { value: "Stickers", confidence: 90, evidence: [] },
          productType: { value: "stickers", confidence: 88, evidence: [] },
        },
        materialAnalysis: {
          detectedMaterialReferences: ["A1 Vinyl"],
          likelyMaterialMatches: [{ materialId: "mat_a1_vinyl", sku: "A1VINYL", name: "A1 Vinyl", confidence: 90, evidence: [] }],
          confidence: 90,
          evidence: [],
        },
        sizeBehavior: { behavior: "custom_size", confidence: 95, notes: "Custom width/height product", evidence: [] },
        quantityBehavior: { behavior: "per_piece", confidence: 85, evidence: [] },
        pricingAnalysis: { behavior: "formula", confidence: 92, notes: "Sticker-style adjusted rounded square-foot formula", evidence: [] },
        requiredOptions: [
          option("Laminate", { normalizedGroup: "laminate", sampleValues: ["Glossy", "Matte"] }),
          option("Contour Cutting", { normalizedGroup: "contour_cutting", sampleValues: ["No", "Yes"] }),
        ],
        optionalOptions: [
          option("Weed and Tape", { normalizedGroup: "weed_and_tape", required: false, sampleValues: ["No", "Yes"] }),
        ],
      }),
      sessionId: "sess_a1_vinyl",
      productName: "A1 Vinyl Stickers",
      userId: "user_1",
      sourceText,
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoQuantityOption(tree);
    expect(tree.meta?.requiresDimensions).toBe(true);
    expectNoGeneratedSizeOption(tree);
    expect(tree.meta?.productIntake?.size).toMatchObject({
      behavior: "custom_dimensions",
      customerFacingOptionGenerated: false,
    });
    expect((tree as any).pricingMatrix).toBeUndefined();
    expect(tree.meta?.productIntake?.matrixReadiness?.required).toBe(false);
    expect(tree.meta?.productIntake?.productClassification?.type).toBe("FORMULA_PRODUCT");
    expect(tree.meta?.pricingFormula).toBe("ceil(((w + 0.25) * (h + 0.25)) * q / 144) * base_price");
    expect(tree.meta?.productIntake?.formulaAssignment?.code).toBe("STICKER_ADJUSTED_ROUNDED_SQFT");

    const laminate = inputNode(tree, "laminate");
    const contour = inputNode(tree, "contour_cutting");
    const weed = inputNode(tree, "weed_and_tape");
    expect(laminate?.choices?.map((choice: any) => choice.label)).toEqual(["Glossy", "Matte"]);
    expect(contour?.choices?.map((choice: any) => choice.label)).toEqual(["No", "Yes"]);
    expect(weed?.choices?.map((choice: any) => choice.label)).toEqual(["No", "Yes"]);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Lamination", "Cutting", "Application Prep"]));

    const contourYes = contour.choices.find((choice: any) => choice.value === "yes");
    const weedYes = weed.choices.find((choice: any) => choice.value === "yes");
    expect(contourYes.pricingImpact).toEqual([{ mode: "addPercent", percent: 10, basis: "base", label: "Contour Cutting surcharge" }]);
    expect(weedYes.pricingImpact).toEqual([{ mode: "addPercent", percent: 25, basis: "base", label: "Weed and Tape surcharge" }]);
    expect((tree as any).rules).toEqual([expect.objectContaining({
      id: "rule_contour_cutting_weed_and_tape",
      when: { all: [{ optionGroup: "contour_cutting", operator: "equals", value: "yes" }] },
      then: [{ action: "show", targetOptionGroup: "weed_and_tape" }],
      else: [
        { action: "hide", targetOptionGroup: "weed_and_tape" },
        { action: "clear", targetOptionGroup: "weed_and_tape" },
      ],
    })]);

    const pricedTree = {
      ...tree,
      meta: {
        ...tree.meta,
        pricingV2: { base: { perSqftCents: 5000 } },
      },
    };
    const priceWithSelections = (selections: Record<string, { value: unknown }>) => evaluatePricingPreviewFromTree({
      treeJson: pricedTree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        laminate: { value: "glossy" },
        ...selections,
      },
      debug: true,
    });
    expect(priceWithSelections({ contour_cutting: { value: "no" }, weed_and_tape: { value: "no" } }).totalPrice).toBeCloseTo(100, 2);
    expect(priceWithSelections({ contour_cutting: { value: "yes" }, weed_and_tape: { value: "no" } }).totalPrice).toBeCloseTo(110, 2);
    expect(priceWithSelections({ contour_cutting: { value: "yes" }, weed_and_tape: { value: "yes" } }).totalPrice).toBeCloseTo(135, 2);
    expect(priceWithSelections({ contour_cutting: { value: "no" }, weed_and_tape: { value: "yes" } }).totalPrice).toBeCloseTo(100, 2);
  });

  test("applies A1 Vinyl pricing impacts and rules to reused template option keys", () => {
    const sourceText = [
      "A1 Vinyl Stickers custom width and height formula product.",
      "rounded_sqft = ceil(((width + 0.25) * (height + 0.25)) / 144).",
      "Contour Cutting: No, Yes. If Contour Cutting = Yes Add 10% to the base product price.",
      "Weed and Tape: No, Yes. If Weed and Tape = Yes Add 25% to the base product price.",
      "Weed and Tape is only available when Contour Cutting = Yes.",
      "This is NOT a pricing matrix product.",
    ].join("\n");

    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "A1 Vinyl Stickers", confidence: 94, evidence: [] },
          category: { value: "Stickers", confidence: 90, evidence: [] },
          productType: { value: "stickers", confidence: 88, evidence: [] },
        },
        sizeBehavior: { behavior: "custom_size", confidence: 95, notes: "Custom width/height product", evidence: [] },
        pricingAnalysis: { behavior: "formula", confidence: 92, notes: "Sticker-style adjusted rounded square-foot formula", evidence: [] },
        requiredOptions: [
          option("Laminate", { normalizedGroup: "laminate", sampleValues: ["Glossy", "Matte"] }),
          option("Contour Cutting", { normalizedGroup: "contour_cutting", sampleValues: ["No", "Yes"], source: "reusable_template", reuseTemplateId: "tpl_contour" }),
        ],
        optionalOptions: [
          option("Weed and Tape", { normalizedGroup: "weed_and_tape", required: false, sampleValues: ["No", "Yes"], source: "reusable_template", reuseTemplateId: "tpl_weed" }),
        ],
        templateMatches: [
          { templateId: "tpl_contour", name: "Contour Cutting", slug: "contour-cutting", category: "cutting", score: 0.96, recommendation: "suggest_reuse", matchedSignals: [], evidence: [] },
          { templateId: "tpl_weed", name: "Weed and Tape", slug: "weed-and-tape", category: "application_prep", score: 0.96, recommendation: "suggest_reuse", matchedSignals: [], evidence: [] },
        ],
      }),
      sessionId: "sess_a1_vinyl_templates",
      productName: "A1 Vinyl Stickers",
      userId: "user_1",
      sourceText,
      templates: [
        {
          id: "tpl_contour",
          templateTree: {
            schemaVersion: 2,
            rootGroupId: "group_contour",
            rootNodeIds: ["group_contour"],
            nodes: {
              group_contour: { id: "group_contour", kind: "group", type: "GROUP", label: "Cutting" },
              node_contour: {
                id: "node_contour",
                kind: "question",
                type: "INPUT",
                label: "Contour Cutting",
                key: "contour_cutting",
                input: { type: "select", required: true, selectionKey: "contour_cutting" },
                choices: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
              },
            },
            edges: [{ id: "edge_contour", fromNodeId: "group_contour", toNodeId: "node_contour" }],
          },
        },
        {
          id: "tpl_weed",
          templateTree: {
            schemaVersion: 2,
            rootGroupId: "group_weed",
            rootNodeIds: ["group_weed"],
            nodes: {
              group_weed: { id: "group_weed", kind: "group", type: "GROUP", label: "Application Prep" },
              node_weed: {
                id: "node_weed",
                kind: "question",
                type: "INPUT",
                label: "Weed and Tape",
                key: "weed_and_tape",
                input: { type: "select", required: false, selectionKey: "weed_and_tape" },
                choices: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
              },
            },
            edges: [{ id: "edge_weed", fromNodeId: "group_weed", toNodeId: "node_weed" }],
          },
        },
      ],
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoQuantityOption(tree);
    const contour = nodes(tree).find((node) => node.input?.selectionKey?.startsWith("contour_cutting__"));
    const weed = nodes(tree).find((node) => node.input?.selectionKey?.startsWith("weed_and_tape__"));
    expect(contour).toBeTruthy();
    expect(weed).toBeTruthy();
    expect(nodes(tree).filter((node) => node.label === "Contour Cutting" && node.kind === "question" && node.input)).toHaveLength(1);
    expect(nodes(tree).filter((node) => node.label === "Weed and Tape" && node.kind === "question" && node.input)).toHaveLength(1);

    const contourKey = contour.input.selectionKey;
    const weedKey = weed.input.selectionKey;
    expect(contour.choices.find((choice: any) => choice.value === "yes")?.pricingImpact).toEqual([
      { mode: "addPercent", percent: 10, basis: "base", label: "Contour Cutting surcharge" },
    ]);
    expect(weed.choices.find((choice: any) => choice.value === "yes")?.pricingImpact).toEqual([
      { mode: "addPercent", percent: 25, basis: "base", label: "Weed and Tape surcharge" },
    ]);
    expect((tree as any).rules).toEqual([expect.objectContaining({
      id: "rule_contour_cutting_weed_and_tape",
      when: { all: [{ optionGroup: contourKey, operator: "equals", value: "yes" }] },
      then: [{ action: "show", targetOptionGroup: weedKey }],
      else: [
        { action: "hide", targetOptionGroup: weedKey },
        { action: "clear", targetOptionGroup: weedKey },
      ],
    })]);

    const pricedTree = { ...tree, meta: { ...tree.meta, pricingV2: { base: { perSqftCents: 5000 } } } };
    const priceWithSelections = (selections: Record<string, { value: unknown }>) => evaluatePricingPreviewFromTree({
      treeJson: pricedTree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        laminate: { value: "glossy" },
        ...selections,
      },
      debug: true,
    });
    expect(priceWithSelections({ [contourKey]: { value: "no" }, [weedKey]: { value: "no" } }).totalPrice).toBeCloseTo(100, 2);
    expect(priceWithSelections({ [contourKey]: { value: "yes" }, [weedKey]: { value: "no" } }).totalPrice).toBeCloseTo(110, 2);
    expect(priceWithSelections({ [contourKey]: { value: "yes" }, [weedKey]: { value: "yes" } }).totalPrice).toBeCloseTo(135, 2);
    expect(priceWithSelections({ [contourKey]: { value: "no" }, [weedKey]: { value: "yes" } }).totalPrice).toBeCloseTo(100, 2);
  });

  test("uses saved matrix answers to generate draft rows when source matrix is incomplete", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "4mm Coroplast Yard Signs", confidence: 94, evidence: [] },
          category: { value: "Yard Signs", confidence: 90, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size", confidence: 95, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 80, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 77, notes: "Printed Sides by quantity tier matrix. Prices missing.", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["24x18"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
        optionalOptions: [],
      }),
      sessionId: "sess_answered_matrix",
      productName: "4mm Coroplast Yard Signs",
      userId: "user_1",
      sourceText: "4mm Coroplast Yard Signs. Printed Sides pricing matrix by quantity tier; source prices are missing.",
      answers: [
        { questionKey: "confirm-matrix-dimension", answer: "printed_sides" },
        { questionKey: "confirm-matrix-quantity-tiers", answer: "1-100, 101-500, 501+" },
        { questionKey: "matrix-price-printed_sides-single_sided-1_100", answer: 4.4 },
        { questionKey: "matrix-price-printed_sides-single_sided-101_500", answer: 3.3 },
        { questionKey: "matrix-price-printed_sides-single_sided-501", answer: 3 },
        { questionKey: "matrix-price-printed_sides-double_sided-1_100", answer: 5.5 },
        { questionKey: "matrix-price-printed_sides-double_sided-101_500", answer: 4.4 },
        { questionKey: "matrix-price-printed_sides-double_sided-501", answer: 4 },
      ],
    });

    const matrix = (tree as any).pricingMatrix;
    expect(matrix?.dimensions).toEqual(["printed_sides"]);
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows.find((row: any) => row.when.printed_sides === "single_sided").qtyTiers.map((tier: any) => tier.perPieceCents)).toEqual([440, 330, 300]);
    expect(matrix.rows.find((row: any) => row.when.printed_sides === "double_sided").qtyTiers.map((tier: any) => tier.perPieceCents)).toEqual([550, 440, 400]);
  });

  test.each([
    {
      label: "4mm Coroplast Yard Signs",
      expectedType: "SIZE_QUANTITY",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "4mm Coroplast Yard Signs", confidence: 94, evidence: [] },
          category: { value: "Yard Signs", confidence: 90, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 92, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 90, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 82, notes: "size x quantity", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["12x18", "18x24", "24x36"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
      },
      sourceText: "4mm Coroplast Yard Signs with sizes 12x18, 18x24, 24x36 and quantity breaks 1, 5, 10, 25, 50, 100.",
    },
    {
      label: "Contour-Cut Stickers",
      expectedType: "QUANTITY_TIER",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "Contour-Cut Stickers", confidence: 92, evidence: [] },
          category: { value: "Stickers", confidence: 90, evidence: [] },
          productType: { value: "Sticker", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "custom_width_height", confidence: 88, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 88, evidence: [] },
        pricingAnalysis: { behavior: "quantity_tiers", confidence: 82, notes: "size x quantity tier pricing", evidence: [] },
        requiredOptions: [option("Cut Type", { normalizedGroup: "cut_type", sampleValues: ["Contour Cut", "Square Cut"] })],
        optionalOptions: [option("Laminate", { normalizedGroup: "laminate", required: false, sampleValues: ["None", "Gloss", "Matte"] })],
      },
      sourceText: "Contour-cut stickers use custom sizes and quantity breaks 25, 50, 100, 250.",
    },
    {
      label: "Business Cards",
      expectedType: "MULTI_DIMENSION",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "Business Cards", confidence: 92, evidence: [] },
          category: { value: "Business Cards", confidence: 90, evidence: [] },
          productType: { value: "Flat Print", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size", confidence: 80, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 90, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 84, notes: "quantity x stock x coating", evidence: [] },
        requiredOptions: [
          option("Stock", { normalizedGroup: "stock", sampleValues: ["14pt", "16pt"] }),
          option("Coating", { normalizedGroup: "coating", sampleValues: ["None", "UV"] }),
        ],
      },
      sourceText: "Business Cards quantity x stock x coating price table. Quantity breaks 250, 500, 1000.",
    },
    {
      label: "Postcards",
      expectedType: "MULTI_DIMENSION",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "Postcards", confidence: 92, evidence: [] },
          category: { value: "Postcards", confidence: 90, evidence: [] },
          productType: { value: "Flat Print", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 90, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 90, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 84, notes: "size x quantity x stock", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["4x6", "5x7"] }),
          option("Stock", { normalizedGroup: "stock", sampleValues: ["100lb Cover", "14pt"] }),
        ],
      },
      sourceText: "Postcards size x quantity x stock pricing grid. Quantity breaks 100, 250, 500.",
    },
    {
      label: "13oz Banner",
      expectedType: "NONE",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: "13oz Banner", confidence: 92, evidence: [] },
          category: { value: "Banners", confidence: 90, evidence: [] },
          productType: { value: "Banner", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "custom_size", confidence: 90, evidence: [] },
        quantityBehavior: { behavior: "per_piece", confidence: 70, evidence: [] },
        pricingAnalysis: { behavior: "square_foot", confidence: 90, notes: "$5.00 per sqft", evidence: [] },
      },
      sourceText: "13oz Banner custom size priced at $5.00 per sqft with minimum $25.",
    },
    {
      label: ".040 Styrene Signs",
      expectedType: "SIZE_QUANTITY",
      briefOverrides: {
        productIdentity: {
          likelyProductName: { value: ".040 Styrene Signs", confidence: 92, evidence: [] },
          category: { value: "Rigid Signs", confidence: 90, evidence: [] },
          productType: { value: "Styrene", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 90, evidence: [] },
        quantityBehavior: { behavior: "quantity tiers", confidence: 84, evidence: [] },
        pricingAnalysis: { behavior: "matrix_or_tiered", confidence: 80, notes: "size x quantity", evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["12x18", "18x24", "24x36"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
      },
      sourceText: ".040 Styrene Signs sizes 12x18, 18x24, 24x36 with quantity breaks 1, 10, 25, 50.",
    },
  ])("detects matrix readiness for $label without generating matrix rows", ({ label, expectedType, briefOverrides, sourceText }) => {
    const tree = buildProductIntakeDraftTree({
      brief: brief(briefOverrides as Partial<ProductIntakeBrief>),
      sessionId: `sess_${label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      productName: label,
      userId: "user_1",
      sourceText,
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoQuantityOption(tree);
    expect(tree).not.toHaveProperty("pricingMatrix");
    expect(tree.meta).not.toHaveProperty("pricingMatrix");
    const matrixReadiness = tree.meta?.productIntake?.matrixReadiness;
    expect(matrixReadiness?.matrixType).toBe(expectedType);
    expect(matrixReadiness?.noMatrixRowsGenerated).toBe(true);
    if (expectedType === "NONE") {
      expect(matrixReadiness?.required).toBe(false);
    } else {
      expect(matrixReadiness?.required).toBe(true);
      expect(matrixReadiness?.matrixConfidence).toBeGreaterThanOrEqual(60);
      expect(matrixReadiness?.recommendedSetup).toMatch(/PBV2|quantity tiers/i);
    }
  });

  test("reuses explicitly selected templates without creating template records", () => {
    const templateBrief = brief({
      requiredOptions: [option("Printed Sides", {
        normalizedGroup: "printed_sides",
        sampleValues: ["Single Sided", "Double Sided"],
        source: "reusable_template",
        reuseTemplateId: "tpl_printed_sides",
        templateMatches: [{
          templateId: "tpl_printed_sides",
          name: "Printed Sides",
          slug: "printed-sides",
          category: "print",
          score: 0.96,
          recommendation: "suggest_reuse",
          matchedSignals: ["printed sides"],
          evidence: [],
        }],
      })],
      templateMatches: [{
        templateId: "tpl_printed_sides",
        name: "Printed Sides",
        slug: "printed-sides",
        category: "print",
        score: 0.96,
        recommendation: "suggest_reuse",
        matchedSignals: ["printed sides"],
        evidence: [],
      }],
      optionalOptions: [],
    });
    const tree = buildProductIntakeDraftTree({
      brief: templateBrief,
      sessionId: "sess_1",
      productName: "13oz Banner",
      userId: "user_1",
      templates: [{
        id: "tpl_printed_sides",
        templateTree: {
          schemaVersion: 2,
          rootGroupId: "group_printed_sides",
          rootNodeIds: ["group_printed_sides"],
          nodes: {
            group_printed_sides: { id: "group_printed_sides", kind: "group", type: "GROUP", label: "Printed Sides" },
            node_printed_sides: {
              id: "node_printed_sides",
              kind: "question",
              type: "INPUT",
              label: "Printed Sides",
              key: "printed_sides",
              input: { type: "select", required: true, selectionKey: "printed_sides" },
              choices: [{ value: "single", label: "Single Sided" }, { value: "double", label: "Double Sided" }],
            },
          },
          edges: [{ id: "edge_1", fromNodeId: "group_printed_sides", toNodeId: "node_printed_sides" }],
        },
      }],
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectNoRuntimeArchitectureErrors(tree);
    expect(Object.values(tree.nodes).some((node: any) => node.meta?.templateSource?.sourceTemplateId === "tpl_printed_sides")).toBe(true);
    expect(nodes(tree).filter((node) => node.label === "Printed Sides" && node.kind === "question" && node.input).length).toBe(1);
    expect(tree.meta?.productIntake?.draftQuality?.reasons.some((reason) => /generic option/.test(reason))).toBe(true);
  });

  test("Coroplast yard signs use fixed size dropdown only with logical groups", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "4mm Coroplast Yard Signs", confidence: 94, evidence: [] },
          category: { value: "Yard Signs", confidence: 90, evidence: [] },
          productType: { value: "Rigid Sign", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "fixed_size_list", confidence: 92, evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["12x18", "18x24", "24x36"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
        optionalOptions: [
          option("H-Wire Stakes", { normalizedGroup: "h_wire_stakes", required: false, sampleValues: ["None", "Include Stakes"] }),
        ],
      }),
      sessionId: "sess_coro",
      productName: "4mm Coroplast Yard Signs",
      userId: "user_1",
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectGeneratedDraftShape(tree);
    expect(inputNode(tree, "size")?.input?.type).toBe("select");
    expect(inputNode(tree, "size")?.choices?.map((choice: any) => choice.label)).toEqual(["12x18", "18x24", "24x36"]);
    expect(nodes(tree).some((node) => node.input?.selectionKey === "size" && node.input?.type === "dimension")).toBe(false);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Print Setup", "Hardware"]));
    expect(inputNode(tree, "h_wire_stakes")).toBeTruthy();
  });

  test("banner custom-size drafts use line-item dimensions and finishing groups", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        requiredOptions: [
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
        optionalOptions: [
          option("Grommets", { normalizedGroup: "grommets", required: false, sampleValues: ["None", "Corners"] }),
          option("Pole Pockets", { normalizedGroup: "pole_pockets", required: false, sampleValues: ["None", "Top", "Top and Bottom"] }),
        ],
      }),
      sessionId: "sess_banner",
      productName: "13oz Banner",
      userId: "user_1",
    });

    expect(validateOptionTreeV2(tree).ok).toBe(true);
    expectGeneratedDraftShape(tree);
    expect(tree.meta?.requiresDimensions).toBe(true);
    expectNoGeneratedSizeOption(tree);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Print Setup", "Finishing"]));
    expect(inputNode(tree, "grommets")).toBeTruthy();
    expect(inputNode(tree, "pole_pockets")).toBeTruthy();
  });

  test("styrene fixed size drafts do not create dimension size controls", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: ".040 Styrene Signs", confidence: 90, evidence: [] },
          category: { value: "Rigid Signs", confidence: 90, evidence: [] },
          productType: { value: "Styrene", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "standard_fixed_sizes", confidence: 90, evidence: [] },
        requiredOptions: [
          option("Size", { normalizedGroup: "size", sampleValues: ["8x10", "11x14", "18x24"] }),
          option("Printed Sides", { normalizedGroup: "printed_sides", sampleValues: ["Single Sided", "Double Sided"] }),
        ],
      }),
      sessionId: "sess_styrene",
      productName: ".040 Styrene Signs",
      userId: "user_1",
    });

    expect(inputNode(tree, "size")?.input?.type).toBe("select");
    expectGeneratedDraftShape(tree);
    expect(nodes(tree).some((node) => node.input?.selectionKey === "size" && node.input?.type === "dimension")).toBe(false);
  });

  test("contour-cut sticker custom-size drafts use line-item dimensions and finishing options", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "Contour-Cut Stickers", confidence: 92, evidence: [] },
          category: { value: "Stickers", confidence: 90, evidence: [] },
          productType: { value: "Sticker", confidence: 85, evidence: [] },
        },
        requiredOptions: [
          option("Cut Type", { normalizedGroup: "cut_type", sampleValues: ["Contour Cut", "Square Cut"] }),
        ],
        optionalOptions: [
          option("Laminate", { normalizedGroup: "laminate", required: false, sampleValues: ["None", "Gloss", "Matte"] }),
        ],
      }),
      sessionId: "sess_sticker",
      productName: "Contour-Cut Stickers",
      userId: "user_1",
    });

    expect(tree.meta?.requiresDimensions).toBe(true);
    expectNoGeneratedSizeOption(tree);
    expectGeneratedDraftShape(tree);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Cutting", "Lamination"]));
    expect(inputNode(tree, "cut_type")).toBeTruthy();
    expect(inputNode(tree, "laminate")).toBeTruthy();
  });

  test("acrylic custom-size drafts use line-item dimensions only", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "3mm Acrylic Signs", confidence: 92, evidence: [] },
          category: { value: "Rigid Signs", confidence: 90, evidence: [] },
          productType: { value: "Acrylic", confidence: 85, evidence: [] },
        },
        sizeBehavior: { behavior: "custom_width_height", confidence: 90, evidence: [] },
        optionalOptions: [
          option("Standoffs", { normalizedGroup: "standoffs", required: false, sampleValues: ["None", "Include Standoffs"] }),
        ],
      }),
      sessionId: "sess_acrylic",
      productName: "3mm Acrylic Signs",
      userId: "user_1",
    });

    expect(tree.meta?.requiresDimensions).toBe(true);
    expectNoGeneratedSizeOption(tree);
    expectGeneratedDraftShape(tree);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Hardware"]));
  });

  test("quantity-like intake options are preserved as metadata instead of customer-facing PBV2 options", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        optionalOptions: [
          option("Quantity Tiers", {
            normalizedGroup: "quantity_tiers",
            required: false,
            sampleValues: ["1", "10", "25", "100"],
            sourcePaths: ["$.pricing.quantity_tiers"],
          }),
          option("Grommets", { normalizedGroup: "grommets", required: false, sampleValues: ["None", "Corners"] }),
        ],
      }),
      sessionId: "sess_quantity",
      productName: "Quantity Metadata Draft",
      userId: "user_1",
    });

    expectGeneratedDraftShape(tree);
    expect(inputNode(tree, "grommets")).toBeTruthy();
    expect((tree.meta?.productIntake as any)?.quantity?.sourceOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Quantity Tiers",
        sampleValues: ["1", "10", "25", "100"],
        sourcePaths: ["$.pricing.quantity_tiers"],
      }),
    ]));
  });

  test("builds a Polystyrene product with brand-new product-specific priced options", () => {
    const productSpecific = (label: string, normalizedGroup: string, choices: ProductIntakeBrief["requiredOptions"][number]["choices"]) => option(label, {
      normalizedGroup,
      source: "product_specific",
      selectionMode: "single",
      pricingRequired: true,
      sampleValues: choices?.map((choice) => choice.label) ?? [],
      choices,
      templateMatches: [],
    });
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        productIdentity: {
          likelyProductName: { value: "Polystyrene Signs", confidence: 96, evidence: [] },
          category: { value: "Rigid Signs", confidence: 90, evidence: [] },
          productType: { value: "Polystyrene", confidence: 90, evidence: [] },
        },
        requiredOptions: [
          productSpecific("Thickness", "thickness", [
            { value: "020", label: ".020", pricing: { mode: "set_per_sqft", amount: 3.5 } },
            { value: "030", label: ".030", pricing: { mode: "set_per_sqft", amount: 4 } },
            { value: "040", label: ".040", pricing: { mode: "set_per_sqft", amount: 4.5 } },
            { value: "060", label: ".060", pricing: { mode: "set_per_sqft", amount: 5.5 } },
            { value: "080", label: ".080", pricing: { mode: "set_per_sqft", amount: 6.5 } },
          ]),
          productSpecific("Print Sides", "printed_sides", [
            { value: "single_sided", label: "Single-Sided", pricing: { mode: "none" } },
            { value: "double_sided", label: "Double-Sided", pricing: { mode: "add_percent", amount: 25 } },
          ]),
          productSpecific("Contour Cutting", "contour_cutting", [
            { value: "no", label: "No", pricing: { mode: "none" } },
            { value: "yes", label: "Yes", pricing: { mode: "add_percent", amount: 10 } },
          ]),
          productSpecific("Grommets", "grommets", [
            { value: "none", label: "None", pricing: { mode: "none" } },
            { value: "corners", label: "Corners", pricing: { mode: "add_per_piece", amount: 1 } },
          ]),
        ],
        optionalOptions: [],
        templateMatches: [],
      }),
      sessionId: "sess_polystyrene_custom",
      productName: "Polystyrene Signs",
      userId: "user_1",
      templates: [],
    });

    expect(inputNode(tree, "thickness")?.choices).toHaveLength(5);
    expect(inputNode(tree, "printed_sides")?.choices.map((choice: any) => choice.label)).toEqual(["Single-Sided", "Double-Sided"]);
    expect(inputNode(tree, "contour_cutting")).toBeTruthy();
    expect(inputNode(tree, "grommets")).toBeTruthy();
    expect(nodes(tree).some((node) => node.sourceTemplateId)).toBe(false);

    const pricedTree = {
      ...tree,
      meta: { ...tree.meta, pricingV2: { base: { perSqftCents: 100 } } },
    };
    const preview = evaluatePricingPreviewFromTree({
      treeJson: pricedTree,
      widthIn: 12,
      heightIn: 12,
      quantity: 1,
      pbv2ExplicitSelections: {
        thickness: { value: "040" },
        printed_sides: { value: "double_sided" },
        contour_cutting: { value: "yes" },
        grommets: { value: "corners" },
      },
      debug: true,
    });
    expect(preview.totalPrice).toBeCloseTo(7.08, 2);
  });

  test("keeps generated default choices separate from cleaned customer-facing labels", () => {
    const tree = buildProductIntakeDraftTree({
      brief: brief({
        requiredOptions: [],
        optionalOptions: [option("Grommets", {
          normalizedGroup: "grommets",
          required: false,
          source: "product_specific",
          selectionMode: "single",
          pricingRequired: true,
          choices: [
            { value: "no (default option)", label: "no (default option)", pricing: { mode: "none" } },
            { value: "yes", label: "yes", pricing: { mode: "add_per_grommet", amount: null } },
          ],
        })],
      }),
      answers: [
        { questionKey: "custom-option-grommets-pricing-model", answer: "add_per_grommet" },
        { questionKey: "custom-option-grommets-pricing-values", answer: ".25 per grommet" },
        { questionKey: "custom-option-grommets-default-choice", answer: "no" },
      ],
      sessionId: "sess_grommets_default",
      productName: "Grommet Signs",
      userId: "user_1",
    });

    const grommetNode = inputNode(tree, "grommets");
    expect(grommetNode?.choices?.map((choice: any) => choice.label)).toEqual(["no", "yes"]);
    expect(grommetNode?.choices?.map((choice: any) => choice.value)).toEqual(["no", "yes"]);
    expect(grommetNode?.input?.defaultValue).toBe("no");
    expect(grommetNode?.choices?.some((choice: any) => /default option/i.test(choice.label))).toBe(false);
  });

  test("blocks incomplete product-specific option pricing until valid answers are supplied", () => {
    const intakeBrief = brief({
      requiredOptions: [option("Lamination", {
        normalizedGroup: "lamination",
        source: "product_specific",
        selectionMode: "single",
        pricingRequired: true,
        sampleValues: ["None", "Gloss"],
        choices: [
          { value: "none", label: "None", pricing: { mode: "none" } },
          { value: "gloss", label: "Gloss", pricing: { mode: "add_per_sqft", amount: null } },
        ],
      })],
      optionalOptions: [],
    });

    expect(validateProductIntakeCustomOptions(intakeBrief)).toEqual([
      "Lamination: pricing is required for Gloss.",
    ]);
    expect(validateProductIntakeCustomOptions(intakeBrief, [
      { questionKey: "custom-option-lamination-pricing-model", answer: "add_per_sqft" },
      { questionKey: "custom-option-lamination-pricing-values", answer: "Gloss=1.25" },
    ])).toEqual([]);
  });
});
