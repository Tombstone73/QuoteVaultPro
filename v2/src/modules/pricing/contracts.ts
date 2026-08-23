import type {
  CurrencyCode, DecimalText, JsonValue, Money, OrganizationId, PercentageBasisPoints,
  PricingConfigurationId, PricingResultId, ProductId, ProductTypeId,
} from "../shared/commercialValues.js";
import type { SellableProductConfiguration } from "../products/contracts.js";
import type { ProductionRequirementSnapshot } from "../shared/productionRequirements.js";

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
  /** Frozen configured Product/PBV2 output requirements; absent only for pre-M2.2.1 history. */
  productionRequirements?: ProductionRequirementSnapshot;
}>;

export type NestingEstimateEvidence = Readonly<{
  estimateId: string;
  calculatorVersion: string;
  facts: Readonly<Record<string, JsonValue>>;
}>;
export type PricingTierRule = Readonly<{ id: string; minQuantity: number; maxQuantity?: number; perPieceCents?: number; perSquareFootCents?: DecimalText; minimumChargeCents?: number }>;
/**
 * A published V1 configuration can carry independent quantity and area tier
 * schedules.  Keep those schedules distinct at the compatibility boundary;
 * collapsing them into one list loses the commercial meaning of the other
 * schedule.
 */
export type PricingTierFamily = Readonly<{ basis: "quantity" | "square_foot" | "computed_sheet"; tiers: readonly PricingTierRule[] }>;
export type PricingMatrixRow = Readonly<{ id: string; when: Readonly<Record<string, string | boolean | number>>; tierBasis?: "quantity" | "square_foot" | "computed_sheet"; tiers?: readonly PricingTierRule[]; perPieceCents?: number; perSquareFootCents?: DecimalText }>;
/**
 * Typed compatibility projection for V1 PBV2 impacts. Formula values are
 * dollar-valued, matching the established PBV2 evaluator contract; all other
 * monetary quantities are cents unless their kind documents a multiplier.
 */
export type PricingOptionRule = Readonly<{
  id: string;
  selectionKey: string;
  whenValue?: string | boolean | number;
  kind: "fixed" | "per_unit" | "per_square_foot" | "per_linear_foot" | "per_inch" | "percent" | "percent_of_options_subtotal" | "percent_of_line_subtotal" | "multiplier" | "formula";
  amount?: number;
  percentBasisPoints?: PercentageBasisPoints;
  formula?: string;
}>;
/** A typed compatibility projection for established PBV2 choice base-rate overrides. */
export type PricingBaseRateOverride = Readonly<{
  id: string;
  selectionKey: string;
  whenValue: string | boolean | number;
  kind: "set_per_square_foot" | "add_per_square_foot" | "multiply_per_square_foot" | "set_per_piece" | "add_per_piece" | "multiply_per_piece" | "set_minimum_charge" | "add_minimum_charge" | "multiply_minimum_charge";
  /** cents for set/add rules; present as a compatibility field for all kinds. */
  amountCents?: number;
  /** scalar factor for multiply rules. */
  factor?: number;
}>;
/** Explicit resolved pricing inputs supplied by a future Product/PBV2 compatibility reader. */
export type PricingRules = Readonly<{
  base: Readonly<{ perPieceCents?: number; perSquareFootCents?: DecimalText; flatFeeCents?: number }>;
  minimumChargeCents?: number;
  tierBasis?: "quantity" | "square_foot" | "computed_sheet";
  tiers?: readonly PricingTierRule[];
  /** Independent V1 tier schedules; canonical consumers select each expressly. */
  tierFamilies?: readonly PricingTierFamily[];
  matrix?: Readonly<{ id: string; dimensions: readonly string[]; rows: readonly PricingMatrixRow[] }>;
  formula?: Readonly<{ id: string; source: "formula_revision" | "library" | "embedded" | "legacy_product"; version: string; contentHash: string; expression: string; variables: Readonly<Record<string, JsonValue>> }>;
  optionImpacts?: readonly PricingOptionRule[];
  baseRateOverrides?: readonly PricingBaseRateOverride[];
}>;

