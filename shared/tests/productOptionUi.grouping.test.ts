import { describe, expect, test } from "@jest/globals";
import { normalizeProductOptionItemsToUiDefinitions } from "../productOptionUi";

describe("normalizeProductOptionItemsToUiDefinitions grouping", () => {
  test("ignores opt.groupKey/groupLabel (editor-only for now)", () => {
    const defs = normalizeProductOptionItemsToUiDefinitions([
      {
        id: "opt1",
        label: "Gloss Lamination",
        type: "checkbox",
        priceMode: "flat",
        amount: 10,
        groupKey: "finish_opt",
        groupLabel: "Finishing Options",
        config: { kind: "generic" },
      } as any,
    ]);

    expect(defs).toHaveLength(1);
    expect(defs[0].group).toBeUndefined();
  });

  test("falls back to legacy finishing group for finishing kinds", () => {
    const defs = normalizeProductOptionItemsToUiDefinitions([
      {
        id: "opt2",
        label: "Grommets",
        type: "checkbox",
        priceMode: "flat",
        amount: 0,
        config: { kind: "grommets" },
      } as any,
    ]);

    expect(defs).toHaveLength(1);
    expect(defs[0].group).toBe("finishing");
  });

  test("uses legacy opt.group when groupKey is missing", () => {
    const defs = normalizeProductOptionItemsToUiDefinitions([
      {
        id: "opt3",
        label: "Installation",
        type: "checkbox",
        priceMode: "flat",
        amount: 25,
        group: "install",
        config: { kind: "generic" },
      } as any,
    ]);

    expect(defs).toHaveLength(1);
    expect(defs[0].group).toBe("install");
  });
});
