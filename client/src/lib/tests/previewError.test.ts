import { describe, expect, test } from "@jest/globals";
import {
  normalizePreviewError,
  buildClientPreviewError,
  buildUnexpectedPreviewError,
  categorizePreviewDetails,
  findMissingRequiredSelections,
  parsePreviewPath,
  enrichPreviewDetail,
  buildPreviewErrorSummary,
  PBV2_PREVIEW_CLIENT_VALIDATION,
} from "../pbv2/pricing/previewError";

describe("normalizePreviewError", () => {
  test("generic invalid preview error (message only) can be expanded", () => {
    const error = normalizePreviewError({ message: "Invalid preview payload" }, 400);
    expect(error.kind).toBe("generic_error");
    expect(error.message).toBe("Invalid preview payload");
    expect(error.details).toEqual([]);
    // Banner still renders an expandable area; rawMessage is the fallback body.
    expect(error.rawMessage).toBe("Invalid preview payload");
  });

  test("structured validation details render field paths/messages", () => {
    const error = normalizePreviewError(
      {
        success: false,
        message: "Invalid preview payload",
        errorCode: "PBV2_INVALID_PREVIEW_PAYLOAD",
        details: [
          {
            path: "selections.grommets",
            message: "Required option group 'Grommets' has no selected value.",
            expected: "one selected choice",
            received: null,
          },
        ],
      },
      400,
    );
    expect(error.kind).toBe("validation_error_with_details");
    expect(error.errorCode).toBe("PBV2_INVALID_PREVIEW_PAYLOAD");
    expect(error.details).toHaveLength(1);
    expect(error.details[0].path).toBe("selections.grommets");
    expect(error.details[0].expected).toBe("one selected choice");
    expect(error.details[0].received).toBeNull();
  });

  test("normalizes raw zod issues into details", () => {
    const error = normalizePreviewError(
      { message: "Invalid", issues: [{ path: ["width"], message: "Expected number, received string" }] },
      400,
    );
    expect(error.kind).toBe("validation_error_with_details");
    expect(error.details[0].path).toBe("width");
  });

  test("normalizes formula error lists (code becomes the path)", () => {
    const error = normalizePreviewError(
      {
        success: false,
        message: "Formula evaluation failed",
        errors: [{ code: "PBV2_FORMULA_ERROR", message: "Unknown variable q2" }],
      },
      200,
    );
    expect(error.details[0].message).toBe("Unknown variable q2");
    expect(error.details[0].path).toBe("PBV2_FORMULA_ERROR");
  });

  test("treats 5xx without details as an unexpected error", () => {
    expect(normalizePreviewError({ message: "boom" }, 500).kind).toBe("unexpected_error");
  });
});

describe("buildClientPreviewError / buildUnexpectedPreviewError", () => {
  test("client preview error carries the client-validation code", () => {
    const error = buildClientPreviewError("Fix preview inputs before pricing.", [
      { path: "width", message: "Width must be greater than 0." },
    ]);
    expect(error.errorCode).toBe(PBV2_PREVIEW_CLIENT_VALIDATION);
    expect(error.kind).toBe("validation_error_with_details");
    expect(error.details).toHaveLength(1);
  });

  test("unexpected error has a kind but no details", () => {
    const error = buildUnexpectedPreviewError("network down");
    expect(error.kind).toBe("unexpected_error");
    expect(error.details).toEqual([]);
  });
});

describe("findMissingRequiredSelections", () => {
  const groups = [
    { groupId: "g1", groupName: "Grommets", isRequired: true, selectionKeys: ["grommets"] },
    { groupId: "g2", groupName: "Finish", isRequired: false, selectionKeys: ["finish"] },
  ];

  test("missing required option selection shows useful detail", () => {
    const details = findMissingRequiredSelections(groups, {});
    expect(details).toHaveLength(1);
    expect(details[0].message).toContain("Grommets");
    expect(details[0].message).toMatch(/no selected value/i);
    expect(details[0].path).toBe("selections.grommets");
    expect(details[0].received).toBeNull();
  });

  test("produces no detail when the required selection is present", () => {
    expect(findMissingRequiredSelections(groups, { grommets: "corners" })).toEqual([]);
  });

  test("ignores optional groups even when empty", () => {
    expect(findMissingRequiredSelections(groups, { grommets: "corners", finish: "" })).toEqual([]);
  });
});

describe("categorizePreviewDetails", () => {
  test("buckets details into the debug sub-sections", () => {
    const sections = categorizePreviewDetails([
      { path: "selections.grommets", message: "Required option group has no selected value" },
      { path: "width", message: "Width must be a positive number." },
      { path: "formulaVariables.p", message: "Missing variable p" },
      { path: "treeJson", message: "tree is malformed" },
    ]);
    expect(sections.missingSelections).toHaveLength(1);
    expect(sections.invalidNumericInputs).toHaveLength(1);
    expect(sections.missingVariables).toHaveLength(1);
    expect(sections.other).toHaveLength(1);
  });
});

describe("parsePreviewPath", () => {
  test("parses a node-level pricingImpact path", () => {
    const parsed = parsePreviewPath("nodes.opt_abc.pricingImpact.0.mode");
    expect(parsed.nodeId).toBe("opt_abc");
    expect(parsed.choiceIndex).toBeUndefined();
    expect(parsed.pricingImpactIndex).toBe(0);
    expect(parsed.pricingField).toBe("mode");
    expect(parsed.isPricingImpactPath).toBe(true);
  });

  test("parses a choice-level pricingImpact path", () => {
    const parsed = parsePreviewPath("nodes.opt_abc.choices.2.pricingImpact.0.unit");
    expect(parsed.nodeId).toBe("opt_abc");
    expect(parsed.choiceIndex).toBe(2);
    expect(parsed.pricingField).toBe("unit");
    expect(parsed.isPricingImpactPath).toBe(true);
  });

  test("non-node paths are not pricing-impact paths", () => {
    expect(parsePreviewPath("width").isPricingImpactPath).toBe(false);
    expect(parsePreviewPath("").isPricingImpactPath).toBe(false);
  });
});

