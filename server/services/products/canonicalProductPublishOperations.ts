import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Finding } from "@shared/pbv2/findings";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";
import { auditLogs, materials, pbv2TreeVersions, pricingFormulas, products } from "@shared/schema";
import { collectPbv2MaterialValidationIds, validatePbv2MaterialReferences } from "../pbv2MaterialValidation";

type ProductRecord = Pick<typeof products.$inferSelect, "id" | "organizationId" | "name" | "isActive" | "primaryMaterialId" | "pbv2ActiveTreeVersionId" | "updatedAt" | "pricingEngine" | "pricingFormulaId" | "pricingFormula">;
type TreeRecord = Pick<typeof pbv2TreeVersions.$inferSelect, "id" | "organizationId" | "productId" | "status" | "schemaVersion" | "treeJson" | "publishedAt" | "updatedAt">;
export type CanonicalProductPublishTarget = { product: ProductRecord; tree: TreeRecord; materials: Array<{ id: string; name: string; sku: string | null; weightOzPerBasis: string | null }>; pricingFormula?: { id: string; isActive: boolean; expression: string | null } | null };
type PublishRepository = {
  get(input: { organizationId: string; productId?: string; treeVersionId?: string }): Promise<CanonicalProductPublishTarget | null>;
  publish(input: { organizationId: string; actorUserId: string; product: ProductRecord; tree: TreeRecord; treeJson: Record<string, unknown>; reference: string; activateProduct: boolean }): Promise<{ product: typeof products.$inferSelect; tree: typeof pbv2TreeVersions.$inferSelect } | null>;
};

