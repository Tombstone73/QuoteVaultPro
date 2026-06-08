import { describe, expect, test } from "@jest/globals";
import { validateOptionTreeV2 } from "../../shared/optionTreeV2";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "../../shared/pbv2/validator";
import { validateTreeHasBasePrice } from "../../shared/pbv2/validator/validateBasePrice";
import type { ProductIntakeBrief } from "../../shared/productIntakeWizardSchemas";
import {
  buildProductIntakeDraftTree,
  buildProductIntakeProductValues,
} from "../services/productIntakeWizard/productIntakeDraftService";

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
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Print Setup", "Finishing"]));
    expect(inputNode(tree, "size")?.input?.type).toBe("dimension");
    expect(inputNode(tree, "quantity")).toBeUndefined();
    expect(inputNode(tree, "printed_sides")?.input?.required).toBe(true);
    expect(inputNode(tree, "grommets")?.input?.required).toBe(false);
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
    expect(tree.meta?.productIntake?.draftQuality?.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/Matrix pricing is likely required/),
    ]));
    expect(validateTreeHasBasePrice(tree).errors.map((finding) => finding.code)).toContain("PBV2_E_BASE_PRICE_MISSING");
    expectNoQuantityOption(tree);
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
      expectedType: "SIZE_QUANTITY",
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

  test("reuses suggested templates without creating template records", () => {
    const templateBrief = brief({
      requiredOptions: [option("Printed Sides", {
        normalizedGroup: "printed_sides",
        sampleValues: ["Single Sided", "Double Sided"],
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

  test("banner drafts use custom dimension size only and finishing groups", () => {
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
    expect(inputNode(tree, "size")?.input?.type).toBe("dimension");
    expect(nodes(tree).some((node) => node.input?.selectionKey === "size" && node.input?.type === "select")).toBe(false);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Print Setup", "Finishing"]));
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

  test("contour-cut sticker drafts use dimension size and finishing options", () => {
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

    expect(inputNode(tree, "size")?.input?.type).toBe("dimension");
    expectGeneratedDraftShape(tree);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Finishing"]));
    expect(inputNode(tree, "cut_type")).toBeTruthy();
    expect(inputNode(tree, "laminate")).toBeTruthy();
  });

  test("acrylic sign drafts use dimension size only", () => {
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

    expect(inputNode(tree, "size")?.input?.type).toBe("dimension");
    expectGeneratedDraftShape(tree);
    expect(nodes(tree).some((node) => node.input?.selectionKey === "size" && node.input?.type === "select")).toBe(false);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Hardware"]));
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
});