describe("enrichPreviewDetail", () => {
  const tree = {
    nodes: {
      opt_grommets: {
        id: "opt_grommets",
        label: "Grommets",
        choices: [
          { value: "tl", label: "Top Left" },
          { value: "tr", label: "Top Right" },
        ],
      },
    },
  };

  test("node id resolves to the option label", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_grommets.pricingImpact.0.mode", message: "Invalid", received: "spread" },
      tree,
    );
    expect(enriched.displayLocation).toBe("Grommets");
  });

  test("choice index resolves to the choice label", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_grommets.choices.0.pricingImpact.0.unit", message: "Required" },
      tree,
    );
    expect(enriched.displayLocation).toBe("Grommets > Choice: Top Left");
  });

  test("missing node falls back to 'Unknown option' safely", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_missing.pricingImpact.0.cents", message: "Required" },
      tree,
    );
    expect(enriched.displayLocation).toBe("Unknown option");
    // Raw technical path must still be available for developers.
    expect(enriched.technicalPath).toBe("nodes.opt_missing.pricingImpact.0.cents");
  });

  test("missing choice falls back to '{Option} > Unknown choice' safely", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_grommets.choices.9.pricingImpact.0.unit", message: "Required" },
      tree,
    );
    expect(enriched.displayLocation).toBe("Grommets > Unknown choice");
    expect(enriched.technicalPath).toBe("nodes.opt_grommets.choices.9.pricingImpact.0.unit");
  });

  test("raw technical path, expected and received are preserved", () => {
    const enriched = enrichPreviewDetail(
      {
        path: "nodes.opt_grommets.choices.1.pricingImpact.0.unit",
        message: "Required",
        expected: "sqft | piece",
        received: "undefined",
      },
      tree,
    );
    expect(enriched.technicalPath).toBe("nodes.opt_grommets.choices.1.pricingImpact.0.unit");
    expect(enriched.expected).toBe("sqft | piece");
    expect(enriched.received).toBe("undefined");
  });

  test("pricingImpact mode becomes 'Invalid pricing adjustment type'", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_grommets.pricingImpact.0.mode", message: "Invalid" },
      tree,
    );
    expect(enriched.category).toBe("Invalid pricing adjustment type");
  });

  test("missing centsPerSqft becomes 'Missing pricing amount'", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_grommets.choices.0.pricingImpact.0.centsPerSqft", message: "Required" },
      tree,
    );
    expect(enriched.category).toBe("Missing pricing amount");
  });

  test("missing unit becomes 'Missing pricing unit'", () => {
    const enriched = enrichPreviewDetail(
      { path: "nodes.opt_grommets.choices.0.pricingImpact.0.unit", message: "Required" },
      tree,
    );
    expect(enriched.category).toBe("Missing pricing unit");
    expect(enriched.suggestedFix).toContain("Top Left");
    expect(enriched.suggestedFix).toContain("pricing unit");
  });

  test("non-pricing paths still enrich without crashing", () => {
    const enriched = enrichPreviewDetail({ path: "width", message: "Width must be positive." }, tree);
    expect(enriched.displayLocation).toBe("Preview input: Width");
    expect(enriched.friendlyMessage).toBe("Width must be positive.");
  });

  test("missing required selection path resolves to option label", () => {
    const enriched = enrichPreviewDetail(
      { path: "selections.opt_grommets", message: "Required option group has no selected value." },
      tree,
    );
    expect(enriched.displayLocation).toBe("Option selection: Grommets");
    expect(enriched.category).toBe("Missing required selection");
    expect(enriched.suggestedFix).toBe("Choose a value for Grommets.");
    expect(enriched.technicalPath).toBe("selections.opt_grommets");
  });

  test("double-prefixed selection IDs resolve defensively while preserving raw path", () => {
    const enriched = enrichPreviewDetail(
      { path: "selections.opt_opt_grommets", message: "Required option group has no selected value." },
      tree,
    );
    expect(enriched.displayLocation).toBe("Option selection: Grommets");
    expect(enriched.technicalPath).toBe("selections.opt_opt_grommets");
  });

  test("unknown selection IDs fall back safely while preserving raw path", () => {
    const enriched = enrichPreviewDetail(
      { path: "selections.opt_missing", message: "Required option group has no selected value." },
      tree,
    );
    expect(enriched.displayLocation).toBe("Option selection");
    expect(enriched.technicalPath).toBe("selections.opt_missing");
  });
});

describe("buildPreviewErrorSummary", () => {
  test("summarizes pricing setup problems in plain English", () => {
    const tree = { nodes: { opt_a: { label: "Custom" } } };
    const enriched = [
      enrichPreviewDetail({ path: "nodes.opt_a.pricingImpact.0.unit", message: "x" }, tree),
      enrichPreviewDetail({ path: "nodes.opt_a.pricingImpact.1.mode", message: "y" }, tree),
    ];
    const summary = buildPreviewErrorSummary(enriched);
    expect(summary).toContain("Pricing preview found 2 setup problems.");
    expect(summary).toContain("incomplete pricing settings");
  });

  test("returns an empty string when there are no issues", () => {
    expect(buildPreviewErrorSummary([])).toBe("");
  });
});
