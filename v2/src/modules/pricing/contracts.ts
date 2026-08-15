import type {
  CurrencyCode, DecimalText, JsonValue, Money, OrganizationId, PercentageBasisPoints,
  PricingConfigurationId, PricingResultId, ProductId, ProductTypeId,
} from "../shared/commercialValues.js";
import type { SellableProductConfiguration } from "../products/contracts.js";

export type DimensionInput = Readonly<{ width: DecimalText; height: DecimalText; unit: "in" | "ft" | "mm" }>;

/** Stable, serializable PBV2 resolution result; it deliberately contains no tree/editor/runtime state. */
export type ResolvedProductConfiguration = Readonly<{
  schemaVersion: 1;
  organizationId: OrganizationId;
  productId: ProductId;
  pricingConfigurationId: PricingConfigurationId;
  pricingConfigurationVersion: string;
  pricingConfigurationContentHash: string;
  quantity: number;
  dimensions?: DimensionInput;
  selections: Readonly<Record<string, JsonValue>>;
  derivedFacts: Readonly<Record<string, JsonValue>>;
  productFacts: Readonly<Record<string, JsonValue>>;
}>;

export type NestingEstimateEvidence = Readonly<{
  estimateId: string;
  calculatorVersion: string;
  facts: Readonly<Record<string, JsonValue>>;
}>;

export type PricingCalculationRequest = Readonly<{
  organizationId: OrganizationId;
  sellableProduct: SellableProductConfiguration;
  resolvedConfiguration: ResolvedProductConfiguration;
  pricingContext: Readonly<{ channel: "staff" | "portal" | "service" | "ai"; effectiveAt: string }>;
  nestingEstimate?: NestingEstimateEvidence;
}>;

export const assertPricingCalculationRequest = (request: PricingCalculationRequest): PricingCalculationRequest => {
  const { sellableProduct, resolvedConfiguration } = request;
  if (request.organizationId !== sellableProduct.organizationId || request.organizationId !== resolvedConfiguration.organizationId) throw new Error("Pricing request organization mismatch.");
  if (sellableProduct.productId !== resolvedConfiguration.productId || sellableProduct.pricingConfiguration.id !== resolvedConfiguration.pricingConfigurationId || sellableProduct.pricingConfiguration.version !== resolvedConfiguration.pricingConfigurationVersion || sellableProduct.pricingConfiguration.contentHash !== resolvedConfiguration.pricingConfigurationContentHash) throw new Error("Pricing request product/configuration mismatch.");
  if (!Number.isSafeInteger(resolvedConfiguration.quantity) || resolvedConfiguration.quantity <= 0) throw new Error("Pricing quantity must be a positive safe integer.");
  return request;
};

export type PricingComponent = Readonly<{ kind: "base" | "option" | "minimum_charge" | "tier_adjustment" | "matrix_adjustment" | "formula_adjustment"; label: string; amount: Money }>;
export type PricingOptionImpact = Readonly<{ selectionKey: string; effectId: string; kind: "fixed" | "percent" | "multiplier" | "per_unit"; amount: Money; percentBasisPoints?: PercentageBasisPoints }>;
export type PricingTierEvidence = Readonly<{ source: "quantity" | "square_foot" | "computed_sheet"; basisValue: DecimalText; selectedTierId: string; selectedRate: DecimalText; fallbackApplied: boolean }>;
export type PricingMatrixEvidence = Readonly<{ matrixId: string; rowId: string; columnId?: string; selectedValueKeys: readonly string[] }>;
export type PricingFormulaEvidence = Readonly<{ source: "library" | "embedded"; formulaId?: string; resolvedExpression: string; resolvedConfiguration: Readonly<Record<string, JsonValue>>; variables: Readonly<Record<string, JsonValue>> }>;
export type RoundingStage = Readonly<{ stage: string; mode: string; precision: number }>;
export type RoundingEvidence = Readonly<{ policyId: string; policyVersion: string; stages: readonly RoundingStage[] }>;

/** Calculated price only. Sales decisions are intentionally absent. */
export type PricingResult = Readonly<{
  schemaVersion: 1;
  id: PricingResultId;
  evidenceFingerprint: string;
  organizationId: OrganizationId;
  currency: CurrencyCode;
  calculatedUnitAmount: Money;
  calculatedLineAmount: Money;
  components: readonly PricingComponent[];
  optionImpacts: readonly PricingOptionImpact[];
  minimumChargeApplied: boolean;
  tier?: PricingTierEvidence;
  matrix?: PricingMatrixEvidence;
  formula?: PricingFormulaEvidence;
  nestingEstimate?: NestingEstimateEvidence;
  evaluator: Readonly<{ id: string; version: string }>;
  rounding: RoundingEvidence;
  normalizedInput: ResolvedProductConfiguration;
  warnings: readonly Readonly<{ code: string; message: string }>[];
}>;

/** Rejects incomplete evidence at the Pricing boundary before Sales can snapshot it. */
export const assertPricingResultEvidence = (result: PricingResult): PricingResult => {
  if (!result.evaluator.id || !result.evaluator.version) throw new Error("PricingResult requires evaluator identity and version.");
  if (!result.rounding.policyId || !result.rounding.policyVersion || result.rounding.stages.length === 0) {
    throw new Error("PricingResult requires rounding policy and applied stages.");
  }
  if (result.currency !== result.calculatedUnitAmount.currency || result.currency !== result.calculatedLineAmount.currency) {
    throw new Error("PricingResult money must use its declared currency.");
  }
  if (result.organizationId !== result.normalizedInput.organizationId || !result.normalizedInput.productId || !result.normalizedInput.pricingConfigurationId || !result.normalizedInput.pricingConfigurationContentHash) throw new Error("PricingResult normalized input lineage is incomplete.");
  if ([...result.components.map((component) => component.amount), ...result.optionImpacts.map((impact) => impact.amount)].some((amount) => amount.currency !== result.currency)) throw new Error("PricingResult components must use its declared currency.");
  if (result.components.filter((component) => component.kind === "base").length !== 1) throw new Error("PricingResult requires exactly one base component.");
  if (!result.evidenceFingerprint) throw new Error("PricingResult requires stable evidence fingerprint.");
  return result;
};

export interface PricingPort {
  calculate(request: PricingCalculationRequest): Promise<PricingResult>;
}
