import { and, desc, eq } from "drizzle-orm";
import {
  auditLogs,
  pbv2TreeVersions,
  productIntakeSessions,
  products,
  productTypes,
} from "@shared/schema";
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
  }): Promise<ProductIntakeDraftReview>;
  getDraftLinkForProduct(args: { organizationId: string; productId: string }): Promise<{
    sessionId: string;
    productId: string;
    pbv2TreeVersionId: string | null;
    sessionStatus: string;
    productIsActive: boolean;
    pbv2Status: string | null;
    pbv2ActiveTreeVersionId: string | null;
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
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
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

function buildIntakeSummary(session: any): ProductIntakeDraftReview["intake"] {
  const brief = session.aiBriefJson && typeof session.aiBriefJson === "object" ? session.aiBriefJson as any : {};
  const likelyMaterial = Array.isArray(brief?.materialAnalysis?.likelyMaterialMatches)
    ? brief.materialAnalysis.likelyMaterialMatches[0]
    : null;
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
    materialMatch: typeof likelyMaterial?.name === "string" ? likelyMaterial.name : null,
    warnings: Array.isArray(brief?.draftWarnings)
      ? brief.draftWarnings.map((warning: any) => String(warning?.message ?? "")).filter(Boolean)
      : [],
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

    async updateDraftPricing({ organizationId, sessionId, base, userId, userName }) {
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

        const treeJson = tree.treeJson && typeof tree.treeJson === "object" ? { ...(tree.treeJson as any) } : {};
        const meta = treeJson.meta && typeof treeJson.meta === "object" ? { ...treeJson.meta } : {};
        const pricingV2 = meta.pricingV2 && typeof meta.pricingV2 === "object" ? { ...meta.pricingV2 } : {};
        const previousBase = pricingV2.base && typeof pricingV2.base === "object" ? pricingV2.base : {};
        const nextBase = {
          ...previousBase,
          perSqftCents: normalizePricingCents(base.perSqftCents),
          perPieceCents: normalizePricingCents(base.perPieceCents),
          minimumChargeCents: normalizePricingCents(base.minimumChargeCents),
        };
        for (const key of ["perSqftCents", "perPieceCents", "minimumChargeCents"] as const) {
          if (nextBase[key] == null) delete nextBase[key];
        }

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

        await tx
          .update(pbv2TreeVersions)
          .set({
            treeJson: updatedTreeJson,
            updatedByUserId: userId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(pbv2TreeVersions.organizationId, organizationId),
            eq(pbv2TreeVersions.id, tree.id),
            eq(pbv2TreeVersions.status, "DRAFT"),
          ));

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: userName ?? null,
          actionType: "product_intake_draft_pricing_updated",
          entityType: "product_intake_session",
          entityId: sessionId,
          entityName: session.createdProductId,
          description: `Product Intake draft pricing updated for PBV2 DRAFT tree ${tree.id}.`,
          newValues: {
            sessionId,
            productId: session.createdProductId,
            pbv2TreeVersionId: tree.id,
            base: nextBase,
          },
        });
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
      return session ?? null;
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
