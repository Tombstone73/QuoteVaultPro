import { createHash } from "node:crypto";

export const productPricingChangeSetMaxTargets = 100;
export const productPricingScalarFields = ["perSqftCents", "perPieceCents", "minimumChargeCents"] as const;
export type ProductPricingScalarField = typeof productPricingScalarFields[number];
export type ProductPricingValues = Partial<Record<ProductPricingScalarField, number | null>>;
export type ProductPricingOperation =
  | { kind: "percent"; field: ProductPricingScalarField; percent: number }
  | { kind: "fixed"; field: ProductPricingScalarField; cents: number }
  | { kind: "set"; field: ProductPricingScalarField; cents: number | null };

export type ProductPricingTarget = {
  productId: string;
  productName: string;
  active: boolean;
  archived?: boolean;
  category?: string | null;
  route?: string | null;
  activeTreeVersionId: string | null;
  pricing: ProductPricingValues;
  fingerprint: string;
  unsupportedPricing?: string | null;
};

export type ProductPricingChangeSetRow = {
  productId: string; productName: string; activeSnapshot: boolean; activeTreeVersionId: string | null;
  beforeValues: ProductPricingValues; proposedValues: ProductPricingValues; sourceFingerprint: string;
  executionState: "pending" | "excluded" | "succeeded" | "failed" | "stale";
  exclusionReason?: string;
  executedValues?: ProductPricingValues | null;
  failureReason?: string | null;
  rollbackState?: "not_requested" | "rolled_back" | "conflicted" | "failed";
  rollbackConflictReason?: string | null;
};

export type ProductPricingChangeSet = {
  id: string; organizationId: string; requestSummary: string; selector: Record<string, unknown>; operation: ProductPricingOperation;
  fingerprint: string; rows: ProductPricingChangeSetRow[];
  executionStatus?: string;
  rollbackStatus?: string;
  createdAt?: Date;
  executedAt?: Date | null;
};

export interface ProductPricingChangeSetStore {
  create(input: Omit<ProductPricingChangeSet, "id">): Promise<ProductPricingChangeSet>;
  get(organizationId: string, changeSetId: string): Promise<ProductPricingChangeSet | null>;
  markConfirmed(input: { organizationId: string; changeSetId: string; planId: string; idempotencyKey: string; correlationId: string }): Promise<void>;
  markRow(input: { organizationId: string; changeSetId: string; productId: string; state: ProductPricingChangeSetRow["executionState"]; executedValues?: ProductPricingValues; failureReason?: string }): Promise<void>;
  complete(input: { organizationId: string; changeSetId: string; succeeded: number; failed: number; conflicted: number; summary?: string }): Promise<void>;
  markRollback(input: { organizationId: string; changeSetId: string; productId: string; state: "rolled_back" | "conflicted" | "failed"; reason?: string }): Promise<void>;
  markRollbackComplete?(input: { organizationId: string; changeSetId: string; actorUserId: string; planId?: string; restored: number; conflicted: number; failed: number }): Promise<void>;
}

/**
 * This is the only mutation boundary used by Stage 19J. Its implementation
 * must call the same active-tree propagation path used by the product editor;
 * it must not change active/publication/visibility fields.
 */
