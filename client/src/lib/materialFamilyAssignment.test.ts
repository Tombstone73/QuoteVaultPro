import { materialFamilyActionLabel, materialFamilyAssignmentPayload } from "./materialFamilyAssignment";
describe("Material Family assignment UI contract", () => {
  const dimensions = [{ id: "thickness", displayName: "Thickness" }, { id: "color", displayName: "Color" }];
  test("builds dynamic selected-Family values", () => expect(materialFamilyAssignmentPayload("family_1", dimensions, { thickness: "4mm", color: "White" })).toEqual({ familyId: "family_1", values: [{ dimensionId: "thickness", value: "4mm" }, { dimensionId: "color", value: "White" }] }));
  test("requires every selected Family dimension", () => expect(() => materialFamilyAssignmentPayload("family_1", dimensions, { thickness: "4mm" })).toThrow("Color is required."));
  test("labels assigned and unassigned Materials", () => { expect(materialFamilyActionLabel(null)).toBe("Assign Family"); expect(materialFamilyActionLabel("family_1")).toBe("Change Family"); });
});
