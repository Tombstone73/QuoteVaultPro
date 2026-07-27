import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  auditLogs,
  materials,
  pbv2TreeVersions,
  productIntakeSessions,
  products,
  productTypes,
  pbv2OptionGroupTemplates,
  stations,
} from "@shared/schema";
import { cloneTemplateIntoTree } from "@shared/pbv2/optionGroupTemplates";
import { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } from "@shared/pbv2/validator";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";
import type { Finding } from "@shared/pbv2/findings";
import {
  productIntakeMatrixDraftSchema,
  productIntakeMatrixReadinessSchema,
  type ProductIntakeMatrixDraft,
  type ProductIntakeMatrixReadiness,
} from "@shared/productIntakeWizardSchemas";
import { db as defaultDb } from "../../db";
import { ProductIntakeSessionError } from "./productIntakeSessionService";
import {
  normalizeRelationshipText,
  productDraftRelationshipPatchSchema,
  relationshipSnapshotFromTree,
  removeTemplateImport,
  type DraftRelationshipSnapshot,
  type ProductDraftRelationshipPatch,
} from "./productIntakeDraftRelationships";

export type ProductIntakeDraftReview = {
  intake: {
    sessionId: string;
    status: string;
    sourceType: string;
    sourceText: string | null;
    sourceJson: unknown | null;
    sourceFingerprint: string | null;
    briefSource: string | null;
    confidence: number | null;
    productName: string | null;
    materialMatch: string | null;
    materialMatchStatus: "resolved" | "review_required" | "unresolved";
    materialAssociationRequired: boolean;
    sourceMaterialText: string | null;
    materialCandidates: Array<{ materialId: string | null; sku: string | null; name: string; confidence: number }>;
    warnings: string[];
    unansweredDecisions: string[];
  };
  product: {
    id: string;
    name: string;
    category: string | null;
    description: string;
    isActive: boolean;
    productTypeId: string | null;
    productTypeName: string | null;
    primaryMaterialId: string | null;
    measurementMode: "dimensions_required" | "quantity_only";
    workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
    isTaxable: boolean;
    allowZeroPrice: boolean;
    requiresProductionJob: boolean;
    pricingMode: "area" | "quantity" | "flat";
    useNestingCalculator: boolean;
    sheetWidth: string | null;
    sheetHeight: string | null;
    materialType: "sheet" | "roll" | null;
    pricingProfileConfig: Record<string, unknown> | null;
    pbv2ActiveTreeVersionId: string | null;
  };
  pbv2Tree: {
    id: string;
    status: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED";
    schemaVersion: number;
    publishedAt: string | null;
    updatedAt: string;
    groupCount: number;
    optionCount: number;
    optionGroups: Array<{ id: string; label: string; optionCount: number; options: string[] }>;
    draftQuality: unknown | null;
    intakeSummary: unknown | null;
    matrixReadiness: ProductIntakeMatrixReadiness | null;
    matrixPreview: ProductIntakeMatrixDraft | null;
    basePricing: {
      perSqftCents: number | null;
      perPieceCents: number | null;
      minimumChargeCents: number | null;
    };
    requiresDimensions: boolean;
    fixedDimensions: { widthIn: number; heightIn: number; unit: "in"; label?: string } | null;
    relationships: DraftRelationshipSnapshot;
  };
  publishReadiness: {
    productInactive: boolean;
    pbv2TreeDraft: boolean;
    pbv2TreePublished: boolean;
    activeTreeAssigned: boolean;
    requiredOptionsPresent: boolean;
    noDuplicateSizeControls: boolean;
    pricingConfigured: boolean;
    materialLinked: boolean;
    validationStatus: "ready" | "blocked" | "warnings" | "published";
    findings: Finding[];
  };
};

export type ProductIntakeDraftReviewService = {
  getDraftReview(args: { organizationId: string; sessionId: string }): Promise<ProductIntakeDraftReview>;
  findInactiveDraftMatches(args: { organizationId: string; productId?: string; productName?: string; category?: string }): Promise<Array<{
    sessionId: string;
    productId: string;
    productName: string;
    category: string | null;
    pbv2TreeVersionId: string;
  }>>;
  updateDraftPricing(args: {
    organizationId: string;
    sessionId: string;
    base: {
      perSqftCents?: number | null;
      perPieceCents?: number | null;
      minimumChargeCents?: number | null;
    };
    userId: string | null;
    userName?: string | null;
    /** Optional server-derived optimistic-concurrency guard for assistant plans. */
    expectedDraftUpdatedAt?: string;
    /** Server-derived execution context for an assistant-confirmed update. */
    assistantAudit?: {
      command: "products.update_inactive_draft@v1";
      planId: string;
      idempotencyKey: string;
      correlationId: string;
    };
  }): Promise<ProductIntakeDraftReview>;
  updateDraftConfiguration(args: {
    organizationId: string;
    sessionId: string;
    patch: Record<string, unknown>;
    userId: string | null;
    expectedDraftUpdatedAt?: string;
    assistantAudit?: { command: "products.update_inactive_draft@v1"; planId: string; idempotencyKey: string; correlationId: string };
  }): Promise<ProductIntakeDraftReview>;
  updateDraftRelationships(args: {
    organizationId: string;
    sessionId: string;
    patch: ProductDraftRelationshipPatch;
    userId: string | null;
    expectedDraftUpdatedAt?: string;
    assistantAudit?: { command: "products.update_inactive_draft@v1"; planId: string; idempotencyKey: string; correlationId: string };
  }): Promise<ProductIntakeDraftReview>;
  getDraftLinkForProduct(args: { organizationId: string; productId: string }): Promise<{
    sessionId: string;
    productId: string;
    pbv2TreeVersionId: string | null;
    sessionStatus: string;
    productIsActive: boolean;
    pbv2Status: string | null;
    pbv2ActiveTreeVersionId: string | null;
    materialAssociationRequired: boolean;
    intakeWarnings: string[];
  } | null>;
  activateProduct(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
    userName?: string | null;
  }): Promise<{ productId: string; isActive: true }>;
};

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizePricingCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function basePricingFromTree(treeJson: any): ProductIntakeDraftReview["pbv2Tree"]["basePricing"] {
  const base = treeJson?.meta?.pricingV2?.base && typeof treeJson.meta.pricingV2.base === "object"
    ? treeJson.meta.pricingV2.base
    : {};
  return {
    perSqftCents: normalizePricingCents(base.perSqftCents),
    perPieceCents: normalizePricingCents(base.perPieceCents),
    minimumChargeCents: normalizePricingCents(base.minimumChargeCents),
  };
}

