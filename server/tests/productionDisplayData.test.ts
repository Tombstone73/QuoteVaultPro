import { describe, expect, test } from "@jest/globals";

import {
  buildPrepressOptionRows,
  resolveLineItemProductionDisplayData,
} from "../routes/flatStockNesting.shared";

describe("production display data", () => {
  test("resolves media from product primary material when line item material is blank", () => {
    const display = resolveLineItemProductionDisplayData({
      lineItem: {
        id: "li-1",
        materialName: null,
        materialUsageJson: null,
        pbv2SnapshotJson: null,
      },
      primaryMaterialName: "Reflective Vinyl - Nikkalite",
    });

    expect(display.mediaLabel).toBe("Reflective Vinyl - Nikkalite");
  });

  test("renders imported PBV2 option keys as operator labels and ignores internal metadata", () => {
    const rows = buildPrepressOptionRows({
      id: "li-2",
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: {
          contour_cutting__import_mpm_1234567890: { value: "no" },
          lamination_finish__import_mpm_abcdef: { value: "gloss" },
          schemaVersion: { value: 2 },
        },
      },
    });

    expect(rows).toEqual([
      { groupLabel: null, optionLabel: "Contour Cutting", selectedLabel: "No" },
      { groupLabel: null, optionLabel: "Lamination Finish", selectedLabel: "Gloss" },
    ]);
  });

  test("uses PBV2 tree labels and choice labels when available", () => {
    const rows = buildPrepressOptionRows(
      {
        id: "li-3",
        optionSelectionsJson: {
          schemaVersion: 2,
          selected: {
            lamination: { value: "gloss" },
          },
        },
      },
      {
        schemaVersion: 2,
        rootNodeIds: ["lam"],
        nodes: {
          lam: {
            id: "lam",
            kind: "question",
            label: "Lamination Finish",
            ui: { groupKey: "finishing" },
            input: { type: "select", selectionKey: "lamination", defaultValue: "none" },
            choices: [
              { value: "none", label: "None" },
              { value: "gloss", label: "Gloss" },
            ],
          },
        },
        edges: [],
      },
    );

    expect(rows).toEqual([
      { groupLabel: "Finishing", optionLabel: "Lamination Finish", selectedLabel: "Gloss", isDefault: false },
    ]);
  });
});
