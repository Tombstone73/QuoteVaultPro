import { describe, expect, jest, test } from "@jest/globals";

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

  test("resolves generated PBV2 option ids and choice_1 through the saved option tree", () => {
    const optionId = "dfa265fa-f1fc-4fdd-afde-a12274db2aec";
    const importedSelectionKey = "Dfa265fa F1fc 4fdd Afde A12274db2aec";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const rows = buildPrepressOptionRows({
        id: "li-4",
        optionSelectionsJson: {
          schemaVersion: 2,
          selected: {
            [importedSelectionKey]: { value: "choice_1" },
          },
        },
        pbv2SnapshotJson: {
          treeJson: {
            schemaVersion: 2,
            rootNodeIds: [optionId],
            nodes: {
              [optionId]: {
                id: optionId,
                kind: "question",
                label: "Weeding & Taping",
                key: `opt_${optionId}`,
                input: { type: "select", selectionKey: `opt_${optionId}`, defaultValue: "choice_1" },
                choices: [
                  { value: "choice_1", label: "No" },
                  { value: "choice_2", label: "Yes" },
                ],
              },
            },
            edges: [],
          },
          selectedOptions: [
            {
              optionId,
              optionName: "Weeding & Taping",
              value: "choice_1",
            },
          ],
        },
      });

      expect(rows).toEqual([
        { groupLabel: null, optionLabel: "Weeding & Taping", selectedLabel: "No", isDefault: true },
      ]);
      expect(JSON.stringify(rows)).not.toContain(optionId);
      expect(JSON.stringify(rows)).not.toContain("Unknown choice");
      expect(JSON.stringify(rows)).not.toContain("choice_1");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("keeps boolean fallback as Yes only for unresolved toggle-style selections", () => {
    const optionId = "toggle-raw-id";
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const rows = buildPrepressOptionRows(
        {
          id: "li-5",
          optionSelectionsJson: {
            schemaVersion: 2,
            selected: {
              [optionId]: { value: "choice_1" },
            },
          },
        },
        {
          schemaVersion: 2,
          rootNodeIds: [optionId],
          nodes: {
            [optionId]: {
              id: optionId,
              kind: "question",
              label: "Rush Add-On",
              input: { type: "boolean", selectionKey: optionId, defaultValue: false },
            },
          },
          edges: [],
        },
      );

      expect(rows).toEqual([
        { groupLabel: null, optionLabel: "Rush Add-On", selectedLabel: "Yes", isDefault: false },
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