export type PricingCalculationRequest = Readonly<{
  organizationId: OrganizationId;
  sellableProduct: SellableProductConfiguration;
  resolvedConfiguration: ResolvedProductConfiguration;
  pricingContext: Readonly<{ channel: "staff" | "portal" | "service" | "ai"; effectiveAt: string }>;
  rules: PricingRules;
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
export type PricingOptionImpact = Readonly<{
  selectionKey: string;
  effectId: string;
  kind: PricingOptionRule["kind"];
  amount: Money;
  percentBasisPoints?: PercentageBasisPoints;
  /** Canonical inputs used for this impact; this is evidence, never a PBV2 tree. */
  basis?: Readonly<Record<string, JsonValue>>;
}>;
export type PricingTierEvidence = Readonly<{ source: "quantity" | "square_foot" | "computed_sheet"; basisValue: DecimalText; selectedTierId: string; selectedRate: DecimalText; fallbackApplied: boolean }>;
export type PricingMatrixEvidence = Readonly<{ matrixId: string; rowId: string; columnId?: string; selectedValueKeys: readonly string[] }>;
export type PricingFormulaEvidence = Readonly<{ source: "formula_revision" | "library" | "embedded" | "legacy_product"; formulaId?: string; version: string; contentHash: string; resolvedExpression: string; resolvedConfiguration: Readonly<Record<string, JsonValue>>; variables: Readonly<Record<string, JsonValue>> }>;
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
  /** A line total is authoritative; a display unit amount can have a rounding residual. */
  unitAmountEvidence: Readonly<{ exactUnitCents: DecimalText; allocation: "rounded_line_total_divided_by_quantity" }>;
  components: readonly PricingComponent[];
  optionImpacts: readonly PricingOptionImpact[];
  minimumChargeApplied: boolean;
  tier?: PricingTierEvidence;
  matrix?: PricingMatrixEvidence;
  formula?: PricingFormulaEvidence;
  nestingEstimate?: NestingEstimateEvidence;
  /** Source dimensions and the inches normalized for calculation, if geometry was used. */
  calculationDimensions?: Readonly<{ source: DimensionInput; widthIn: DecimalText; heightIn: DecimalText }>;
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
  const exactUnitCents = Number(result.unitAmountEvidence.exactUnitCents);
  if (!Number.isFinite(exactUnitCents) || result.unitAmountEvidence.allocation !== "rounded_line_total_divided_by_quantity" || result.calculatedUnitAmount.cents !== Math.round(result.calculatedLineAmount.cents / result.normalizedInput.quantity)) {
    throw new Error("PricingResult unit amount must be a declared display allocation of its authoritative line total.");
  }
  if ([...result.components.map((component) => component.amount), ...result.optionImpacts.map((impact) => impact.amount)].some((amount) => amount.currency !== result.currency)) throw new Error("PricingResult components must use its declared currency.");
  if (result.components.filter((component) => component.kind === "base").length !== 1) throw new Error("PricingResult requires exactly one base component.");
  if (result.components.reduce((total, component) => total + component.amount.cents, 0) !== result.calculatedLineAmount.cents) throw new Error("PricingResult components must reconcile to its calculated line amount.");
  if (result.minimumChargeApplied !== result.components.some((component) => component.kind === "minimum_charge")) throw new Error("PricingResult minimum-charge evidence is inconsistent.");
  if (result.formula && (!result.formula.version || !result.formula.contentHash)) throw new Error("PricingResult formula evidence requires immutable version and content hash.");
  if (!result.evidenceFingerprint) throw new Error("PricingResult requires stable evidence fingerprint.");
  return result;
};

export interface PricingPort {
  calculate(request: PricingCalculationRequest): Promise<PricingResult>;
}
