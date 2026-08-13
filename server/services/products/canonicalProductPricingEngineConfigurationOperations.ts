import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, products } from "@shared/schema";
import { getProductAllowRotation, normalizeProductPricingRotationConfig } from "@shared/pbv2/productPricingRotation";

export const productPricingEngineConfigurationChangesSchema = z.object({ allowRotation: z.boolean() }).strict();
export type ProductPricingEngineConfigurationChanges = z.infer<typeof productPricingEngineConfigurationChangesSchema>;
type ProductRecord = Pick<typeof products.$inferSelect, "id" | "organizationId" | "name" | "pricingProfileConfig" | "updatedAt">;
type Store = {
  get(input: { organizationId: string; productId: string }): Promise<ProductRecord | null>;
  update(input: { organizationId: string; productId: string; actorUserId: string; expectedUpdatedAt: Date; changes: ProductPricingEngineConfigurationChanges; reference: string }): Promise<typeof products.$inferSelect | null>;
};
const store: Store = {
  async get(input) { const { db } = await import("../../db"); const [product] = await db.select({ id: products.id, organizationId: products.organizationId, name: products.name, pricingProfileConfig: products.pricingProfileConfig, updatedAt: products.updatedAt }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1); return product ?? null; },
  async update(input) { const { db } = await import("../../db"); return db.transaction(async (tx) => { const [current] = await tx.select({ pricingProfileConfig: products.pricingProfileConfig }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.updatedAt, input.expectedUpdatedAt))).limit(1); if (!current) return null; const before = getProductAllowRotation(current.pricingProfileConfig) ?? false; const pricingProfileConfig = normalizeProductPricingRotationConfig({ ...(current.pricingProfileConfig && typeof current.pricingProfileConfig === "object" && !Array.isArray(current.pricingProfileConfig) ? current.pricingProfileConfig as Record<string, unknown> : {}), allowRotation: input.changes.allowRotation }, input.changes.allowRotation); const [updated] = await tx.update(products).set({ pricingProfileConfig, updatedAt: new Date() }).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.updatedAt, input.expectedUpdatedAt))).returning(); if (!updated) return null; await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType: "product", entityId: input.productId, actionType: "product_pricing_engine_configuration_updated", description: `Product Pricing Engine rotation changed from ${before ? "on" : "off"} to ${input.changes.allowRotation ? "on" : "off"}.`, oldValues: { allowRotation: before }, newValues: { allowRotation: input.changes.allowRotation, mixedSheetLayout: input.changes.allowRotation, operationReference: "products.update_pricing_engine_configuration.v1", reference: input.reference } }); return updated; }); },
};

export class CanonicalProductPricingEngineConfigurationError extends Error {
  constructor(readonly code: "ACTOR_REQUIRED" | "PRODUCT_NOT_FOUND" | "PRODUCT_PRICING_ENGINE_STALE" | "NO_PRODUCT_PRICING_ENGINE_CHANGES", message: string) { super(message); this.name = "CanonicalProductPricingEngineConfigurationError"; }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class CanonicalProductPricingEngineConfigurationOperations {
  constructor(private readonly repository: Store = store) {}
  async propose(input: { organizationId: string; productId: string; changes: unknown }) { const changes = productPricingEngineConfigurationChangesSchema.parse(input.changes); const product = await this.repository.get(input); if (!product) throw new CanonicalProductPricingEngineConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available."); const before = getProductAllowRotation(product.pricingProfileConfig) ?? false; if (before === changes.allowRotation) throw new CanonicalProductPricingEngineConfigurationError("NO_PRODUCT_PRICING_ENGINE_CHANGES", `Allow Rotation / Mixed Sheet Layout is already ${before ? "on" : "off"}.`); const expectedUpdatedAt = new Date(product.updatedAt).toISOString(); return { productId: product.id, productName: product.name, changes, expectedUpdatedAt, appliedChanges: [{ field: "Allow Rotation / Mixed Sheet Layout", before, after: changes.allowRotation }], operationReference: "products.update_pricing_engine_configuration.v1" as const, fingerprint: hash({ organizationId: input.organizationId, productId: product.id, expectedUpdatedAt, before, changes }) }; }
  async execute(input: { organizationId: string; actorUserId: string; productId: string; changes: unknown; expectedUpdatedAt?: string; auditContext?: { source: "product_editor" | "assistant_go"; reference?: string } }) { if (!input.actorUserId) throw new CanonicalProductPricingEngineConfigurationError("ACTOR_REQUIRED", "An authenticated actor is required."); const changes = productPricingEngineConfigurationChangesSchema.parse(input.changes); const product = await this.repository.get(input); if (!product) throw new CanonicalProductPricingEngineConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available."); const version = new Date(product.updatedAt).toISOString(); if (input.expectedUpdatedAt && input.expectedUpdatedAt !== version) throw new CanonicalProductPricingEngineConfigurationError("PRODUCT_PRICING_ENGINE_STALE", "The Product Pricing Engine configuration changed before this update could be applied."); const before = getProductAllowRotation(product.pricingProfileConfig) ?? false; if (before === changes.allowRotation) return { product, appliedChanges: [], resultingVersion: version, operationReference: "products.update_pricing_engine_configuration.v1" as const, auditReference: `pricing-engine:no-change:${product.id}` }; const reference = input.auditContext?.reference ?? `${input.auditContext?.source ?? "application"}:${product.id}:${version}`; const updated = await this.repository.update({ organizationId: input.organizationId, productId: input.productId, actorUserId: input.actorUserId, expectedUpdatedAt: new Date(input.expectedUpdatedAt ?? version), changes, reference }); if (!updated) throw new CanonicalProductPricingEngineConfigurationError("PRODUCT_PRICING_ENGINE_STALE", "The Product Pricing Engine configuration changed during this update."); return { product: updated, appliedChanges: [{ field: "Allow Rotation / Mixed Sheet Layout", before, after: changes.allowRotation }], resultingVersion: new Date(updated.updatedAt).toISOString(), operationReference: "products.update_pricing_engine_configuration.v1" as const, auditReference: reference }; }
}
export const canonicalProductPricingEngineConfigurationOperations = new CanonicalProductPricingEngineConfigurationOperations();

/** Removes only the reviewed rotation setting while preserving every other
 * Product Editor pricing configuration field for its established metadata path. */
export function takeCanonicalProductPricingEngineConfigurationChange(value: Record<string, unknown>, existingPricingProfileConfig?: unknown): ProductPricingEngineConfigurationChanges | null {
  const config = value.pricingProfileConfig;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const allowRotation = getProductAllowRotation(config);
  if (allowRotation === null) return null;
  const normalized = normalizeProductPricingRotationConfig(config, allowRotation);
  normalized.allowRotation = getProductAllowRotation(existingPricingProfileConfig) ?? false;
  value.pricingProfileConfig = normalized;
  return { allowRotation };
}
