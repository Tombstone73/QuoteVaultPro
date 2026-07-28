import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiProductPricingChangeSetRows, aiProductPricingChangeSets, pbv2TreeVersions, products } from "@shared/schema";
import { db } from "../../db";
import {
  fingerprintProductPricingTarget,
  productPricingChangeSetMaxTargets,
  type ProductPricingCanonicalService,
  type ProductPricingChangeSet,
  type ProductPricingChangeSetRow,
  type ProductPricingChangeSetStore,
  type ProductPricingTarget,
  type ProductPricingValues,
} from "./productPricingChangeSetService";

function baseFromTree(tree: any): ProductPricingValues {
  const base = tree?.meta?.pricingV2?.base;
  return {
    perSqftCents: Number.isInteger(base?.perSqftCents) ? base.perSqftCents : null,
    perPieceCents: Number.isInteger(base?.perPieceCents) ? base.perPieceCents : null,
    minimumChargeCents: Number.isInteger(base?.minimumChargeCents) ? base.minimumChargeCents : null,
  };
}
function unsupportedPricing(tree: any): string | null {
  if (!tree || typeof tree !== "object") return "No canonical PBV2 tree is available.";
  if (tree.pricingMatrix || tree?.meta?.pricingV2?.qtyTiers || tree?.meta?.pricingV2?.matrix) return "Quantity tiers or pricing matrices are not included in the initial scalar pricing change-set operation.";
  return null;
}
function routeFromTree(tree: any): string | null { return typeof tree?.meta?.productIntake?.draftRouting?.stationName === "string" ? tree.meta.productIntake.draftRouting.stationName : null; }

type DbRow = typeof aiProductPricingChangeSetRows.$inferSelect;
function toRow(row: DbRow): ProductPricingChangeSetRow {
  return { productId: row.productId, productName: row.productName, activeSnapshot: row.activeSnapshot, activeTreeVersionId: row.activeTreeVersionId, beforeValues: row.beforeValues, proposedValues: row.proposedValues, sourceFingerprint: row.sourceFingerprint, executionState: row.executionState as ProductPricingChangeSetRow["executionState"], executedValues: row.executedValues, failureReason: row.failureReason, rollbackState: row.rollbackState as ProductPricingChangeSetRow["rollbackState"], rollbackConflictReason: row.rollbackConflictReason, ...(row.exclusionReason ? { exclusionReason: row.exclusionReason } : {}) };
}