function matrixReadinessFromTree(treeJson: any): ProductIntakeMatrixReadiness | null {
  const productIntake = treeJson?.meta?.productIntake && typeof treeJson.meta.productIntake === "object"
    ? treeJson.meta.productIntake
    : null;
  const direct = productIntake?.matrixReadiness;
  const parsedDirect = productIntakeMatrixReadinessSchema.safeParse(direct);
  if (parsedDirect.success) return parsedDirect.data;

  const pricing = productIntake?.pricingReadiness && typeof productIntake.pricingReadiness === "object"
    ? productIntake.pricingReadiness
    : null;
  if (!pricing) return null;
  const parsedLegacy = productIntakeMatrixReadinessSchema.safeParse({
    required: Boolean(pricing.likelyMatrixPricing),
    matrixType: typeof pricing.matrixType === "string" ? pricing.matrixType : Boolean(pricing.likelyMatrixPricing) ? "MULTI_DIMENSION" : "NONE",
    matrixDimensions: Array.isArray(pricing.candidateDimensions) ? pricing.candidateDimensions.map(String) : [],
    matrixConfidence: typeof pricing.matrixConfidence === "number" ? pricing.matrixConfidence : Boolean(pricing.likelyMatrixPricing) ? 60 : 0,
    reasoning: Array.isArray(pricing.matrixEvidence) ? pricing.matrixEvidence.map(String).filter(Boolean) : [],
    recommendedSetup: Boolean(pricing.likelyMatrixPricing)
      ? "Create or review a PBV2 pricing matrix before publish."
      : "No pricing matrix setup is recommended from the current intake signals.",
    detectedSizes: Array.isArray(pricing.detectedSizes) ? pricing.detectedSizes.map(String).filter(Boolean) : [],
    detectedQuantityBreaks: Array.isArray(pricing.detectedQuantityBreaks) ? pricing.detectedQuantityBreaks.map(Number).filter((value: number) => Number.isInteger(value) && value > 0) : [],
    detectedMaterials: Array.isArray(pricing.detectedMaterials) ? pricing.detectedMaterials.map(String).filter(Boolean) : [],
    detectedPricingSignals: Array.isArray(pricing.detectedPricingSignals) ? pricing.detectedPricingSignals.map(String).filter(Boolean) : [],
    noMatrixRowsGenerated: true,
  });
  return parsedLegacy.success ? parsedLegacy.data : null;
}

function matrixPreviewFromTree(treeJson: any): ProductIntakeMatrixDraft | null {
  const candidate = treeJson?.meta?.productIntake?.matrixDraft;
  const parsed = productIntakeMatrixDraftSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function summarizeTree(treeJson: any): Pick<ProductIntakeDraftReview["pbv2Tree"], "groupCount" | "optionCount" | "optionGroups" | "draftQuality" | "intakeSummary" | "matrixReadiness" | "matrixPreview" | "basePricing"> {
  const nodes = treeJson?.nodes && typeof treeJson.nodes === "object" ? treeJson.nodes : {};
  const edges = Array.isArray(treeJson?.edges) ? treeJson.edges : [];
  const groups = Object.values(nodes).filter((node: any) => String(node?.type ?? "").toUpperCase() === "GROUP");
  const optionNodes = Object.values(nodes).filter((node: any) => node?.input && String(node?.type ?? "").toUpperCase() !== "GROUP");
  const optionGroups = groups.map((group: any) => {
    const childIds = edges.filter((edge: any) => edge?.fromNodeId === group.id).map((edge: any) => edge.toNodeId);
    const options = childIds
      .map((childId: string) => nodes[childId])
      .filter((node: any) => node?.input)
      .map((node: any) => String(node.label ?? node.key ?? node.id));
    return {
      id: String(group.id),
      label: String(group.label ?? group.id),
      optionCount: options.length,
      options,
    };
  });
  return {
    groupCount: groups.length,
    optionCount: optionNodes.length,
    optionGroups,
    draftQuality: treeJson?.meta?.productIntake?.draftQuality ?? null,
    intakeSummary: treeJson?.meta?.productIntake ?? null,
    matrixReadiness: matrixReadinessFromTree(treeJson),
    matrixPreview: matrixPreviewFromTree(treeJson),
    basePricing: basePricingFromTree(treeJson),
  };
}

function conclusionValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as any).value;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function materialReviewFromBrief(brief: any) {
  const materialAnalysis = brief?.materialAnalysis && typeof brief.materialAnalysis === "object" ? brief.materialAnalysis : {};
  const matches = Array.isArray(materialAnalysis.likelyMaterialMatches) ? materialAnalysis.likelyMaterialMatches : [];
  const candidates = matches.slice(0, 10).map((match: any) => ({
    materialId: typeof match?.materialId === "string" && match.materialId ? match.materialId : null,
    sku: typeof match?.sku === "string" && match.sku ? match.sku : null,
    name: String(match?.name ?? "Unknown material"),
    confidence: typeof match?.confidence === "number" ? match.confidence : 0,
  }));
  const likelyMaterial = candidates[0] ?? null;
  const sourceMaterialText = Array.isArray(materialAnalysis.detectedMaterialReferences)
    ? materialAnalysis.detectedMaterialReferences.map((value: any) => String(value).trim()).filter(Boolean).join(", ") || null
    : null;
  const analysisConfidence = typeof materialAnalysis.confidence === "number" ? materialAnalysis.confidence : 0;
  const resolved = Boolean(likelyMaterial?.materialId && analysisConfidence >= 65 && likelyMaterial.confidence >= 65);
  const materialMatchStatus: "resolved" | "review_required" | "unresolved" = resolved
    ? "resolved"
    : candidates.length > 0 || sourceMaterialText
      ? "review_required"
      : "unresolved";

  return {
    likelyMaterial,
    materialMatchStatus,
    materialAssociationRequired: materialMatchStatus !== "resolved",
    sourceMaterialText,
    materialCandidates: candidates,
  };
}