class PublishStoreStaleError extends Error {}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}
function fingerprint(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function iso(value: Date | string): string { return new Date(value).toISOString(); }
function mergeFindings(...groups: readonly Finding[][]): Finding[] { return groups.flat(); }
const formulaText = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const legacyFormulaCanonicalizationFindings = (target: CanonicalProductPublishTarget, treeJson: Record<string, unknown>): Finding[] => {
  // The compatibility resolver recognizes the persisted legacy expression
  // independently of the old engine label, so publication must protect every
  // Draft for which that expression remains the effective fallback.
  const legacyExpression = formulaText(target.product.pricingFormula);
  if (!legacyExpression) return [];
  const libraryExpression = target.pricingFormula?.isActive ? formulaText(target.pricingFormula.expression) : "";
  // Formula Library has higher canonical resolver precedence, so a valid
  // active library expression means the legacy row is not the effective
  // source that this Draft must preserve.
  if (libraryExpression) return [];
  const embeddedExpression = formulaText((treeJson.meta as Record<string, unknown> | undefined)?.pricingFormula);
  if (embeddedExpression) return [];
  return [{ code: "PBV2_E_LEGACY_PRODUCT_FORMULA_NOT_CANONICALIZED", severity: "ERROR", message: "A Draft inheriting a legacy Product Formula must own a canonical ProductVersion Formula before publication.", path: "tree.meta.pricingFormula" } as Finding];
};

const repository: PublishRepository = {
  async get(input) {
    const { db } = await import("../../db");
    const [tree] = input.treeVersionId
      ? await db.select({ id: pbv2TreeVersions.id, organizationId: pbv2TreeVersions.organizationId, productId: pbv2TreeVersions.productId, status: pbv2TreeVersions.status, schemaVersion: pbv2TreeVersions.schemaVersion, treeJson: pbv2TreeVersions.treeJson, publishedAt: pbv2TreeVersions.publishedAt, updatedAt: pbv2TreeVersions.updatedAt }).from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, input.treeVersionId))).limit(1)
      : input.productId
        ? await db.select({ id: pbv2TreeVersions.id, organizationId: pbv2TreeVersions.organizationId, productId: pbv2TreeVersions.productId, status: pbv2TreeVersions.status, schemaVersion: pbv2TreeVersions.schemaVersion, treeJson: pbv2TreeVersions.treeJson, publishedAt: pbv2TreeVersions.publishedAt, updatedAt: pbv2TreeVersions.updatedAt }).from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, input.productId), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1)
        : [];
    if (!tree) return null;
    const [product] = await db.select({ id: products.id, organizationId: products.organizationId, name: products.name, isActive: products.isActive, primaryMaterialId: products.primaryMaterialId, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId, updatedAt: products.updatedAt, pricingEngine: products.pricingEngine, pricingFormulaId: products.pricingFormulaId, pricingFormula: products.pricingFormula }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, tree.productId))).limit(1);
    if (!product || (input.productId && product.id !== input.productId)) return null;
    const materialIds = collectPbv2MaterialValidationIds({ treeJson: tree.treeJson, productPrimaryMaterialId: product.primaryMaterialId });
    const materialRows = materialIds.length ? await db.select({ id: materials.id, name: materials.name, sku: materials.sku, weightOzPerBasis: materials.weightOzPerBasis }).from(materials).where(and(eq(materials.organizationId, input.organizationId), inArray(materials.id, materialIds))) : [];
    const [pricingFormula] = product.pricingFormulaId ? await db.select({ id: pricingFormulas.id, isActive: pricingFormulas.isActive, expression: pricingFormulas.expression }).from(pricingFormulas).where(and(eq(pricingFormulas.organizationId, input.organizationId), eq(pricingFormulas.id, product.pricingFormulaId))).limit(1) : [];
    return { product, tree, materials: materialRows, pricingFormula: pricingFormula ?? null };
  },
  async publish(input) {
    const { db } = await import("../../db");
    return db.transaction(async (tx) => {
      const now = new Date();
      // Lock and re-check the canonical Product/Draft pair inside the one
      // publisher transaction.  The version columns are timestamp without
      // time zone and V2's pg runtime and this canonical Neon runtime bind
      // Date values differently; comparing a bound Date in UPDATE can yield a
      // false stale result.  The lock plus same-driver revision check keeps
      // the optimistic-concurrency guarantee without weakening publication.
      const [lockedProduct] = await tx.select({
        id: products.id,
        pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId,
        updatedAt: products.updatedAt,
      }).from(products).where(and(
        eq(products.organizationId, input.organizationId),
        eq(products.id, input.product.id),
      )).for("update");
      const [lockedTree] = await tx.select({
        id: pbv2TreeVersions.id,
        status: pbv2TreeVersions.status,
        updatedAt: pbv2TreeVersions.updatedAt,
      }).from(pbv2TreeVersions).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId),
        eq(pbv2TreeVersions.id, input.tree.id),
        eq(pbv2TreeVersions.productId, input.product.id),
      )).for("update");
      if (!lockedProduct || !lockedTree || lockedTree.status !== "DRAFT"
        || iso(lockedProduct.updatedAt) !== iso(input.product.updatedAt)
        || iso(lockedTree.updatedAt) !== iso(input.tree.updatedAt)) {
        throw new PublishStoreStaleError();
      }
      if (input.product.pbv2ActiveTreeVersionId && input.product.pbv2ActiveTreeVersionId !== input.tree.id) {
        await tx.update(pbv2TreeVersions).set({ status: "DEPRECATED", updatedAt: now, updatedByUserId: input.actorUserId }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, input.product.pbv2ActiveTreeVersionId), eq(pbv2TreeVersions.status, "ACTIVE")));
      }
      const nextTreeJson = { ...input.treeJson, schemaVersion: 2, status: "ACTIVE" };
      const [tree] = await tx.update(pbv2TreeVersions).set({ status: "ACTIVE", publishedAt: now, updatedAt: now, updatedByUserId: input.actorUserId, treeJson: nextTreeJson }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, input.tree.id), eq(pbv2TreeVersions.productId, input.product.id), eq(pbv2TreeVersions.status, "DRAFT"))).returning();
      if (!tree) throw new PublishStoreStaleError();
      const pointerCondition = input.product.pbv2ActiveTreeVersionId ? eq(products.pbv2ActiveTreeVersionId, input.product.pbv2ActiveTreeVersionId) : isNull(products.pbv2ActiveTreeVersionId);
      const [product] = await tx.update(products).set({ pbv2ActiveTreeVersionId: tree.id, optionTreeJson: nextTreeJson, ...(input.activateProduct ? { isActive: true } : {}), updatedAt: now }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.product.id), pointerCondition)).returning();
      if (!product) throw new PublishStoreStaleError();
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "product", entityId: product.id, actionType: "product_configuration_published", description: `Published PBV2 configuration ${tree.id} for Product ${product.name}.`, oldValues: { activeTreeVersionId: input.product.pbv2ActiveTreeVersionId, draftTreeVersionId: input.tree.id, draftStatus: input.tree.status }, newValues: { activeTreeVersionId: tree.id, treeStatus: tree.status, operationReference: "products.publish_configuration.v1", reference: input.reference } });
      if (input.activateProduct && !input.product.isActive) await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "product", entityId: product.id, actionType: "product_lifecycle_updated", description: "Product activated after its confirmed PBV2 configuration was published.", oldValues: { isActive: false }, newValues: { isActive: true, operationReference: "products.update_lifecycle.v1", reference: input.reference } });
      return { product, tree };
    });
  },
};