export class DbProductPricingChangeSetStore implements ProductPricingChangeSetStore {
  async create(input: Omit<ProductPricingChangeSet, "id">): Promise<ProductPricingChangeSet> {
    return db.transaction(async (tx) => {
      const eligibleCount = input.rows.filter((row) => row.executionState === "pending").length;
      const [changeSet] = await tx.insert(aiProductPricingChangeSets).values({ orgId: input.organizationId, commandName: "products.adjust_pricing", commandVersion: "v1", requestSummary: input.requestSummary, selector: input.selector, operation: input.operation, fingerprint: input.fingerprint, targetCount: input.rows.length, eligibleCount, excludedCount: input.rows.length - eligibleCount, updatedAt: new Date() }).returning();
      if (!changeSet) throw new Error("Failed to persist the product pricing change set.");
      if (input.rows.length) await tx.insert(aiProductPricingChangeSetRows).values(input.rows.map((row, index) => ({ changeSetId: changeSet.id, orgId: input.organizationId, sourceOrder: index + 1, productId: row.productId, productName: row.productName, activeSnapshot: row.activeSnapshot, activeTreeVersionId: row.activeTreeVersionId, beforeValues: row.beforeValues, proposedValues: row.proposedValues, sourceFingerprint: row.sourceFingerprint, executionState: row.executionState, ...(row.exclusionReason ? { exclusionReason: row.exclusionReason } : {}), updatedAt: new Date() })));
      return { id: changeSet.id, ...input };
    });
  }
  async get(organizationId: string, changeSetId: string): Promise<ProductPricingChangeSet | null> {
    const [changeSet] = await db.select().from(aiProductPricingChangeSets).where(and(eq(aiProductPricingChangeSets.orgId, organizationId), eq(aiProductPricingChangeSets.id, changeSetId))).limit(1);
    if (!changeSet) return null;
    const rows = await db.select().from(aiProductPricingChangeSetRows).where(and(eq(aiProductPricingChangeSetRows.orgId, organizationId), eq(aiProductPricingChangeSetRows.changeSetId, changeSetId))).orderBy(aiProductPricingChangeSetRows.sourceOrder);
    return { id: changeSet.id, organizationId, requestSummary: changeSet.requestSummary, selector: changeSet.selector, operation: changeSet.operation as any, fingerprint: changeSet.fingerprint, rows: rows.map(toRow), executionStatus: changeSet.executionStatus, rollbackStatus: changeSet.rollbackStatus, createdAt: changeSet.createdAt, executedAt: changeSet.executedAt };
  }
  async markConfirmed(input: { organizationId: string; changeSetId: string; planId: string; idempotencyKey: string; correlationId: string }): Promise<void> {
    await db.update(aiProductPricingChangeSets).set({ planId: input.planId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, proposalStatus: "confirmed", confirmationStatus: "consumed", executionStatus: "running", confirmedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductPricingChangeSets.orgId, input.organizationId), eq(aiProductPricingChangeSets.id, input.changeSetId), eq(aiProductPricingChangeSets.confirmationStatus, "pending")));
  }
  async markRow(input: { organizationId: string; changeSetId: string; productId: string; state: ProductPricingChangeSetRow["executionState"]; executedValues?: ProductPricingValues; failureReason?: string }): Promise<void> {
    await db.update(aiProductPricingChangeSetRows).set({ executionState: input.state, ...(input.executedValues ? { executedValues: input.executedValues } : {}), ...(input.failureReason ? { failureReason: input.failureReason.slice(0, 1000) } : {}), attemptCount: sql`${aiProductPricingChangeSetRows.attemptCount} + 1`, updatedAt: new Date() }).where(and(eq(aiProductPricingChangeSetRows.orgId, input.organizationId), eq(aiProductPricingChangeSetRows.changeSetId, input.changeSetId), eq(aiProductPricingChangeSetRows.productId, input.productId)));
  }
  async complete(input: { organizationId: string; changeSetId: string; succeeded: number; failed: number; conflicted: number; summary?: string }): Promise<void> {
    await db.update(aiProductPricingChangeSets).set({ executionStatus: input.failed || input.conflicted ? "partially_failed" : "succeeded", succeededCount: input.succeeded, failedCount: input.failed, conflictedCount: input.conflicted, ...(input.summary ? { failureSummary: input.summary.slice(0, 1000) } : {}), executedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiProductPricingChangeSets.orgId, input.organizationId), eq(aiProductPricingChangeSets.id, input.changeSetId)));
  }
  async markRollback(input: { organizationId: string; changeSetId: string; productId: string; state: "rolled_back" | "conflicted" | "failed"; reason?: string }): Promise<void> {
    await db.update(aiProductPricingChangeSetRows).set({ rollbackState: input.state, rollbackAttemptCount: sql`${aiProductPricingChangeSetRows.rollbackAttemptCount} + 1`, ...(input.reason ? { rollbackConflictReason: input.reason.slice(0, 1000) } : {}), updatedAt: new Date() }).where(and(eq(aiProductPricingChangeSetRows.orgId, input.organizationId), eq(aiProductPricingChangeSetRows.changeSetId, input.changeSetId), eq(aiProductPricingChangeSetRows.productId, input.productId)));
  }
  async list(organizationId: string, limit = 25) { return db.select().from(aiProductPricingChangeSets).where(eq(aiProductPricingChangeSets.orgId, organizationId)).orderBy(desc(aiProductPricingChangeSets.createdAt)).limit(Math.max(1, Math.min(limit, 25))); }
  async markRollbackComplete(input: { organizationId: string; changeSetId: string; actorUserId: string; planId?: string; restored: number; conflicted: number; failed: number }): Promise<void> {
    const status = input.failed || input.conflicted ? "partially_rolled_back" : "rolled_back";
    await db.update(aiProductPricingChangeSets).set({ rollbackStatus: status, ...(input.planId ? { rollbackPlanId: input.planId } : {}), rollbackedAt: new Date(), rollbackActorUserId: input.actorUserId, updatedAt: new Date() }).where(and(eq(aiProductPricingChangeSets.orgId, input.organizationId), eq(aiProductPricingChangeSets.id, input.changeSetId)));
  }
}

