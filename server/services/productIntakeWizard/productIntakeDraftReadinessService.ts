import { createHash } from "node:crypto";
import { and, asc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { materials, pbv2OptionGroupTemplates, pbv2TreeVersions, productIntakeSessions, products, stations } from "@shared/schema";
import type { ProductIntakeDraftReview, ProductIntakeDraftReviewService } from "./productIntakeDraftReviewService";
import { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } from "@shared/pbv2/validator";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";
import { relationshipSnapshotFromTree } from "./productIntakeDraftRelationships";

export type ProductDraftReadinessSeverity = "blocker" | "warning" | "information" | "unknown";
export type ProductDraftReadinessStatus = "ready_for_human_activation" | "blocked" | "needs_review" | "unknown";

export type ProductDraftReadinessFinding = {
  code: string;
  severity: ProductDraftReadinessSeverity;
  area: "identity" | "status" | "pricing" | "measurement" | "material" | "routing" | "options" | "taxability" | "review" | "pbv2";
  message: string;
  currentValue?: string | number | boolean | null;
  expectedCondition?: string;
  automaticFix: boolean;
  suggestedAction: string;
  commandCapability?: "products.update_inactive_draft@v1";
};

export type ProductDraftReadinessReferenceHealth = {
  material: { exists: boolean; active: boolean; type: string | null } | null;
  station: { exists: boolean; active: boolean } | null;
  optionTemplates: Record<string, { exists: boolean; active: boolean; priceBearing: boolean }>;
};

export type ProductDraftReadinessResult = {
  productId: string;
  productName: string;
  category: string | null;
  sessionId: string;
  status: ProductDraftReadinessStatus;
  inactive: boolean;
  pbv2Draft: boolean;
  updatedAt: string;
  blockers: ProductDraftReadinessFinding[];
  warnings: ProductDraftReadinessFinding[];
  information: ProductDraftReadinessFinding[];
  unknowns: ProductDraftReadinessFinding[];
  missingRequiredFields: string[];
  suspiciousConfiguration: string[];
  supportedAutomaticFixes: ProductDraftReadinessFinding[];
  unsupportedManualFixes: ProductDraftReadinessFinding[];
  completed: Array<{ field: string; value: string }>;
  internalSetupNote: string | null;
  reviewWarnings: string[];
  derivedMissingFieldWarnings: string[];
  fingerprint: string;
};

export type ProductDraftReadinessListFilter = "incomplete" | "pricing" | "routing" | "material" | "dimensions" | "review_warnings" | "ready" | "needs_review";
export type ProductDraftReadinessListResult = { items: Array<Pick<ProductDraftReadinessResult, "productId" | "productName" | "category" | "status" | "updatedAt"> & { blockerCount: number; warningCount: number; primaryBlockers: string[]; sessionId: string }>; hasMore: boolean; limit: number; offset: number };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function finding(input: Omit<ProductDraftReadinessFinding, "automaticFix" | "suggestedAction"> & Partial<Pick<ProductDraftReadinessFinding, "automaticFix" | "suggestedAction">>): ProductDraftReadinessFinding {
  const automaticFix = input.automaticFix ?? false;
  return {
    ...input,
    automaticFix,
    suggestedAction: input.suggestedAction ?? (automaticFix ? "Prepare a confirmation-bound inactive-draft update." : "Review and correct this in the product editor."),
    ...(automaticFix ? { commandCapability: "products.update_inactive_draft@v1" as const } : {}),
  };
}

function addUnique(findings: ProductDraftReadinessFinding[], next: ProductDraftReadinessFinding) {
  if (!findings.some((item) => item.code === next.code || item.message === next.message)) findings.push(next);
}

function listRowReview(row: any): ProductIntakeDraftReview {
  const treeJson = row.treeJson && typeof row.treeJson === "object" ? row.treeJson : {};
  const base = treeJson?.meta?.pricingV2?.base && typeof treeJson.meta.pricingV2.base === "object" ? treeJson.meta.pricingV2.base : {};
  const fixed = treeJson?.meta?.fixedDimensions;
  const relationships = relationshipSnapshotFromTree(treeJson);
  const missingFieldWarnings: string[] = [];
  if (row.workflowIntent === "standard_production" && !relationships.routing) missingFieldWarnings.push("Production routing review required.");
  if (!row.primaryMaterialId) missingFieldWarnings.push("Material review required.");
  const findings = [...validateTreeHasBasePrice(treeJson).findings, ...(row.treeStatus === "DRAFT" ? validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS).findings : [])];
  return {
    intake: { sessionId: row.sessionId, status: row.sessionStatus },
    product: { id: row.productId, name: row.productName, category: row.category, description: row.description, isActive: row.isActive, productTypeId: null, productTypeName: null, primaryMaterialId: row.primaryMaterialId, measurementMode: row.measurementMode, workflowIntent: row.workflowIntent, isTaxable: row.isTaxable, allowZeroPrice: row.allowZeroPrice, requiresProductionJob: row.requiresProductionJob, pricingMode: row.pricingMode, useNestingCalculator: row.useNestingCalculator, sheetWidth: row.sheetWidth, sheetHeight: row.sheetHeight, materialType: row.materialType, pricingProfileConfig: row.pricingProfileConfig, pbv2ActiveTreeVersionId: row.pbv2ActiveTreeVersionId },
    pbv2Tree: { id: row.treeId, status: row.treeStatus, schemaVersion: row.schemaVersion, publishedAt: null, updatedAt: new Date(row.treeUpdatedAt).toISOString(), groupCount: 0, optionCount: 0, optionGroups: [], draftQuality: null, intakeSummary: null, matrixReadiness: null, matrixPreview: null, basePricing: { perSqftCents: typeof base.perSqftCents === "number" ? base.perSqftCents : null, perPieceCents: typeof base.perPieceCents === "number" ? base.perPieceCents : null, minimumChargeCents: typeof base.minimumChargeCents === "number" ? base.minimumChargeCents : null }, requiresDimensions: treeJson?.meta?.requiresDimensions === true, fixedDimensions: fixed && Number(fixed.widthIn) > 0 && Number(fixed.heightIn) > 0 ? { widthIn: Number(fixed.widthIn), heightIn: Number(fixed.heightIn), unit: "in" } : null, relationships: { ...relationships, missingFieldWarnings } },
    publishReadiness: { findings },
  } as any;
}