export type CanonicalProductPublishValidation = { treeJson: Record<string, unknown>; findings: Finding[]; warnings: Finding[]; errors: Finding[] };
export function validateCanonicalProductPublishTarget(target: CanonicalProductPublishTarget): CanonicalProductPublishValidation {
  const sanitized = sanitizePbv2PricingMatrix(target.tree.treeJson as Record<string, unknown>);
  // The PBV2 tree row is the lifecycle authority. Older/P7-created trees do
  // not necessarily duplicate its status inside tree_json, and an ACTIVE
  // source copied into a new row must still validate as the DRAFT row it is.
  // Normalize from the versioned row, never from an optional stale JSON mirror.
  const treeJson = { ...(sanitized.tree as Record<string, unknown>), status: target.tree.status };
  const schemaVersion = Number((treeJson as any)?.schemaVersion ?? target.tree.schemaVersion ?? 1);
  const schemaFindings: Finding[] = schemaVersion === 2 ? [] : [{ code: "PBV2_E_SCHEMA_VERSION_UNSUPPORTED", severity: "ERROR", message: "Tree must be PBV2 schema version 2", path: "schemaVersion", actual: schemaVersion, expected: 2 } as Finding];
  const base = validateTreeHasBasePrice(treeJson as any);
  // The same structural rules apply when diagnosing an already ACTIVE tree;
  // validatePublish's status check is specific to the DRAFT→ACTIVE transition.
  const publishCandidate = String((treeJson as any).status).toUpperCase() === "ACTIVE" ? { ...treeJson, status: "DRAFT" } : treeJson;
  const publish = validateTreeForPublish(publishCandidate as any, DEFAULT_VALIDATE_OPTS);
  const materialFindings = validatePbv2MaterialReferences({ treeJson, productPrimaryMaterialId: target.product.primaryMaterialId, materials: target.materials });
  const formulaFindings: Finding[] = target.product.pricingEngine === "formulaLibrary" && (!target.product.pricingFormulaId || !target.pricingFormula?.isActive)
    ? [{ code: "PBV2_E_FORMULA_LIBRARY_REFERENCE_MISSING", severity: "ERROR", message: "Formula Library pricing requires an active Formula Library entry in this organization.", path: "product.pricingFormulaId" } as Finding]
    : [];
  const findings = mergeFindings(schemaFindings, base.findings, publish.findings, materialFindings, formulaFindings, legacyFormulaCanonicalizationFindings(target, treeJson));
  return { treeJson, findings, warnings: findings.filter((item) => item.severity === "WARNING"), errors: findings.filter((item) => item.severity === "ERROR") };
}

export class CanonicalProductPublishError extends Error {
  constructor(readonly code: "ACTOR_REQUIRED" | "PRODUCT_PUBLISH_TARGET_NOT_FOUND" | "PBV2_DRAFT_REQUIRED" | "PBV2_PUBLISH_INVALID" | "PBV2_PUBLISH_WARNINGS_CONFIRM_REQUIRED" | "PBV2_PUBLISH_STALE", message: string, readonly findings: readonly Finding[] = []) { super(message); this.name = "CanonicalProductPublishError"; }
}

export class CanonicalProductPublishOperations {
  constructor(private readonly store: PublishRepository = repository, private readonly validate: (target: CanonicalProductPublishTarget) => CanonicalProductPublishValidation = validateCanonicalProductPublishTarget) {}

