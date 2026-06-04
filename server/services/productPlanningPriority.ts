import type { productPlanningBusinessValueValues, productPlanningComplexityValues } from "@shared/schema";

type BusinessValue = typeof productPlanningBusinessValueValues[number];
type Complexity = typeof productPlanningComplexityValues[number];

export type ProductPlanningScoringInput = {
  businessValue?: BusinessValue | null;
  complexity?: Complexity | null;
  userImpact?: number | null;
  revenueImpact?: number | null;
  operationalImpact?: number | null;
  riskReduction?: number | null;
  confidence?: number | null;
};

export type ProductPlanningScoreResult = {
  priorityScore: number | null;
  priorityScoreExplanation: {
    inputs: ProductPlanningScoringInput;
    components: Record<string, number>;
    confidenceModifier: number;
    formula: string;
  };
};

const businessValueWeights: Record<BusinessValue, number> = {
  very_high: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const complexityPenalty: Record<Complexity, number> = {
  small: 1,
  medium: 2,
  large: 3,
  massive: 4,
};

function clampMetric(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

export function calculateProductPlanningPriorityScore(input: ProductPlanningScoringInput): ProductPlanningScoreResult {
  const hasScoringInput = Boolean(
    input.businessValue ||
    input.complexity ||
    input.userImpact != null ||
    input.revenueImpact != null ||
    input.operationalImpact != null ||
    input.riskReduction != null ||
    input.confidence != null,
  );

  const confidence = clampMetric(input.confidence) || 3;
  const confidenceModifier = confidence / 5;
  const businessValue = input.businessValue ? businessValueWeights[input.businessValue] ?? 0 : 0;
  const complexity = input.complexity ? complexityPenalty[input.complexity] ?? 0 : 0;
  const components = {
    businessValue: businessValue * 10,
    userImpact: clampMetric(input.userImpact) * 8,
    revenueImpact: clampMetric(input.revenueImpact) * 7,
    operationalImpact: clampMetric(input.operationalImpact) * 6,
    riskReduction: clampMetric(input.riskReduction) * 5,
    complexityPenalty: complexity * -6,
  };

  const rawScore = Object.values(components).reduce((sum, value) => sum + value, 0);
  const priorityScore = hasScoringInput
    ? Math.max(0, Math.min(100, Math.round(rawScore * confidenceModifier)))
    : null;

  return {
    priorityScore,
    priorityScoreExplanation: {
      inputs: {
        businessValue: input.businessValue ?? null,
        complexity: input.complexity ?? null,
        userImpact: input.userImpact ?? null,
        revenueImpact: input.revenueImpact ?? null,
        operationalImpact: input.operationalImpact ?? null,
        riskReduction: input.riskReduction ?? null,
        confidence: input.confidence ?? null,
      },
      components,
      confidenceModifier,
      formula: "(businessValue*10 + userImpact*8 + revenueImpact*7 + operationalImpact*6 + riskReduction*5 - complexityPenalty*6) * confidence/5",
    },
  };
}
