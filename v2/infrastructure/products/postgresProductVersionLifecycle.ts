import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { validateOptionTreeV2 } from "../../../shared/optionTreeV2Runtime.js";
import { optionTreeV2Schema } from "../../../shared/optionTreeV2.js";
import type {
  ProductDraftFormulaPricing,
  ProductDraftGeneral,
  ProductDraftGeneralRead,
  ProductDraftOption,
  ProductDraftOptionChoice,
  ProductDraftOptionsRead,
  ProductDraftOptionPricing,
  ProductDraftOptionPricingImpact,
  ProductDraftOptionPricingOverride,
  ProductDraftPricing,
  ProductDraftPricingMatrix,
  ProductDraftPricingMatrixDimension,
  ProductDraftPricingMatrixRow,
  ProductDraftPricingPreview,
  ProductDraftPricingTier,
  ProductVersionLifecycle,
  ProductVersionSummary,
  ProductVersionTransaction,
  ProductVersionTransactionRunner,
} from "../../src/modules/products/productVersionLifecycle.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import {
  evaluateResolvedFormula,
  V2PricingParityAdapter,
} from "../../src/modules/pricing/v2PricingAdapter.js";
import {
  resolveActivePbv2PricingInput,
  resolveProductVersionRotationPolicy,
} from "../../src/modules/products/pbv2CompatibilityResolution.js";
import { explainPricingResult } from "../../src/modules/pricing/operatorPricingExplanation.js";
import { validateProductionUnitSpecification } from "../../src/modules/shared/productionRequirements.js";
import {
  brandedId,
  currencyCode,
  decimalText,
} from "../../src/modules/shared/commercialValues.js";
import {
  extractProductOptionPricingMatrix,
  resolveProductOptionPricingMatrixBaseRateCents,
} from "../../../shared/productOptionPricingMatrix.js";
import {
  productFormulaInputsFromLibraryConfig,
  validateProductFormulaInput,
} from "../../src/modules/products/productFormulaInputs.js";
import { extractFormulaVariables } from "../../../shared/pbv2/formulaHelpers.js";

type VersionRow = {
  id: string;
  status: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED";
  schema_version: number;
  tree_json: unknown;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
};
const historyLimit = 25;
const asSummary = (row: VersionRow): ProductVersionSummary => ({
  productVersionId: row.id,
  status: row.status.toLowerCase() as ProductVersionSummary["status"],
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}),
  editable: row.status === "DRAFT",
});

const lifecycle = (
  rows: readonly VersionRow[],
  activeId: string | null,
): ProductVersionLifecycle => {
  const active = activeId
    ? rows.find((row) => row.id === activeId && row.status === "ACTIVE")
    : undefined;
  const drafts = rows.filter((row) => row.status === "DRAFT");
  const draft = drafts[0];
  const current = new Set([active?.id, draft?.id]);
  const history = rows
    .filter((row) => !current.has(row.id))
    .slice(0, historyLimit)
    .map(asSummary);
  return {
    ...(active ? { active: asSummary(active) } : {}),
    ...(draft ? { draft: asSummary(draft) } : {}),
    history,
    historyLimit,
    historyHasMore:
      rows.filter((row) => !current.has(row.id)).length > historyLimit,
    canCreateDraft: Boolean(active) && !draft,
  };
};
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const record = object;
/**
 * A newly-created Product starts as an inactive identity with a structurally
 * valid Draft tree.  The runtime graph validator requires at least one root,
 * even before the merchant has authored sellable options.
 */
export const createInitialProductDraftTree = (displayName: string) => ({
  schemaVersion: 2 as const,
  status: "DRAFT" as const,
  rootNodeIds: ["product_configuration"],
  nodes: {
    product_configuration: {
      id: "product_configuration",
      kind: "group" as const,
      label: "Product configuration",
    },
  },
  meta: {
    general: {
      displayName,
      category: null,
      description: null,
      storefrontVisible: false,
      measurementMode: "dimensions_required" as const,
      workflowIntent: "standard_production" as const,
      requiresProofApproval: false,
      requiresProductionJob: false,
    },
    pricingV2: { base: {} },
  },
});
const general = (
  tree: unknown,
  fallback: ProductDraftGeneral,
): ProductDraftGeneral => {
  const candidate = object(object(tree).meta).general;
  const value = object(candidate);
  return {
    displayName:
      typeof value.displayName === "string"
        ? value.displayName
        : fallback.displayName,
    category:
      typeof value.category === "string" ? value.category : fallback.category,
    description:
      typeof value.description === "string"
        ? value.description
        : fallback.description,
    storefrontVisible:
      typeof value.storefrontVisible === "boolean"
        ? value.storefrontVisible
        : fallback.storefrontVisible,
    measurementMode:
      value.measurementMode === "quantity_only"
        ? "quantity_only"
        : value.measurementMode === "dimensions_required"
          ? "dimensions_required"
          : fallback.measurementMode,
    workflowIntent:
      value.workflowIntent === "fulfillment_only" ||
      value.workflowIntent === "service_fee" ||
      value.workflowIntent === "standard_production"
        ? value.workflowIntent
        : fallback.workflowIntent,
    requiresProofApproval:
      typeof value.requiresProofApproval === "boolean"
        ? value.requiresProofApproval
        : fallback.requiresProofApproval,
    requiresProductionJob:
      typeof value.requiresProductionJob === "boolean"
        ? value.requiresProductionJob
        : fallback.requiresProductionJob,
    productionUnitSpecification:
      object(object(tree).meta).productionUnitSpecification === undefined ||
      object(object(tree).meta).productionUnitSpecification === null
        ? null
        : validateProductionUnitSpecification(
            object(object(tree).meta).productionUnitSpecification,
          ),
  };
};
export const draftMeasurementMode = (
  tree: unknown,
  fallback: "dimensions_required" | "quantity_only",
) => {
  const value = object(object(object(tree).meta).general).measurementMode;
  return value === "quantity_only" || value === "dimensions_required"
    ? value
    : fallback;
};
const generalFallback = (row: {
  product_name: string;
  category: string | null;
  description: string | null;
  measurement_mode: "dimensions_required" | "quantity_only";
  workflow_intent: "standard_production" | "fulfillment_only" | "service_fee";
  requires_proof_approval: boolean;
  requires_production_job: boolean;
}): ProductDraftGeneral => ({
  displayName: row.product_name,
  category: row.category,
  description: row.description,
  storefrontVisible: false,
  measurementMode: row.measurement_mode,
  workflowIntent: row.workflow_intent,
  requiresProofApproval: row.requires_proof_approval,
  requiresProductionJob: row.requires_production_job,
  productionUnitSpecification: null,
});
export const validateProductionUnitConditions = (
  specification: ProductDraftGeneral["productionUnitSpecification"],
  tree: Record<string, unknown>,
) => {
  if (!specification) return;
  const options = new Map<string, ReadonlySet<string | number | boolean>>();
  for (const source of Object.values(record(tree.nodes))) {
    const node = record(source),
      input = record(node.input);
    if (node.kind !== "question") continue;
    const selectionKey =
      typeof input.selectionKey === "string"
        ? input.selectionKey
        : typeof node.key === "string"
          ? node.key
          : typeof node.id === "string"
            ? node.id
            : "";
    const choices = new Set(
      (Array.isArray(node.choices) ? node.choices : []).flatMap((candidate) => {
        const value = record(candidate).value;
        return typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
          ? [value]
          : [];
      }),
    );
    if (selectionKey && choices.size) options.set(selectionKey, choices);
  }
  for (const rule of specification.rules) {
    if (!rule.when) continue;
    const choices = options.get(rule.when.selectionKey);
    if (!choices || !choices.has(rule.when.equals))
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "A production-unit condition must reference a choice on this Product Draft.",
      );
  }
};

