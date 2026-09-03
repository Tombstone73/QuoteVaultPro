import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Finding } from "@shared/pbv2/findings";
import { sanitizePbv2PricingMatrix } from "@shared/pbv2/pricingMatrixSanitizer";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "@shared/pbv2/validator";
import { validateTreeHasBasePrice } from "@shared/pbv2/validator/validateBasePrice";
import { auditLogs, materials, pbv2TreeVersions, pricingFormulas, products, v2FormulaRevisions, v2ProductVersionFormulaRevisionBindings } from "@shared/schema";
import { collectPbv2MaterialValidationIds, validatePbv2MaterialReferences } from "../pbv2MaterialValidation";

type ProductRecord = Pick<typeof products.$inferSelect, "id" | "organizationId" | "name" | "category" | "description" | "measurementMode" | "workflowIntent" | "requiresProofApproval" | "requiresProductionJob" | "isActive" | "primaryMaterialId" | "pbv2ActiveTreeVersionId" | "updatedAt" | "pricingEngine" | "pricingFormulaId" | "pricingFormula">;
type TreeRecord = Pick<typeof pbv2TreeVersions.$inferSelect, "id" | "organizationId" | "productId" | "status" | "schemaVersion" | "treeJson" | "publishedAt" | "updatedAt">;
export type CanonicalProductPublishTarget = {
  product: ProductRecord;
  tree: TreeRecord;
  /**
   * The immutable active source is read only to distinguish an inherited
   * compatibility finding from a newly authored invalid Draft change.
   */
  activeTreeJson?: unknown | null;
  materials: Array<{ id: string; name: string; sku: string | null; weightOzPerBasis: string | null }>;
  pricingFormula?: { id: string; isActive: boolean; expression: string | null } | null;
  /** A Draft binding is promoted with the same immutable ProductVersion row. */
  formulaRevision?: { id: string; formulaId: string; expression: string } | null;
};
type PublishRepository = {
  get(input: { organizationId: string; productId?: string; treeVersionId?: string }): Promise<CanonicalProductPublishTarget | null>;
  publish(input: { organizationId: string; actorUserId: string; product: ProductRecord; tree: TreeRecord; treeJson: Record<string, unknown>; basics: ProductBasicsProjection; formulaRevision?: CanonicalProductPublishTarget["formulaRevision"]; reference: string; activateProduct: boolean }): Promise<{ product: typeof products.$inferSelect; tree: typeof pbv2TreeVersions.$inferSelect } | null>;
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
type ProductBasicsProjection = Pick<ProductRecord, "name" | "category" | "description" | "measurementMode" | "workflowIntent" | "requiresProofApproval" | "requiresProductionJob" | "isActive">;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Draft Basics are versioned authoring state.  This is their one-way, publish
 * time projection into the Product row consumed by catalog and sales reads.
 * Draft saves deliberately never call this function against the live row.
 */
export const productBasicsProjection = (
  treeJson: Record<string, unknown>,
  product: ProductRecord,
  activateLegacyProduct = false,
): ProductBasicsProjection => {
  const meta = record(treeJson.meta);
  const general = record(meta?.general);
  // Older PBV2 trees predate versioned Basics. Preserve their Product-row
  // facts, retaining the legacy route's explicit activation behavior only for
  // that compatibility case.
  if (!general) return {
    name: product.name,
    category: product.category,
    description: product.description,
    measurementMode: product.measurementMode,
    workflowIntent: product.workflowIntent,
    requiresProofApproval: product.requiresProofApproval,
    requiresProductionJob: product.requiresProductionJob,
    isActive: activateLegacyProduct ? true : product.isActive,
  };
  const displayName = typeof general.displayName === "string" ? general.displayName.trim() : "";
  const category = general.category === null || general.category === undefined || general.category === "" ? null : typeof general.category === "string" ? general.category.trim() : undefined;
  const description = general.description === null || general.description === undefined || general.description === "" ? null : typeof general.description === "string" ? general.description.trim() : undefined;
  if (!displayName || displayName.length > 160 || category === undefined || (category !== null && category.length > 100) || description === undefined || (description !== null && description.length > 2000)
    || typeof general.storefrontVisible !== "boolean" || typeof general.requiresProofApproval !== "boolean" || typeof general.requiresProductionJob !== "boolean"
    || (general.measurementMode !== "dimensions_required" && general.measurementMode !== "quantity_only")
    || (general.workflowIntent !== "standard_production" && general.workflowIntent !== "fulfillment_only" && general.workflowIntent !== "service_fee")
    || (general.workflowIntent !== "standard_production" && (general.requiresProofApproval || general.requiresProductionJob))) {
    throw new Error("Draft Basics cannot be projected to the Product row.");
  }
  return {
    name: displayName,
    category,
    // The legacy Product column is non-null while Draft Basics intentionally
    // permits an empty description. The Product name is the established
    // initial-create fallback and keeps the projection deterministic.
    description: description ?? displayName,
    measurementMode: general.measurementMode,
    workflowIntent: general.workflowIntent,
    requiresProofApproval: general.requiresProofApproval,
    requiresProductionJob: general.requiresProductionJob,
    // Catalog activation and storefront visibility are independent operator
    // decisions.  A staff user can publish an active internal Product that is
    // intentionally hidden from the storefront; the explicit publisher
    // activation request must therefore never be overwritten by this display
    // preference.
    isActive: activateLegacyProduct ? true : general.storefrontVisible,
  };
};
const productBasicsProjectionFindings = (treeJson: Record<string, unknown>, product: ProductRecord): Finding[] => {
  try { productBasicsProjection(treeJson, product); return []; }
  catch { return [{ code: "PBV2_E_PRODUCT_BASICS_PROJECTION_INVALID", severity: "ERROR", message: "Draft Basics cannot be projected to the Product identity.", path: "tree.meta.general" } as Finding]; }
};
/** ProductVersion formula selection is staged in the Draft tree.  At publish
 * it is projected atomically into the legacy Product identity pointer used by
 * all existing sales readers; an embedded ProductVersion Formula explicitly
 * clears that pointer so library precedence cannot shadow it. */
const formulaLibraryProjection = (treeJson: Record<string, unknown>): string | null | undefined => {
  const meta = treeJson.meta && typeof treeJson.meta === "object" && !Array.isArray(treeJson.meta)
    ? treeJson.meta as Record<string, unknown>
    : {};
  if (meta.pricingFormulaSource === "embedded") return null;
  // An explicit library source without an ID is invalid—not an instruction to
  // inherit the Product's older pointer.  Returning an empty ID makes the
  // existing publish validation fail closed before the transaction can run.
  if (meta.pricingFormulaSource === "library") return typeof meta.pricingFormulaId === "string" ? meta.pricingFormulaId.trim() : "";
  return undefined;
};
const legacyFormulaCanonicalizationFindings = (target: CanonicalProductPublishTarget, treeJson: Record<string, unknown>): Finding[] => {
  // The compatibility resolver recognizes the persisted legacy expression
  // independently of the old engine label, so publication must protect every
  // Draft for which that expression remains the effective fallback.
  const legacyExpression = formulaText(target.product.pricingFormula);
  if (!legacyExpression) return [];
  if (formulaText(target.formulaRevision?.expression) === legacyExpression) return [];
  const libraryExpression = target.pricingFormula?.isActive ? formulaText(target.pricingFormula.expression) : "";
  // Formula Library has higher canonical resolver precedence, so a valid
  // active library expression means the legacy row is not the effective
  // source that this Draft must preserve.
  if (libraryExpression) return [];
  const embeddedExpression = formulaText((treeJson.meta as Record<string, unknown> | undefined)?.pricingFormula);
  if (embeddedExpression) return [];
  return [{ code: "PBV2_E_LEGACY_PRODUCT_FORMULA_NOT_CANONICALIZED", severity: "ERROR", message: "A Draft inheriting a legacy Product Formula must own a canonical ProductVersion Formula before publication.", path: "tree.meta.pricingFormula" } as Finding];
};

/** A legacy PBV2 material conflict must never become a new authoring bypass.
 *
 * Some historically published trees contain both an old materialOverride and
 * an inventoryConsumption reference for a choice.  V2's Product Builder does
 * not author either field.  A routing-only revision must preserve that exact
 * historical fact rather than become impossible to publish, while a new or
 * changed conflict remains a hard error.
 */
const nodeForFinding = (tree: unknown, entityId: unknown): Record<string, unknown> | null => {
  if (!entityId || !tree || typeof tree !== "object" || Array.isArray(tree)) return null;
  const nodes = (tree as Record<string, unknown>).nodes;
  if (Array.isArray(nodes)) return nodes.find((node) => record(node)?.id === entityId) as Record<string, unknown> | undefined ?? null;
  return record(nodes)?.[String(entityId)] as Record<string, unknown> | undefined ?? null;
};
const materialConflictKey = (tree: unknown, finding: Finding): string | null => {
  if (finding.code !== "PBV2_E_CHOICE_MATERIAL_OVERRIDE_CONFLICT") return null;
  const value = finding as Finding & { entityId?: unknown; context?: unknown };
  const node = nodeForFinding(tree, value.entityId);
  const input = record(node?.input);
  const context = record(value.context);
  const overrideId = typeof context?.materialOverrideId === "string" ? context.materialOverrideId : null;
  const conflictingIds = Array.isArray(context?.conflictingInventoryMaterialIds)
    ? context.conflictingInventoryMaterialIds.filter((id): id is string => typeof id === "string").sort()
    : [];
  const choice = Array.isArray(node?.choices)
    ? node.choices.map(record).find((candidate) => {
      const materialId = record(candidate?.materialOverride)?.materialId;
      const inventoryIds = Array.isArray(candidate?.inventoryConsumption)
        ? candidate.inventoryConsumption.map(record).map((entry) => entry?.materialId).filter((id): id is string => typeof id === "string")
        : [];
      return materialId === overrideId && conflictingIds.every((id) => inventoryIds.includes(id));
    })
    : null;
  return stable({
    selectionKey: typeof input?.selectionKey === "string" ? input.selectionKey : node?.key ?? node?.id ?? null,
    choiceValue: choice?.value ?? null,
    materialOverrideId: overrideId,
    conflictingInventoryMaterialIds: conflictingIds,
  });
};
const inheritedLegacyMaterialConflictFindings = (
  draftFindings: readonly Finding[],
  activeTreeJson: unknown | null | undefined,
): Finding[] => {
  if (!activeTreeJson || typeof activeTreeJson !== "object" || Array.isArray(activeTreeJson)) return [...draftFindings];
  const activeCandidate = { ...(activeTreeJson as Record<string, unknown>), status: "DRAFT" };
  const inherited = new Set(
    validateTreeForPublish(activeCandidate as any, DEFAULT_VALIDATE_OPTS).errors
      .map((finding) => materialConflictKey(activeCandidate, finding))
      .filter((key): key is string => key !== null),
  );
  return draftFindings.map((finding) => {
    const key = materialConflictKey(activeTreeJson, finding);
    if (!key || !inherited.has(key)) return finding;
    return {
      ...finding,
      code: "PBV2_W_LEGACY_CHOICE_MATERIAL_OVERRIDE_CONFLICT",
      severity: "WARNING",
      message: "An inherited legacy material override conflict is preserved unchanged. Review material configuration before editing this Product option.",
    } as Finding;
  });
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
    const [product] = await db.select({ id: products.id, organizationId: products.organizationId, name: products.name, category: products.category, description: products.description, measurementMode: products.measurementMode, workflowIntent: products.workflowIntent, requiresProofApproval: products.requiresProofApproval, requiresProductionJob: products.requiresProductionJob, isActive: products.isActive, primaryMaterialId: products.primaryMaterialId, pbv2ActiveTreeVersionId: products.pbv2ActiveTreeVersionId, updatedAt: products.updatedAt, pricingEngine: products.pricingEngine, pricingFormulaId: products.pricingFormulaId, pricingFormula: products.pricingFormula }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, tree.productId))).limit(1);
    if (!product || (input.productId && product.id !== input.productId)) return null;
    // The PBV2 version lifecycle is authoritative.  Older products can have
    // a stale compatibility pointer even while a different version row is the
    // canonical ACTIVE ProductVersion used by V2 reads and Order freezing.
    const [activeTree] = tree.status !== "ACTIVE"
      ? await db.select({ treeJson: pbv2TreeVersions.treeJson }).from(pbv2TreeVersions).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId),
        eq(pbv2TreeVersions.productId, tree.productId),
        eq(pbv2TreeVersions.status, "ACTIVE"),
      )).orderBy(desc(pbv2TreeVersions.updatedAt), desc(pbv2TreeVersions.id)).limit(1)
      : [];
    const materialIds = collectPbv2MaterialValidationIds({ treeJson: tree.treeJson, productPrimaryMaterialId: product.primaryMaterialId });
    const materialRows = materialIds.length ? await db.select({ id: materials.id, name: materials.name, sku: materials.sku, weightOzPerBasis: materials.weightOzPerBasis }).from(materials).where(and(eq(materials.organizationId, input.organizationId), inArray(materials.id, materialIds))) : [];
    const [formulaRevision] = await db.select({ id: v2FormulaRevisions.id, formulaId: v2FormulaRevisions.formulaId, expression: v2FormulaRevisions.expression })
      .from(v2ProductVersionFormulaRevisionBindings)
      .innerJoin(v2FormulaRevisions, and(
        eq(v2FormulaRevisions.id, v2ProductVersionFormulaRevisionBindings.formulaRevisionId),
        eq(v2FormulaRevisions.formulaId, v2ProductVersionFormulaRevisionBindings.formulaId),
        eq(v2FormulaRevisions.organizationId, v2ProductVersionFormulaRevisionBindings.organizationId),
      ))
      .where(and(
        eq(v2ProductVersionFormulaRevisionBindings.organizationId, input.organizationId),
        eq(v2ProductVersionFormulaRevisionBindings.productId, tree.productId),
        eq(v2ProductVersionFormulaRevisionBindings.productVersionId, tree.id),
      )).limit(1);
    const projectedFormulaId = formulaRevision ? null : formulaLibraryProjection(tree.treeJson as Record<string, unknown>);
    const formulaId = projectedFormulaId === undefined ? product.pricingFormulaId : projectedFormulaId;
    const [pricingFormula] = formulaId ? await db.select({ id: pricingFormulas.id, isActive: pricingFormulas.isActive, expression: pricingFormulas.expression }).from(pricingFormulas).where(and(eq(pricingFormulas.organizationId, input.organizationId), eq(pricingFormulas.id, formulaId))).limit(1) : [];
    return { product, tree, ...(activeTree ? { activeTreeJson: activeTree.treeJson } : {}), materials: materialRows, pricingFormula: pricingFormula ?? null, formulaRevision: formulaRevision ?? null };
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
      const basics = input.basics;
      const [tree] = await tx.update(pbv2TreeVersions).set({ status: "ACTIVE", publishedAt: now, updatedAt: now, updatedByUserId: input.actorUserId, treeJson: nextTreeJson }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, input.tree.id), eq(pbv2TreeVersions.productId, input.product.id), eq(pbv2TreeVersions.status, "DRAFT"))).returning();
      if (!tree) throw new PublishStoreStaleError();
      const pointerCondition = input.product.pbv2ActiveTreeVersionId ? eq(products.pbv2ActiveTreeVersionId, input.product.pbv2ActiveTreeVersionId) : isNull(products.pbv2ActiveTreeVersionId);
      const projectedFormulaId = input.formulaRevision ? null : formulaLibraryProjection(nextTreeJson as Record<string, unknown>);
      const [product] = await tx.update(products).set({
        pbv2ActiveTreeVersionId: tree.id,
        optionTreeJson: nextTreeJson,
        name: basics.name,
        category: basics.category,
        description: basics.description,
        measurementMode: basics.measurementMode,
        workflowIntent: basics.workflowIntent,
        requiresProofApproval: basics.requiresProofApproval,
        requiresProductionJob: basics.requiresProductionJob,
        isActive: basics.isActive,
        ...(projectedFormulaId === undefined ? {} : { pricingFormulaId: projectedFormulaId, pricingEngine: projectedFormulaId ? "formulaLibrary" : "pricingFormula" }),
        updatedAt: now,
      }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.product.id), pointerCondition)).returning();
      if (!product) throw new PublishStoreStaleError();
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "product", entityId: product.id, actionType: "product_configuration_published", description: `Published PBV2 configuration ${tree.id} for Product ${product.name}.`, oldValues: { activeTreeVersionId: input.product.pbv2ActiveTreeVersionId, draftTreeVersionId: input.tree.id, draftStatus: input.tree.status, basics: productBasicsProjection(input.tree.treeJson as Record<string, unknown>, input.product) }, newValues: { activeTreeVersionId: tree.id, treeStatus: tree.status, basics, operationReference: "products.publish_configuration.v1", reference: input.reference } });
      if (product.isActive !== input.product.isActive) await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "product", entityId: product.id, actionType: "product_lifecycle_updated", description: `Product ${product.isActive ? "activated" : "deactivated"} with its confirmed PBV2 configuration.`, oldValues: { isActive: input.product.isActive }, newValues: { isActive: product.isActive, operationReference: "products.update_lifecycle.v1", reference: input.reference } });
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
  const publishFindings = inheritedLegacyMaterialConflictFindings(publish.findings, target.activeTreeJson);
  const materialFindings = validatePbv2MaterialReferences({ treeJson, productPrimaryMaterialId: target.product.primaryMaterialId, materials: target.materials });
  const projectedFormulaId = target.formulaRevision ? null : formulaLibraryProjection(treeJson);
  const formulaFindings: Finding[] = !target.formulaRevision && (projectedFormulaId === undefined ? target.product.pricingEngine === "formulaLibrary" : projectedFormulaId !== null) && (!(projectedFormulaId === undefined ? target.product.pricingFormulaId : projectedFormulaId) || !target.pricingFormula?.isActive)
    ? [{ code: "PBV2_E_FORMULA_LIBRARY_REFERENCE_MISSING", severity: "ERROR", message: "Formula Library pricing requires an active Formula Library entry in this organization.", path: "product.pricingFormulaId" } as Finding]
    : [];
  const findings = mergeFindings(schemaFindings, base.findings, publishFindings, materialFindings, formulaFindings, productBasicsProjectionFindings(treeJson, target.product), legacyFormulaCanonicalizationFindings(target, treeJson));
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
    const basics = productBasicsProjection(validation.treeJson, target.product, input.activateProduct === true);
    let result: Awaited<ReturnType<PublishRepository["publish"]>>;
    try {
      result = await this.store.publish({ organizationId: input.organizationId, actorUserId: input.actorUserId, product: target.product, tree: target.tree, treeJson: validation.treeJson, basics, formulaRevision: target.formulaRevision, reference, activateProduct: input.activateProduct === true });
    } catch (error) {
      if (error instanceof PublishStoreStaleError) throw new CanonicalProductPublishError("PBV2_PUBLISH_STALE", "The Product or PBV2 DRAFT changed during publication. Review it again.");
      throw error;
    }
    if (!result) throw new CanonicalProductPublishError("PBV2_PUBLISH_STALE", "The Product or PBV2 DRAFT changed during publication. Review it again.");
    return { ...result, appliedChanges: [{ field: "PBV2 configuration", before: "DRAFT", after: "ACTIVE" }, ...(result.product.isActive !== target.product.isActive ? [{ field: "Lifecycle", before: target.product.isActive ? "active" : "inactive", after: result.product.isActive ? "active" : "inactive" }] : [])], operationReference: "products.publish_configuration.v1" as const, auditReference: reference };
  }
}

export const canonicalProductPublishOperations = new CanonicalProductPublishOperations();
