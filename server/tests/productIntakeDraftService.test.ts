import { describe, expect, test } from "@jest/globals";
import { validateOptionTreeV2 } from "../../shared/optionTreeV2";
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
    expect(tree.schemaVersion).toBe(2);
    expect(tree.meta?.requiresDimensions).toBe(true);
    expect(tree.meta?.notes).toContain("Product Intake session sess_1");
    expect(tree.meta?.productIntake?.draftQuality?.label).toMatch(/Excellent|Good|Needs Review/);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Print Setup", "Finishing"]));
    expect(inputNode(tree, "size")?.input?.type).toBe("dimension");
    expect(inputNode(tree, "quantity")?.input?.type).toBe("number");
    expect(inputNode(tree, "printed_sides")?.input?.required).toBe(true);
    expect(inputNode(tree, "grommets")?.input?.required).toBe(false);
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
    expect(nodes(tree).some((node) => node.input?.selectionKey === "size" && node.input?.type === "select")).toBe(false);
    expect(groupLabels(tree)).toEqual(expect.arrayContaining(["Size & Quantity", "Hardware"]));
  });
});
