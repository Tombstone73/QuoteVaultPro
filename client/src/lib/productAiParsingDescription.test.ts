import { describe, expect, test } from "@jest/globals";
import {
  buildProductAiParsingDescriptionContext,
  hasExistingAiParsingDescription,
  normalizeGeneratedAiParsingDescriptionResponse,
} from "./productAiParsingDescription";

describe("product AI parsing description client helpers", () => {
  test("builds generator context from unsaved editor values and current PBV2 tree", () => {
    const context = buildProductAiParsingDescriptionContext({
      mode: "new",
      productId: null,
      productTypes: [{ id: "pt_banner", name: "Banner" }],
      currentTree: {
        nodes: {
          opt_grommets: { label: "Grommets", input: { choices: [{ label: "Corners" }] } },
        },
      },
      values: {
        name: "Vinyl Banner",
        category: "Banners",
        productTypeId: "pt_banner",
        description: "Printed banner with finishing options.",
        aiParsingDescription: "",
      },
    });

    expect(context).toEqual(expect.objectContaining({
      mode: "new",
      productId: null,
      name: "Vinyl Banner",
      category: "Banners",
      productTypeId: "pt_banner",
      productTypeName: "Banner",
      description: "Printed banner with finishing options.",
      optionTreeJson: expect.objectContaining({
        nodes: expect.objectContaining({
          opt_grommets: expect.objectContaining({ label: "Grommets" }),
        }),
      }),
    }));
  });

  test("detects existing content so the page can offer improve, replace, or cancel", () => {
    expect(hasExistingAiParsingDescription(" Existing guidance. ")).toBe(true);
    expect(hasExistingAiParsingDescription("   ")).toBe(false);
    expect(hasExistingAiParsingDescription(null)).toBe(false);
  });

  test("improve and replace keep the current description in request context", () => {
    const values = {
      name: "ACM Panel",
      aiParsingDescription: "Existing ACM guidance.",
    };

    expect(buildProductAiParsingDescriptionContext({ mode: "improve", values }).existingAiParsingDescription)
      .toBe("Existing ACM guidance.");
    expect(buildProductAiParsingDescriptionContext({ mode: "replace", values }).mode).toBe("replace");
  });

  test("normalizes a successful response and rejects a failed or empty response without touching form state", () => {
    expect(normalizeGeneratedAiParsingDescriptionResponse({
      success: true,
      data: {
        generatedDescription: "Use for vinyl banner and grommet requests.",
        mode: "new",
        sourceFields: ["name"],
      },
    })).toEqual({
      generatedDescription: "Use for vinyl banner and grommet requests.",
      mode: "new",
      sourceFields: ["name"],
    });

    expect(() => normalizeGeneratedAiParsingDescriptionResponse({ success: false, message: "AI unavailable" }))
      .toThrow("AI unavailable");
    expect(() => normalizeGeneratedAiParsingDescriptionResponse({ success: true, data: {} }))
      .toThrow("AI did not return");
  });
});
