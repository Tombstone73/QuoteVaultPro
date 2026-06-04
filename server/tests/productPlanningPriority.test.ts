import { describe, expect, it } from "@jest/globals";

import { calculateProductPlanningPriorityScore } from "../services/productPlanningPriority";

describe("calculateProductPlanningPriorityScore", () => {
  it("returns null when no scoring inputs are present", () => {
    expect(calculateProductPlanningPriorityScore({}).priorityScore).toBeNull();
  });

  it("rewards impact and business value while penalizing complexity", () => {
    const result = calculateProductPlanningPriorityScore({
      businessValue: "very_high",
      complexity: "small",
      userImpact: 5,
      revenueImpact: 4,
      operationalImpact: 3,
      riskReduction: 2,
      confidence: 5,
    });

    expect(result.priorityScore).toBe(100);
    expect(result.priorityScoreExplanation.components.complexityPenalty).toBe(-6);
  });

  it("applies confidence as a visible modifier", () => {
    const lowConfidence = calculateProductPlanningPriorityScore({ businessValue: "high", confidence: 1 });
    const highConfidence = calculateProductPlanningPriorityScore({ businessValue: "high", confidence: 5 });

    expect(lowConfidence.priorityScore).toBeLessThan(highConfidence.priorityScore ?? 0);
    expect(lowConfidence.priorityScoreExplanation.confidenceModifier).toBe(0.2);
  });
});