  async propose(input: { organizationId: string; productId?: string; treeVersionId?: string }) {
    const target = await this.store.get(input);
    if (!target) throw new CanonicalProductPublishError("PRODUCT_PUBLISH_TARGET_NOT_FOUND", "The tenant-scoped Product PBV2 configuration is no longer available.");
    const alreadyPublished = target.tree.status === "ACTIVE" && target.product.pbv2ActiveTreeVersionId === target.tree.id;
    if (!alreadyPublished && target.tree.status !== "DRAFT") throw new CanonicalProductPublishError("PBV2_DRAFT_REQUIRED", "Only the current PBV2 DRAFT configuration can be published.");
    // Reuse the same validator when an existing ACTIVE pointer is inspected by
    // lifecycle/repair paths.  Returning a no-op publish proposal must not
    // turn a legacy import or clone into an activation-validation bypass.
    const validation = this.validate(target);
    if (validation.errors.length) throw new CanonicalProductPublishError("PBV2_PUBLISH_INVALID", validation.errors[0]?.message ?? "PBV2 publish validation failed.", validation.findings);
    const expectedProductUpdatedAt = iso(target.product.updatedAt); const expectedTreeUpdatedAt = iso(target.tree.updatedAt);
    return { productId: target.product.id, productName: target.product.name, treeVersionId: target.tree.id, expectedProductUpdatedAt, expectedTreeUpdatedAt, alreadyPublished, warnings: validation.warnings, operationReference: "products.publish_configuration.v1" as const, fingerprint: fingerprint({ organizationId: input.organizationId, productId: target.product.id, treeVersionId: target.tree.id, expectedProductUpdatedAt, expectedTreeUpdatedAt, activeTreeVersionId: target.product.pbv2ActiveTreeVersionId, treeStatus: target.tree.status, warnings: validation.warnings.map((item) => ({ code: item.code, path: item.path })) }) };
  }

  async execute(input: { organizationId: string; actorUserId: string; productId?: string; treeVersionId: string; expectedProductUpdatedAt: string; expectedTreeUpdatedAt: string; confirmWarnings?: boolean; activateProduct?: boolean; auditContext?: { source: "product_editor" | "assistant_go"; reference?: string } }) {
    if (!input.actorUserId) throw new CanonicalProductPublishError("ACTOR_REQUIRED", "An authenticated actor is required.");
    const target = await this.store.get({ organizationId: input.organizationId, productId: input.productId, treeVersionId: input.treeVersionId });
    if (!target) throw new CanonicalProductPublishError("PRODUCT_PUBLISH_TARGET_NOT_FOUND", "The tenant-scoped Product PBV2 configuration is no longer available.");
    if (iso(target.product.updatedAt) !== input.expectedProductUpdatedAt || iso(target.tree.updatedAt) !== input.expectedTreeUpdatedAt) throw new CanonicalProductPublishError("PBV2_PUBLISH_STALE", "The Product or PBV2 DRAFT changed before publication. Review it again.");
    if (target.tree.status === "ACTIVE" && target.product.pbv2ActiveTreeVersionId === target.tree.id) return { product: target.product, tree: target.tree, appliedChanges: [], operationReference: "products.publish_configuration.v1" as const, auditReference: `publish:no-change:${target.tree.id}` };
    if (target.tree.status !== "DRAFT") throw new CanonicalProductPublishError("PBV2_DRAFT_REQUIRED", "Only the current PBV2 DRAFT configuration can be published.");
    const validation = this.validate(target);
    if (validation.errors.length) throw new CanonicalProductPublishError("PBV2_PUBLISH_INVALID", validation.errors[0]?.message ?? "PBV2 publish validation failed.", validation.findings);
    if (validation.warnings.length && input.confirmWarnings !== true) throw new CanonicalProductPublishError("PBV2_PUBLISH_WARNINGS_CONFIRM_REQUIRED", "PBV2 publish has warnings that must be included in the confirmed plan.", validation.findings);
    const reference = input.auditContext?.reference ?? `${input.auditContext?.source ?? "application"}:${target.product.id}:${target.tree.id}:${input.expectedTreeUpdatedAt}`;
    let result: Awaited<ReturnType<PublishRepository["publish"]>>;
    try {
      result = await this.store.publish({ organizationId: input.organizationId, actorUserId: input.actorUserId, product: target.product, tree: target.tree, treeJson: validation.treeJson, reference, activateProduct: input.activateProduct === true });
    } catch (error) {
      if (error instanceof PublishStoreStaleError) throw new CanonicalProductPublishError("PBV2_PUBLISH_STALE", "The Product or PBV2 DRAFT changed during publication. Review it again.");
      throw error;
    }
    if (!result) throw new CanonicalProductPublishError("PBV2_PUBLISH_STALE", "The Product or PBV2 DRAFT changed during publication. Review it again.");
    return { ...result, appliedChanges: [{ field: "PBV2 configuration", before: "DRAFT", after: "ACTIVE" }, ...(input.activateProduct && !target.product.isActive ? [{ field: "Lifecycle", before: "inactive", after: "active" }] : [])], operationReference: "products.publish_configuration.v1" as const, auditReference: reference };
  }
}

export const canonicalProductPublishOperations = new CanonicalProductPublishOperations();
