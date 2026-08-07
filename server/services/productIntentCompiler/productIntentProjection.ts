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
    pricingProfileKey: "default" | "qty_only" | "fee"; requiresProductionJob: boolean;
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
    assert(!(group.required && group.selectionMode === "single" && group.values.every((value) => !value.isDefault)), "OPTION_DEFAULT_UNRESOLVED", `A default is required for option group '${group.label}' before projection.`, `optionGroups.${group.key}.default`);
  }
  if (intent.pricing.model === "two_dimensional_matrix") {
    assert(intent.pricing.unit !== "unresolved", "PRICING_UNIT_UNRESOLVED", "Matrix pricing must be per piece or per square foot before projection.", "pricing.unit");
  }
  assert(intent.unresolvedFields.length === 0, "UNRESOLVED_FIELDS", "All unresolved fields must be resolved before projection.", "unresolvedFields");
  assert(intent.workflow.kind !== "service_fee" || !intent.workflow.requiresProductionJob, "SERVICE_FEE_PRODUCTION_JOB", "Service fees cannot create production jobs.", "workflow.requiresProductionJob");
  assert(intent.production.route.state === "explicitly_unset" || intent.workflow.requiresProductionJob, "ROUTE_WITHOUT_PRODUCTION_JOB", "A production route requires a production job.", "production.route");
  if (intent.measurement.mode === "quantity_only") {
    assert(intent.quantity.behavior !== "not_applicable", "QUANTITY_ONLY_QUANTITY_UNCONFIGURED", "Quantity-only products must declare a customer-entered or fixed quantity behavior.", "quantity");
    assert(!(intent.pricing.model === "scalar" && intent.pricing.unit === "per_square_foot"), "SQUARE_FOOT_QUANTITY_ONLY", "Per-square-foot pricing requires dimensions or fixed dimensions.", "pricing");
    assert(!(intent.pricing.model === "quantity_tiers" && intent.pricing.unit === "per_square_foot"), "SQUARE_FOOT_QUANTITY_ONLY", "Per-square-foot quantity tiers require dimensions or fixed dimensions.", "pricing");
  }
}

function buildOptions(intent: ProductDraftIntent) {
  const nodes: Record<string, unknown> = {}; const rootNodeIds: string[] = []; const edges: Record<string, unknown>[] = [];
  const groups = new Map<string, ProductDraftIntent["optionGroups"][number]>();
  intent.optionGroups.forEach((group, index) => {
    assert(!groups.has(group.key), "OPTION_GROUP_DUPLICATE", `Option group '${group.key}' is duplicated.`, "optionGroups");
    groups.set(group.key, group);
    const groupId = stableId("intent_group", group.key); const nodeId = stableId("intent_input", group.key);
    rootNodeIds.push(nodeId);
    nodes[groupId] = { id: groupId, kind: "group", type: "GROUP", status: "ENABLED", key: `${group.key}_group`, label: group.label, displayOrder: index + 1, input: { type: "select", required: group.required } };
    const defaults = group.values.filter((value) => value.isDefault).map((value) => value.key);
    nodes[nodeId] = {
      id: nodeId, kind: "question", type: "INPUT", status: "ENABLED", key: group.key, label: group.label, ui: { sortOrder: index + 1 },
      input: { type: group.selectionMode === "multiple" ? "multiselect" : "select", required: group.required, selectionKey: group.key, valueType: "ENUM", constraints: { select: { allowEmpty: !group.required } }, ...(defaults.length ? { defaultValue: group.selectionMode === "multiple" ? defaults : defaults[0] } : {}) },
      choices: group.values.map((value, valueIndex) => ({
        id: `${nodeId}_choice_${valueIndex + 1}`,
        value: value.key,
        label: value.label,
        sortOrder: valueIndex + 1,
        ...(value.priceImpact ? {
          pricingImpact: [{
            mode: "addPercent" as const,
            percent: value.priceImpact.percent,
            basis: "base" as const,
            label: `${value.label} adjustment`,
          }],
        } : {}),
      })),
    };
    edges.push({ id: `${groupId}_edge`, fromNodeId: groupId, toNodeId: nodeId, status: "DISABLED" });
  });
  return { nodes, rootNodeIds, edges, groups };
}

function buildMatrix(intent: ProductDraftIntent, groups: Map<string, ProductDraftIntent["optionGroups"][number]>): ProductOptionPricingMatrix | null {
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
function pricingProfileKeyFor(pricing: ProductDraftIntent["pricing"]): "default" | "qty_only" | "fee" {
  if (pricing.model === "scalar" && pricing.unit === "flat_fee") return "fee";
  if (
    (pricing.model === "scalar" && pricing.unit === "per_piece")
    || (pricing.model === "quantity_tiers" && pricing.unit === "per_piece")
    || (pricing.model === "two_dimensional_matrix" && pricing.unit === "per_piece")
  ) return "qty_only";
  return "default";
}

function quantityPricingBehaviorFor(pricing: ProductDraftIntent["pricing"]): ProductIntakeQuantityPricingBehavior {
  if (pricing.model === "quantity_tiers") return pricing.unit === "per_piece" ? "quantity_tiers" : "per_square_foot";
  if (pricing.model === "two_dimensional_matrix") return pricing.unit === "per_piece" ? "per_piece" : "per_square_foot";
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
    matrixAxes: pricing.model === "two_dimensional_matrix" ? [pricing.rowOptionKey, pricing.columnOptionKey] : [],
    ...(fixedQuantity === undefined ? {} : { fixedQuantity }),
  });
}