function buildIntakeSummary(session: any): ProductIntakeDraftReview["intake"] {
  const brief = session.aiBriefJson && typeof session.aiBriefJson === "object" ? session.aiBriefJson as any : {};
  const materialReview = materialReviewFromBrief(brief);
  const draftWarnings = Array.isArray(brief?.draftWarnings)
    ? brief.draftWarnings.map((warning: any) => String(warning?.message ?? "")).filter(Boolean)
    : [];
  return {
    sessionId: session.id,
    status: session.status,
    sourceType: session.sourceType,
    sourceText: session.sourceText ?? null,
    sourceJson: session.sourceJson ?? null,
    sourceFingerprint: session.sourceFingerprint ?? null,
    briefSource: typeof brief.source === "string" ? brief.source : null,
    confidence: typeof brief.overallConfidence === "number" ? brief.overallConfidence : null,
    productName: conclusionValue(brief?.productIdentity?.likelyProductName),
    materialMatch: typeof materialReview.likelyMaterial?.name === "string" ? materialReview.likelyMaterial.name : null,
    materialMatchStatus: materialReview.materialMatchStatus,
    materialAssociationRequired: materialReview.materialAssociationRequired,
    sourceMaterialText: materialReview.sourceMaterialText,
    materialCandidates: materialReview.materialCandidates,
    warnings: [
      ...(materialReview.materialAssociationRequired ? ["Material association required."] : []),
      ...draftWarnings,
    ],
    unansweredDecisions: Array.isArray(brief?.missingDecisions)
      ? brief.missingDecisions.map((decision: any) => String(decision?.question ?? decision?.reason ?? "")).filter(Boolean)
      : [],
  };
}

function hasNoDuplicateSizeControls(treeJson: any): boolean {
  const nodes = treeJson?.nodes && typeof treeJson.nodes === "object" ? Object.values(treeJson.nodes) as any[] : [];
  const sizeInputs = nodes.filter((node) => node?.input?.selectionKey === "size");
  const dimensionCount = sizeInputs.filter((node) => node.input?.type === "dimension").length;
  const selectCount = sizeInputs.filter((node) => node.input?.type === "select").length;
  return !(dimensionCount > 0 && selectCount > 0);
}

function requiredOptionsPresent(treeJson: any): boolean {
  const nodes = treeJson?.nodes && typeof treeJson.nodes === "object" ? Object.values(treeJson.nodes) as any[] : [];
  return nodes.some((node) => node?.input?.required === true);
}

function pricingConfigured(treeJson: any): boolean {
  const base = treeJson?.meta?.pricingV2?.base;
  return Boolean(
    treeJson?.meta?.pricingFormula ||
    (base && typeof base === "object" && (
      Number(base.perSqftCents) > 0 ||
      Number(base.perPieceCents) > 0 ||
      Number(base.minimumChargeCents) > 0
    )),
  );
}

function relationshipsFromTree(treeJson: any, product: any): DraftRelationshipSnapshot {
  const relationships = relationshipSnapshotFromTree(treeJson);
  const missingFieldWarnings: string[] = [];
  if (product.workflowIntent === "standard_production" && !relationships.routing) {
    missingFieldWarnings.push("Production routing review required.");
  }
  if (!pricingConfigured(treeJson)) {
    missingFieldWarnings.push("Pricing review required.");
  }
  if (product.measurementMode === "dimensions_required" && treeJson?.meta?.requiresDimensions !== true) {
    const fixed = treeJson?.meta?.fixedDimensions;
    if (!fixed || Number(fixed.widthIn) <= 0 || Number(fixed.heightIn) <= 0) {
      missingFieldWarnings.push("Dimensions configuration is incomplete.");
    }
  }
  if (product.useNestingCalculator && (!Number(product.sheetWidth) || !Number(product.sheetHeight))) {
    missingFieldWarnings.push("Sheet size is incomplete for nesting.");
  }
  if (!product.primaryMaterialId) missingFieldWarnings.push("Material review required.");
  return { ...relationships, missingFieldWarnings };
}

async function buildReview(database: any, organizationId: string, sessionId: string): Promise<ProductIntakeDraftReview> {
  const [session] = await database
    .select()
    .from(productIntakeSessions)
    .where(and(eq(productIntakeSessions.organizationId, organizationId), eq(productIntakeSessions.id, sessionId)))
    .limit(1);
  if (!session) throw new ProductIntakeSessionError(404, "Product Intake session not found.", "SESSION_NOT_FOUND");
  if (!session.createdProductId || !session.createdPbv2TreeVersionId) {
    throw new ProductIntakeSessionError(409, "This Product Intake session has not created a draft product yet.", "INTAKE_DRAFT_NOT_CREATED");
  }

  const [product] = await database
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      description: products.description,
      isActive: products.isActive,
      productTypeId: products.productTypeId,
      productTypeName: productTypes.name,
      primaryMaterialId: products.primaryMaterialId,
      measurementMode: products.measurementMode,
      workflowIntent: products.workflowIntent,
      isTaxable: products.isTaxable,
      allowZeroPrice: products.allowZeroPrice,
      requiresProductionJob: products.requiresProductionJob,
      pricingMode: products.pricingMode,
      useNestingCalculator: products.useNestingCalculator,
      sheetWidth: products.sheetWidth,
      sheetHeight: products.sheetHeight,
      materialType: products.materialType,
      pricingProfileConfig: products.pricingProfileConfig,
      pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
    })
    .from(products)
    .leftJoin(productTypes, eq(products.productTypeId, productTypes.id))
    .where(and(eq(products.organizationId, organizationId), eq(products.id, session.createdProductId)))
    .limit(1);
  if (!product) throw new ProductIntakeSessionError(404, "Draft product not found.", "PRODUCT_NOT_FOUND");

  const [tree] = await database
    .select()
    .from(pbv2TreeVersions)
    .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, session.createdPbv2TreeVersionId)))
    .limit(1);
  if (!tree) throw new ProductIntakeSessionError(404, "PBV2 draft tree not found.", "PBV2_TREE_NOT_FOUND");

  const treeJson = tree.treeJson as any;
  const baseValidation = validateTreeHasBasePrice(treeJson);
  const publishValidation = tree.status === "DRAFT"
    ? validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS)
    : { findings: [] as Finding[], errors: [] as Finding[], warnings: [] as Finding[], info: [] as Finding[], ok: true };
  const findings = [...baseValidation.findings, ...publishValidation.findings];
  const errors = findings.filter((finding) => finding.severity === "ERROR");
  const warnings = findings.filter((finding) => finding.severity === "WARNING");
  const summary = summarizeTree(treeJson);
  const activeTreeAssigned = product.pbv2ActiveTreeVersionId === tree.id;
  const pbv2TreePublished = tree.status === "ACTIVE";
  return {
    intake: buildIntakeSummary(session),
    product,
    pbv2Tree: {
      id: tree.id,
      status: tree.status,
      schemaVersion: tree.schemaVersion,
      publishedAt: toIso(tree.publishedAt),
      updatedAt: toIso(tree.updatedAt)!,
      ...summary,
      requiresDimensions: treeJson?.meta?.requiresDimensions === true,
      fixedDimensions: (() => {
        const fixed = treeJson?.meta?.fixedDimensions;
        if (!fixed || typeof fixed !== "object" || Number(fixed.widthIn) <= 0 || Number(fixed.heightIn) <= 0) return null;
        return { widthIn: Number(fixed.widthIn), heightIn: Number(fixed.heightIn), unit: "in" as const, ...(typeof fixed.label === "string" ? { label: fixed.label } : {}) };
      })(),
      relationships: relationshipsFromTree(treeJson, product),
    },
    publishReadiness: {
      productInactive: !product.isActive,
      pbv2TreeDraft: tree.status === "DRAFT",
      pbv2TreePublished,
      activeTreeAssigned,
      requiredOptionsPresent: requiredOptionsPresent(treeJson),
      noDuplicateSizeControls: hasNoDuplicateSizeControls(treeJson),
      pricingConfigured: pricingConfigured(treeJson),
      materialLinked: Boolean(product.primaryMaterialId),
      validationStatus: pbv2TreePublished && activeTreeAssigned
        ? "published"
        : errors.length > 0
          ? "blocked"
          : warnings.length > 0
            ? "warnings"
            : "ready",
      findings,
    },
  };
}

