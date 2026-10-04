import { activeMaterialFamilies, materialDimensionKey, materialFamilyLifecycleRequest } from "./materialFamilyControls";
describe("Material Family controls", () => {
  test("creates dimension keys without hard-coded dimensions", () => expect(materialDimensionKey("Sheet Size")).toBe("sheet_size"));
  test("toggles lifecycle request", () => { expect(materialFamilyLifecycleRequest(true)).toEqual({ isActive: false }); expect(materialFamilyLifecycleRequest(false)).toEqual({ isActive: true }); });
  test("filters inactive Families for new assignment", () => expect(activeMaterialFamilies([{ id: "active", isActive: true }, { id: "inactive", isActive: false }])).toEqual([{ id: "active", isActive: true }]));
});