/** Pure readiness evaluator shared by chat, future activation controls, and tests. */
export function evaluateInactiveDraftReadiness(review: ProductIntakeDraftReview, health: ProductDraftReadinessReferenceHealth): ProductDraftReadinessResult {
  const all: ProductDraftReadinessFinding[] = [];
  const product = review.product as ProductIntakeDraftReview["product"] & { allowZeroPrice?: boolean; requiresProductionJob?: boolean; pricingMode?: string };
  const relationships = review.pbv2Tree.relationships;
  const price = review.pbv2Tree.basePricing;
  const requiresProduction = product.requiresProductionJob !== false && product.workflowIntent === "standard_production";

  if (!review.intake.sessionId || review.intake.status !== "draft_created") addUnique(all, finding({ code: "INTAKE_DRAFT_REQUIRED", severity: "unknown", area: "status", message: "The Product Intake session is not in editable draft state.", automaticFix: false }));
  if (product.isActive) addUnique(all, finding({ code: "PRODUCT_ACTIVE_OUT_OF_SCOPE", severity: "unknown", area: "status", message: "Active products are outside inactive-draft readiness review.", automaticFix: false }));
  if (review.pbv2Tree.status !== "DRAFT" || product.pbv2ActiveTreeVersionId) addUnique(all, finding({ code: "PBV2_DRAFT_REQUIRED", severity: "unknown", area: "status", message: "A non-published PBV2 DRAFT without an active-tree assignment is required.", automaticFix: false }));
  if (!product.name.trim() || /^(new product|untitled|placeholder)$/i.test(product.name.trim())) addUnique(all, finding({ code: "PRODUCT_NAME_REVIEW", severity: "blocker", area: "identity", message: "A non-placeholder product name is required.", automaticFix: true }));

  for (const source of review.publishReadiness.findings) {
    const severity: ProductDraftReadinessSeverity = source.severity === "ERROR" ? "blocker" : source.severity === "WARNING" ? "warning" : "information";
    addUnique(all, finding({ code: `PBV2_${source.code}`, severity, area: "pbv2", message: source.message, automaticFix: false }));
  }
  const configuredPrices = [price.perSqftCents, price.perPieceCents, price.minimumChargeCents];
  if (configuredPrices.some((value) => value !== null && value < 0)) addUnique(all, finding({ code: "PRICING_INVALID", severity: "blocker", area: "pricing", message: "Pricing values cannot be negative.", automaticFix: true }));
  if (configuredPrices.every((value) => value === null)) addUnique(all, finding({ code: "PRICING_MISSING", severity: "blocker", area: "pricing", message: "No applicable base pricing is configured.", automaticFix: true }));
  if (configuredPrices.some((value) => value === 0) && !product.allowZeroPrice) addUnique(all, finding({ code: "ZERO_PRICE_REVIEW", severity: "warning", area: "pricing", message: "A zero price is configured without an explicit zero-price opt-in.", automaticFix: false }));

  if (product.workflowIntent === "service_fee" && product.measurementMode !== "quantity_only") addUnique(all, finding({ code: "SERVICE_FEE_MEASUREMENT_INCOMPATIBLE", severity: "blocker", area: "measurement", message: "Service-fee products must use quantity-only measurement.", automaticFix: true }));
  if (product.workflowIntent === "service_fee" && product.requiresProductionJob !== false) addUnique(all, finding({ code: "SERVICE_FEE_PRODUCTION_JOB_INCOMPATIBLE", severity: "blocker", area: "status", message: "Service-fee products cannot require a production job.", automaticFix: true }));
  if (product.measurementMode === "quantity_only" && (review.pbv2Tree.requiresDimensions || review.pbv2Tree.fixedDimensions || product.useNestingCalculator)) addUnique(all, finding({ code: "QUANTITY_ONLY_DIMENSIONS_INCOMPATIBLE", severity: "blocker", area: "measurement", message: "Quantity-only products cannot require dimensions, fixed dimensions, or sheet nesting.", automaticFix: true }));
  if (review.pbv2Tree.fixedDimensions && (review.pbv2Tree.fixedDimensions.widthIn <= 0 || review.pbv2Tree.fixedDimensions.heightIn <= 0)) addUnique(all, finding({ code: "FIXED_DIMENSIONS_INVALID", severity: "blocker", area: "measurement", message: "Fixed dimensions must include positive width and height.", automaticFix: true }));
  if (product.useNestingCalculator && (product.materialType !== "sheet" || Number(product.sheetWidth) <= 0 || Number(product.sheetHeight) <= 0)) addUnique(all, finding({ code: "SHEET_NESTING_INCOMPLETE", severity: "blocker", area: "measurement", message: "Sheet nesting requires a sheet product with positive sheet width and height.", automaticFix: true }));

  if (requiresProduction && !product.primaryMaterialId) addUnique(all, finding({ code: "MATERIAL_MISSING", severity: "blocker", area: "material", message: "A production material is required for this standard-production product.", automaticFix: true }));
  if (product.primaryMaterialId && !health.material?.exists) addUnique(all, finding({ code: "MATERIAL_NOT_FOUND", severity: "blocker", area: "material", message: "The linked material is no longer available to this tenant.", automaticFix: true }));
  if (product.primaryMaterialId && health.material?.exists && !health.material.active) addUnique(all, finding({ code: "MATERIAL_INACTIVE", severity: "blocker", area: "material", message: "The linked material is inactive.", automaticFix: true }));
  if (product.workflowIntent === "service_fee" && product.primaryMaterialId) addUnique(all, finding({ code: "SERVICE_FEE_MATERIAL_REVIEW", severity: "warning", area: "material", message: "Service-fee products normally do not consume a production material; review this linkage.", automaticFix: true }));

  if (requiresProduction && !relationships.routing) addUnique(all, finding({ code: "ROUTING_MISSING", severity: "blocker", area: "routing", message: "A production station is required for this standard-production product.", automaticFix: true }));
  if (relationships.routing && (product.workflowIntent === "service_fee" || product.workflowIntent === "fulfillment_only")) addUnique(all, finding({ code: "ROUTING_WORKFLOW_INCOMPATIBLE", severity: "blocker", area: "routing", message: "This workflow intent cannot retain a production route.", automaticFix: true }));
  if (relationships.routing && !health.station?.exists) addUnique(all, finding({ code: "ROUTING_STATION_NOT_FOUND", severity: "blocker", area: "routing", message: "The configured production station is no longer available to this tenant.", automaticFix: true }));
  if (relationships.routing && health.station?.exists && !health.station.active) addUnique(all, finding({ code: "ROUTING_STATION_INACTIVE", severity: "blocker", area: "routing", message: "The configured production station is inactive.", automaticFix: true }));

  const seenTemplates = new Set<string>();
  for (const option of relationships.optionTemplates) {
    if (seenTemplates.has(option.templateId)) addUnique(all, finding({ code: "OPTION_TEMPLATE_DUPLICATE", severity: "blocker", area: "options", message: `Option template ${option.name} is linked more than once.`, automaticFix: true }));
    seenTemplates.add(option.templateId);
    const template = health.optionTemplates[option.templateId];
    if (!template?.exists) addUnique(all, finding({ code: "OPTION_TEMPLATE_NOT_FOUND", severity: "blocker", area: "options", message: `Option template ${option.name} is no longer available.`, automaticFix: true }));
    else if (!template.active) addUnique(all, finding({ code: "OPTION_TEMPLATE_INACTIVE", severity: "blocker", area: "options", message: `Option template ${option.name} is inactive.`, automaticFix: true }));
    else if (template.priceBearing) addUnique(all, finding({ code: "OPTION_PRICING_UNVERIFIED", severity: "warning", area: "options", message: `Option template ${option.name} has pricing that requires manual review.`, automaticFix: false }));
  }
  for (const warning of relationships.reviewWarnings) addUnique(all, finding({ code: `REVIEW_WARNING_${createHash("sha1").update(warning).digest("hex").slice(0, 10)}`, severity: "warning", area: "review", message: warning, automaticFix: true }));

  const blockers = all.filter((item) => item.severity === "blocker");
  const warnings = all.filter((item) => item.severity === "warning");
  const information = all.filter((item) => item.severity === "information");
  const unknowns = all.filter((item) => item.severity === "unknown");
  const status: ProductDraftReadinessStatus = unknowns.length ? "unknown" : blockers.length ? "blocked" : warnings.length ? "needs_review" : "ready_for_human_activation";
  const completed = [
    product.category ? { field: "Category", value: product.category } : null,
    { field: "Measurement", value: product.measurementMode },
    { field: "Workflow", value: product.workflowIntent },
    product.primaryMaterialId && health.material?.exists ? { field: "Material", value: health.material.type ?? "Linked" } : null,
    relationships.routing ? { field: "Production station", value: relationships.routing.stationName } : null,
  ].filter(Boolean) as Array<{ field: string; value: string }>;
  const payload = { productId: product.id, updatedAt: review.pbv2Tree.updatedAt, status, all, relationships };
  return {
    productId: product.id, productName: product.name, category: product.category, sessionId: review.intake.sessionId, status,
    inactive: !product.isActive, pbv2Draft: review.pbv2Tree.status === "DRAFT", updatedAt: review.pbv2Tree.updatedAt,
    blockers, warnings, information, unknowns,
    missingRequiredFields: blockers.filter((item) => /MISSING|INCOMPLETE|REQUIRED/.test(item.code)).map((item) => item.message),
    suspiciousConfiguration: warnings.map((item) => item.message),
    supportedAutomaticFixes: all.filter((item) => item.automaticFix),
    unsupportedManualFixes: all.filter((item) => !item.automaticFix && item.severity !== "information"),
    completed, internalSetupNote: relationships.setupNote, reviewWarnings: relationships.reviewWarnings,
    derivedMissingFieldWarnings: relationships.missingFieldWarnings,
    fingerprint: createHash("sha256").update(stable(payload)).digest("hex"),
  };
}