type GeneralRow = {
  product_id: string;
  product_name: string;
  category: string | null;
  description: string | null;
  measurement_mode: "dimensions_required" | "quantity_only";
  workflow_intent: "standard_production" | "fulfillment_only" | "service_fee";
  requires_proof_approval: boolean;
  requires_production_job: boolean;
  draft_id: string;
  draft_updated_at: Date;
  draft_tree_json: unknown;
};
export class PostgresProductDraftGeneralReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftGeneralRead | null> {
    const result = await this.pool.query<GeneralRow>(
      `SELECT p.id product_id,p.name product_name,p.category,p.description,p.measurement_mode,p.workflow_intent,p.requires_proof_approval,p.requires_production_job,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    const row = result.rows[0];
    return row
      ? {
          productId: row.product_id,
          draftVersionId: row.draft_id,
          draftUpdatedAt: row.draft_updated_at.toISOString(),
          lifecycle: "draft",
          general: general(row.draft_tree_json, generalFallback(row)),
        }
      : null;
  }
}

const optionInputTypes = new Set([
  "boolean",
  "select",
  "multiselect",
  "number",
  "text",
  "textarea",
]);
const choiceBasedOption = (type: string) =>
  type === "select" || type === "multiselect";
/** The Draft editor owns UI input types; PBV2 owns the corresponding typed value contract. */
const pbv2ValueType = (
  type: ProductDraftOption["inputType"],
): "BOOLEAN" | "ENUM" | "NUMBER" | "TEXT" => {
  switch (type) {
    case "boolean":
      return "BOOLEAN";
    case "select":
    case "multiselect":
      return "ENUM";
    case "number":
      return "NUMBER";
    case "text":
    case "textarea":
      return "TEXT";
  }
};
const optionDefault = (input: Record<string, unknown>) =>
  input.defaultValue === undefined
    ? null
    : (input.defaultValue as ProductDraftOption["defaultValue"]);
const optionsFromTree = (tree: unknown): readonly ProductDraftOption[] => {
  const source = record(tree),
    nodes = record(source.nodes),
    roots = Array.isArray(source.rootNodeIds) ? source.rootNodeIds : [];
  return roots.flatMap((id) => {
    const node = record(nodes[String(id)]),
      input = record(node.input),
      type = input.type;
    if (
      node.kind !== "question" ||
      typeof node.id !== "string" ||
      typeof type !== "string" ||
      !optionInputTypes.has(type)
    )
      return [];
    const choices = (Array.isArray(node.choices) ? node.choices : []).flatMap(
      (choice) => {
        const value = record(choice);
        return typeof value.value === "string" &&
          typeof value.label === "string"
          ? [
              {
                choiceValue: value.value,
                label: value.label,
              } satisfies ProductDraftOptionChoice,
            ]
          : [];
      },
    );
    return [
      {
        optionId: node.id,
        label: typeof node.label === "string" ? node.label : node.id,
        inputType: type as ProductDraftOption["inputType"],
        required: Boolean(input.required),
        defaultValue: optionDefault(input),
        choices,
        canRemove: true,
      } satisfies ProductDraftOption,
    ];
  });
};
type OptionsRow = {
  product_id: string;
  draft_id: string;
  draft_updated_at: Date;
  draft_tree_json: unknown;
};
type UpdateDraftOptionsTransactionInput = Readonly<{
  organizationId: string;
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
  options: readonly ProductDraftOption[];
  staffActorUserId?: string;
}>;
type DraftOptionsAuditInput = Readonly<{
  organizationId: string;
  requestId: string;
  operation: string;
  resourceId: string;
  principalKind: "staff" | "delegated_ai" | "portal" | "service";
  principalSubject: string;
  staffActorUserId?: string;
  changedFields: readonly string[];
}>;
export class PostgresProductDraftOptionsReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftOptionsRead | null> {
    const result = await this.pool.query<OptionsRow>(
      `SELECT p.id product_id,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    const row = result.rows[0];
    return row
      ? {
          productId: row.product_id,
          draftVersionId: row.draft_id,
          draftUpdatedAt: row.draft_updated_at.toISOString(),
          lifecycle: "draft",
          options: optionsFromTree(row.draft_tree_json),
        }
      : null;
  }
}
const impactView = (value: unknown): ProductDraftOptionPricingImpact | null => {
  const impact = record(value);
  if (impact.applyWhen) return null;
  switch (impact.mode) {
    case "addFlat":
      return typeof impact.amountCents === "number"
        ? { type: "fixed", value: impact.amountCents }
        : null;
    case "addCents":
      return typeof impact.cents === "number"
        ? { type: "fixed", value: impact.cents }
        : null;
    case "addPerQty":
      return typeof impact.amountCents === "number"
        ? { type: "per_item", value: impact.amountCents }
        : null;
    case "addPerSqft":
      return typeof impact.amountCents === "number"
        ? { type: "per_square_foot", value: impact.amountCents }
        : null;
    case "percentOfBase":
      return typeof impact.percent === "number"
        ? { type: "percent_of_base", value: impact.percent }
        : null;
    case "multiplier":
      return typeof impact.factor === "number"
        ? { type: "multiplier", value: impact.factor }
        : null;
    case "addPercent":
      if (typeof impact.percent !== "number") return null;
      return impact.basis === "optionsSubtotal"
        ? { type: "percent_of_options_subtotal", value: impact.percent }
        : impact.basis === "lineSubtotal"
          ? { type: "percent_of_line_subtotal", value: impact.percent }
          : { type: "percent_of_base", value: impact.percent };
    case "addPerUnit":
      return typeof impact.centsPerUnit === "number" &&
        ["perPiece", "perQty", "perSqft", "perLinearFoot", "perInch"].includes(
          String(impact.unit),
        )
        ? {
            type:
              impact.unit === "perSqft"
                ? "per_square_foot"
                : impact.unit === "perLinearFoot"
                  ? "per_linear_foot"
                  : impact.unit === "perInch"
                    ? "per_inch"
                    : "per_item",
            value: impact.centsPerUnit,
          }
        : null;
    case "addFormula":
      return typeof impact.formula === "string" && impact.formula.trim()
        ? { type: "formula", formula: impact.formula }
        : null;
    default:
      return null;
  }
};
const impactsView = (
  values: unknown,
): readonly ProductDraftOptionPricingImpact[] | null => {
  if (!Array.isArray(values)) return [];
  const impacts = values.map(impactView);
  return impacts.some((impact) => impact === null)
    ? null
    : (impacts as ProductDraftOptionPricingImpact[]);
};
const overrideView = (
  value: unknown,
): ProductDraftOptionPricingOverride | null => {
  const override = record(value);
  if (!override || override.mode === "none") return null;
  const target =
    override.unit === "perSqft"
      ? "per_square_foot"
      : override.unit === "perPiece"
        ? "per_piece"
        : override.unit === "minimumCharge"
          ? "minimum_charge"
          : null;
  const mode =
    override.mode === "set_base_rate"
      ? "set"
      : override.mode === "add_base_rate"
        ? "add"
        : override.mode === "multiply_base_rate"
          ? "multiply"
          : null;
  return target &&
    mode &&
    typeof override.amount === "number" &&
    Number.isFinite(override.amount)
    ? { target, mode, value: override.amount }
    : null;
};
const optionPricingFromTree = (row: OptionsRow): ProductDraftOptionPricing => {
  const nodes = record(record(row.draft_tree_json).nodes);
  return {
    productId: row.product_id,
    draftVersionId: row.draft_id,
    draftUpdatedAt: row.draft_updated_at.toISOString(),
    lifecycle: "draft",
    options: Object.values(nodes)
      .map(record)
      .filter((node) => node.kind === "question" && typeof node.id === "string")
      .map((node) => {
        const input = record(node.input),
          nodeImpacts = impactsView(node.pricingImpact),
          nodeImpact = nodeImpacts?.length === 1 ? nodeImpacts[0]! : null;
        return {
          optionId: node.id!,
          selectionKey: optionSelectionKey(node),
          label: typeof node.label === "string" ? node.label : node.id!,
          nodeImpact,
          nodeImpacts: nodeImpacts ?? [],
          choices: (Array.isArray(node.choices) ? node.choices : [])
            .map(record)
            .filter((choice) => typeof choice.value === "string")
            .map((choice) => {
              const storedImpacts = Array.isArray(choice.pricingImpact)
                  ? choice.pricingImpact
                  : [],
                decodedImpacts =
                  choice.priceDeltaCents !== undefined
                    ? typeof choice.priceDeltaCents === "number"
                      ? [
                          {
                            type: "fixed" as const,
                            value: choice.priceDeltaCents,
                          },
                          ...(impactsView(storedImpacts) ?? []),
                        ]
                      : null
                    : impactsView(storedImpacts),
                override =
                  choice.pricingOverride === undefined
                    ? null
                    : overrideView(choice.pricingOverride),
                impact =
                  decodedImpacts?.length === 1 ? decodedImpacts[0]! : null,
                editable =
                  decodedImpacts !== null &&
                  (choice.pricingOverride === undefined || override !== null);
              return {
                choiceValue: choice.value as string,
                label:
                  typeof choice.label === "string"
                    ? choice.label
                    : (choice.value as string),
                impact,
                impacts: decodedImpacts ?? [],
                override,
                editable,
                ...(!editable
                  ? { readOnlyReason: "This pricing rule is read only." }
                  : {}),
              };
            }),
        };
      }),
  };
};
export class PostgresProductDraftOptionPricingReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftOptionPricing | null> {
    const result = await this.pool.query<OptionsRow>(
      `SELECT p.id product_id,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    return result.rows[0] ? optionPricingFromTree(result.rows[0]!) : null;
  }
}
const exactReference = (
  value: unknown,
  needles: ReadonlySet<string>,
): boolean => {
  if (typeof value === "string") return needles.has(value);
  if (Array.isArray(value))
    return value.some((item) => exactReference(item, needles));
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).some((item) =>
      exactReference(item, needles),
    );
  return false;
};
const optionSelectionKey = (node: Record<string, unknown>) => {
  const input = record(node.input);
  return typeof input.selectionKey === "string"
    ? input.selectionKey
    : typeof node.key === "string"
      ? node.key
      : typeof node.id === "string"
        ? node.id
        : "";
};
const removalError = (
  next: Record<string, unknown>,
  needles: readonly string[],
  kind: "option" | "choice",
) => {
  if (exactReference(next, new Set(needles.filter(Boolean))))
    throw new V2ApplicationError(
      "CONFLICT",
      kind === "option"
        ? "This option is used by the current pricing configuration."
        : "This choice is used by the current pricing configuration.",
    );
};
const matrixDimensionReference = (
  tree: Record<string, unknown>,
  selectionKey: string,
) =>
  Boolean(
    selectionKey &&
    extractProductOptionPricingMatrix(tree)?.dimensions.includes(selectionKey),
  );
const matrixChoiceReference = (
  tree: Record<string, unknown>,
  selectionKey: string,
  value: string,
) =>
  Boolean(
    selectionKey &&
    extractProductOptionPricingMatrix(tree)?.rows.some(
      (row) =>
        record(
          record(row).when ?? record(row).match ?? record(row).combination,
        )[selectionKey] === value,
    ),
  );
const pricingTier = (
  value: unknown,
  index: number,
): ProductDraftPricingTier => {
  const tier = record(value);
  return {
    tierId: typeof tier.id === "string" ? tier.id : `tier-${index}`,
    minimum: Number(tier.minQty ?? tier.minSqft ?? 1),
    maximum: typeof tier.maxQty === "number" ? tier.maxQty : null,
    perPieceCents:
      typeof tier.perPieceCents === "number" ? tier.perPieceCents : null,
    perSqftCents:
      typeof tier.perSqftCents === "number" ? tier.perSqftCents : null,
    minimumChargeCents:
      typeof tier.minimumChargeCents === "number"
        ? tier.minimumChargeCents
        : null,
  };
};
const pricingFromTree = (
  row: OptionsRow & {
    measurement_mode: "dimensions_required" | "quantity_only";
  },
): ProductDraftPricing => {
  const tree = record(row.draft_tree_json),
    meta = record(tree.meta),
    pricing = record(meta.pricingV2),
    base = record(pricing.base),
    formulaVariables = record(meta.pricingFormulaVariables),
    legacyFormulaVariables = record(meta.formulaVariables),
    flatFeeDollars =
      typeof formulaVariables.flatFee === "number"
        ? formulaVariables.flatFee
        : typeof legacyFormulaVariables.flatFee === "number"
          ? legacyFormulaVariables.flatFee
          : null,
    flatFeeCents =
      flatFeeDollars === null ? null : Math.round(flatFeeDollars * 100),
    matrix = Boolean(
      tree.pricingMatrix ||
      meta.pricingMatrix ||
      pricing.optionMatrixPricingUnit,
    ),
    formula = typeof meta.pricingFormula === "string";
  const rawQty = Array.isArray(pricing.qtyTiers) ? pricing.qtyTiers : [],
    rawSqft = Array.isArray(pricing.sqftTiers) ? pricing.sqftTiers : [],
    computed = pricing.tierBasis === "computed_sheet_usage",
    qty = computed ? [] : rawQty,
    sqft = computed ? [] : rawSqft,
    computedTiers = computed ? rawQty : [],
    tierSets = {
      quantity: qty.map(pricingTier),
      squareFoot: sqft.map(pricingTier),
      computedSheetUsage: computedTiers.map(pricingTier),
    },
    tierBasis = computed
      ? "computed_sheet_usage"
      : qty.length
        ? "quantity"
        : sqft.length
          ? "square_foot"
          : null;
  const advanced = matrix || formula || (qty.length && sqft.length) || computed;
  const mode = matrix
    ? "matrix"
    : formula
      ? "formula"
      : advanced
        ? "advanced"
        : typeof base.perPieceCents === "number" ||
            typeof base.perSqftCents === "number"
          ? qty.length || sqft.length
            ? "simple_with_tiers"
            : "simple_base"
          : "unconfigured";
  const tiers =
    tierBasis === "quantity"
      ? tierSets.quantity
      : tierBasis === "square_foot"
        ? tierSets.squareFoot
        : tierBasis === "computed_sheet_usage"
          ? tierSets.computedSheetUsage
          : [];
  return {
    productId: row.product_id,
    draftVersionId: row.draft_id,
    draftUpdatedAt: row.draft_updated_at.toISOString(),
    lifecycle: "draft",
    measurementMode: row.measurement_mode,
    mode,
    editable: !matrix,
    ...(matrix ? { unavailableReason: "Matrix pricing has its own editor." } : {}),
    base: {
      perPieceCents:
        typeof base.perPieceCents === "number" ? base.perPieceCents : null,
      perSqftCents:
        typeof base.perSqftCents === "number" ? base.perSqftCents : null,
      minimumChargeCents:
        typeof base.minimumChargeCents === "number"
          ? base.minimumChargeCents
          : null,
    },
    flatFeeCents,
    tierBasis,
    tiers,
    tierSets,
  };
};
type PricingRow = OptionsRow & {
  measurement_mode: "dimensions_required" | "quantity_only";
};
const matrixDimensions = (
  tree: Record<string, unknown>,
): ProductDraftPricingMatrixDimension[] =>
  Object.values(record(tree.nodes))
    .map(record)
    .filter(
      (node) =>
        node.kind === "question" &&
        Array.isArray(node.choices) &&
        node.choices.length > 0,
    )
    .map((node) => ({
      selectionKey: optionSelectionKey(node),
      label:
        typeof node.label === "string" ? node.label : optionSelectionKey(node),
      values: node
        .choices!.map((value: unknown) => {
          const choice = record(value);
          return typeof choice.value === "string" ||
            typeof choice.value === "number" ||
            typeof choice.value === "boolean"
            ? {
                value: choice.value,
                label:
                  typeof choice.label === "string"
                    ? choice.label
                    : String(choice.value),
              }
            : null;
        })
        .filter(
          (
            value: { value: string | number | boolean; label: string } | null,
          ): value is { value: string | number | boolean; label: string } =>
            Boolean(value),
        ),
    }))
    .filter((dimension: ProductDraftPricingMatrixDimension) => dimension.selectionKey && dimension.values.length > 0);
const matrixFromTree = (
  row: PricingRow & { product_formula_id?: string | null },
): ProductDraftPricingMatrix => {
  const tree = record(row.draft_tree_json),
    meta = record(tree.meta),
    matrix = extractProductOptionPricingMatrix(tree),
    availableDimensions = matrixDimensions(tree),
    formula =
      typeof meta.pricingFormula === "string" ||
      Boolean(row.product_formula_id),
    unit =
      record(meta.pricingV2).optionMatrixPricingUnit === "per_piece"
        ? "per_piece"
        : ("per_square_foot" as const);
  const dimensions = (matrix?.dimensions ?? [])
    .map((key) =>
      availableDimensions.find((dimension) => dimension.selectionKey === key),
    )
    .filter((value): value is ProductDraftPricingMatrixDimension =>
      Boolean(value),
    );
  const rows: ProductDraftPricingMatrix["rows"] = (matrix?.rows ?? []).map((item, index) => {
    const source = record(item),
      match = record(source.when ?? source.match ?? source.combination),
      tiers = Array.isArray(source.qtyTiers)
        ? source.qtyTiers.map(pricingTier)
        : [];
    return {
      rowId: typeof source.id === "string" ? source.id : `row-${index}`,
      combination: match as Record<string, string | number | boolean>,
      baseRateCents: resolveProductOptionPricingMatrixBaseRateCents(item) ?? 0,
      tierBasis:
        source.tierBasis === "computed_sheet_usage"
          ? "computed_sheet_usage"
          : tiers.length
            ? "quantity"
            : null,
      tiers,
    };
  });
  return {
    productId: row.product_id,
    draftVersionId: row.draft_id,
    draftUpdatedAt: row.draft_updated_at.toISOString(),
    lifecycle: "draft",
    // The resolver composes Formula and Matrix data; editing rows must not
    // require stripping a valid embedded/library Formula from the Draft.
    editable: true,
    active: Boolean(matrix),
    matrixId: matrix?.id ?? `new:matrix:${row.draft_id}`,
    pricingUnit: unit,
    availableDimensions,
    dimensions,
    rows,
    warnings:
      matrix && rows.length === 0
        ? [
            "Matrix pricing is active but has no rows. Add all option combinations before saving.",
          ]
        : [],
  };
};
const formulaRuntimeVariables = [
  "q",
  "w",
  "h",
  "sqft",
  "total_sqft",
  "computed_sheets",
  "billed_sqft",
  "base_price",
  "p",
  "sheet_price",
  "unitPrice",
] as const;
const supportsLegacyFormulaAdoption = (
  expression: string,
  variables: Record<string, number>,
  allowRotation: boolean,
): boolean => {
  try {
    evaluateResolvedFormula(
      expression,
      {
        ...Object.fromEntries(formulaRuntimeVariables.map((key) => [key, 1])),
        ...variables,
      },
      allowRotation,
    );
    return true;
  } catch {
    return false;
  }
};
type FormulaRow = PricingRow & {
  product_formula_id: string | null;
  pricing_profile_config: unknown | null;
  pricing_engine: string | null;
  product_formula: string | null;
  formula_id: string | null;
  formula_name: string | null;
  formula_expression: string | null;
  formula_config: unknown | null;
};
const rotationControlFromTree = (
  pricing: Record<string, unknown>,
):
  | { optionId: string; allowWhenChoiceValues: readonly string[] }
  | undefined => {
  const source = record(pricing.rotationControl),
    values = Array.isArray(source.allowWhenChoiceValues)
      ? source.allowWhenChoiceValues
      : [];
  if (
    typeof source.optionId !== "string" ||
    !source.optionId ||
    values.length === 0 ||
    values.some((value) => typeof value !== "string" || !value)
  )
    return undefined;
  return {
    optionId: source.optionId,
    allowWhenChoiceValues: values as string[],
  };
};
const assertRotationControlReferences = (
  tree: Record<string, unknown>,
  control:
    { optionId: string; allowWhenChoiceValues: readonly string[] } | undefined,
) => {
  if (!control) return;
  const option = record(record(tree.nodes)[control.optionId]),
    choices = Array.isArray(option.choices) ? option.choices : [];
  if (option.kind !== "question" || choices.length === 0)
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "The rotation control Option is invalid.",
    );
  const available = new Set(
    choices
      .map(record)
      .flatMap((choice) =>
        typeof choice.value === "string" ? [choice.value] : [],
      ),
  );
  if (
    new Set(control.allowWhenChoiceValues).size !==
      control.allowWhenChoiceValues.length ||
    control.allowWhenChoiceValues.some((value) => !available.has(value))
  )
    throw new V2ApplicationError(
      "VALIDATION_ERROR",
      "The rotation control Choice is invalid.",
    );
};
const numericFormulaVariables = (value: unknown) =>
  Object.fromEntries(
    Object.entries(record(value)).filter(
      ([, entry]) => typeof entry === "number" && Number.isFinite(entry),
    ),
  ) as Record<string, number>;
export const formulaFromTree = (
  row: FormulaRow,
): ProductDraftFormulaPricing => {
  const tree = record(row.draft_tree_json),
    meta = record(tree.meta),
    pricing = record(meta.pricingV2),
    profile = record(row.pricing_profile_config),
    embedded =
      typeof meta.pricingFormula === "string" && meta.pricingFormula.trim()
        ? meta.pricingFormula.trim()
        : "",
    legacyExpression = (row.product_formula ?? "").trim(),
    variables = numericFormulaVariables({
      ...record(meta.pricingFormulaVariables),
      ...record(meta.formulaVariables),
    }),
    legacyVariables = numericFormulaVariables({
      ...record(profile.variables),
      ...record(profile.formulaVariables),
    }),
    explicitEmbedded = meta.pricingFormulaSource === "embedded",
    libraryReference = !explicitEmbedded && Boolean(row.product_formula_id),
    library = Boolean(row.product_formula_id && row.formula_id),
    inputs = library
      ? productFormulaInputsFromLibraryConfig(row.formula_config)
      : Object.keys(variables).map((key) => ({ key, label: key }));
  const hasFormula = Boolean(embedded || libraryReference || legacyExpression);
  const source =
      library && inputs.length
        ? "library_product_inputs_editable"
        : libraryReference
          ? "library_reference_read_only"
          : embedded
            ? "embedded_editable"
            : legacyExpression
              ? "unsupported_legacy"
              : "none",
    expression = library ? (row.formula_expression ?? "").trim() : embedded,
    expressionEditable = source === "embedded_editable" || source === "none",
    variablesEditable =
      source === "embedded_editable" ||
      source === "library_product_inputs_editable" ||
      source === "none",
    rotationEditable = /\bsheet_consumption_sqft\s*\(/iu.test(expression),
    rotation = resolveProductVersionRotationPolicy(
      pricing,
      meta,
      row.pricing_profile_config as any,
      row.formula_config as any,
    ),
    rotationControl = rotationControlFromTree(pricing),
    unavailableReason =
      source === "library_reference_read_only"
        ? "This shared Formula Library entry has no supported ProductVersion inputs."
        : source === "unsupported_legacy"
          ? "This formula configuration is read only here."
          : undefined;
  return {
    productId: row.product_id,
    draftVersionId: row.draft_id,
    draftUpdatedAt: row.draft_updated_at.toISOString(),
    lifecycle: "draft",
    source,
    editable: expressionEditable || variablesEditable,
    expressionEditable,
    variablesEditable,
    rotationEditable,
    inputs: hasFormula ? inputs : [],
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(library
      ? {
          formulaId: row.formula_id!,
          formulaName: row.formula_name ?? undefined,
        }
      : {}),
    expression,
    ...(source === "unsupported_legacy"
      ? {
          legacyExpression,
          canAdoptLegacyFormula: supportsLegacyFormulaAdoption(
            legacyExpression,
            { ...variables, ...legacyVariables },
            rotation.allowRotation,
          ),
        }
      : {}),
    variables,
    allowRotation: rotation.allowRotation,
    ...(rotationControl ? { rotationControl } : {}),
    supportedRuntimeVariables: formulaRuntimeVariables,
    warnings: /\b(computed_sheets|billed_sqft)\b/u.test(expression)
      ? [
          "Preview uses available pricing inputs; sheet estimates are not supplied here.",
        ]
      : [],
  };
};
export class PostgresProductDraftFormulaReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftFormulaPricing | null> {
    const result = await this.pool.query<FormulaRow>(
      `SELECT p.id product_id,p.measurement_mode,COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) product_formula_id,p.pricing_profile_config,p.pricing_engine,p.pricing_formula product_formula,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,f.id formula_id,f.name formula_name,f.expression formula_expression,f.config formula_config FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' LEFT JOIN pricing_formulas f ON f.id=COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) AND f.organization_id=p.organization_id AND f.is_active=TRUE WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    return result.rows[0] ? formulaFromTree(result.rows[0]!) : null;
  }
}
export class PostgresProductDraftPricingMatrixReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftPricingMatrix | null> {
    const result = await this.pool.query<PricingRow>(
      `SELECT p.id product_id,p.measurement_mode,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    return result.rows[0] ? matrixFromTree(result.rows[0]!) : null;
  }
}
export class PostgresProductDraftPricingReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductDraftPricing | null> {
    const result = await this.pool.query<PricingRow>(
      `SELECT p.id product_id,p.measurement_mode,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    return result.rows[0] ? pricingFromTree(result.rows[0]!) : null;
  }
}
export type ProductDraftPricingPreviewInput = Readonly<{
  quantity: number;
  width?: number;
  height?: number;
  selections?: Record<string, unknown>;
}>;
export class PostgresProductDraftPricingPreview {
  constructor(private readonly pool: Pool) {}
  async preview(
    organizationId: string,
    productId: string,
    input: ProductDraftPricingPreviewInput,
  ): Promise<ProductDraftPricingPreview> {
    const result = await this.pool.query<
      PricingRow & {
        schema_version: number;
        pricing_profile_key: string | null;
        pricing_profile_config: unknown | null;
        formula_id: string | null;
        formula_code: string | null;
        formula_profile_key: string | null;
        formula_expression: string | null;
        formula_config: unknown;
        formula_updated_at: Date | null;
      }
    >(
      `SELECT p.id product_id,p.measurement_mode,p.pricing_profile_key,p.pricing_profile_config,COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) pricing_formula_id,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.schema_version,f.id formula_id,f.code formula_code,f.pricing_profile_key formula_profile_key,f.expression formula_expression,f.config formula_config,f.updated_at formula_updated_at FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' LEFT JOIN pricing_formulas f ON f.id=COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) AND f.organization_id=p.organization_id AND f.is_active=TRUE WHERE p.organization_id=$1 AND p.id=$2 ORDER BY d.updated_at DESC,d.id DESC LIMIT 1`,
      [organizationId, productId],
    );
    const row = result.rows[0];
    if (!row)
      throw new V2ApplicationError(
        "NOT_FOUND",
        "A Product Draft is unavailable.",
      );
    const measurementMode = draftMeasurementMode(
      row.draft_tree_json,
      row.measurement_mode,
    );
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Quantity must be a positive whole number.",
      );
    if (
      measurementMode !== "quantity_only" &&
      (!Number.isFinite(input.width) ||
        !Number.isFinite(input.height) ||
        input.width! <= 0 ||
        input.height! <= 0)
    )
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Width and height are required for this Product.",
      );
    const sellable = {
      organizationId: brandedId<"OrganizationId">(organizationId),
      productId: brandedId<"ProductId">(productId),
      displayName: "Draft Product",
      lifecycle: "active" as const,
      pricingConfiguration: {
        id: brandedId<"PricingConfigurationId">(row.draft_id),
        version: row.draft_updated_at.toISOString(),
        contentHash: `sha256:${createHash("sha256").update(JSON.stringify(row.draft_tree_json)).digest("hex")}`,
      },
      requiresDimensions: measurementMode !== "quantity_only",
      pricingCurrency: currencyCode("USD"),
    };
    const dimensions =
      measurementMode === "quantity_only"
        ? undefined
        : {
            width: decimalText(String(input.width)),
            height: decimalText(String(input.height)),
            unit: "in" as const,
          };
    const explicitEmbedded = record(record(row.draft_tree_json).meta)
      .pricingFormulaSource === "embedded";
    const formula =
      !explicitEmbedded &&
      row.formula_id &&
      row.formula_profile_key &&
      row.formula_expression &&
      row.formula_updated_at
        ? {
            id: row.formula_id,
            code: row.formula_code ?? row.formula_id,
            profileKey: row.formula_profile_key,
            expression: row.formula_expression,
            config: record(row.formula_config),
            updatedAt: row.formula_updated_at.toISOString(),
          }
        : null;
    const resolved = resolveActivePbv2PricingInput(
      sellable,
      {
        id: row.draft_id,
        schemaVersion: row.schema_version,
        publishedAt: row.draft_updated_at.toISOString(),
        treeJson: row.draft_tree_json,
        productMeasurementMode: measurementMode,
        productPricingProfileKey: row.pricing_profile_key,
        legacyProductPricingConfig: row.pricing_profile_config as any,
        formula,
      },
      {
        organizationId: brandedId<"OrganizationId">(organizationId),
        productId: brandedId<"ProductId">(productId),
        quantity: input.quantity,
        ...(dimensions ? { dimensions } : {}),
        selections: (input.selections ?? {}) as any,
      },
    );
    if (!resolved.ok)
      throw new V2ApplicationError(
        resolved.error.code,
        resolved.error.publicMessage,
      );
    const pricingSellable = {
      ...sellable,
      pricingConfiguration: {
        ...sellable.pricingConfiguration,
        contentHash:
          resolved.value.resolvedConfiguration.pricingConfigurationContentHash,
      },
    };
    const value = await new V2PricingParityAdapter().calculate({
      organizationId: brandedId<"OrganizationId">(organizationId),
      sellableProduct: pricingSellable,
      resolvedConfiguration: resolved.value.resolvedConfiguration,
      rules: resolved.value.rules,
      pricingContext: {
        channel: "staff",
        effectiveAt: new Date().toISOString(),
      },
      ...(resolved.value.nestingEstimate
        ? { nestingEstimate: resolved.value.nestingEstimate }
        : {}),
    });
    const area = dimensions ? (input.width! * input.height!) / 144 : undefined;
    return {
      quantity: input.quantity,
      ...(dimensions
        ? {
            dimensions: {
              width: input.width!,
              height: input.height!,
              unit: "in" as const,
              areaSquareFeet: area!,
            },
          }
        : {}),
      calculatedUnitAmount: {
        cents: value.calculatedUnitAmount.cents,
        currency: value.calculatedUnitAmount.currency,
      },
      calculatedLineAmount: {
        cents: value.calculatedLineAmount.cents,
        currency: value.calculatedLineAmount.currency,
      },
      minimumChargeApplied: value.minimumChargeApplied,
      ...(value.tier
        ? { tier: { basis: value.tier.source, value: value.tier.basisValue } }
        : {}),
      breakdown: value.components.map((component) => ({
        label: component.label,
        cents: component.amount.cents,
        currency: component.amount.currency,
      })),
      explanation: explainPricingResult(value),
      warnings: value.warnings.map((warning) => warning.message),
    };
  }
}

