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

function summarizeTree(treeJson: any): Pick<ProductIntakeDraftReview["pbv2Tree"], "groupCount" | "optionCount" | "optionGroups" | "draftQuality" | "intakeSummary"> {
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
