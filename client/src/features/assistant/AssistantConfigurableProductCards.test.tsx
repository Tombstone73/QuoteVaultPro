import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { jest } from "@jest/globals";
import { ConfigurableProductConfirmationCardView, ConfigurableProductResultCardView, toConfigurableProductConfirmation, toConfigurableProductProposal, toConfigurableProductResult } from "./AssistantConfigurableProductCards";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fingerprint = "a".repeat(64); const proposalId = "11111111-1111-4111-8111-111111111111";
function confirmation(overrides: Record<string, unknown> = {}) { return { kind: "configurable_product_confirmation", version: "v1", proposalId, fingerprint, product: { name: "PVC Panel", category: "Rigid Signs", inactive: true, pbv2Status: "DRAFT", unpublished: true, nonLiveQuotable: true, sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: true, route: "Flatbed", minimumChargeCents: 2500 }, optionGroups: [{ key: "thickness", name: "Thickness", required: true, selectionMode: "single", values: [{ value: "3mm", label: "3mm" }, { value: "6mm", label: "6mm" }] }, { key: "printed_sides", name: "Printed sides", required: true, selectionMode: "single", values: [{ value: "single", label: "Single-sided" }, { value: "double", label: "Double-sided" }] }], matrix: { rowValues: ["3mm", "6mm"], columnValues: ["single", "double"], cells: { "3mm:single": 450, "3mm:double": 575, "6mm:single": 625, "6mm:double": 775 } }, warnings: ["Review finish."], blockers: [], readiness: { ready: true }, goEligible: true, ...overrides }; }

describe("configurable product assistant cards", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it("renders the complete confirmation matrix and dedicated review control", () => { const dto = toConfigurableProductConfirmation(confirmation())!; const review = jest.fn(); act(() => root.render(<ConfigurableProductConfirmationCardView confirmation={dto} onCreatePlan={review} />)); expect(container.textContent).toContain("48 × 96 in"); expect(container.textContent).toContain("$25.00"); expect(container.textContent).toContain("$7.75"); expect(container.textContent).toContain("Required single-select options"); const button = container.querySelector("button"); expect(button?.textContent).toContain("Review configurable-product plan"); act(() => button?.click()); expect(review).toHaveBeenCalledTimes(1); });
  it("fails closed for unsupported, incomplete, or blocked DTOs", () => { expect(toConfigurableProductConfirmation(confirmation({ version: "v2" }))).toBeNull(); const incomplete = confirmation(); delete (incomplete.matrix.cells as any)["6mm:double"]; expect(toConfigurableProductConfirmation(incomplete)).toBeNull(); const blocked = toConfigurableProductConfirmation(confirmation({ blockers: ["Matrix review required"], readiness: { ready: false }, goEligible: false }))!; act(() => root.render(<ConfigurableProductConfirmationCardView confirmation={blocked} onCreatePlan={jest.fn()} />)); expect(container.querySelector("button")).toBeNull(); });
  it("presents a generalized per-piece proposal with unset production configuration", () => {
    const dto = toConfigurableProductConfirmation(confirmation({ product: { name: "DEV Test Yard Signs 073126", category: "Rigid Signs", inactive: true, pbv2Status: "DRAFT", unpublished: true, nonLiveQuotable: true, requiresDimensions: false, minimumChargeCents: 2500 }, matrix: { pricingComponent: "per_piece", rowValues: ["3mm", "6mm"], columnValues: ["single", "double"], cells: { "3mm:single": 1200, "3mm:double": 1800, "6mm:single": 1600, "6mm:double": 2200 } } }))!;
    act(() => root.render(<ConfigurableProductConfirmationCardView confirmation={dto} />));
    expect(container.textContent).toContain("DEV Test Yard Signs 073126"); expect(container.textContent).toContain("Per piece pricing matrix"); expect(container.textContent).toContain("Not set"); expect(container.textContent).toContain("$22.00"); expect(container.textContent).not.toContain("$0.00");
  });
  it("blocks an unresolved measurement correction and displays all cleared values as Not set", () => {
    const dto = toConfigurableProductConfirmation(confirmation({ product: { name: "DEV Test Yard Signs 073126", category: "Rigid Signs", inactive: true, pbv2Status: "DRAFT", unpublished: true, nonLiveQuotable: true, measurementMode: "unresolved" }, matrix: { pricingComponent: "per_piece", rowValues: ["3mm", "6mm"], columnValues: ["single", "double"], cells: { "3mm:single": 1200, "3mm:double": 1800, "6mm:single": 1600, "6mm:double": 2200 } }, blockers: ["Should customers enter width and height, use a fixed size, or only enter a quantity?"], readiness: { ready: false }, goEligible: false }))!;
    act(() => root.render(<ConfigurableProductConfirmationCardView confirmation={dto} onCreatePlan={jest.fn()} />));
    expect(container.textContent).toContain("Measurement: Not set"); expect(container.textContent).toContain("Minimum charge: Not set"); expect(container.textContent).toContain("$12.00"); expect(container.querySelector("button")).toBeNull();
  });
  it("recognizes the route's turn-bound configurable proposal without losing numeric or boolean fields", () => {
    const dto = confirmation({
      product: { name: "PVC Panel", category: "Rigid Signs", inactive: true, pbv2Status: "DRAFT", unpublished: true, nonLiveQuotable: true, sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: true, route: "Flatbed", minimumChargeCents: 2500 },
      matrix: { rowValues: ["3mm", "6mm", "12mm", "18mm"], columnValues: ["Single-sided", "Double-sided"], cells: { "3mm:Single-sided": 450, "3mm:Double-sided": 575, "6mm:Single-sided": 625, "6mm:Double-sided": 775, "12mm:Single-sided": 975, "12mm:Double-sided": 1150, "18mm:Single-sided": 1250, "18mm:Double-sided": 1475 } },
    });
    const plan = { action: "products.create_configurable_draft", proposalId, fingerprint, configurableProduct: dto };
    const proposal = toConfigurableProductProposal({ kind: "action_proposal", title: "Create PVC draft", plan, proposal: { ...plan, turnId: "turn_19k" } });

    expect(proposal).toEqual(expect.objectContaining({ turnId: "turn_19k" }));
    expect(proposal?.confirmation).toEqual(expect.objectContaining({ sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: true, route: "Flatbed", minimumChargeCents: 2500, rows: ["3mm", "6mm", "12mm", "18mm"], columns: ["Single-sided", "Double-sided"] }));
    expect(proposal?.confirmation.cells["18mm:Double-sided"]).toBe(1475);
  });
  it("accepts an exact PBV2 DRAFT editor link in the result", () => { const result = toConfigurableProductResult({ kind: "configurable_product_result", version: "v1", proposalId, productId: "product_1", pbv2TreeVersionId: "tree_1", editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1", inactive: true, pbv2Status: "DRAFT", unpublished: true, optionGroupCount: 2, optionValueCount: 4, matrixRowCount: 2, matrixColumnCount: 2, matrixCellCount: 4, warnings: [], blockers: [], reused: true })!; expect(result.editorLink).toBe("/products/product_1/edit?draftTreeVersionId=tree_1"); });
});
