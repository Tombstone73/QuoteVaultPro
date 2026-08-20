import assert from "node:assert/strict";
import {
  materialConsumptionRequest,
  materialRequirementChoices,
} from "./ProductionWorkspace";

const requirements = [
  {
    materialId: "laminate-a",
    materialName: "Substance 3150 Laminate",
    materialSku: "LAM-3150",
    requirementId: "requirement-a",
    unit: "square_foot" as const,
    expectedQuantity: "1",
    consumedQuantity: "0",
    wasteQuantity: "0",
    correctionQuantity: "0",
    totalPhysicalUsageQuantity: "0",
    varianceQuantity: "-1",
  },
  {
    materialId: "laminate-a",
    materialName: "Substance 3150 Laminate",
    materialSku: "LAM-3150",
    requirementId: "requirement-b",
    unit: "square_foot" as const,
    expectedQuantity: "1",
    consumedQuantity: "0",
    wasteQuantity: "0",
    correctionQuantity: "0",
    totalPhysicalUsageQuantity: "0",
    varianceQuantity: "-1",
  },
  {
    materialId: "styrene-a",
    materialName: "Styrene .080",
    materialSku: null,
    requirementId: "requirement-c",
    unit: "sheet" as const,
    expectedQuantity: "1",
    consumedQuantity: "0",
    wasteQuantity: "0",
    correctionQuantity: "0",
    totalPhysicalUsageQuantity: "0",
    varianceQuantity: "-1",
  },
] as const;

const choices = materialRequirementChoices(requirements);

assert.deepEqual(
  choices.map((choice) => choice.value),
  ["requirement-a", "requirement-b", "requirement-c"],
  "frozen requirements, not duplicated Material ids, must be selector values",
);
assert.match(choices[0]!.label, /Requirement 1/);
assert.match(choices[1]!.label, /Requirement 2/);
assert.doesNotMatch(choices[2]!.label, /Requirement \d/);

const requirementA = materialConsumptionRequest(choices[0]!.requirement, {
  quantity: "1",
  kind: "consumed",
});
const requirementB = materialConsumptionRequest(choices[1]!.requirement, {
  quantity: "1",
  kind: "consumed",
});
assert.deepEqual(requirementA, {
  materialId: "laminate-a",
  requirementId: "requirement-a",
  quantity: "1",
  unit: "square_foot",
  kind: "consumed",
});
assert.deepEqual(requirementB, {
  materialId: "laminate-a",
  requirementId: "requirement-b",
  quantity: "1",
  unit: "square_foot",
  kind: "consumed",
});

console.log("Production material requirement selection tests passed.");