export interface ProductPricingCanonicalService {
  loadExactTargets(input: { organizationId: string; selector: Record<string, unknown> }): Promise<ProductPricingTarget[]>;
  loadProduct(input: { organizationId: string; productId: string }): Promise<ProductPricingTarget | null>;
  applyConfirmedPricing(input: { organizationId: string; productId: string; expectedFingerprint: string; values: ProductPricingValues; actorUserId: string; correlationId: string }): Promise<{ fingerprint: string; values: ProductPricingValues; active: boolean; activeTreeVersionId: string | null }>;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function hash(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function assertCents(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error("Pricing values must be non-negative integer cents."); }

export function applyPricingOperation(before: ProductPricingValues, operation: ProductPricingOperation): ProductPricingValues {
  const current = before[operation.field];
  if (operation.kind === "set") {
    if (operation.cents !== null) assertCents(operation.cents);
    return { [operation.field]: operation.cents };
  }
  if (current === null || current === undefined) throw new Error(`${operation.field} is not configured on this product.`);
  assertCents(current);
  const next = operation.kind === "percent"
    ? Math.round(current * (100 + operation.percent) / 100)
    : current + operation.cents;
  assertCents(next);
  return { [operation.field]: next };
}

export function fingerprintProductPricingTarget(target: Pick<ProductPricingTarget, "productId" | "active" | "activeTreeVersionId" | "pricing">): string {
  return hash({ productId: target.productId, active: target.active, activeTreeVersionId: target.activeTreeVersionId, pricing: target.pricing });
}

export class ProductPricingChangeSetService {
  constructor(private readonly canonical: ProductPricingCanonicalService, private readonly store: ProductPricingChangeSetStore) {}

  async createProposal(input: { organizationId: string; requestSummary: string; selector: Record<string, unknown>; operation: ProductPricingOperation; overrides?: Array<{ productId?: string; productName?: string; operation: ProductPricingOperation }> }) {
    const targets = await this.canonical.loadExactTargets({ organizationId: input.organizationId, selector: input.selector });
    if (!targets.length) throw new Error("No tenant-scoped products matched the selector.");
    if (targets.length > productPricingChangeSetMaxTargets) throw new Error(`A product pricing change set may target at most ${productPricingChangeSetMaxTargets} products.`);
    const duplicate = targets.find((target, index) => targets.findIndex((candidate) => candidate.productId === target.productId) !== index);
    if (duplicate) throw new Error("The selector resolved duplicate product IDs.");
    const rows = targets.map((target): ProductPricingChangeSetRow => {
      const sourceFingerprint = target.fingerprint || fingerprintProductPricingTarget(target);
      if (target.archived) return { productId: target.productId, productName: target.productName, activeSnapshot: target.active, activeTreeVersionId: target.activeTreeVersionId, beforeValues: target.pricing, proposedValues: {}, sourceFingerprint, executionState: "excluded", exclusionReason: "Archived products are not eligible." };
      if (target.unsupportedPricing) return { productId: target.productId, productName: target.productName, activeSnapshot: target.active, activeTreeVersionId: target.activeTreeVersionId, beforeValues: target.pricing, proposedValues: {}, sourceFingerprint, executionState: "excluded", exclusionReason: target.unsupportedPricing };
      try {
        const matches = (input.overrides ?? []).filter((override) => override.productId === target.productId || (override.productName && override.productName === target.productName));
        if (matches.length > 1) throw new Error("More than one pricing override matched this product.");
        const operation = matches[0]?.operation ?? input.operation;
        return { productId: target.productId, productName: target.productName, activeSnapshot: target.active, activeTreeVersionId: target.activeTreeVersionId, beforeValues: target.pricing, proposedValues: applyPricingOperation(target.pricing, operation), sourceFingerprint, executionState: "pending" };
      } catch (error) {
        return { productId: target.productId, productName: target.productName, activeSnapshot: target.active, activeTreeVersionId: target.activeTreeVersionId, beforeValues: target.pricing, proposedValues: {}, sourceFingerprint, executionState: "excluded", exclusionReason: error instanceof Error ? error.message : "The target pricing is unsupported." };
      }
    });
    if (!rows.some((row) => row.executionState === "pending")) throw new Error("No selected product has a supported pricing component for this operation.");
    const fingerprint = hash({ selector: input.selector, operation: input.operation, overrides: input.overrides ?? [], rows: rows.map((row) => ({ productId: row.productId, sourceFingerprint: row.sourceFingerprint, proposedValues: row.proposedValues, executionState: row.executionState })) });
    return this.store.create({ organizationId: input.organizationId, requestSummary: input.requestSummary, selector: input.selector, operation: input.operation, fingerprint, rows });
  }

  async execute(input: { organizationId: string; actorUserId: string; changeSetId: string; fingerprint: string; planId: string; idempotencyKey: string; correlationId: string }) {
    const changeSet = await this.store.get(input.organizationId, input.changeSetId);
    if (!changeSet || changeSet.fingerprint !== input.fingerprint) throw new Error("The persisted pricing change set was not found or has changed.");
    if (changeSet.rows.every((row) => row.executionState !== "pending")) {
      return {
        succeeded: changeSet.rows.filter((row) => row.executionState === "succeeded").length,
        failed: changeSet.rows.filter((row) => row.executionState === "failed").length,
        conflicted: changeSet.rows.filter((row) => row.executionState === "stale").length,
        excluded: changeSet.rows.filter((row) => row.executionState === "excluded").length,
      };
    }
    await this.store.markConfirmed(input);
    let succeeded = 0; let failed = 0; let conflicted = 0;
    for (const row of changeSet.rows.filter((candidate) => candidate.executionState === "pending")) {
      const current = await this.canonical.loadProduct({ organizationId: input.organizationId, productId: row.productId });
      if (!current || (current.fingerprint || fingerprintProductPricingTarget(current)) !== row.sourceFingerprint) {
        conflicted += 1;
        await this.store.markRow({ organizationId: input.organizationId, changeSetId: changeSet.id, productId: row.productId, state: "stale", failureReason: "The product pricing or active-tree identity changed after this proposal." });
        continue;
      }
      try {
        const result = await this.canonical.applyConfirmedPricing({ organizationId: input.organizationId, productId: row.productId, expectedFingerprint: row.sourceFingerprint, values: row.proposedValues, actorUserId: input.actorUserId, correlationId: input.correlationId });
        if (result.active !== row.activeSnapshot) throw new Error("Lifecycle safety check failed: product active status changed.");
        succeeded += 1;
        await this.store.markRow({ organizationId: input.organizationId, changeSetId: changeSet.id, productId: row.productId, state: "succeeded", executedValues: result.values });
      } catch (error) {
        failed += 1;
        await this.store.markRow({ organizationId: input.organizationId, changeSetId: changeSet.id, productId: row.productId, state: "failed", failureReason: error instanceof Error ? error.message : "Pricing update failed safely." });
      }
    }
    await this.store.complete({ organizationId: input.organizationId, changeSetId: changeSet.id, succeeded, failed, conflicted });
    return { succeeded, failed, conflicted, excluded: changeSet.rows.filter((row) => row.executionState === "excluded").length };
  }

  async rollback(input: { organizationId: string; actorUserId: string; changeSetId: string; correlationId: string; planId?: string }) {
    const changeSet = await this.store.get(input.organizationId, input.changeSetId);
    if (!changeSet) throw new Error("The tenant-scoped pricing change set was not found.");
    let restored = 0; let conflicted = 0; let failed = 0;
    for (const row of changeSet.rows.filter((candidate) => candidate.executionState === "succeeded" && candidate.rollbackState !== "rolled_back")) {
      const current = await this.canonical.loadProduct({ organizationId: input.organizationId, productId: row.productId });
      // The canonical live update creates a replacement ACTIVE tree version.
      // Rollback therefore compares only the fields this change set owns plus
      // lifecycle state; a version-ID comparison would reject every success.
      if (!current || current.active !== row.activeSnapshot || !Object.entries(row.proposedValues).every(([field, value]) => current.pricing[field as ProductPricingScalarField] === value)) {
        conflicted += 1;
        await this.store.markRollback({ organizationId: input.organizationId, changeSetId: changeSet.id, productId: row.productId, state: "conflicted", reason: "Current values no longer match this change set's executed values." });
        continue;
      }
      try {
        await this.canonical.applyConfirmedPricing({ organizationId: input.organizationId, productId: row.productId, expectedFingerprint: current.fingerprint || fingerprintProductPricingTarget(current), values: row.beforeValues, actorUserId: input.actorUserId, correlationId: input.correlationId });
        restored += 1;
        await this.store.markRollback({ organizationId: input.organizationId, changeSetId: changeSet.id, productId: row.productId, state: "rolled_back" });
      } catch (error) {
        failed += 1;
        await this.store.markRollback({ organizationId: input.organizationId, changeSetId: changeSet.id, productId: row.productId, state: "failed", reason: error instanceof Error ? error.message : "Rollback failed safely." });
      }
    }
    await this.store.markRollbackComplete?.({ organizationId: input.organizationId, changeSetId: changeSet.id, actorUserId: input.actorUserId, planId: input.planId, restored, conflicted, failed });
    return { restored, conflicted, failed };
  }
}