export class ProductIntakeDraftReadinessService {
  constructor(private readonly review?: ProductIntakeDraftReviewService, private readonly database?: any) {}

  private async dependencies() {
    const review = this.review ?? (await import("./productIntakeDraftReviewService")).createDbProductIntakeDraftReviewService();
    const database = this.database ?? (await import("../../db")).db;
    return { review, database };
  }

  async reviewDraft(input: { organizationId: string; sessionId: string }): Promise<ProductDraftReadinessResult> {
    const { review: reviewService, database } = await this.dependencies();
    const review = await reviewService.getDraftReview(input);
    const templateIds = review.pbv2Tree.relationships.optionTemplates.map((item) => item.templateId);
    const [materialRows, stationRows, templateRows] = await Promise.all([
      review.product.primaryMaterialId ? database.select({ id: materials.id, isActive: materials.isActive, type: materials.type }).from(materials).where(and(eq(materials.organizationId, input.organizationId), eq(materials.id, review.product.primaryMaterialId))) : Promise.resolve([]),
      review.pbv2Tree.relationships.routing ? database.select({ id: stations.id, active: stations.active }).from(stations).where(and(eq(stations.organizationId, input.organizationId), eq(stations.id, review.pbv2Tree.relationships.routing.stationId))) : Promise.resolve([]),
      templateIds.length ? database.select({ id: pbv2OptionGroupTemplates.id, state: pbv2OptionGroupTemplates.state, pricingMetadata: pbv2OptionGroupTemplates.pricingMetadata, templateTree: pbv2OptionGroupTemplates.templateTree }).from(pbv2OptionGroupTemplates).where(and(inArray(pbv2OptionGroupTemplates.id, templateIds), eq(pbv2OptionGroupTemplates.state, "active"))) : Promise.resolve([]),
    ]);
    const material = materialRows[0] ? { exists: true, active: materialRows[0].isActive, type: materialRows[0].type } : review.product.primaryMaterialId ? { exists: false, active: false, type: null } : null;
    const station = stationRows[0] ? { exists: true, active: stationRows[0].active } : review.pbv2Tree.relationships.routing ? { exists: false, active: false } : null;
    const optionTemplates = Object.fromEntries(templateIds.map((id) => {
      const row = templateRows.find((template: any) => template.id === id);
      return [id, row ? { exists: true, active: row.state === "active", priceBearing: Object.keys(row.pricingMetadata ?? {}).length > 0 || Boolean((row.templateTree as any)?.pricingMatrix) } : { exists: false, active: false, priceBearing: false }];
    }));
    return evaluateInactiveDraftReadiness(review, { material, station, optionTemplates });
  }

