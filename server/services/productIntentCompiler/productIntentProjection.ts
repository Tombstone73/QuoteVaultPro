import { createHash } from "node:crypto";
import { parseProductDraftIntent, productDraftIntentFingerprint, type ProductDraftIntent } from "@shared/productDraftIntent";
import type { ProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";
import { optionTreeV2Schema, validateOptionTreeV2 } from "@shared/optionTreeV2";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";
import { buildProductIntakeQuantityMetadata, type ProductIntakeQuantityPricingBehavior } from "@shared/productIntakeQuantityMetadata";

/** A structured pre-write failure; callers must not fall back to legacy intake. */
export class ProductIntentProjectionError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) { super(message); }
}

export type ProjectedProductBuilderDraft = {
  product: {
    name: string; category: string; description: string; pricingMode: "area" | "quantity";
    measurementMode: "dimensions_required" | "quantity_only"; pricingEngine: "pricingProfile";
    pricingProfileKey: "default" | "qty_only" | "fee" | "hourly"; requiresProductionJob: boolean;
    requiresProofApproval: boolean; isService: boolean; isTaxable: boolean; isActive: false;
  };
  treeJson: Record<string, unknown>;
  relationships: {
    productionRoute: { id: string; label: string } | null;
    material: { state: "resolved"; id: string; label: string } | { state: "explicitly_unset" };
  };
  audit: { contractVersion: 1; intentId: string; revision: number; fingerprint: string; fieldMetadata: Record<string, unknown> };
};

