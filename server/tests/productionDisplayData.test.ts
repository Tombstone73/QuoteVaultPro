import { describe, expect, jest, test } from "@jest/globals";

import {
  collectLineItemProductionMaterialIds,
  buildPrepressOptionRows,
  resolveLineItemMaterialDisplayLabel,
  resolveLineItemProductionDisplayData,
} from "../routes/flatStockNesting.shared";
import { buildOrderTravelerData } from "../../shared/productionTicket";

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

  test("order traveler uses product primary material when line item material is blank", () => {
    const lineItem = {
      id: "li-traveler-primary",
      materialId: null,
      productPrimaryMaterialId: "mat-primary",
      pbv2SnapshotJson: null,
    };
    const materialById = new Map([["mat-primary", "Reflective Vinyl - Nikkalite"]]);

    expect(collectLineItemProductionMaterialIds({ lineItem })).toEqual(["mat-primary"]);

    const material = resolveLineItemMaterialDisplayLabel({
      lineItem,
      materialById,
      productPrimaryMaterialId: "mat-primary",
    });
    const traveler = buildOrderTravelerData({
      orderId: "order-1",
      orderNumber: "ORD-1",
      customerName: "Customer",
      lineItems: [{ description: "Sign", quantity: 1, material }],
    });

    expect(traveler.lineItems[0].material).toBe("Reflective Vinyl - Nikkalite");
  });

  test("order traveler renders missing material references safely as dash", () => {
    const material = resolveLineItemMaterialDisplayLabel({
      lineItem: {
        id: "li-traveler-missing",
        materialId: null,
        productPrimaryMaterialId: "missing-material",
      },
      materialById: new Map(),
      productPrimaryMaterialId: "missing-material",
    });
    const traveler = buildOrderTravelerData({
      orderId: "order-2",
      orderNumber: "ORD-2",
      customerName: "Customer",
      lineItems: [{ description: "Sign", quantity: 1, material }],
    });

    expect(material).toBeNull();
    expect(traveler.lineItems[0].material).toMatch(/\u2014|\u00e2\u20ac\u201d/);
  });

  test("resolves selected PBV2 choice material override before product primary material", () => {
    const lineItem = {
      id: "li-traveler-pbv2",
      materialId: null,
      productPrimaryMaterialId: "mat-primary",
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: {
          substrate: { value: "reflective" },
        },
      },
      pbv2SnapshotJson: {
        treeJson: {
          schemaVersion: 2,
          nodes: {
            substrate: {
              id: "substrate",
              kind: "question",
              label: "Substrate",
              input: { type: "select", selectionKey: "substrate" },
              choices: [
                { value: "standard", label: "Standard", materialOverride: { materialId: "mat-standard" } },
                { value: "reflective", label: "Reflective", materialOverride: { materialId: "mat-reflective" } },
              ],
            },
          },
        },
      },
    };
    const materialById = new Map([
      ["mat-primary", "Default ACM"],
      ["mat-reflective", "Reflective Vinyl"],
    ]);

    expect(collectLineItemProductionMaterialIds({ lineItem })).toEqual([
      "mat-reflective",
      "mat-primary",
    ]);
    expect(resolveLineItemMaterialDisplayLabel({ lineItem, materialById })).toBe("Reflective Vinyl");
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

  test("prepress option rows prefer current saved Print Sides over stale snapshot labels", () => {
    const rows = buildPrepressOptionRows({
      id: "li-print-sides",
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: { printSides: { value: "double", label: "Double-Sided" } },
      },
      selectedOptions: [{ optionId: "printSides", optionName: "Print Sides", value: "single" }],
      pbv2SnapshotJson: {
        runtimeSelectionContext: {
          resolvedChoices: {
            printSides: { optionLabel: "Print Sides", choiceLabel: "Single-Sided" },
          },
        },
      },
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ optionLabel: "Print Sides", selectedLabel: "Double-Sided" }),
    ]));
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ optionLabel: "Print Sides", selectedLabel: "Single-Sided" }),
    ]));
  });

  test("prepress resolves historic saved option IDs against the active option tree", () => {
    const rows = buildPrepressOptionRows({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: { old_sides: { value: "old_double" } },
      },
      pbv2SnapshotJson: {
        treeJson: {
          schemaVersion: 2,
          rootNodeIds: ["old_sides"],
          nodes: {
            old_sides: {
              id: "old_sides",
              kind: "question",
              label: "Print Sides",
              input: { type: "select", selectionKey: "old_sides" },
              choices: [{ value: "old_double", label: "Double-Sided" }],
            },
          },
        },
      },
    }, {
      schemaVersion: 2,
      rootNodeIds: ["active_sides"],
      nodes: {
        active_sides: {
          id: "active_sides",
          kind: "question",
          label: "Print Sides",
          input: { type: "select", selectionKey: "print_sides", defaultValue: "single" },
          choices: [
            { value: "single", label: "Single-Sided" },
            { value: "double", label: "Double-Sided" },
          ],
        },
      },
      edges: [],
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ optionLabel: "Print Sides", selectedLabel: "Double-Sided", isDefault: false }),
    ]));
  });

  test("prepress displays the choice label when the saved value is a choice ID", () => {
    const rows = buildPrepressOptionRows({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: {
          thickness: { value: "choice_2" },
          grommet_placement: { value: "choice_2" },
        },
      },
    }, {
      schemaVersion: 2,
      rootNodeIds: ["thickness", "grommets"],
      nodes: {
        thickness: {
          id: "thickness",
          kind: "question",
          label: "Thickness",
          input: { type: "select", selectionKey: "thickness", defaultValue: "4mm" },
          choices: [
            { id: "choice_1", value: "4mm", label: "4mm" },
            { id: "choice_2", value: "10mm", label: "10mm" },
          ],
        },
        grommets: {
          id: "grommets",
          kind: "question",
          label: "Grommet Placement",
          input: { type: "select", selectionKey: "grommet_placement", defaultValue: "none" },
          choices: [
            { id: "choice_1", value: "none", label: "None" },
            { id: "choice_2", value: "every_2_feet", label: "Every 2 Feet" },
          ],
        },
      },
      edges: [],
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ optionLabel: "Thickness", selectedLabel: "10mm" }),
      expect.objectContaining({ optionLabel: "Grommet Placement", selectedLabel: "Every 2 Feet" }),
    ]));
    expect(rows.map((row) => row.selectedLabel).join(" ")).not.toContain("choice_2");
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