export class PostgresProductVersionLifecycleReader {
  constructor(private readonly pool: Pool) {}
  async read(
    organizationId: string,
    productId: string,
  ): Promise<ProductVersionLifecycle | null> {
    const product = await this.pool.query<{
      pbv2_active_tree_version_id: string | null;
    }>(
      "SELECT pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2",
      [organizationId, productId],
    );
    if (!product.rows[0]) return null;
    const versions = await this.pool.query<VersionRow>(
      `SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 ORDER BY updated_at DESC,id DESC LIMIT $3`,
      [organizationId, productId, historyLimit + 3],
    );
    return lifecycle(
      versions.rows,
      product.rows[0].pbv2_active_tree_version_id,
    );
  }
}

class PostgresProductVersionTransaction implements ProductVersionTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient) {}
  async reserve(input: Parameters<ProductVersionTransaction["reserve"]>[0]) {
    return this.requests.reserve(this.client, input);
  }
  async createDraftFromActive(
    input: Parameters<ProductVersionTransaction["createDraftFromActive"]>[0],
  ) {
    const product = await this.client.query<{
      pbv2_active_tree_version_id: string | null;
    }>(
      "SELECT pbv2_active_tree_version_id FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [input.organizationId, input.productId],
    );
    const activeId = product.rows[0]?.pbv2_active_tree_version_id;
    if (!product.rows[0])
      throw new V2ApplicationError("NOT_FOUND", "Product was not found.");
    if (!activeId)
      throw new V2ApplicationError(
        "CONFLICT",
        "This Product has no Active version to draft from.",
      );
    const active = await this.client.query<VersionRow>(
      "SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND id=$3 AND status='ACTIVE' FOR UPDATE",
      [input.organizationId, input.productId, activeId],
    );
    const source = active.rows[0];
    if (!source)
      throw new V2ApplicationError(
        "STALE_STATE",
        "The Product Active version changed. Refresh and try again.",
      );
    if (
      source.updated_at.toISOString() !==
      new Date(input.expectedActiveVersionUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "The Product Active version changed. Refresh and try again.",
      );
    const existing = await this.client.query<VersionRow>(
      "SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [input.organizationId, input.productId],
    );
    if (existing.rows[0])
      throw new V2ApplicationError(
        "CONFLICT",
        "A Draft already exists for this Product.",
      );
    const now = new Date();
    const inserted = await this.client.query<VersionRow>(
      "INSERT INTO pbv2_tree_versions(organization_id,product_id,status,schema_version,tree_json,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES($1,$2,'DRAFT',$3,$4::jsonb,$5,$5,$6,$6) RETURNING id,status,schema_version,tree_json,created_at,updated_at,published_at",
      [
        input.organizationId,
        input.productId,
        source.schema_version,
        JSON.stringify(source.tree_json),
        input.staffActorUserId ?? null,
        now,
      ],
    );
    // A recipe belongs to a Product Version, never to the mutable Product row.
    // Starting a new draft therefore copies the current active definition and its
    // material snapshots; edits to the new draft cannot rewrite prior versions.
    const sourceRecipe = await this.client.query<{ id: string }>(
      "SELECT id FROM v2_product_recipes WHERE organization_id=$1 AND product_id=$2 AND product_version_id=$3 FOR UPDATE",
      [input.organizationId, input.productId, activeId],
    );
    if (sourceRecipe.rows[0]) {
      const draftRecipe = await this.client.query<{ id: string }>(
        "INSERT INTO v2_product_recipes(organization_id,product_id,product_version_id,updated_by_user_id) VALUES($1,$2,$3,$4) RETURNING id",
        [
          input.organizationId,
          input.productId,
          inserted.rows[0]!.id,
          input.staffActorUserId ?? null,
        ],
      );
      await this.client.query(
        `INSERT INTO v2_product_recipe_components(
          organization_id,recipe_id,material_id,position,quantity,quantity_unit,quantity_kind,
          material_name_snapshot,material_sku_snapshot,condition_option_id,condition_choice_value,replaces_pbv2_compatibility
        ) SELECT organization_id,$2,material_id,position,quantity,quantity_unit,quantity_kind,
        material_name_snapshot,material_sku_snapshot,condition_option_id,condition_choice_value,replaces_pbv2_compatibility
        FROM v2_product_recipe_components WHERE organization_id=$1 AND recipe_id=$3`,
        [
          input.organizationId,
          draftRecipe.rows[0]!.id,
          sourceRecipe.rows[0].id,
        ],
      );
    }
    // Routing selection is version-owned just like the recipe.  Copy the
    // complete frozen definition snapshot so Draft edits cannot rewrite the
    // prior Active Product Version or orders formed from it.
    await this.client.query(
      `INSERT INTO v2_product_version_routing_specs(
        organization_id,product_id,product_version_id,routing_mode,route_template_id,
        source_template_revision,source_template_fingerprint,steps_json,updated_by_user_id
      ) SELECT organization_id,product_id,$4,routing_mode,route_template_id,
        source_template_revision,source_template_fingerprint,steps_json,$5
      FROM v2_product_version_routing_specs
      WHERE organization_id=$1 AND product_id=$2 AND product_version_id=$3`,
      [
        input.organizationId,
        input.productId,
        activeId,
        inserted.rows[0]!.id,
        input.staffActorUserId ?? null,
      ],
    );
    const all = await this.client.query<VersionRow>(
      "SELECT id,status,schema_version,tree_json,created_at,updated_at,published_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 ORDER BY updated_at DESC,id DESC LIMIT $3",
      [input.organizationId, input.productId, historyLimit + 3],
    );
    return {
      draftId: inserted.rows[0]!.id,
      lifecycle: lifecycle(all.rows, activeId),
    };
  }
  async createProductWithInitialDraft(
    input: Parameters<
      NonNullable<ProductVersionTransaction["createProductWithInitialDraft"]>
    >[0],
  ) {
    const productId = randomUUID(),
      draftId = randomUUID(),
      now = new Date();
    // A new identity begins inactive and without an Active pointer.  Existing
    // publication validation is the only operation that can activate it.
    const tree = createInitialProductDraftTree(input.displayName);
    const valid = validateOptionTreeV2(tree as any),
      complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "CONFLICT",
        "The initial Product Draft could not be initialized.",
      );
    await this.client.query(
      "INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,workflow_intent,requires_proof_approval,requires_production_job,created_at,updated_at) VALUES($1,$2,$3::text,$3::text,FALSE,'dimensions_required','standard_production',FALSE,FALSE,$4,$4)",
      [productId, input.organizationId, input.displayName, now],
    );
    const inserted = await this.client.query<{ id: string; updated_at: Date }>(
      "INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'DRAFT',2,$4::jsonb,$5,$5,$6,$6) RETURNING id,updated_at",
      [
        draftId,
        input.organizationId,
        productId,
        JSON.stringify(tree),
        input.staffActorUserId ?? null,
        now,
      ],
    );
    return {
      productId,
      draftVersionId: inserted.rows[0]!.id,
      draftUpdatedAt: inserted.rows[0]!.updated_at.toISOString(),
    };
  }
  async succeed(
    organizationId: string,
    requestId: string,
    draftId: string,
    result: unknown,
  ) {
    await this.requests.succeed(this.client, organizationId, requestId, {
      resourceType: "product_version",
      resourceId: draftId,
      resultJson: result,
    });
  }
  async attribute(
    input: Parameters<ProductVersionTransaction["attribute"]>[0],
  ) {
    await this.requests.recordAttribution(this.client, {
      organizationId: input.organizationId,
      operationRequestId: input.requestId,
      operation: input.operation,
      resourceType: "product_version",
      resourceId: input.resourceId,
      principalKind: input.principalKind,
      principalSubject: input.principalSubject,
      staffActorUserId: input.staffActorUserId,
    });
  }
  async audit(input: Parameters<ProductVersionTransaction["audit"]>[0]) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_created','product_version',$4,$5,$6,$7,'[]'::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        input.staffActorUserId ?? null,
      ],
    );
  }
  async updateDraftGeneral(
    input: NonNullable<
      ProductVersionTransaction["updateDraftGeneral"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ): Promise<ProductDraftGeneralRead> {
    const product = await this.client.query<{ id: string }>(
      "SELECT id FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [input.organizationId, input.productId],
    );
    if (!product.rows[0])
      throw new V2ApplicationError("NOT_FOUND", "Product was not found.");
    const draft = await this.client.query<GeneralRow & { status: string }>(
      `SELECT p.id product_id,p.name product_name,p.category,p.description,p.measurement_mode,p.workflow_intent,p.requires_proof_approval,p.requires_production_job,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = draft.rows[0];
    if (!row || row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    const tree = structuredClone(object(row.draft_tree_json));
    validateProductionUnitConditions(
      input.general.productionUnitSpecification,
      tree,
    );
    const meta = structuredClone(object(tree.meta));
    const { productionUnitSpecification, ...general } = input.general;
    tree.meta = { ...meta, general, productionUnitSpecification };
    const now = new Date();
    const updated = await this.client.query<{ updated_at: Date }>(
      "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=$2,updated_by_user_id=$3 WHERE organization_id=$4 AND product_id=$5 AND id=$6 AND status='DRAFT' RETURNING updated_at",
      [
        JSON.stringify(tree),
        now,
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
      ],
    );
    if (!updated.rows[0])
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    return {
      productId: row.product_id,
      draftVersionId: row.draft_id,
      draftUpdatedAt: updated.rows[0].updated_at.toISOString(),
      lifecycle: "draft",
      general: input.general,
    };
  }
  async auditDraftGeneral(
    input: NonNullable<ProductVersionTransaction["auditDraftGeneral"]> extends (
      value: infer Value,
    ) => unknown
      ? Value
      : never,
  ) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_general_updated','product_version',$4,$5,$6,$7,$8::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        input.staffActorUserId ?? null,
        JSON.stringify(input.changedFields.map((field) => ({ field }))),
      ],
    );
  }
  async updateDraftPricing(
    input: NonNullable<
      ProductVersionTransaction["updateDraftPricing"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ): Promise<ProductDraftPricing> {
    const locked = await this.client.query<PricingRow & { status: string }>(
      `SELECT p.id product_id,p.measurement_mode,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = locked.rows[0];
    if (!row)
      throw new V2ApplicationError("NOT_FOUND", "Product Draft was not found.");
    if (row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    if (!pricingFromTree(row).editable)
      throw new V2ApplicationError(
        "CONFLICT",
        "Advanced pricing is not editable here yet.",
      );
    if (
      row.measurement_mode === "quantity_only" &&
      input.base.perSqftCents !== null
    )
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Quantity-only products use per-piece pricing.",
      );
    const tree = structuredClone(record(row.draft_tree_json)),
      meta = structuredClone(record(tree.meta)),
      pricing = structuredClone(record(meta.pricingV2)),
      base = record(pricing.base);
    for (const [key, value] of Object.entries(input.base)) {
      if (value === null) delete base[key];
      else base[key] = value;
    }
    const formulaVariables = structuredClone(
      record(meta.pricingFormulaVariables),
    );
    if (input.flatFeeCents !== undefined) {
      if (input.flatFeeCents === null) delete formulaVariables.flatFee;
      else formulaVariables.flatFee = input.flatFeeCents / 100;
    }
    const legacySets = {
      quantity: input.tierBasis === "quantity" ? input.tiers : [],
      squareFoot: input.tierBasis === "square_foot" ? input.tiers : [],
      computedSheetUsage:
        input.tierBasis === "computed_sheet_usage" ? input.tiers : [],
    };
    const sets = input.tierSets ?? legacySets;
    const serialize = (
      tiers: readonly ProductDraftPricingTier[],
      basis: "quantity" | "squareFoot" | "computedSheetUsage",
    ) =>
      tiers.map((tier) => ({
        id: tier.tierId.startsWith("new:")
          ? `tier:${randomUUID()}`
          : tier.tierId,
        ...(basis === "squareFoot"
          ? { minSqft: tier.minimum }
          : { minQty: tier.minimum, maxQty: tier.maximum }),
        ...(tier.perPieceCents === null
          ? {}
          : { perPieceCents: tier.perPieceCents }),
        ...(tier.perSqftCents === null
          ? {}
          : { perSqftCents: tier.perSqftCents }),
        ...(tier.minimumChargeCents === null
          ? {}
          : { minimumChargeCents: tier.minimumChargeCents }),
      }));
    pricing.base = base;
    if (sets.computedSheetUsage.length) {
      pricing.qtyTiers = serialize(
        sets.computedSheetUsage,
        "computedSheetUsage",
      );
      delete pricing.sqftTiers;
      pricing.tierBasis = "computed_sheet_usage";
    } else {
      pricing.qtyTiers = serialize(sets.quantity, "quantity");
      pricing.sqftTiers = serialize(sets.squareFoot, "squareFoot");
      pricing.tierBasis = "line_item_quantity";
    }
    tree.meta = {
      ...meta,
      pricingV2: pricing,
      pricingFormulaVariables: formulaVariables,
    };
    const valid = validateOptionTreeV2(tree as any),
      complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "The resulting Product pricing is invalid.",
      );
    const updated = await this.client.query<{ updated_at: Date }>(
      "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT' RETURNING updated_at",
      [
        JSON.stringify(tree),
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
      ],
    );
    if (!updated.rows[0])
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    return pricingFromTree({
      ...row,
      draft_tree_json: tree,
      draft_updated_at: updated.rows[0].updated_at,
    });
  }
  async auditDraftPricing(
    input: NonNullable<ProductVersionTransaction["auditDraftPricing"]> extends (
      value: infer Value,
    ) => unknown
      ? Value
      : never,
  ) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_pricing_updated','product_version',$4,$5,$6,$7,$8::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        null,
        JSON.stringify(input.changedFields.map((field) => ({ field }))),
      ],
    );
  }
  async updateDraftPricingMatrix(
    input: NonNullable<
      ProductVersionTransaction["updateDraftPricingMatrix"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ): Promise<ProductDraftPricingMatrix> {
    const locked = await this.client.query<PricingRow & { status: string }>(
      `SELECT p.id product_id,p.measurement_mode,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = locked.rows[0];
    if (!row)
      throw new V2ApplicationError("NOT_FOUND", "Product Draft was not found.");
    if (row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    const current = matrixFromTree(row),
      tree = structuredClone(record(row.draft_tree_json)),
      meta = structuredClone(record(tree.meta)),
      matrix = input.matrix;
    if (!current.editable)
      throw new V2ApplicationError(
        "CONFLICT",
        current.unavailableReason ?? "Matrix pricing is read only.",
      );
    const persist = async () => {
      const updated = await this.client.query<{ updated_at: Date }>(
        "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT' RETURNING updated_at",
        [
          JSON.stringify(tree),
          input.staffActorUserId ?? null,
          input.organizationId,
          input.productId,
          input.draftVersionId,
        ],
      );
      if (!updated.rows[0])
        throw new V2ApplicationError(
          "CONFLICT",
          "Only the current Draft can be edited.",
        );
      return matrixFromTree({
        ...row,
        draft_tree_json: tree,
        draft_updated_at: updated.rows[0].updated_at,
      });
    };
    if (!matrix.active) {
      delete tree.pricingMatrix;
      const nextMeta = { ...record(tree.meta) },
        pricing = record(nextMeta.pricingV2);
      delete nextMeta.pricingMatrix;
      delete pricing.optionMatrixPricingUnit;
      nextMeta.pricingV2 = pricing;
      tree.meta = nextMeta;
      return persist();
    }
    if (
      (matrix.pricingUnit !== "per_piece" &&
        matrix.pricingUnit !== "per_square_foot") ||
      !matrix.matrixId.trim() ||
      !matrix.dimensions.length ||
      new Set(matrix.dimensions).size !== matrix.dimensions.length
    )
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Matrix dimensions are invalid.",
      );
    const options = new Map(
      Object.values(record(tree.nodes))
        .map(record)
        .filter((node) => node.kind === "question")
        .map((node) => [optionSelectionKey(node), node] as const),
    );
    for (const dimension of matrix.dimensions) {
      const option = options.get(dimension);
      if (
        !option ||
        !Array.isArray(option.choices) ||
        option.choices.length === 0
      )
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "Matrix dimensions must reference choice-based options.",
        );
    }
    // A persisted Matrix is always total over its declared choice dimensions.
    // This prevents a Draft from reaching Publish in a state that the Pricing
    // spine must fail closed for an unmatched line-item configuration.
    const expectedCombinations = new Set<string>();
    const collectExpected = (index: number, values: unknown[]): void => {
      if (index === matrix.dimensions.length) {
        expectedCombinations.add(JSON.stringify(values));
        return;
      }
      for (const choice of options
        .get(matrix.dimensions[index]!)!
        .choices!.map((item: unknown) => record(item).value))
        collectExpected(index + 1, [...values, choice]);
    };
    collectExpected(0, []);
    const rowIds = new Set<string>(),
      combinations = new Set<string>();
    const rows = matrix.rows.map((entry) => {
      const baseRateCents = entry.baseRateCents;
      if (
        !entry.rowId.trim() ||
        rowIds.has(entry.rowId) ||
        !Number.isSafeInteger(baseRateCents) ||
        (baseRateCents ?? -1) < 0
      )
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "Matrix row pricing is invalid.",
        );
      rowIds.add(entry.rowId);
      const combination: Record<string, string | number | boolean> = {};
      for (const dimension of matrix.dimensions) {
        const value = entry.combination[dimension],
          option = options.get(dimension)!;
        if (
          value === undefined ||
          !option
            .choices!.map((item: unknown) => record(item).value)
            .some((choice: unknown) => choice === value)
        )
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            "A matrix row contains an invalid option value.",
          );
        combination[dimension] = value;
      }
      if (
        Object.keys(entry.combination).some(
          (key) => !matrix.dimensions.includes(key),
        )
      )
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "A matrix row contains an unknown dimension.",
        );
      const key = JSON.stringify(
        matrix.dimensions.map((dimension) => combination[dimension]),
      );
      if (combinations.has(key))
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "Matrix rows cannot use the same option combination.",
        );
      combinations.add(key);
      let prior = 0;
      for (const tier of entry.tiers) {
        if (
          !Number.isSafeInteger(tier.minimum) ||
          tier.minimum < 1 ||
          tier.minimum <= prior ||
          (tier.maximum !== null &&
            (!Number.isSafeInteger(tier.maximum) ||
              tier.maximum < tier.minimum)) ||
          (tier.perPieceCents !== null &&
            (!Number.isSafeInteger(tier.perPieceCents) ||
              tier.perPieceCents < 0)) ||
          (tier.perSqftCents !== null &&
            (!Number.isSafeInteger(tier.perSqftCents) ||
              tier.perSqftCents < 0)) ||
          (tier.minimumChargeCents !== null &&
            (!Number.isSafeInteger(tier.minimumChargeCents) ||
              tier.minimumChargeCents < 0)) ||
          (tier.perPieceCents !== null && tier.perSqftCents !== null)
        )
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            "Matrix row tiers are invalid.",
          );
        prior = tier.minimum;
      }
      return {
        id: entry.rowId.startsWith("new:")
          ? `matrix-row:${randomUUID()}`
          : entry.rowId,
        when: combination,
        variables: { base_price: (baseRateCents as number) / 100 },
        ...(entry.tiers.length
          ? {
              qtyTiers: entry.tiers.map((tier) => ({
                id: tier.tierId.startsWith("new:")
                  ? `matrix-tier:${randomUUID()}`
                  : tier.tierId,
                minQty: tier.minimum,
                maxQty: tier.maximum,
                ...(tier.perPieceCents === null
                  ? {}
                  : { perPieceCents: tier.perPieceCents }),
                ...(tier.perSqftCents === null
                  ? {}
                  : { perSqftCents: tier.perSqftCents }),
                ...(tier.minimumChargeCents === null
                  ? {}
                  : { minimumChargeCents: tier.minimumChargeCents }),
              })),
              tierBasis:
                entry.tierBasis === "computed_sheet_usage"
                  ? "computed_sheet_usage"
                  : "product_default",
            }
          : {}),
      };
    });
    if (
      combinations.size !== expectedCombinations.size ||
      [...expectedCombinations].some((key) => !combinations.has(key))
    )
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Matrix rows must cover every selected option combination.",
      );
    const next = {
      id: matrix.matrixId.startsWith("new:")
        ? `matrix:${randomUUID()}`
        : matrix.matrixId,
      dimensions: [...matrix.dimensions],
      rows,
    };
    tree.meta = {
      ...meta,
      pricingV2: {
        ...record(meta.pricingV2),
        optionMatrixPricingUnit: matrix.pricingUnit,
      },
    };
    if (Object.prototype.hasOwnProperty.call(tree, "pricingMatrix"))
      tree.pricingMatrix = next;
    else tree.meta = { ...record(tree.meta), pricingMatrix: next };
    const valid = validateOptionTreeV2(tree as any),
      complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "The resulting Product pricing matrix is invalid.",
      );
    return persist();
  }
  async auditDraftPricingMatrix(
    input: NonNullable<
      ProductVersionTransaction["auditDraftPricingMatrix"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_pricing_matrix_updated','product_version',$4,$5,$6,$7,$8::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        null,
        JSON.stringify(input.changedFields.map((field) => ({ field }))),
      ],
    );
  }
  async updateDraftFormulaPricing(
    input: NonNullable<
      ProductVersionTransaction["updateDraftFormulaPricing"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ): Promise<ProductDraftFormulaPricing> {
    const locked = await this.client.query<FormulaRow & { status: string }>(
      `SELECT p.id product_id,p.measurement_mode,COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) product_formula_id,p.pricing_profile_config,p.pricing_engine,p.pricing_formula product_formula,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status,f.id formula_id,f.name formula_name,f.expression formula_expression,f.config formula_config FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id LEFT JOIN pricing_formulas f ON f.id=COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) AND f.organization_id=p.organization_id AND f.is_active=TRUE WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE OF p,d`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = locked.rows[0];
    if (!row)
      throw new V2ApplicationError("NOT_FOUND", "Product Draft was not found.");
    if (row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    const currentRead = formulaFromTree(row);
    const selectedLibrary = input.formula.source === "library"
      ? await this.client.query<{id:string;name:string;expression:string;config:unknown}>(
          "SELECT id,name,expression,config FROM pricing_formulas WHERE organization_id=$1 AND id=$2 AND is_active=TRUE LIMIT 1",
          [input.organizationId, input.formula.formulaId],
        )
      : null;
    const library = selectedLibrary?.rows[0];
    if (input.formula.source === "library" && !library)
      throw new V2ApplicationError("VALIDATION_ERROR", "The selected Formula Library entry is unavailable.");
    const current = input.formula.source === "library" ? {
      ...currentRead,
      source: productFormulaInputsFromLibraryConfig(library!.config).length ? "library_product_inputs_editable" as const : "library_reference_read_only" as const,
      formulaId: library!.id,
      formulaName: library!.name,
      expression: library!.expression,
      variables: numericFormulaVariables(
        extractFormulaVariables(library!.config as Record<string, unknown>),
      ),
      expressionEditable: false,
      variablesEditable: productFormulaInputsFromLibraryConfig(library!.config).length > 0,
      editable: productFormulaInputsFromLibraryConfig(library!.config).length > 0,
      inputs: productFormulaInputsFromLibraryConfig(library!.config),
    } : input.formula.source === "embedded" ? {
      ...currentRead,
      source: "embedded_editable" as const,
      expressionEditable: true,
      variablesEditable: true,
      editable: true,
      inputs: Object.keys(input.formula.variables).map((key) => ({ key, label: key })),
    } : currentRead;
    if (!current || (!current.editable && !current.rotationEditable))
      throw new V2ApplicationError(
        "CONFLICT",
        current?.unavailableReason ??
          "This Formula configuration is read only.",
      );

    // The shared Formula Library expression is never accepted from the
    // browser. Library mode obtains it from the tenant-scoped record locked
    // above; embedded mode owns the submitted ProductVersion expression.
    const expression = input.formula.source === "library"
      ? library!.expression.trim()
      : input.formula.expression.trim();
    if (!expression || expression.length > 1000)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Formula expression is invalid.",
      );
    if (!current.expressionEditable && expression !== current.expression)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Shared Formula Library expressions are read only.",
      );

    const variables: Record<string, number> = current.expressionEditable
      ? {}
      : { ...current.variables };
    if (current.expressionEditable) {
      for (const [key, value] of Object.entries(input.formula.variables)) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key) ||
          formulaRuntimeVariables.includes(
            key as (typeof formulaRuntimeVariables)[number],
          ) ||
          !Number.isFinite(value)
        )
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            "Formula variables are invalid.",
          );
        variables[key] = value;
      }
    } else if (current.variablesEditable) {
      const editableInputs = new Map(
        current.inputs.map((value) => [value.key, value]),
      );
      for (const [key, value] of Object.entries(input.formula.variables)) {
        const definition = editableInputs.get(key);
        if (!definition) {
          if (variables[key] !== value)
            throw new V2ApplicationError(
              "VALIDATION_ERROR",
              "Formula variables are invalid.",
            );
          continue;
        }
        const valid = validateProductFormulaInput(definition, value);
        if (valid == null)
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            `${definition.label} is invalid.`,
          );
        variables[key] = valid;
      }
      for (const definition of current.inputs)
        if (
          validateProductFormulaInput(definition, variables[definition.key]) ==
          null
        )
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            `${definition.label} is required.`,
          );
    } else {
      for (const [key, value] of Object.entries(input.formula.variables))
        if (variables[key] !== value)
          throw new V2ApplicationError(
            "VALIDATION_ERROR",
            "Formula variables are read only.",
          );
    }

    try {
      evaluateResolvedFormula(
        current.expressionEditable ? expression : current.expression,
        {
          ...Object.fromEntries(formulaRuntimeVariables.map((key) => [key, 1])),
          ...variables,
        },
        input.formula.allowRotation,
      );
    } catch (error) {
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        error instanceof Error
          ? error.message
          : "Formula expression is invalid.",
      );
    }

    const tree = structuredClone(record(row.draft_tree_json));
    assertRotationControlReferences(tree, input.formula.rotationControl);
    const meta = structuredClone(record(tree.meta));
    const variableKey =
      Object.prototype.hasOwnProperty.call(meta, "pricingFormulaVariables") &&
      !Object.prototype.hasOwnProperty.call(meta, "formulaVariables")
        ? "pricingFormulaVariables"
        : "formulaVariables";
    const pricingV2: Record<string, unknown> = {
      ...record(meta.pricingV2),
      allowRotation: input.formula.allowRotation,
    };
    if (input.formula.rotationControl)
      pricingV2.rotationControl = {
        optionId: input.formula.rotationControl.optionId,
        allowWhenChoiceValues: [
          ...input.formula.rotationControl.allowWhenChoiceValues,
        ],
      };
    else delete pricingV2.rotationControl;
    tree.meta = input.formula.source === "embedded"
      ? {
          ...meta,
          pricingFormula: expression,
          pricingFormulaSource: "embedded",
          [variableKey]: variables,
          pricingV2,
        }
      : {
          ...meta,
          pricingFormulaId: library!.id,
          pricingFormulaSource: "library",
          pricingFormula: undefined,
          [variableKey]: variables,
          pricingV2,
        };
    const valid = validateOptionTreeV2(tree as any),
      complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "The resulting Product Formula is invalid.",
      );
    const updated = await this.client.query<{ updated_at: Date }>(
      "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT' RETURNING updated_at",
      [
        JSON.stringify(tree),
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
      ],
    );
    if (!updated.rows[0])
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    return formulaFromTree({
      ...row,
      draft_tree_json: tree,
      draft_updated_at: updated.rows[0].updated_at,
    })!;
  }
  async adoptLegacyProductFormula(
    input: NonNullable<
      ProductVersionTransaction["adoptLegacyProductFormula"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ): Promise<ProductDraftFormulaPricing> {
    const locked = await this.client.query<FormulaRow & { status: string }>(
      `SELECT p.id product_id,p.measurement_mode,COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) product_formula_id,p.pricing_profile_config,p.pricing_engine,p.pricing_formula product_formula,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status,f.id formula_id,f.name formula_name,f.expression formula_expression,f.config formula_config FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id LEFT JOIN pricing_formulas f ON f.id=COALESCE(NULLIF(d.tree_json #>> '{meta,pricingFormulaId}',''),p.pricing_formula_id) AND f.organization_id=p.organization_id AND f.is_active=TRUE WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE OF p,d`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = locked.rows[0];
    if (!row)
      throw new V2ApplicationError("NOT_FOUND", "Product Draft was not found.");
    if (row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    if (row.product_formula_id)
      throw new V2ApplicationError(
        "CONFLICT",
        "A Formula Library reference cannot be adopted as a legacy Product Formula.",
      );
    const expression = row.product_formula?.trim();
    if (!expression || expression.length > 1000)
      throw new V2ApplicationError(
        "CONFLICT",
        "No valid legacy Product Formula is available to adopt.",
      );
    const tree = structuredClone(record(row.draft_tree_json));
    const meta = structuredClone(record(tree.meta));
    if (typeof meta.pricingFormula === "string" && meta.pricingFormula.trim())
      throw new V2ApplicationError(
        "CONFLICT",
        "This Draft already owns a ProductVersion Formula.",
      );
    const legacy = record(row.pricing_profile_config);
    const variables = numericFormulaVariables({
      ...record(meta.pricingFormulaVariables),
      ...record(meta.formulaVariables),
      ...record(legacy.variables),
      ...record(legacy.formulaVariables),
    });
    const rotation = resolveProductVersionRotationPolicy(
      record(meta.pricingV2),
      meta,
      row.pricing_profile_config as any,
      null,
    );
    try {
      evaluateResolvedFormula(
        expression,
        {
          ...Object.fromEntries(formulaRuntimeVariables.map((key) => [key, 1])),
          ...variables,
        },
        rotation.allowRotation,
      );
    } catch (error) {
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        error instanceof Error
          ? error.message
          : "The legacy Product Formula is invalid.",
      );
    }
    const variableKey =
      Object.prototype.hasOwnProperty.call(meta, "pricingFormulaVariables") &&
      !Object.prototype.hasOwnProperty.call(meta, "formulaVariables")
        ? "pricingFormulaVariables"
        : "formulaVariables";
    tree.meta = {
      ...meta,
      pricingFormula: expression,
      [variableKey]: variables,
    };
    const valid = validateOptionTreeV2(tree as any),
      complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "The resulting Product Formula is invalid.",
      );
    const updated = await this.client.query<{ updated_at: Date }>(
      "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT' RETURNING updated_at",
      [
        JSON.stringify(tree),
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
      ],
    );
    if (!updated.rows[0])
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    return formulaFromTree({
      ...row,
      draft_tree_json: tree,
      draft_updated_at: updated.rows[0].updated_at,
    })!;
  }
  async auditDraftFormulaPricing(
    input: NonNullable<
      ProductVersionTransaction["auditDraftFormulaPricing"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_pricing_formula_updated','product_version',$4,$5,$6,$7,$8::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        input.staffActorUserId ?? null,
        JSON.stringify(input.changedFields.map((field) => ({ field }))),
      ],
    );
  }
  async updateDraftOptionPricing(
    input: NonNullable<
      ProductVersionTransaction["updateDraftOptionPricing"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ): Promise<ProductDraftOptionPricing> {
    const locked = await this.client.query<
      OptionsRow & {
        status: string;
        measurement_mode: "dimensions_required" | "quantity_only";
      }
    >(
      `SELECT p.id product_id,p.measurement_mode,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = locked.rows[0];
    if (!row || row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    const tree = structuredClone(record(row.draft_tree_json)),
      node = record(record(tree.nodes)[input.optionPricing.optionId]);
    if (!node || node.kind !== "question")
      throw new V2ApplicationError("NOT_FOUND", "Option was not found.");
    const encode = (impact: ProductDraftOptionPricingImpact) => {
      if (impact.type === "fixed")
        return { mode: "addFlat", amountCents: impact.value };
      if (impact.type === "per_item")
        return { mode: "addPerQty", amountCents: impact.value };
      if (impact.type === "per_square_foot")
        return { mode: "addPerSqft", amountCents: impact.value };
      if (impact.type === "per_linear_foot")
        return {
          mode: "addPerUnit",
          centsPerUnit: impact.value,
          unit: "perLinearFoot",
        };
      if (impact.type === "per_inch")
        return {
          mode: "addPerUnit",
          centsPerUnit: impact.value,
          unit: "perInch",
        };
      if (impact.type === "percent_of_base")
        return { mode: "addPercent", percent: impact.value, basis: "base" };
      if (impact.type === "percent_of_options_subtotal")
        return {
          mode: "addPercent",
          percent: impact.value,
          basis: "optionsSubtotal",
        };
      if (impact.type === "percent_of_line_subtotal")
        return {
          mode: "addPercent",
          percent: impact.value,
          basis: "lineSubtotal",
        };
      if (impact.type === "formula")
        return { mode: "addFormula", formula: impact.formula };
      return { mode: "multiplier", factor: impact.value };
    };
    const encodeOverride = (override: ProductDraftOptionPricingOverride) => ({
      mode:
        override.mode === "set"
          ? "set_base_rate"
          : override.mode === "add"
            ? "add_base_rate"
            : "multiply_base_rate",
      amount: override.value,
      unit:
        override.target === "per_square_foot"
          ? "perSqft"
          : override.target === "per_piece"
            ? "perPiece"
            : "minimumCharge",
      appliesTo:
        override.target === "per_square_foot"
          ? "area"
          : override.target === "per_piece"
            ? "quantity"
            : "base",
    });
    const requestedImpacts = Object.hasOwn(input.optionPricing, "impacts")
      ? input.optionPricing.impacts!
      : input.optionPricing.impact === undefined
        ? undefined
        : input.optionPricing.impact === null
          ? []
          : [input.optionPricing.impact];
    if (
      row.measurement_mode === "quantity_only" &&
      requestedImpacts?.some((impact) => impact.type === "per_square_foot")
    )
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "Quantity-only Products cannot use a per-square-foot option price.",
      );
    if (input.optionPricing.choiceValue === undefined) {
      if (input.optionPricing.override !== undefined)
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "Only a Choice may override a base rate.",
        );
      if (impactsView(node.pricingImpact) === null)
        throw new V2ApplicationError(
          "CONFLICT",
          "This pricing rule is read only.",
        );
      if (requestedImpacts !== undefined) {
        if (requestedImpacts.length)
          node.pricingImpact = requestedImpacts.map(encode);
        else delete node.pricingImpact;
      }
    } else {
      const choices = Array.isArray(node.choices) ? node.choices : [],
        choice = choices
          .map(record)
          .find((value) => value.value === input.optionPricing.choiceValue);
      if (!choice)
        throw new V2ApplicationError("NOT_FOUND", "Choice was not found.");
      if (
        impactsView(choice.pricingImpact) === null ||
        (choice.pricingOverride !== undefined &&
          choice.pricingOverride !== null &&
          overrideView(choice.pricingOverride) === null)
      )
        throw new V2ApplicationError(
          "CONFLICT",
          "This pricing rule is read only.",
        );
      if (requestedImpacts !== undefined) {
        if (
          Object.hasOwn(choice, "priceDeltaCents") &&
          requestedImpacts.length === 1 &&
          requestedImpacts[0]?.type === "fixed"
        ) {
          choice.priceDeltaCents = requestedImpacts[0].value;
          delete choice.pricingImpact;
        } else {
          delete choice.priceDeltaCents;
          if (requestedImpacts.length)
            choice.pricingImpact = requestedImpacts.map(encode);
          else delete choice.pricingImpact;
        }
      }
      if (input.optionPricing.override !== undefined) {
        if (input.optionPricing.override)
          choice.pricingOverride = encodeOverride(input.optionPricing.override);
        else delete choice.pricingOverride;
      }
    }
    const valid = validateOptionTreeV2(tree as any),
      complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "The resulting Product pricing is invalid.",
      );
    const updated = await this.client.query<{ updated_at: Date }>(
      "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT' RETURNING updated_at",
      [
        JSON.stringify(tree),
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
      ],
    );
    return optionPricingFromTree({
      ...row,
      draft_tree_json: tree,
      draft_updated_at: updated.rows[0]!.updated_at,
    });
  }
  async auditDraftOptionPricing(
    input: NonNullable<
      ProductVersionTransaction["auditDraftOptionPricing"]
    > extends (value: infer Value) => unknown
      ? Value
      : never,
  ) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_option_pricing_updated','product_version',$4,$5,$6,$7,$8::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        null,
        JSON.stringify(input.changedFields.map((field) => ({ field }))),
      ],
    );
  }
  async updateDraftOptions(
    input: UpdateDraftOptionsTransactionInput,
  ): Promise<ProductDraftOptionsRead> {
    const product = await this.client.query<{ id: string }>(
      "SELECT id FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [input.organizationId, input.productId],
    );
    if (!product.rows[0])
      throw new V2ApplicationError("NOT_FOUND", "Product was not found.");
    const locked = await this.client.query<OptionsRow & { status: string }>(
      `SELECT p.id product_id,d.id draft_id,d.updated_at draft_updated_at,d.tree_json draft_tree_json,d.status FROM products p JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id WHERE p.organization_id=$1 AND p.id=$2 AND d.id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    );
    const row = locked.rows[0];
    if (!row || row.status !== "DRAFT")
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    if (
      row.draft_updated_at.toISOString() !==
      new Date(input.expectedDraftUpdatedAt).toISOString()
    )
      throw new V2ApplicationError(
        "STALE_STATE",
        "This Draft changed elsewhere. Refresh and try again.",
      );
    const tree = structuredClone(record(row.draft_tree_json));
    const nodes = structuredClone(record(tree.nodes));
    const roots = Array.isArray(tree.rootNodeIds)
      ? [...tree.rootNodeIds].map(String)
      : [];
    const current = optionsFromTree(tree);
    const currentById = new Map(
      current.map((option) => [option.optionId, option]),
    );
    const nextIds = new Set<string>();
    const generatedIds = new Map<string, string>();
    for (const option of input.options) {
      if (currentById.has(option.optionId)) {
        nextIds.add(option.optionId);
        continue;
      }
      if (!option.optionId.startsWith("new:"))
        throw new V2ApplicationError(
          "VALIDATION_ERROR",
          "An option identity is invalid.",
        );
      const id = `opt_${randomUUID().replace(/-/gu, "")}`;
      generatedIds.set(option.optionId, id);
      nextIds.add(id);
    }
    const removed = current.filter((option) => !nextIds.has(option.optionId));
    for (const removedOption of removed) {
      const node = record(nodes[removedOption.optionId]);
      if (matrixDimensionReference(tree, optionSelectionKey(node)))
        throw new V2ApplicationError(
          "CONFLICT",
          "This option is used by the current pricing configuration.",
        );
      delete nodes[removedOption.optionId];
      const remainingRoots = roots.filter(
        (id) => id !== removedOption.optionId,
      );
      const candidate = { ...tree, nodes, rootNodeIds: remainingRoots };
      removalError(
        candidate,
        [removedOption.optionId, optionSelectionKey(node)],
        "option",
      );
    }
    for (const currentOption of current) {
      const requested = input.options.find(
          (option) => option.optionId === currentOption.optionId,
        ),
        node = record(nodes[currentOption.optionId]);
      if (
        !requested ||
        !matrixDimensionReference(tree, optionSelectionKey(node))
      )
        continue;
      const retained = new Set(
        requested.choices.map((choice) => choice.choiceValue),
      );
      if (
        currentOption.choices.some(
          (choice) => !retained.has(choice.choiceValue),
        )
      )
        throw new V2ApplicationError(
          "CONFLICT",
          "This choice is used by the current pricing configuration.",
        );
    }
    const optionIds: string[] = [];
    for (const option of input.options) {
      const id = currentById.has(option.optionId)
        ? option.optionId
        : generatedIds.get(option.optionId)!;
      const existing = record(nodes[id]);
      if (existing.id && existing.kind !== "question")
        throw new V2ApplicationError(
          "CONFLICT",
          "This option cannot be edited here.",
        );
      const priorInput = record(existing.input);
      if (existing.id && priorInput.type !== option.inputType)
        throw new V2ApplicationError(
          "CONFLICT",
          "Change this option type in a later Product Builder step.",
        );
      const priorChoices = Array.isArray(existing.choices)
        ? existing.choices
        : [];
      const priorByValue = new Map(
        priorChoices.flatMap((choice) => {
          const entry = record(choice);
          return typeof entry.value === "string"
            ? [[entry.value, entry] as const]
            : [];
        }),
      );
      const nextChoices: Record<string, unknown>[] = [];
      const incomingValues = new Set<string>();
      for (const choice of option.choices) {
        const existingChoice = priorByValue.get(choice.choiceValue);
        const value = choice.choiceValue;
        if (existingChoice) incomingValues.add(choice.choiceValue);
        nextChoices.push({
          ...existingChoice,
          value,
          label: choice.label,
          sortOrder: nextChoices.length,
        });
      }
      for (const [value] of priorByValue) {
        if (incomingValues.has(value)) continue;
        if (
          matrixChoiceReference(tree, optionSelectionKey(existing), value) ||
          matrixDimensionReference(tree, optionSelectionKey(existing))
        )
          throw new V2ApplicationError(
            "CONFLICT",
            "This choice is used by the current pricing configuration.",
          );
        const candidate = structuredClone(tree);
        const candidateNode = record(record(candidate.nodes)[id]);
        candidateNode.choices = (candidateNode.choices as unknown[]).filter(
          (item) => record(item).value !== value,
        );
        record(candidate.nodes)[id] = candidateNode;
        removalError(candidate, [value], "choice");
      }
      const defaultValue = option.defaultValue;
      const inputValue: Record<string, unknown> = {
        ...priorInput,
        type: option.inputType,
        valueType: pbv2ValueType(option.inputType),
        required: option.required,
        selectionKey:
          typeof priorInput.selectionKey === "string"
            ? priorInput.selectionKey
            : id,
      };
      if (defaultValue === null) delete inputValue.defaultValue;
      else inputValue.defaultValue = defaultValue;
      nodes[id] = {
        ...existing,
        id,
        kind: "question",
        label: option.label,
        input: inputValue,
        ...(choiceBasedOption(option.inputType)
          ? { choices: nextChoices }
          : {}),
      };
      if (!choiceBasedOption(option.inputType))
        delete record(nodes[id]).choices;
      optionIds.push(id);
    }
    const retainedRoots = roots.filter((id) => !currentById.has(id));
    tree.nodes = nodes;
    tree.rootNodeIds = [...retainedRoots, ...optionIds];
    const valid = validateOptionTreeV2(tree as any);
    const complete = optionTreeV2Schema.safeParse(tree);
    if (!valid.ok || !complete.success)
      throw new V2ApplicationError(
        "VALIDATION_ERROR",
        "The resulting Product options are invalid.",
      );
    const now = new Date();
    const updated = await this.client.query<{ updated_at: Date }>(
      "UPDATE pbv2_tree_versions SET tree_json=$1::jsonb,updated_at=$2,updated_by_user_id=$3 WHERE organization_id=$4 AND product_id=$5 AND id=$6 AND status='DRAFT' RETURNING updated_at",
      [
        JSON.stringify(tree),
        now,
        input.staffActorUserId ?? null,
        input.organizationId,
        input.productId,
        input.draftVersionId,
      ],
    );
    if (!updated.rows[0])
      throw new V2ApplicationError(
        "CONFLICT",
        "Only the current Draft can be edited.",
      );
    return {
      productId: row.product_id,
      draftVersionId: row.draft_id,
      draftUpdatedAt: updated.rows[0].updated_at.toISOString(),
      lifecycle: "draft",
      options: optionsFromTree(tree),
    };
  }
  async auditDraftOptions(input: DraftOptionsAuditInput) {
    await this.client.query(
      "INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'product_draft_options_updated','product_version',$4,$5,$6,$7,$8::jsonb)",
      [
        input.organizationId,
        input.requestId,
        input.operation,
        input.resourceId,
        input.principalKind,
        input.principalSubject,
        input.staffActorUserId ?? null,
        JSON.stringify(input.changedFields.map((field) => ({ field }))),
      ],
    );
  }
}

export class PostgresProductVersionTransactionRunner implements ProductVersionTransactionRunner {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(
    action: (tx: ProductVersionTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(
        new PostgresProductVersionTransaction(client),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
