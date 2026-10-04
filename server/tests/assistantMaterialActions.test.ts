import fs from "node:fs";
import path from "node:path";
import { normalizeAssistantMaterialUnitInput } from "../services/assistant/materialActionNormalization";
import { resolveExplicitCreationEntity } from "../services/assistant/materialEntityIntent";

const root = path.resolve(process.cwd());
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const assistantMaterialActionCommandNames = ["materials.create", "materials.create_family", "materials.create_variant", "materials.assign_family"] as const;

const liquidMaterial = {
  name: "Digitech TruFire KSJ Ink / Cyan", sku: "TRUFIRE-C", type: "liquid",
  materialForm: "liquid", inventoryUnit: "milliliter", consumptionUnit: "milliliter",
  costPerUnit: 130, purchaseUnit: "liter", vendorCostPerUnit: 130,
  preferredVendorName: "Digitech", stockQuantity: 0, minStockAlert: 0, isActive: true,
};

describe("assistant Material actions", () => {
  test("normalizes a natural-language liter purchase through canonical milliliter cost fields", () => {
    const material = normalizeAssistantMaterialUnitInput(liquidMaterial);
    expect(material.inventoryUnit).toBe("milliliter");
    expect(material.consumptionUnit).toBe("milliliter");
    expect(material.vendorCostUnit).toBe("milliliter");
    expect(material.inventoryUnitsPerPurchaseUnit).toBe(1000);
    expect(material.costPerUnit).toBeCloseTo(0.13, 8);
  });

  test("keeps explicit Material intent out of Product Builder while explicit products remain products", () => {
    expect(resolveExplicitCreationEntity("Add a material called 4mm White Coroplast")).toBe("material");
    expect(resolveExplicitCreationEntity("Create a product called 4mm White Coroplast")).toBe("product");
  });

  test("registers four narrow confirmation-bound canonical Material commands", () => {
    expect(assistantMaterialActionCommandNames).toEqual([
      "materials.create", "materials.create_family", "materials.create_variant", "materials.assign_family",
    ]);
    for (const name of assistantMaterialActionCommandNames) {
      expect(read("server/services/assistant/execution/materialActionsCommands.ts")).toContain(`\"${name}\"`);
    }
  });

  test("uses canonical services, protected plans, and no route/database shortcuts", () => {
    const actions = read("server/services/assistant/materialActionService.ts");
    const commands = read("server/services/assistant/execution/materialActionsCommands.ts");
    const assistant = read("server/services/assistant/assistantService.ts");
    const executionRoutes = read("server/routes/assistantExecution.routes.ts");
    expect(actions).toContain("materialMutationService.create");
    expect(actions).toContain("materialFamilyCreationService.createFamily");
    expect(actions).toContain("materialFamilyCreationService.createVariant");
    expect(actions).toContain("materialFamilyAssignmentService.assign");
    expect(actions).not.toContain("from \"../../db\"");
    expect(actions).not.toContain("fetch(");
    expect(commands).toContain("confirmationRequired: true");
    expect(commands).toContain("partialFailurePolicy: name === \"materials.create_family\" ? \"record_and_stop\"");
    expect(assistant).toContain("materials.prepare_action");
    expect(assistant).toContain("materialCreationRequest");
    expect(assistant).toContain("resolveExplicitCreationEntity(task.goal) === \"material\"");
    expect(executionRoutes).toContain("assistantMaterialActionCommandNames");
  });
});