export class DbProductPricingCanonicalService implements ProductPricingCanonicalService {
  private async toTarget(product: typeof products.$inferSelect): Promise<ProductPricingTarget> {
    const [tree] = product.pbv2ActiveTreeVersionId
      ? await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, product.organizationId), eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId), eq(pbv2TreeVersions.status, "ACTIVE"))).limit(1)
      : await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, product.organizationId), eq(pbv2TreeVersions.productId, product.id), eq(pbv2TreeVersions.status, "DRAFT"))).orderBy(desc(pbv2TreeVersions.updatedAt)).limit(1);
    const target: ProductPricingTarget = { productId: product.id, productName: product.name, active: product.isActive, category: product.category, activeTreeVersionId: tree?.id ?? null, pricing: baseFromTree(tree?.treeJson), route: routeFromTree(tree?.treeJson), unsupportedPricing: unsupportedPricing(tree?.treeJson), fingerprint: "" };
    target.fingerprint = fingerprintProductPricingTarget(target);
    return target;
  }
  async loadExactTargets(input: { organizationId: string; selector: Record<string, unknown> }): Promise<ProductPricingTarget[]> {
    const ids = Array.isArray(input.selector.productIds) ? input.selector.productIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    const active = typeof input.selector.active === "boolean" ? input.selector.active : true;
    const category = typeof input.selector.category === "string" ? input.selector.category : null;
    const measurementMode = typeof input.selector.measurementMode === "string" ? input.selector.measurementMode : null;
    const clauses = [eq(products.organizationId, input.organizationId), ...(ids.length ? [inArray(products.id, ids)] : [eq(products.isActive, active)]), ...(category ? [eq(products.category, category)] : []), ...(measurementMode === "dimensions_required" || measurementMode === "quantity_only" ? [eq(products.measurementMode, measurementMode)] : [])];
    const candidates = await db.select().from(products).where(and(...clauses)).limit(productPricingChangeSetMaxTargets + 1);
    if (candidates.length > productPricingChangeSetMaxTargets) throw new Error(`The selector matched more than ${productPricingChangeSetMaxTargets} products.`);
    const named = Array.isArray(input.selector.productNames) ? new Set(input.selector.productNames.filter((name): name is string => typeof name === "string")) : null;
    const excludedNames = new Set(Array.isArray(input.selector.excludeProductNames) ? input.selector.excludeProductNames.filter((name): name is string => typeof name === "string") : []);
    const route = typeof input.selector.route === "string" ? input.selector.route.trim().toLocaleLowerCase() : null;
    const targets = await Promise.all(candidates.map((product) => this.toTarget(product)));
    return targets.filter((target) => (!named || named.has(target.productName)) && !excludedNames.has(target.productName) && (!route || target.route?.trim().toLocaleLowerCase() === route));
  }
  async loadProduct(input: { organizationId: string; productId: string }): Promise<ProductPricingTarget | null> {
    const [product] = await db.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    return product ? this.toTarget(product) : null;
  }
  async applyConfirmedPricing(input: { organizationId: string; productId: string; expectedFingerprint: string; values: ProductPricingValues; actorUserId: string; correlationId: string }) {
    if (!Object.keys(input.values).length) throw new Error("A product pricing update requires at least one field.");
    const current = await this.loadProduct({ organizationId: input.organizationId, productId: input.productId });
    if (!current || current.fingerprint !== input.expectedFingerprint) throw new Error("The product changed after proposal confirmation.");
    const nextBase = { ...current.pricing, ...input.values };
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [tree] = await tx.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, current.activeTreeVersionId!))).limit(1);
      if (!tree) throw new Error("The canonical PBV2 pricing tree is no longer available.");
      const treeJson = JSON.parse(JSON.stringify(tree.treeJson ?? {}));
      treeJson.meta ??= {}; treeJson.meta.pricingV2 ??= {}; treeJson.meta.pricingV2.base = nextBase;
      let activeTreeVersionId = tree.id;
      if (current.active) {
        await tx.update(pbv2TreeVersions).set({ status: "DEPRECATED", updatedAt: now, updatedByUserId: input.actorUserId }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.status, "ACTIVE")));
        const [replacement] = await tx.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: input.productId, status: "ACTIVE", schemaVersion: tree.schemaVersion, treeJson, publishedAt: now, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId }).returning();
        if (!replacement) throw new Error("Failed to create the replacement active pricing tree.");
        activeTreeVersionId = replacement.id;
        await tx.update(products).set({ pbv2ActiveTreeVersionId: replacement.id, optionTreeJson: treeJson, updatedAt: now }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.isActive, current.active)));
      } else {
        await tx.update(pbv2TreeVersions).set({ treeJson, updatedAt: now, updatedByUserId: input.actorUserId }).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.status, "DRAFT")));
      }
      return { activeTreeVersionId };
    });
    return { fingerprint: fingerprintProductPricingTarget({ ...current, activeTreeVersionId: result.activeTreeVersionId, pricing: nextBase }), values: input.values, active: current.active, activeTreeVersionId: result.activeTreeVersionId };
  }
}

export const productPricingChangeSetStore = new DbProductPricingChangeSetStore();
export const productPricingCanonicalService = new DbProductPricingCanonicalService();
