import { describe, expect, it } from "@jest/globals";
import { resolveSavedLineItemOptionSelections } from "../lineItemOptionSelections";

const activeTree = {
  schemaVersion: 2,
  rootNodeIds: ["sides", "grommets", "contour", "thickness"],
  nodes: {
    sides: {
      id: "sides",
      key: "print_sides",
      kind: "question",
      label: "Print Sides",
      input: { type: "select", selectionKey: "print_sides", defaultValue: "single" },
      choices: [
        { value: "single", label: "Single-Sided" },
        { value: "double", label: "Double-Sided" },
      ],
    },
    grommets: {
      id: "grommets",
      kind: "question",
      label: "Grommet Placement",
      input: { type: "select", selectionKey: "grommet_placement", defaultValue: "none" },
      choices: [
        { value: "none", label: "None" },
        { value: "corners", label: "Corners" },
      ],
    },
    contour: {
      id: "contour",
      kind: "question",
      label: "Contour Cutting",
      input: { type: "select", selectionKey: "contour_cutting", defaultValue: "no" },
      choices: [
        { value: "no", label: "No" },
        { value: "yes", label: "Yes" },
      ],
    },
    thickness: {
      id: "thickness",
      kind: "question",
      label: "Thickness",
      input: { type: "select", selectionKey: "thickness", defaultValue: "4mm" },
      choices: [
        { value: "4mm", label: "4mm" },
        { value: "10mm", label: "10mm" },
      ],
    },
  },
  edges: [],
} as any;

describe("saved line item option resolution", () => {
  it("hydrates every dropdown from saved canonical selections", () => {
    const resolved = resolveSavedLineItemOptionSelections({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: {
          print_sides: { value: "double" },
          grommet_placement: { value: "corners" },
          contour_cutting: { value: "yes" },
          thickness: { value: "10mm" },
        },
      },
    }, activeTree, { includeDefaults: true });

    expect(Object.fromEntries(Object.entries(resolved.selected).map(([key, entry]) => [key, entry.value]))).toEqual({
      print_sides: "double",
      grommet_placement: "corners",
      contour_cutting: "yes",
      thickness: "10mm",
    });
  });

  it("falls back to product defaults per missing option instead of replacing the saved map", () => {
    const resolved = resolveSavedLineItemOptionSelections({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: { print_sides: { value: "double" }, thickness: { value: "10mm" } },
      },
    }, activeTree, { includeDefaults: true });

    expect(resolved.selected.print_sides.value).toBe("double");
    expect(resolved.selected.thickness.value).toBe("10mm");
    expect(resolved.selected.grommet_placement.value).toBe("none");
    expect(resolved.selected.contour_cutting.value).toBe("no");
  });

  it("maps historic tree IDs and display values onto stable active-tree keys", () => {
    const resolved = resolveSavedLineItemOptionSelections({
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: {
          old_sides_id: { value: "old_double" },
          old_thickness_id: { value: "old_10mm" },
        },
      },
      pbv2SnapshotJson: {
        treeJson: {
          schemaVersion: 2,
          rootNodeIds: ["old_sides_id", "old_thickness_id"],
          nodes: {
            old_sides_id: {
              id: "old_sides_id",
              kind: "question",
              label: "Print Sides",
              input: { type: "select", selectionKey: "old_sides_id" },
              choices: [{ value: "old_double", label: "Double-Sided" }],
            },
            old_thickness_id: {
              id: "old_thickness_id",
              kind: "question",
              label: "Thickness",
              input: { type: "select", selectionKey: "old_thickness_id" },
              choices: [{ value: "old_10mm", label: "10mm" }],
            },
          },
        },
      },
    }, activeTree, { includeDefaults: true });

    expect(resolved.selected.print_sides.value).toBe("double");
    expect(resolved.selected.thickness.value).toBe("10mm");
  });

  it("uses the server-evaluated pricing selections and legacy selectedOptions as per-key fallbacks", () => {
    const resolved = resolveSavedLineItemOptionSelections({
      pbv2SnapshotJson: {
        pbv2PricingSnapshot: {
          effectiveSelections: {
            print_sides: "double",
            grommet_placement: "corners",
          },
        },
      },
      selectedOptions: [
        { optionId: "legacy-contour", optionName: "Contour Cutting", value: "Yes" },
        { optionId: "legacy-thickness", optionName: "Thickness", value: "10mm" },
      ],
    }, activeTree, { includeDefaults: true });

    expect(resolved.selected.print_sides.value).toBe("double");
    expect(resolved.selected.grommet_placement.value).toBe("corners");
    expect(resolved.selected.contour_cutting.value).toBe("yes");
    expect(resolved.selected.thickness.value).toBe("10mm");
  });
});