function assert(value: unknown, code: string, message: string, path?: string): asserts value {
  if (!value) throw new ProductIntentProjectionError(code, message, path);
}
function stableId(prefix: string, key: string): string {
  const readable = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "value";
  return `${prefix}_${readable}_${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
}
function valueKey(values: readonly { key: string }[], key: string): boolean { return values.some((value) => value.key === key); }

function assertReady(intent: ProductDraftIntent): void {
  assert(intent.lifecycle.productStatus === "inactive" && !intent.lifecycle.published, "LIFECYCLE_NOT_INACTIVE", "Only inactive, unpublished intents can create a Product Builder draft.", "lifecycle");
  assert(intent.state === "ready_for_review" || intent.state === "awaiting_confirmation", "INTENT_NOT_READY", "Only a fully resolved intent ready for review can be projected.", "state");
  assert(intent.identity.category.state === "resolved", "CATEGORY_UNRESOLVED", "A tenant-resolved category is required before projection.", "identity.category");
  assert(intent.material.state !== "unresolved", "MATERIAL_UNRESOLVED", "Material must be resolved or explicitly unset before projection.", "material");
  assert(intent.production.route.state !== "unresolved", "ROUTE_UNRESOLVED", "Production route must be resolved or explicitly unset before projection.", "production.route");
  assert(intent.pricing.model !== "unresolved", "PRICING_UNRESOLVED", "Pricing must be resolved before projection.", "pricing");
  for (const group of intent.optionGroups) {
    assert(!(group.inputType == null && group.required && group.selectionMode === "single" && group.values.every((value) => !value.isDefault)), "OPTION_DEFAULT_UNRESOLVED", `A default is required for option group '${group.label}' before projection.`, `optionGroups.${group.key}.default`);
  }
  if (intent.pricing.model === "one_dimensional_matrix" || intent.pricing.model === "two_dimensional_matrix") {
    assert(intent.pricing.unit !== "unresolved", "PRICING_UNIT_UNRESOLVED", "Matrix pricing must be per piece or per square foot before projection.", "pricing.unit");
  }
  assert(intent.unresolvedFields.length === 0, "UNRESOLVED_FIELDS", "All unresolved fields must be resolved before projection.", "unresolvedFields");
  assert(intent.workflow.kind !== "service_fee" || !intent.workflow.requiresProductionJob, "SERVICE_FEE_PRODUCTION_JOB", "Service fees cannot create production jobs.", "workflow.requiresProductionJob");
  assert(intent.production.route.state === "explicitly_unset" || intent.workflow.requiresProductionJob, "ROUTE_WITHOUT_PRODUCTION_JOB", "A production route requires a production job.", "production.route");
  if (intent.measurement.mode === "quantity_only") {
    const pricingDoesNotUseLineItemQuantity = intent.pricing.model === "scalar" && (intent.pricing.unit === "per_hour" || intent.pricing.unit === "flat_fee");
    assert(intent.quantity.behavior !== "not_applicable" || pricingDoesNotUseLineItemQuantity, "QUANTITY_ONLY_QUANTITY_UNCONFIGURED", "Quantity-only products must declare a customer-entered or fixed quantity behavior unless pricing is a fixed service fee or collected from billable hours.", "quantity");
    assert(!(intent.pricing.model === "scalar" && intent.pricing.unit === "per_square_foot"), "SQUARE_FOOT_QUANTITY_ONLY", "Per-square-foot pricing requires dimensions or fixed dimensions.", "pricing");
    assert(!(intent.pricing.model === "quantity_tiers" && intent.pricing.unit === "per_square_foot"), "SQUARE_FOOT_QUANTITY_ONLY", "Per-square-foot quantity tiers require dimensions or fixed dimensions.", "pricing");
    assert(!(intent.pricing.model === "option_quantity_tiers" && intent.pricing.unit === "per_square_foot"), "SQUARE_FOOT_QUANTITY_ONLY", "Per-square-foot option quantity tiers require dimensions or fixed dimensions.", "pricing");
  }
}

function buildOptions(intent: ProductDraftIntent) {
  const nodes: Record<string, unknown> = {}; const rootNodeIds: string[] = []; const edges: Record<string, unknown>[] = [];
  const groups = new Map<string, ProductDraftIntent["optionGroups"][number]>();
  intent.optionGroups.forEach((group) => {
    assert(!groups.has(group.key), "OPTION_GROUP_DUPLICATE", `Option group '${group.key}' is duplicated.`, "optionGroups");
    groups.set(group.key, group);
  });
  intent.optionGroups.forEach((group, index) => {
    const structuralGroupKey = group.parentGroupKey ?? group.key;
    const structuralGroup = groups.get(structuralGroupKey);
    assert(!group.parentGroupKey || structuralGroup, "OPTION_PARENT_GROUP_MISSING", `Parent group '${group.parentGroupKey}' is not declared.`, `optionGroups.${group.key}.parentGroupKey`);
    const groupId = stableId("intent_group", structuralGroupKey); const nodeId = stableId("intent_input", group.key);
    rootNodeIds.push(nodeId);
    nodes[groupId] ??= { id: groupId, kind: "group", type: "GROUP", status: "ENABLED", key: `${structuralGroupKey}_group`, label: structuralGroup?.label ?? group.label, displayOrder: index + 1, input: { type: "select", required: structuralGroup?.required ?? group.required } };
    const defaults = group.values.filter((value) => value.isDefault).map((value) => value.key);
    const inputType = group.inputType ?? (group.selectionMode === "multiple" ? "multiselect" : "select");
    nodes[nodeId] = {
      id: nodeId, kind: "question", type: "INPUT", status: "ENABLED", key: group.key, label: group.label, ui: { sortOrder: index + 1 },
      input: { type: inputType, required: group.required, selectionKey: group.key, valueType: group.inputType ? "TEXT" : "ENUM", ...(!group.inputType ? { constraints: { select: { allowEmpty: !group.required } } } : {}), ...(defaults.length ? { defaultValue: group.selectionMode === "multiple" ? defaults : defaults[0] } : {}) },
      ...(group.availableWhen ? { visibility: { rules: [{ type: "equals", selectionKey: group.availableWhen.optionGroupKey, value: group.availableWhen.optionValueKey }] } } : {}),
      ...(!group.inputType ? { choices: group.values.map((value, valueIndex) => ({
        id: `${nodeId}_choice_${valueIndex + 1}`,
        value: value.key,
        label: value.label,
        sortOrder: valueIndex + 1,
        ...((value.priceImpact || value.totalPercentOfBaseWhenEnabled) ? {
          pricingImpact: [{
            mode: "addPercent" as const,
            percent: value.priceImpact?.percent ?? totalImpactDelta(value, groups),
            basis: "base" as const,
            label: `${value.label} adjustment`,
          }],
        } : {}),
      })) } : {}),
    };
    edges.push({ id: `${groupId}_edge`, fromNodeId: groupId, toNodeId: nodeId, status: "DISABLED" });
  });
  return { nodes, rootNodeIds, edges, groups };
}

function totalImpactDelta(value: ProductDraftIntent["optionGroups"][number]["values"][number], groups: Map<string, ProductDraftIntent["optionGroups"][number]>): number {
  const total = value.totalPercentOfBaseWhenEnabled;
  assert(total, "OPTION_TOTAL_IMPACT_INVALID", "A total option impact is required.", "optionGroups");
  const prerequisiteGroup = groups.get(total.prerequisite.optionGroupKey);
  const prerequisite = prerequisiteGroup?.values.find((candidate) => candidate.key === total.prerequisite.optionValueKey);
  assert(prerequisite && prerequisite.priceImpact, "OPTION_TOTAL_IMPACT_PREREQUISITE_INVALID", "A total option impact requires an existing percentage prerequisite.", "optionGroups");
  const delta = total.percent - prerequisite.priceImpact.percent;
  assert(delta >= -100 && delta <= 100, "OPTION_TOTAL_IMPACT_DELTA_INVALID", "The derived option impact is outside supported bounds.", "optionGroups");
  return delta;
}

function buildMatrix(intent: ProductDraftIntent, groups: Map<string, ProductDraftIntent["optionGroups"][number]>): ProductOptionPricingMatrix | null {
  if (intent.pricing.model === "option_quantity_tiers") {
    const group = groups.get(intent.pricing.optionKey);
    assert(group, "MATRIX_OPTION_MISSING", `Pricing option '${intent.pricing.optionKey}' is not declared.`, "pricing.optionKey");
    const expected = new Set(group.values.map((value) => value.key));
    const rows = intent.pricing.rows.map((row, rowIndex) => {
      assert(expected.has(row.option), "MATRIX_CELL_UNKNOWN", `Tier row '${row.option}' does not belong to its option group.`, "pricing.rows");
      return { id: stableId("intent_matrix", row.option), when: { [intent.pricing.optionKey]: row.option }, tierBasis: "line_item_quantity" as const, qtyTiers: row.tiers.map((tier, tierIndex) => ({ id: `intent_row_${rowIndex + 1}_tier_${tierIndex + 1}`, label: tier.maximumQuantity === null ? `${tier.minimumQuantity}+` : `${tier.minimumQuantity}-${tier.maximumQuantity}`, minQty: tier.minimumQuantity, maxQty: tier.maximumQuantity, ...(intent.pricing.unit === "per_piece" ? { perPieceCents: tier.priceCents } : { perSqftCents: tier.priceCents }) })) };
    });
    assert(new Set(intent.pricing.rows.map((row) => row.option)).size === expected.size && intent.pricing.rows.length === expected.size, "MATRIX_CELL_MISSING", "Every option value requires one quantity-tier schedule.", "pricing.rows");
    return { dimensions: [intent.pricing.optionKey], rows };
  }
  if (intent.pricing.model === "one_dimensional_matrix") {
    const group = groups.get(intent.pricing.optionKey);
    assert(group, "MATRIX_OPTION_MISSING", `Pricing option '${intent.pricing.optionKey}' is not declared.`, "pricing.optionKey");
    const expected = new Set(group.values.map((value) => value.key));
    const rows: ProductOptionPricingMatrix["rows"] = [];
    for (const value of group.values) {
      const matching = intent.pricing.cells.filter((cell) => cell.option === value.key);
      assert(matching.length === 1, matching.length ? "MATRIX_CELL_DUPLICATE" : "MATRIX_CELL_MISSING", `Matrix cell '${value.label}' must appear exactly once.`, "pricing.cells");
      rows.push({ id: stableId("intent_matrix", value.key), when: { [intent.pricing.optionKey]: value.key }, variables: { base_price: matching[0]!.priceCents } });
    }
    for (const cell of intent.pricing.cells) assert(expected.has(cell.option), "MATRIX_CELL_UNKNOWN", `Matrix cell '${cell.option}' does not belong to its option group.`, "pricing.cells");
    return { dimensions: [intent.pricing.optionKey], rows };
  }
  if (intent.pricing.model !== "two_dimensional_matrix") return null;
  const { rowOptionKey, columnOptionKey, cells } = intent.pricing;
  const row = groups.get(rowOptionKey); const column = groups.get(columnOptionKey);
  assert(row, "MATRIX_ROW_OPTION_MISSING", `Matrix row option '${rowOptionKey}' is not declared.`, "pricing.rowOptionKey");
  assert(column, "MATRIX_COLUMN_OPTION_MISSING", `Matrix column option '${columnOptionKey}' is not declared.`, "pricing.columnOptionKey");
  const expected = new Set<string>(); const rows: ProductOptionPricingMatrix["rows"] = [];
  for (const rowValue of row.values) for (const columnValue of column.values) {
    const key = `${rowValue.key}\u0000${columnValue.key}`; expected.add(key);
    const matching = cells.filter((cell) => cell.row === rowValue.key && cell.column === columnValue.key);
    assert(matching.length === 1, matching.length ? "MATRIX_CELL_DUPLICATE" : "MATRIX_CELL_MISSING", `Matrix cell '${rowValue.label}' × '${columnValue.label}' must appear exactly once.`, "pricing.cells");
    rows.push({ id: stableId("intent_matrix", key), when: { [rowOptionKey]: rowValue.key, [columnOptionKey]: columnValue.key }, variables: { base_price: matching[0]!.priceCents } });
  }
  for (const cell of cells) assert(valueKey(row.values, cell.row) && valueKey(column.values, cell.column) && expected.has(`${cell.row}\u0000${cell.column}`), "MATRIX_CELL_UNKNOWN", `Matrix cell '${cell.row}' × '${cell.column}' does not belong to its option groups.`, "pricing.cells");
  return { dimensions: [rowOptionKey, columnOptionKey], rows };
}

/**
 * PBV2's default profile is explicitly square-foot formula pricing. Every
 * canonical per-piece shape must select the existing quantity-only evaluator
 * instead, including option matrices whose rate is resolved from a cell.
 */
function pricingProfileKeyFor(pricing: ProductDraftIntent["pricing"]): "default" | "qty_only" | "fee" | "hourly" {
  if (pricing.model === "scalar" && pricing.unit === "flat_fee") return "fee";
  if (pricing.model === "scalar" && pricing.unit === "per_hour") return "hourly";
  if (
    (pricing.model === "scalar" && pricing.unit === "per_piece")
    || (pricing.model === "quantity_tiers" && pricing.unit === "per_piece")
    || ((pricing.model === "one_dimensional_matrix" || pricing.model === "two_dimensional_matrix" || pricing.model === "option_quantity_tiers") && pricing.unit === "per_piece")
  ) return "qty_only";
  return "default";
}

function quantityPricingBehaviorFor(pricing: ProductDraftIntent["pricing"]): ProductIntakeQuantityPricingBehavior {
  if (pricing.model === "quantity_tiers") return pricing.unit === "per_piece" ? "quantity_tiers" : "per_square_foot";
  if (pricing.model === "option_quantity_tiers") return pricing.unit === "per_piece" ? "quantity_tiers" : "per_square_foot";
  if (pricing.model === "one_dimensional_matrix" || pricing.model === "two_dimensional_matrix") return pricing.unit === "per_piece" ? "per_piece" : "per_square_foot";
  if (pricing.model === "scalar") return pricing.unit;
  throw new ProductIntentProjectionError("PRICING_UNRESOLVED", "Resolved pricing is required before building quantity metadata.", "pricing");
}

function quantityMetadataForIntent(intent: ProductDraftIntent) {
  const fixedQuantity = intent.quantity.behavior === "fixed" ? intent.quantity.quantity : undefined;
  const pricing = intent.pricing;
  return buildProductIntakeQuantityMetadata({
    behavior: intent.quantity.behavior,
    confidence: 100,
    quantityOnly: intent.measurement.mode === "quantity_only",
    pricingBehavior: quantityPricingBehaviorFor(pricing),
    matrixAxes: pricing.model === "one_dimensional_matrix" || pricing.model === "option_quantity_tiers" ? [pricing.optionKey] : pricing.model === "two_dimensional_matrix" ? [pricing.rowOptionKey, pricing.columnOptionKey] : [],
    ...(fixedQuantity === undefined ? {} : { fixedQuantity }),
    ...(pricing.model === "scalar" && pricing.unit === "per_hour" ? { customerFacingOptionGenerated: true, notes: "Billable hours are entered as a fractional PBV2 service field." } : {}),
  });
}

/** Pure, deterministic intent → Product Builder/PBV2 projection. No DB access. */
export function projectProductDraftIntentToProductBuilderDraft(rawIntent: unknown): ProjectedProductBuilderDraft {
  const intent = parseProductDraftIntent(rawIntent); assertReady(intent);
  const optionTree = buildOptions(intent); const matrix = buildMatrix(intent, optionTree.groups);
  const pricing = intent.pricing;
  const isFee = pricing.model === "scalar" && pricing.unit === "flat_fee";
  const isHourly = pricing.model === "scalar" && pricing.unit === "per_hour";
  const pricingProfileKey = pricingProfileKeyFor(pricing);
  assert(!isFee || intent.workflow.kind === "service_fee", "FLAT_FEE_WORKFLOW_INVALID", "Flat-fee pricing requires the service-fee workflow.", "workflow.kind");
  const perSqft = pricing.model === "scalar" && pricing.unit === "per_square_foot" ? pricing.priceCents : null;
  const perPiece = pricing.model === "scalar" && pricing.unit === "per_piece" ? pricing.priceCents : null;
  const minimumCharge = pricing.model === "scalar" || pricing.model === "one_dimensional_matrix" || pricing.model === "two_dimensional_matrix" || pricing.model === "quantity_tiers" || pricing.model === "option_quantity_tiers" ? pricing.minimumChargeCents ?? null : null;
  const pricingV2 = {
    unitSystem: "imperial" as const, tierBasis: "line_item_quantity" as const,
    base: { perSqftCents: perSqft, perPieceCents: perPiece, minimumChargeCents: minimumCharge },
    ...(pricing.model === "quantity_tiers" ? { qtyTiers: pricing.tiers.map((tier, index) => ({ id: `intent_tier_${index + 1}`, label: tier.maximumQuantity === null ? `${tier.minimumQuantity}+` : `${tier.minimumQuantity}-${tier.maximumQuantity}`, minQty: tier.minimumQuantity, maxQty: tier.maximumQuantity, ...(pricing.unit === "per_piece" ? { perPieceCents: tier.priceCents } : { perSqftCents: tier.priceCents }) })) } : {}),
    ...((pricing.model === "one_dimensional_matrix" || pricing.model === "two_dimensional_matrix" || pricing.model === "option_quantity_tiers") ? { optionMatrixPricingUnit: pricing.unit } : {}),
  };
  const fixedDimensions = intent.measurement.mode === "fixed_size" ? { ...intent.measurement.dimensions, unit: "in" as const, label: `${intent.measurement.dimensions.widthIn}\" x ${intent.measurement.dimensions.heightIn}\"` } : null;
  const fingerprint = productDraftIntentFingerprint(intent);
  const quantityMetadata = quantityMetadataForIntent(intent);
  if (isHourly) {
    const nodeId = stableId("intent_input", "hours");
    optionTree.rootNodeIds.push(nodeId);
    optionTree.nodes[nodeId] = {
      id: nodeId, kind: "question", type: "INPUT", status: "ENABLED", key: "hours", label: "Billable hours", ui: { sortOrder: intent.optionGroups.length + 1, helpText: "Enter time in quarter-hour increments." },
      input: { type: "number", required: true, selectionKey: "hours", valueType: "NUMBER", constraints: { number: { min: 0.25, step: 0.25 } } },
    };
  }
  const treeJson: Record<string, unknown> = {
    schemaVersion: 2, status: "DRAFT", rootNodeIds: optionTree.rootNodeIds, nodes: optionTree.nodes, edges: optionTree.edges,
    ...(matrix ? { pricingMatrix: matrix } : {}),
    meta: {
      title: `${intent.identity.name} PBV2 Draft`, pricingProfileKey, pricingV2,
      ...(isFee ? { pricingFormula: "flatFee", pricingFormulaVariables: { flatFee: pricing.priceCents / 100 } } : {}),
      ...(isHourly ? { pricingFormula: "hours * hourly_rate", pricingFormulaVariables: { hourly_rate: pricing.priceCents / 100 }, billingUnit: { kind: "hour", selectionKey: "hours", step: 0.25 } } : {}),
      requiresDimensions: intent.measurement.mode === "dimensions_required", ...(fixedDimensions ? { fixedDimensions } : {}),
      productIntake: {
        architecture: "product_draft_intent", contractVersion: intent.contractVersion, intentId: intent.intentId, revision: intent.revision, fingerprint,
        quantity: quantityMetadata, material: intent.material, production: intent.production, workflow: intent.workflow, fieldMetadata: intent.fieldMetadata,
      },
    },
  };
  // Validate both configurable graphs and the canonical zero-option tree.
  const graph = validateOptionTreeV2(treeJson);
  assert(graph.ok, "PBV2_TREE_INVALID", graph.ok ? "" : graph.errors.join(" "), "treeJson");
  const metadataContract = optionTreeV2Schema.safeParse(treeJson);
  assert(metadataContract.success, "PBV2_PRODUCT_INTAKE_METADATA_INVALID", metadataContract.success ? "" : metadataContract.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "), "treeJson.meta.productIntake.quantity");
  if (pricing.model !== "one_dimensional_matrix" && pricing.model !== "two_dimensional_matrix" && pricing.model !== "option_quantity_tiers") {
    const base = validateTreeHasBasePrice(treeJson);
    assert(base.ok, "PBV2_PRICING_INVALID", base.ok ? "" : base.errors.map((finding) => finding.message).join(" "), "pricing");
  }
  const route = intent.production.route.state === "resolved" ? { id: intent.production.route.id, label: intent.production.route.label } : null;
  const material = intent.material.state === "resolved" ? { state: "resolved" as const, id: intent.material.id, label: intent.material.label } : { state: "explicitly_unset" as const };
  return {
    product: { name: intent.identity.name, category: intent.identity.category.label, description: intent.identity.description, pricingMode: pricing.model === "scalar" && pricing.unit === "per_square_foot" || pricing.model === "one_dimensional_matrix" && pricing.unit === "per_square_foot" || pricing.model === "two_dimensional_matrix" && pricing.unit === "per_square_foot" || pricing.model === "quantity_tiers" && pricing.unit === "per_square_foot" || pricing.model === "option_quantity_tiers" && pricing.unit === "per_square_foot" ? "area" : "quantity", measurementMode: intent.measurement.mode === "quantity_only" ? "quantity_only" : "dimensions_required", pricingEngine: "pricingProfile", pricingProfileKey, requiresProductionJob: intent.workflow.requiresProductionJob, requiresProofApproval: intent.workflow.requiresProofApproval, isService: intent.workflow.kind === "service_fee", isTaxable: true, isActive: false },
    treeJson, relationships: { productionRoute: route, material }, audit: { contractVersion: 1, intentId: intent.intentId, revision: intent.revision, fingerprint, fieldMetadata: intent.fieldMetadata },
  };
}