  /** Bounded inactive-DRAFT list. Each row is subsequently evaluated by the
   * canonical single-draft service so list and detail results cannot diverge. */
  async listDrafts(input: { organizationId: string; filter?: ProductDraftReadinessListFilter; category?: string; productName?: string; limit?: number; offset?: number }): Promise<ProductDraftReadinessListResult> {
    const { database } = await this.dependencies();
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 25);
    const offset = Math.max(input.offset ?? 0, 0);
    const conditions = [
      eq(productIntakeSessions.organizationId, input.organizationId),
      eq(productIntakeSessions.status, "draft_created"),
      eq(products.organizationId, input.organizationId),
      eq(products.isActive, false),
      isNull(products.pbv2ActiveTreeVersionId),
      eq(pbv2TreeVersions.organizationId, input.organizationId),
      eq(pbv2TreeVersions.status, "DRAFT"),
      ...(input.category ? [ilike(products.category, input.category.trim())] : []),
      ...(input.productName ? [ilike(products.name, `%${input.productName.trim()}%`)] : []),
    ];
    const rows = await database.select({
      sessionId: productIntakeSessions.id, sessionStatus: productIntakeSessions.status,
      productId: products.id, productName: products.name, category: products.category, description: products.description, isActive: products.isActive, primaryMaterialId: products.primaryMaterialId, measurementMode: products.measurementMode, workflowIntent: products.workflowIntent, isTaxable: products.isTaxable, allowZeroPrice: products.allowZeroPrice, requiresProductionJob: products.requiresProductionJob, pricingMode: products.pricingMode, useNestingCalculator: products.useNestingCalculator, sheetWidth: products.sheetWidth, sheetHeight: products.sheetHeight, materialType: products.materialType, pricingProfileConfig: products.pricingProfileConfig, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
      treeId: pbv2TreeVersions.id, treeStatus: pbv2TreeVersions.status, schemaVersion: pbv2TreeVersions.schemaVersion, treeUpdatedAt: pbv2TreeVersions.updatedAt, treeJson: pbv2TreeVersions.treeJson,
    })
      .from(productIntakeSessions)
      .innerJoin(products, and(eq(products.organizationId, productIntakeSessions.organizationId), eq(products.id, productIntakeSessions.createdProductId)))
      .innerJoin(pbv2TreeVersions, and(eq(pbv2TreeVersions.organizationId, productIntakeSessions.organizationId), eq(pbv2TreeVersions.id, productIntakeSessions.createdPbv2TreeVersionId), eq(pbv2TreeVersions.productId, products.id)))
      .where(and(...conditions)).orderBy(asc(products.name), asc(products.id)).limit(limit + 1).offset(offset);
    const candidateRows = rows.slice(0, limit);
    const reviews: ProductIntakeDraftReview[] = candidateRows.map((row: any) => listRowReview(row));
    const materialIds = reviews.map((review: ProductIntakeDraftReview) => review.product.primaryMaterialId).filter((id: string | null): id is string => Boolean(id));
    const stationIds = reviews.map((review: ProductIntakeDraftReview) => review.pbv2Tree.relationships.routing?.stationId ?? null).filter((id: string | null): id is string => Boolean(id));
    const templateIds = Array.from(new Set<string>(reviews.flatMap((review: ProductIntakeDraftReview) => review.pbv2Tree.relationships.optionTemplates.map((option: { templateId: string }) => option.templateId))));
    const [materialRows, stationRows, templateRows] = await Promise.all([
      materialIds.length ? database.select({ id: materials.id, isActive: materials.isActive, type: materials.type }).from(materials).where(and(eq(materials.organizationId, input.organizationId), inArray(materials.id, materialIds))) : Promise.resolve([]),
      stationIds.length ? database.select({ id: stations.id, active: stations.active }).from(stations).where(and(eq(stations.organizationId, input.organizationId), inArray(stations.id, stationIds))) : Promise.resolve([]),
      templateIds.length ? database.select({ id: pbv2OptionGroupTemplates.id, state: pbv2OptionGroupTemplates.state, pricingMetadata: pbv2OptionGroupTemplates.pricingMetadata, templateTree: pbv2OptionGroupTemplates.templateTree }).from(pbv2OptionGroupTemplates).where(inArray(pbv2OptionGroupTemplates.id, templateIds)) : Promise.resolve([]),
    ]);
    const readiness: ProductDraftReadinessResult[] = reviews.map((review: ProductIntakeDraftReview) => {
      const materialRow = materialRows.find((row: any) => row.id === review.product.primaryMaterialId);
      const stationRow = stationRows.find((row: any) => row.id === review.pbv2Tree.relationships.routing?.stationId);
      const optionTemplates = Object.fromEntries(review.pbv2Tree.relationships.optionTemplates.map((option: { templateId: string }) => {
        const row = templateRows.find((template: any) => template.id === option.templateId);
        return [option.templateId, row ? { exists: true, active: row.state === "active", priceBearing: Object.keys(row.pricingMetadata ?? {}).length > 0 || Boolean((row.templateTree as any)?.pricingMatrix) } : { exists: false, active: false, priceBearing: false }];
      }));
      return evaluateInactiveDraftReadiness(review, { material: materialRow ? { exists: true, active: materialRow.isActive, type: materialRow.type } : review.product.primaryMaterialId ? { exists: false, active: false, type: null } : null, station: stationRow ? { exists: true, active: stationRow.active } : review.pbv2Tree.relationships.routing ? { exists: false, active: false } : null, optionTemplates });
    });
    const matchesFilter = (result: ProductDraftReadinessResult) => {
      if (!input.filter || input.filter === "incomplete") return result.status !== "ready_for_human_activation";
      if (input.filter === "ready") return result.status === "ready_for_human_activation";
      if (input.filter === "needs_review") return result.status === "needs_review" || result.status === "unknown";
      if (input.filter === "review_warnings") return result.reviewWarnings.length > 0;
      const code = input.filter === "pricing" ? "PRICING" : input.filter === "routing" ? "ROUTING" : input.filter === "material" ? "MATERIAL" : "DIMENSION";
      return result.blockers.some((item) => item.code.includes(code));
    };
    const items = readiness.filter(matchesFilter).map((result) => ({ productId: result.productId, productName: result.productName, category: result.category, status: result.status, blockerCount: result.blockers.length, warningCount: result.warnings.length, primaryBlockers: result.blockers.slice(0, 3).map((item) => item.message), updatedAt: result.updatedAt, sessionId: result.sessionId }));
    return { items, hasMore: rows.length > limit, limit, offset };
  }
}

export const productIntakeDraftReadinessService = new ProductIntakeDraftReadinessService();
