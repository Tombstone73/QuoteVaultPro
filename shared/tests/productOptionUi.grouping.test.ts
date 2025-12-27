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

describe("normalizeProductOptionItemsToUiDefinitions choice note metadata", () => {
  test("preserves requiresNote/noteLabel/notePlaceholder on select choices", () => {
    const defs = normalizeProductOptionItemsToUiDefinitions([
      {
        id: "opt_select",
        label: "Grommets",
        type: "select",
        priceMode: "flat",
        amount: 0,
        required: true,
        choices: [
          { label: "Every 24\"", value: "every_24" },
          {
            label: "Custom",
            value: "custom",
            requiresNote: true,
            noteLabel: "Custom details",
            notePlaceholder: "Describe placement",
          },
        ],
        config: { kind: "generic" },
      } as any,
    ]);

    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe("select");
    expect(defs[0].choices).toHaveLength(2);

    const every24 = defs[0].choices?.find((c) => c.value === "every_24");
    expect(every24).toBeTruthy();
    expect(every24?.label).toBe("Every 24\"");

    const custom = defs[0].choices?.find((c) => c.value === "custom");
    expect(custom).toBeTruthy();
    expect(custom?.label).toBe("Custom");
    expect(custom?.requiresNote).toBe(true);
    expect(custom?.noteLabel).toBe("Custom details");
    expect(custom?.notePlaceholder).toBe("Describe placement");
  });
});