/** Pure, deterministic intent → Product Builder/PBV2 projection. No DB access. */
export function projectProductDraftIntentToProductBuilderDraft(rawIntent: unknown): ProjectedProductBuilderDraft {
  const intent = parseProductDraftIntent(rawIntent); assertReady(intent);
  const optionTree = buildOptions(intent); const matrix = buildMatrix(intent, optionTree.groups);
  const pricing = intent.pricing;
  const isFee = pricing.model === "scalar" && pricing.unit === "flat_fee";
  const pricingProfileKey = pricingProfileKeyFor(pricing);
  assert(!isFee || intent.workflow.kind === "service_fee", "FLAT_FEE_WORKFLOW_INVALID", "Flat-fee pricing requires the service-fee workflow.", "workflow.kind");
  const perSqft = pricing.model === "scalar" && pricing.unit === "per_square_foot" ? pricing.priceCents : null;
  const perPiece = pricing.model === "scalar" && pricing.unit === "per_piece" ? pricing.priceCents : null;
  const minimumCharge = pricing.model === "scalar" || pricing.model === "two_dimensional_matrix" || pricing.model === "quantity_tiers" ? pricing.minimumChargeCents ?? null : null;
  const pricingV2 = {
    unitSystem: "imperial" as const, tierBasis: "line_item_quantity" as const,
    base: { perSqftCents: perSqft, perPieceCents: perPiece, minimumChargeCents: minimumCharge },
    ...(pricing.model === "quantity_tiers" ? { qtyTiers: pricing.tiers.map((tier, index) => ({ id: `intent_tier_${index + 1}`, label: tier.maximumQuantity === null ? `${tier.minimumQuantity}+` : `${tier.minimumQuantity}-${tier.maximumQuantity}`, minQty: tier.minimumQuantity, maxQty: tier.maximumQuantity, ...(pricing.unit === "per_piece" ? { perPieceCents: tier.priceCents } : { perSqftCents: tier.priceCents }) })) } : {}),
    ...(pricing.model === "two_dimensional_matrix" ? { optionMatrixPricingUnit: pricing.unit } : {}),
  };
  const fixedDimensions = intent.measurement.mode === "fixed_size" ? { ...intent.measurement.dimensions, unit: "in" as const, label: `${intent.measurement.dimensions.widthIn}\" x ${intent.measurement.dimensions.heightIn}\"` } : null;
  const fingerprint = productDraftIntentFingerprint(intent);
  const quantityMetadata = quantityMetadataForIntent(intent);
  const treeJson: Record<string, unknown> = {
    schemaVersion: 2, status: "DRAFT", rootNodeIds: optionTree.rootNodeIds, nodes: optionTree.nodes, edges: optionTree.edges,
    ...(matrix ? { pricingMatrix: matrix } : {}),
    meta: {
      title: `${intent.identity.name} PBV2 Draft`, pricingProfileKey, pricingV2,
      ...(isFee ? { pricingFormula: "flatFee", pricingFormulaVariables: { flatFee: pricing.priceCents / 100 } } : {}),
      requiresDimensions: intent.measurement.mode === "dimensions_required", ...(fixedDimensions ? { fixedDimensions } : {}),
      productIntake: {
        architecture: "product_draft_intent", contractVersion: intent.contractVersion, intentId: intent.intentId, revision: intent.revision, fingerprint,
        quantity: quantityMetadata, material: intent.material, production: intent.production, workflow: intent.workflow, fieldMetadata: intent.fieldMetadata,
      },
    },
  };
  // The historical minimal graph validator cannot validate a valid zero-option
  // PBV2 tree. Run it whenever a graph exists; scalar service products retain
  // the established empty-tree representation.
  if (optionTree.rootNodeIds.length) {
    const graph = validateOptionTreeV2(treeJson);
    assert(graph.ok, "PBV2_TREE_INVALID", graph.ok ? "" : graph.errors.join(" "), "treeJson");
  }
  const metadataContract = optionTreeV2Schema.safeParse(treeJson);
  assert(metadataContract.success, "PBV2_PRODUCT_INTAKE_METADATA_INVALID", metadataContract.success ? "" : metadataContract.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "), "treeJson.meta.productIntake.quantity");
  if (pricing.model !== "two_dimensional_matrix") {
    const base = validateTreeHasBasePrice(treeJson);
    assert(base.ok, "PBV2_PRICING_INVALID", base.ok ? "" : base.errors.map((finding) => finding.message).join(" "), "pricing");
  }
  const route = intent.production.route.state === "resolved" ? { id: intent.production.route.id, label: intent.production.route.label } : null;
  const material = intent.material.state === "resolved" ? { state: "resolved" as const, id: intent.material.id, label: intent.material.label } : { state: "explicitly_unset" as const };
  return {
    product: { name: intent.identity.name, category: intent.identity.category.label, description: intent.identity.description, pricingMode: pricing.model === "scalar" && pricing.unit === "per_square_foot" || pricing.model === "two_dimensional_matrix" && pricing.unit === "per_square_foot" || pricing.model === "quantity_tiers" && pricing.unit === "per_square_foot" ? "area" : "quantity", measurementMode: intent.measurement.mode === "quantity_only" ? "quantity_only" : "dimensions_required", pricingEngine: "pricingProfile", pricingProfileKey, requiresProductionJob: intent.workflow.requiresProductionJob, requiresProofApproval: intent.workflow.requiresProofApproval, isService: intent.workflow.kind === "service_fee", isTaxable: true, isActive: false },
    treeJson, relationships: { productionRoute: route, material }, audit: { contractVersion: 1, intentId: intent.intentId, revision: intent.revision, fingerprint, fieldMetadata: intent.fieldMetadata },
  };
}
