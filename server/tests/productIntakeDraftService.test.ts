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
    expect(tree.rootNodeIds.length).toBeGreaterThanOrEqual(4);
    expect(Object.values(tree.nodes).some((node: any) => node.input?.selectionKey === "size" && node.input?.type === "dimension")).toBe(true);
    expect(Object.values(tree.nodes).some((node: any) => node.input?.selectionKey === "quantity" && node.input?.type === "number")).toBe(true);
    expect(Object.values(tree.nodes).some((node: any) => node.input?.selectionKey === "printed_sides" && node.input?.required === true)).toBe(true);
    expect(Object.values(tree.nodes).some((node: any) => node.input?.selectionKey === "grommets" && node.input?.required === false)).toBe(true);
  });

  test("reuses suggested templates without creating template records", () => {
    const templateBrief = brief({
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
      requiredOptions: [],
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
  });
});