export function createDbProductIntakeDraftReviewService(database: any = defaultDb): ProductIntakeDraftReviewService {
  return {
    async getDraftReview(args) {
      return buildReview(database, args.organizationId, args.sessionId);
    },

    async findInactiveDraftMatches({ organizationId, productId, productName, category }) {
      const normalizedName = productName ? normalizeProductName(productName) : null;
      const normalizedCategory = category ? normalizeProductName(category) : null;
      if (!productId && !normalizedName) return [];
      const rows = await database
        .select({
          sessionId: productIntakeSessions.id,
          productId: products.id,
          productName: products.name,
          category: products.category,
          pbv2TreeVersionId: pbv2TreeVersions.id,
        })
        .from(productIntakeSessions)
        .innerJoin(products, and(
          eq(products.organizationId, productIntakeSessions.organizationId),
          eq(products.id, productIntakeSessions.createdProductId),
        ))
        .innerJoin(pbv2TreeVersions, and(
          eq(pbv2TreeVersions.organizationId, productIntakeSessions.organizationId),
          eq(pbv2TreeVersions.id, productIntakeSessions.createdPbv2TreeVersionId),
          eq(pbv2TreeVersions.productId, products.id),
        ))
        .where(and(
          eq(productIntakeSessions.organizationId, organizationId),
          eq(productIntakeSessions.status, "draft_created"),
          eq(products.organizationId, organizationId),
          eq(products.isActive, false),
          isNull(products.pbv2ActiveTreeVersionId),
          eq(pbv2TreeVersions.organizationId, organizationId),
          eq(pbv2TreeVersions.status, "DRAFT"),
        )) as Array<{ sessionId: string; productId: string; productName: string; category: string | null; pbv2TreeVersionId: string }>;
      return rows
        .filter((row) => !productId || row.productId === productId)
        .filter((row) => !normalizedName || normalizeProductName(row.productName) === normalizedName)
        .filter((row) => !normalizedCategory || normalizeProductName(row.category ?? "") === normalizedCategory)
        .sort((left, right) => left.productName.localeCompare(right.productName) || left.productId.localeCompare(right.productId));
    },

    async updateDraftPricing({ organizationId, sessionId, base, userId, userName, expectedDraftUpdatedAt, assistantAudit }) {
      await database.transaction(async (tx: any) => {
        const [session] = await tx
          .select({
            id: productIntakeSessions.id,
            status: productIntakeSessions.status,
            createdProductId: productIntakeSessions.createdProductId,
            createdPbv2TreeVersionId: productIntakeSessions.createdPbv2TreeVersionId,
          })
          .from(productIntakeSessions)
          .where(and(eq(productIntakeSessions.organizationId, organizationId), eq(productIntakeSessions.id, sessionId)))
          .limit(1);
        if (!session) throw new ProductIntakeSessionError(404, "Product Intake session not found.", "SESSION_NOT_FOUND");
        if (session.status !== "draft_created" || !session.createdProductId || !session.createdPbv2TreeVersionId) {
          throw new ProductIntakeSessionError(409, "Create the Product Intake draft before editing draft pricing.", "INTAKE_DRAFT_NOT_CREATED");
        }

        const [product] = await tx
          .select({ id: products.id, name: products.name, isActive: products.isActive, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId })
          .from(products)
          .where(and(eq(products.organizationId, organizationId), eq(products.id, session.createdProductId)))
          .limit(1);
        if (!product || product.isActive || product.pbv2ActiveTreeVersionId) {
          throw new ProductIntakeSessionError(409, "Only an inactive Product Intake draft without an active PBV2 tree can be edited.", "INACTIVE_DRAFT_REQUIRED");
        }

        const [tree] = await tx
          .select()
          .from(pbv2TreeVersions)
          .where(and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.id, session.createdPbv2TreeVersionId),
            eq(pbv2TreeVersions.productId, session.createdProductId),
          ))
          .limit(1);
        if (!tree) throw new ProductIntakeSessionError(404, "PBV2 draft tree not found.", "PBV2_TREE_NOT_FOUND");
        if (tree.status !== "DRAFT") {
          throw new ProductIntakeSessionError(409, "Only PBV2 DRAFT trees can be edited from Product Intake.", "PBV2_NOT_DRAFT");
        }
        if (expectedDraftUpdatedAt && new Date(tree.updatedAt).toISOString() !== new Date(expectedDraftUpdatedAt).toISOString()) {
          throw new ProductIntakeSessionError(409, "The PBV2 draft changed; reload the draft before applying this update.", "DRAFT_STALE");
        }

        const treeJson = tree.treeJson && typeof tree.treeJson === "object" ? { ...(tree.treeJson as any) } : {};
        const meta = treeJson.meta && typeof treeJson.meta === "object" ? { ...treeJson.meta } : {};
        const pricingV2 = meta.pricingV2 && typeof meta.pricingV2 === "object" ? { ...meta.pricingV2 } : {};
        const previousBase = pricingV2.base && typeof pricingV2.base === "object" ? { ...pricingV2.base } : {};
        const pricingKeys = ["perSqftCents", "perPieceCents", "minimumChargeCents"] as const;
        const nextBase = { ...previousBase } as Record<typeof pricingKeys[number], number | undefined>;
        const patchedFields = pricingKeys.filter((key) => Object.prototype.hasOwnProperty.call(base, key));
        for (const key of patchedFields) {
          const value = base[key];
          if (value == null) delete nextBase[key];
          else nextBase[key] = normalizePricingCents(value) ?? 0;
        }
        const beforeBase = basePricingFromTree({ meta: { pricingV2: { base: previousBase } } });
        const afterBase = basePricingFromTree({ meta: { pricingV2: { base: nextBase } } });

        const productIntake = meta.productIntake && typeof meta.productIntake === "object" ? { ...meta.productIntake } : {};
        const pricingReadiness = productIntake.pricingReadiness && typeof productIntake.pricingReadiness === "object"
          ? { ...productIntake.pricingReadiness }
          : {};
        const warnings = Array.isArray(pricingReadiness.warnings)
          ? pricingReadiness.warnings.filter((warning: unknown) => !/Base pricing was not found/i.test(String(warning)))
          : [];
        if (!pricingConfigured({ meta: { pricingV2: { base: nextBase } } })) {
          warnings.push("Base pricing was not found in the intake source. PBV2 publish will remain blocked until per sqft, per piece, or minimum charge pricing is configured.");
        }

        const updatedTreeJson = {
          ...treeJson,
          meta: {
            ...meta,
            updatedAt: new Date().toISOString(),
            updatedByUserId: userId ?? undefined,
            pricingV2: {
              unitSystem: "imperial",
              tierBasis: "line_item_quantity",
              ...pricingV2,
              base: nextBase,
            },
            productIntake: {
              ...productIntake,
              pricingReadiness: {
                ...pricingReadiness,
                base: nextBase,
                basePricingConfigured: pricingConfigured({ meta: { pricingV2: { base: nextBase } } }),
                sources: Array.from(new Set([
                    ...(Array.isArray(pricingReadiness.sources) ? pricingReadiness.sources.map(String) : []),
                    "Product Intake draft review pricing editor",
                ])),
                warnings,
              },
              pricingWarnings: warnings,
            },
          },
        };

        const updateConditions = [
          eq(pbv2TreeVersions.organizationId, organizationId),
          eq(pbv2TreeVersions.id, tree.id),
          eq(pbv2TreeVersions.status, "DRAFT"),
          ...(expectedDraftUpdatedAt ? [eq(pbv2TreeVersions.updatedAt, new Date(expectedDraftUpdatedAt))] : []),
        ];
        const updatedRows = await tx
          .update(pbv2TreeVersions)
          .set({
            treeJson: updatedTreeJson,
            updatedByUserId: userId,
            updatedAt: new Date(),
          })
          .where(and(...updateConditions))
          .returning({ id: pbv2TreeVersions.id });
        if (updatedRows.length !== 1) {
          throw new ProductIntakeSessionError(409, "The PBV2 draft changed; reload the draft before applying this update.", "DRAFT_STALE");
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: userName ?? null,
          actionType: "product_intake_draft_pricing_updated",
          entityType: "product_intake_session",
          entityId: sessionId,
          entityName: product.name,
          description: `Product Intake draft pricing updated for PBV2 DRAFT tree ${tree.id}.`,
          newValues: {
            sessionId,
            productId: session.createdProductId,
            productName: product.name,
            pbv2TreeVersionId: tree.id,
            statusBefore: { productActive: false, pbv2Tree: "DRAFT", activeTreeAssigned: false },
            statusAfter: { productActive: false, pbv2Tree: "DRAFT", activeTreeAssigned: false },
            assistant: assistantAudit ? {
              ...assistantAudit,
              confirmationConsumed: true,
            } : undefined,
            patch: base,
            patchedFields,
            omittedFields: pricingKeys.filter((key) => !patchedFields.includes(key)),
            explicitClears: patchedFields.filter((key) => base[key] === null),
            beforeBase,
            afterBase,
            warnings,
            result: "succeeded",
          },
        });
      });
      return buildReview(database, organizationId, sessionId);
    },

    async updateDraftConfiguration({ organizationId, sessionId, patch, userId, expectedDraftUpdatedAt, assistantAudit }) {
      await database.transaction(async (tx: any) => {
        const [session] = await tx.select({ status: productIntakeSessions.status, createdProductId: productIntakeSessions.createdProductId, createdPbv2TreeVersionId: productIntakeSessions.createdPbv2TreeVersionId })
          .from(productIntakeSessions).where(and(eq(productIntakeSessions.organizationId, organizationId), eq(productIntakeSessions.id, sessionId))).limit(1);
        if (!session || session.status !== "draft_created" || !session.createdProductId || !session.createdPbv2TreeVersionId) throw new ProductIntakeSessionError(409, "Only an existing Product Intake draft can be configured.", "INACTIVE_DRAFT_REQUIRED");
        const [product] = await tx.select().from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, session.createdProductId))).limit(1);
        if (!product || product.isActive || product.pbv2ActiveTreeVersionId) throw new ProductIntakeSessionError(409, "Only an inactive Product Intake draft without an active PBV2 tree can be configured.", "INACTIVE_DRAFT_REQUIRED");
        const [tree] = await tx.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, session.createdPbv2TreeVersionId), eq(pbv2TreeVersions.productId, product.id))).limit(1);
        if (!tree || tree.status !== "DRAFT") throw new ProductIntakeSessionError(409, "Only PBV2 DRAFT trees can be configured.", "PBV2_NOT_DRAFT");
        if (expectedDraftUpdatedAt && new Date(tree.updatedAt).toISOString() !== new Date(expectedDraftUpdatedAt).toISOString()) throw new ProductIntakeSessionError(409, "The PBV2 draft changed; reload before applying this update.", "DRAFT_STALE");

        const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
        if (has("primaryMaterialId") && patch.primaryMaterialId !== null) {
          const [material] = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.organizationId, organizationId), eq(materials.id, String(patch.primaryMaterialId)))).limit(1);
          if (!material) throw new ProductIntakeSessionError(404, "The requested material is not available to this organization.", "MATERIAL_NOT_FOUND");
        }
        const treeJson = tree.treeJson && typeof tree.treeJson === "object" ? { ...(tree.treeJson as any) } : {};
        const meta = treeJson.meta && typeof treeJson.meta === "object" ? { ...treeJson.meta } : {};
        const currentFixed = meta.fixedDimensions && typeof meta.fixedDimensions === "object" ? meta.fixedDimensions : null;
        const nextMeasurement = has("measurementMode") ? patch.measurementMode : product.measurementMode;
        const nextWorkflow = has("workflowIntent") ? patch.workflowIntent : product.workflowIntent;
        const nextRequiresDimensions = has("requiresDimensions") ? patch.requiresDimensions : meta.requiresDimensions === true;
        const nextFixed = has("fixedDimensions") ? patch.fixedDimensions : currentFixed;
        const nextNesting = has("useNestingCalculator") ? patch.useNestingCalculator : product.useNestingCalculator;
        const nextSheetWidth = has("sheetWidth") ? patch.sheetWidth : product.sheetWidth === null ? null : Number(product.sheetWidth);
        const nextSheetHeight = has("sheetHeight") ? patch.sheetHeight : product.sheetHeight === null ? null : Number(product.sheetHeight);
        const nextMaterialType = has("materialType") ? patch.materialType : product.materialType;
        if (nextWorkflow === "service_fee" && nextMeasurement !== "quantity_only") throw new ProductIntakeSessionError(409, "Service-fee drafts must be quantity-only; propose that related measurement change explicitly.", "DRAFT_CONFIGURATION_INCOMPATIBLE");
        if (nextMeasurement === "quantity_only" && (nextRequiresDimensions === true || nextFixed || nextNesting === true)) throw new ProductIntakeSessionError(409, "Quantity-only drafts cannot require dimensions, fixed dimensions, or sheet nesting.", "DRAFT_CONFIGURATION_INCOMPATIBLE");
        if (nextFixed && nextRequiresDimensions === true) throw new ProductIntakeSessionError(409, "Fixed dimensions require requiresDimensions to be false.", "DRAFT_CONFIGURATION_INCOMPATIBLE");
        if (nextNesting === true && (nextMaterialType !== "sheet" || !Number.isFinite(Number(nextSheetWidth)) || Number(nextSheetWidth) <= 0 || !Number.isFinite(Number(nextSheetHeight)) || Number(nextSheetHeight) <= 0)) throw new ProductIntakeSessionError(409, "Sheet nesting requires positive sheet width and height on a sheet product.", "DRAFT_CONFIGURATION_INCOMPATIBLE");

        const productValues: Record<string, unknown> = {};
        for (const key of ["name", "category", "description", "isTaxable", "measurementMode", "workflowIntent", "primaryMaterialId", "useNestingCalculator", "sheetWidth", "sheetHeight", "materialType"] as const) if (has(key)) productValues[key] = patch[key];
        if (has("allowRotation")) productValues.pricingProfileConfig = { ...(product.pricingProfileConfig && typeof product.pricingProfileConfig === "object" ? product.pricingProfileConfig : {}), allowRotation: patch.allowRotation };
        if (Object.keys(productValues).length) {
          const updated = await tx.update(products).set({ ...productValues, updatedAt: new Date() } as any).where(and(eq(products.organizationId, organizationId), eq(products.id, product.id), eq(products.isActive, false), isNull(products.pbv2ActiveTreeVersionId))).returning({ id: products.id });
          if (updated.length !== 1) throw new ProductIntakeSessionError(409, "The product changed; reload before applying this update.", "DRAFT_STALE");
        }
        const nextMeta = { ...meta } as Record<string, unknown>;
        if (has("requiresDimensions")) nextMeta.requiresDimensions = patch.requiresDimensions;
        if (has("fixedDimensions")) { if (patch.fixedDimensions === null) delete nextMeta.fixedDimensions; else nextMeta.fixedDimensions = { ...(patch.fixedDimensions as any), unit: "in" }; }
        if (has("requiresDimensions") || has("fixedDimensions")) {
          const updated = await tx.update(pbv2TreeVersions).set({ treeJson: { ...treeJson, meta: nextMeta }, updatedByUserId: userId, updatedAt: new Date() }).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.status, "DRAFT"), ...(expectedDraftUpdatedAt ? [eq(pbv2TreeVersions.updatedAt, new Date(expectedDraftUpdatedAt))] : []))).returning({ id: pbv2TreeVersions.id });
          if (updated.length !== 1) throw new ProductIntakeSessionError(409, "The PBV2 draft changed; reload before applying this update.", "DRAFT_STALE");
        }
        await tx.insert(auditLogs).values({ organizationId, userId, actionType: "product_intake_draft_configuration_updated", entityType: "product_intake_session", entityId: sessionId, entityName: product.name, description: `Product Intake draft configuration updated for ${product.name}.`, newValues: { productId: product.id, productName: product.name, patch, before: { name: product.name, category: product.category, description: product.description, isTaxable: product.isTaxable, measurementMode: product.measurementMode, workflowIntent: product.workflowIntent, primaryMaterialId: product.primaryMaterialId, useNestingCalculator: product.useNestingCalculator, sheetWidth: product.sheetWidth, sheetHeight: product.sheetHeight, materialType: product.materialType, requiresDimensions: meta.requiresDimensions === true, fixedDimensions: currentFixed }, after: { ...productValues, ...(has("requiresDimensions") ? { requiresDimensions: patch.requiresDimensions } : {}), ...(has("fixedDimensions") ? { fixedDimensions: patch.fixedDimensions } : {}) }, statusBefore: { productActive: false, pbv2Tree: "DRAFT" }, statusAfter: { productActive: false, pbv2Tree: "DRAFT" }, assistant: assistantAudit ? { ...assistantAudit, confirmationConsumed: true } : undefined, result: "succeeded" } });
      });
      return buildReview(database, organizationId, sessionId);
    },

    async updateDraftRelationships({ organizationId, sessionId, patch: rawPatch, userId, expectedDraftUpdatedAt, assistantAudit }) {
      const patch = productDraftRelationshipPatchSchema.parse(rawPatch);
      await database.transaction(async (tx: any) => {
        const [session] = await tx.select({ status: productIntakeSessions.status, createdProductId: productIntakeSessions.createdProductId, createdPbv2TreeVersionId: productIntakeSessions.createdPbv2TreeVersionId })
          .from(productIntakeSessions).where(and(eq(productIntakeSessions.organizationId, organizationId), eq(productIntakeSessions.id, sessionId))).limit(1);
        if (!session || session.status !== "draft_created" || !session.createdProductId || !session.createdPbv2TreeVersionId) throw new ProductIntakeSessionError(409, "Only an existing Product Intake draft can be updated.", "INACTIVE_DRAFT_REQUIRED");
        const [product] = await tx.select().from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, session.createdProductId))).limit(1);
        if (!product || product.isActive || product.pbv2ActiveTreeVersionId) throw new ProductIntakeSessionError(409, "Only an inactive Product Intake draft without an active PBV2 tree can be updated.", "INACTIVE_DRAFT_REQUIRED");
        const [tree] = await tx.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, session.createdPbv2TreeVersionId), eq(pbv2TreeVersions.productId, product.id))).limit(1);
        if (!tree || tree.status !== "DRAFT") throw new ProductIntakeSessionError(409, "Only PBV2 DRAFT trees can be updated.", "PBV2_NOT_DRAFT");
        if (expectedDraftUpdatedAt && new Date(tree.updatedAt).toISOString() !== new Date(expectedDraftUpdatedAt).toISOString()) throw new ProductIntakeSessionError(409, "The PBV2 draft changed; reload before applying this update.", "DRAFT_STALE");

        const originalTree = tree.treeJson && typeof tree.treeJson === "object" ? JSON.parse(JSON.stringify(tree.treeJson)) : {};
        let nextTree = JSON.parse(JSON.stringify(originalTree));
        const meta = nextTree.meta && typeof nextTree.meta === "object" ? { ...nextTree.meta } : {};
        const intake = meta.productIntake && typeof meta.productIntake === "object" ? { ...meta.productIntake } : {};
        const before = relationshipsFromTree(originalTree, product);

        if (patch.routing) {
          if (patch.routing.operation === "clear") {
            delete intake.draftRouting;
          } else {
            if (product.workflowIntent !== "standard_production") {
              throw new ProductIntakeSessionError(409, "Only standard-production drafts can receive production routing.", "DRAFT_ROUTING_INCOMPATIBLE");
            }
            const reference = patch.routing.station!;
            const stationRows = await tx.select({ id: stations.id, key: stations.key, name: stations.name })
              .from(stations).where(and(eq(stations.organizationId, organizationId), eq(stations.active, true)));
            const target = reference.id
              ? stationRows.filter((station: any) => station.id === reference.id)
              : stationRows.filter((station: any) => {
                const query = normalizeRelationshipText(reference.key ?? reference.name);
                return [station.key, station.name].some((value) => normalizeRelationshipText(value) === query);
              });
            if (!target.length) throw new ProductIntakeSessionError(404, "The requested production station is not available to this organization.", "STATION_NOT_FOUND");
            if (target.length > 1) throw new ProductIntakeSessionError(409, "The requested production station is ambiguous; choose a station ID.", "STATION_AMBIGUOUS");
            intake.draftRouting = { stationId: target[0].id, stationKey: target[0].key, stationName: target[0].name };
          }
        }

        if (patch.options) {
          const currentOptions = Array.isArray(intake.draftOptionTemplates) ? intake.draftOptionTemplates.filter((entry: any) => entry && typeof entry.templateId === "string" && typeof entry.importInstanceId === "string") : [];
          const resolveTemplate = async (reference: { id?: string; name?: string; key?: string }) => {
            const rows = await tx.select({ id: pbv2OptionGroupTemplates.id, name: pbv2OptionGroupTemplates.name, slug: pbv2OptionGroupTemplates.slug, tags: pbv2OptionGroupTemplates.tags, templateTree: pbv2OptionGroupTemplates.templateTree, pricingMetadata: pbv2OptionGroupTemplates.pricingMetadata })
              .from(pbv2OptionGroupTemplates)
              .where(and(eq(pbv2OptionGroupTemplates.state, "active"), or(eq(pbv2OptionGroupTemplates.isSystemTemplate, true), and(eq(pbv2OptionGroupTemplates.isSystemTemplate, false), eq(pbv2OptionGroupTemplates.organizationId, organizationId)))));
            const matches = reference.id
              ? rows.filter((row: any) => row.id === reference.id)
              : rows.filter((row: any) => {
                const query = normalizeRelationshipText(reference.key ?? reference.name);
                return [row.name, row.slug, ...(Array.isArray(row.tags) ? row.tags : [])].some((value) => normalizeRelationshipText(value) === query);
              });
            if (!matches.length) throw new ProductIntakeSessionError(404, "The requested option template is not available to this organization.", "OPTION_TEMPLATE_NOT_FOUND");
            if (matches.length > 1) throw new ProductIntakeSessionError(409, "The requested option template is ambiguous; choose a template ID.", "OPTION_TEMPLATE_AMBIGUOUS");
            const template = matches[0] as any;
            const templateNodes = Object.values(template.templateTree?.nodes ?? {});
            const hasEmbeddedPricing = templateNodes.some((node: any) => node?.pricing || node?.priceFormula || node?.input?.pricing || node?.input?.priceFormula)
              || Object.keys(template.templateTree?.meta?.pricing ?? {}).length > 0;
            if (Object.keys(template.pricingMetadata ?? {}).length || template.templateTree?.pricingMatrix || hasEmbeddedPricing) {
              throw new ProductIntakeSessionError(409, "Option templates with pricing configuration cannot be changed by this relationship-only operation.", "OPTION_PRICING_UNSUPPORTED");
            }
            return template;
          };
          const references = patch.options.templates ?? [];
          const resolved = [] as any[];
          for (const reference of references) {
            const template = await resolveTemplate(reference);
            if (!resolved.some((item) => item.id === template.id)) resolved.push(template);
          }
          const requestedIds = new Set(resolved.map((template) => template.id));
          const removeIds = patch.options.operation === "clear"
            ? new Set(currentOptions.map((entry: any) => entry.templateId))
            : patch.options.operation === "replace"
              ? new Set(currentOptions.map((entry: any) => entry.templateId).filter((id: string) => !requestedIds.has(id)))
              : patch.options.operation === "remove"
                ? requestedIds
                : new Set<string>();
          for (const entry of currentOptions) {
            if (removeIds.has(entry.templateId)) nextTree = removeTemplateImport(nextTree, entry.importInstanceId);
          }
          const retained = currentOptions.filter((entry: any) => !removeIds.has(entry.templateId));
          const addTemplates = patch.options.operation === "add" || patch.options.operation === "replace" ? resolved : [];
          for (const template of addTemplates) {
            if (retained.some((entry: any) => entry.templateId === template.id)) continue;
            const importInstanceId = `draft_${tree.id}_${template.id}`;
            const cloned = cloneTemplateIntoTree(nextTree, template.templateTree, { importInstanceId, sourceTemplateId: template.id });
            if (!cloned.ok) throw new ProductIntakeSessionError(409, "The selected option template cannot be safely added to this PBV2 draft.", "OPTION_TEMPLATE_INCOMPATIBLE");
            nextTree = cloned.tree;
            retained.push({ templateId: template.id, name: template.name, importInstanceId });
          }
          intake.draftOptionTemplates = retained;
        }

        if (patch.setupNote) {
          const previous = typeof intake.internalSetupNote === "string" ? intake.internalSetupNote.trim() : "";
          if (patch.setupNote.operation === "clear") delete intake.internalSetupNote;
          else if (patch.setupNote.operation === "replace") intake.internalSetupNote = patch.setupNote.text;
          else intake.internalSetupNote = previous.includes(patch.setupNote.text!) ? previous : [previous, patch.setupNote.text].filter(Boolean).join("\n");
        }
        if (patch.reviewWarnings) {
          const previous = Array.isArray(intake.reviewWarnings) ? intake.reviewWarnings.map(String).map((warning: string) => warning.trim()).filter(Boolean) : [];
          const requested = patch.reviewWarnings.warnings ?? [];
          const contains = (values: string[], value: string) => values.some((item) => normalizeRelationshipText(item) === normalizeRelationshipText(value));
          if (patch.reviewWarnings.operation === "clear") intake.reviewWarnings = [];
          else if (patch.reviewWarnings.operation === "replace") intake.reviewWarnings = Array.from(new Map(requested.map((warning: string) => [normalizeRelationshipText(warning), warning])).values());
          else if (patch.reviewWarnings.operation === "add") intake.reviewWarnings = [...previous, ...requested.filter((warning: string) => !contains(previous, warning))];
          else intake.reviewWarnings = previous.filter((warning: string) => !contains(requested, warning));
        }

        nextTree.meta = { ...meta, productIntake: intake, updatedAt: new Date().toISOString(), updatedByUserId: userId ?? undefined };
        const after = relationshipsFromTree(nextTree, product);
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        const updated = await tx.update(pbv2TreeVersions).set({ treeJson: nextTree, updatedByUserId: userId, updatedAt: new Date() })
          .where(and(eq(pbv2TreeVersions.organizationId, organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.status, "DRAFT"), ...(expectedDraftUpdatedAt ? [eq(pbv2TreeVersions.updatedAt, new Date(expectedDraftUpdatedAt))] : []))).returning({ id: pbv2TreeVersions.id });
        if (updated.length !== 1) throw new ProductIntakeSessionError(409, "The PBV2 draft changed; reload before applying this update.", "DRAFT_STALE");
        await tx.insert(auditLogs).values({ organizationId, userId, actionType: "product_intake_draft_relationships_updated", entityType: "product_intake_session", entityId: sessionId, entityName: product.name, description: `Product Intake draft relationships updated for ${product.name}.`, newValues: { productId: product.id, productName: product.name, patch, before, after, statusBefore: { productActive: false, pbv2Tree: "DRAFT" }, statusAfter: { productActive: false, pbv2Tree: "DRAFT" }, assistant: assistantAudit ? { ...assistantAudit, confirmationConsumed: true } : undefined, result: "succeeded" } });
      });
      return buildReview(database, organizationId, sessionId);
    },

    async getDraftLinkForProduct({ organizationId, productId }) {
      const [session] = await database
        .select({
          sessionId: productIntakeSessions.id,
          productId: products.id,
          pbv2TreeVersionId: productIntakeSessions.createdPbv2TreeVersionId,
          sessionStatus: productIntakeSessions.status,
          productIsActive: products.isActive,
          pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
          pbv2Status: pbv2TreeVersions.status,
          treeJson: pbv2TreeVersions.treeJson,
        })
        .from(productIntakeSessions)
        .innerJoin(products, eq(productIntakeSessions.createdProductId, products.id))
        .leftJoin(pbv2TreeVersions, and(
          eq(productIntakeSessions.createdPbv2TreeVersionId, pbv2TreeVersions.id),
          eq(pbv2TreeVersions.organizationId, organizationId),
        ))
        .where(and(
          eq(productIntakeSessions.organizationId, organizationId),
          eq(productIntakeSessions.createdProductId, productId),
          eq(products.organizationId, organizationId),
        ))
        .orderBy(desc(productIntakeSessions.updatedAt))
        .limit(1);
      if (!session) return null;
      const intake = (session as any).treeJson?.meta?.productIntake;
      const materialAssociationRequired = Boolean(intake?.materialAssociationRequired);
      const materialWarnings = Array.isArray(intake?.materialWarnings)
        ? intake.materialWarnings.map((warning: any) => String(warning)).filter(Boolean)
        : [];
      return {
        sessionId: session.sessionId,
        productId: session.productId,
        pbv2TreeVersionId: session.pbv2TreeVersionId,
        sessionStatus: session.sessionStatus,
        productIsActive: session.productIsActive,
        pbv2ActiveTreeVersionId: session.pbv2ActiveTreeVersionId,
        pbv2Status: session.pbv2Status,
        materialAssociationRequired,
        intakeWarnings: materialAssociationRequired && materialWarnings.length === 0
          ? ["Material association required."]
          : materialWarnings,
      };
    },

    async activateProduct({ organizationId, sessionId, userId, userName }) {
      return database.transaction(async (tx: any) => {
        const [session] = await tx
          .select({
            id: productIntakeSessions.id,
            status: productIntakeSessions.status,
            createdProductId: productIntakeSessions.createdProductId,
            createdPbv2TreeVersionId: productIntakeSessions.createdPbv2TreeVersionId,
          })
          .from(productIntakeSessions)
          .where(and(eq(productIntakeSessions.organizationId, organizationId), eq(productIntakeSessions.id, sessionId)))
          .limit(1);
        if (!session) throw new ProductIntakeSessionError(404, "Product Intake session not found.", "SESSION_NOT_FOUND");
        if (session.status !== "draft_created") {
          throw new ProductIntakeSessionError(409, "Only Product Intake sessions with created drafts can activate products.", "INTAKE_DRAFT_NOT_CREATED");
        }
        if (!session.createdProductId || !session.createdPbv2TreeVersionId) {
          throw new ProductIntakeSessionError(409, "This Product Intake session has not created a draft product yet.", "INTAKE_DRAFT_NOT_CREATED");
        }

        const review = await buildReview(tx, organizationId, sessionId);
        if (review.pbv2Tree.status !== "ACTIVE" || !review.publishReadiness.activeTreeAssigned) {
          throw new ProductIntakeSessionError(409, "Publish the PBV2 draft before activating this product.", "PBV2_NOT_PUBLISHED");
        }
        if (review.product.isActive) {
          return { productId: review.product.id, isActive: true as const };
        }

        const [updated] = await tx
          .update(products)
          .set({ isActive: true, updatedAt: new Date() })
          .where(and(eq(products.organizationId, organizationId), eq(products.id, review.product.id)))
          .returning({ id: products.id, isActive: products.isActive });
        if (!updated?.isActive) {
          throw new ProductIntakeSessionError(500, "Product activation failed.", "PRODUCT_ACTIVATION_FAILED");
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: userName ?? null,
          actionType: "product_intake_product_activated",
          entityType: "product",
          entityId: review.product.id,
          entityName: review.product.name,
          description: `Product Intake product activated after PBV2 publish for session ${sessionId}.`,
          newValues: {
            sessionId,
            productId: review.product.id,
            pbv2TreeVersionId: review.pbv2Tree.id,
            productIsActive: true,
          },
        });

        return { productId: updated.id, isActive: true as const };
      });
    },
  };
}
