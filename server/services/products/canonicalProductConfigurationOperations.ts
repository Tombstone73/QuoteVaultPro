import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { products, productTypes } from "@shared/schema";
import { applyProductTypeIdUpdateGuard } from "../../lib/productUpdateGuards";

/** Phase 5's deliberately small shared slice. Pricing, PBV2 tree mutation,
 * publishing, activation, clone, and deletion remain outside this operation. */
export const productConfigurationChangesSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(100_000).optional(),
  category: z.string().trim().max(100).nullable().optional(),
  productTypeId: z.string().trim().min(1).max(128).nullable().optional(),
  measurementMode: z.enum(["dimensions_required", "quantity_only"]).optional(),
  workflowIntent: z.enum(["standard_production", "fulfillment_only", "service_fee"]).optional(),
  requiresProductionJob: z.boolean().optional(),
  requiresProofApproval: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one product configuration field is required.");
export type ProductConfigurationChanges = z.infer<typeof productConfigurationChangesSchema>;
export const canonicalProductConfigurationFieldNames = ["name", "description", "category", "productTypeId", "measurementMode", "workflowIntent", "requiresProductionJob", "requiresProofApproval"] as const satisfies readonly (keyof ProductConfigurationChanges)[];

export function takeCanonicalProductConfigurationChanges(value: Record<string, unknown>): ProductConfigurationChanges | null {
  const changes = Object.fromEntries(canonicalProductConfigurationFieldNames.flatMap((field) => Object.prototype.hasOwnProperty.call(value, field) ? [[field, value[field]]] : []));
  for (const field of canonicalProductConfigurationFieldNames) delete value[field];
  return Object.keys(changes).length ? changes as ProductConfigurationChanges : null;
}

export type CanonicalProductConfigurationChange = { field: keyof ProductConfigurationChanges; before: unknown; after: unknown };
export type CanonicalProductConfigurationResult = {
  product: typeof products.$inferSelect;
  appliedChanges: readonly CanonicalProductConfigurationChange[];
  resultingVersion: string;
  operationReference: "products.update_configuration.v1";
  auditReference: string;
};
export type CanonicalProductConfigurationProposal = Pick<CanonicalProductConfigurationResult, "appliedChanges" | "operationReference"> & {
  productId: string; productName: string; expectedUpdatedAt: string; fingerprint: string;
};

export class CanonicalProductConfigurationError extends Error {
  constructor(readonly code: "ACTOR_REQUIRED" | "PRODUCT_NOT_FOUND" | "PRODUCT_CONFIGURATION_STALE" | "INVALID_PRODUCT_TYPE_ID" | "UNKNOWN_PRODUCT_TYPE_ID" | "NO_PRODUCT_CONFIGURATION_CHANGES", message: string) {
    super(message); this.name = "CanonicalProductConfigurationError";
  }
}

type ProductConfigurationRecord = Pick<typeof products.$inferSelect,
  "id" | "organizationId" | "name" | "description" | "category" | "productTypeId" | "measurementMode" | "workflowIntent" | "requiresProductionJob" | "requiresProofApproval" | "updatedAt">;
type ProductConfigurationRepository = {
  getProduct(input: { organizationId: string; productId: string }): Promise<ProductConfigurationRecord | null>;
  listProductTypeIds(organizationId: string): Promise<readonly string[]>;
  updateProduct(input: { organizationId: string; productId: string; changes: ProductConfigurationChanges; expectedUpdatedAt?: Date }): Promise<typeof products.$inferSelect | null>;
};

const repository: ProductConfigurationRepository = {
  async getProduct({ organizationId, productId }) {
    const { db } = await import("../../db");
    const [product] = await db.select({ id: products.id, organizationId: products.organizationId, name: products.name, description: products.description, category: products.category, productTypeId: products.productTypeId, measurementMode: products.measurementMode, workflowIntent: products.workflowIntent, requiresProductionJob: products.requiresProductionJob, requiresProofApproval: products.requiresProofApproval, updatedAt: products.updatedAt })
      .from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, productId))).limit(1);
    return product ?? null;
  },
  async listProductTypeIds(organizationId) {
    const { db } = await import("../../db");
    const rows = await db.select({ id: productTypes.id }).from(productTypes).where(eq(productTypes.organizationId, organizationId));
    return rows.map((row) => row.id);
  },
  async updateProduct({ organizationId, productId, changes, expectedUpdatedAt }) {
    const { db } = await import("../../db");
    const [product] = await db.update(products).set({ ...changes, updatedAt: new Date() }).where(and(
      eq(products.organizationId, organizationId), eq(products.id, productId),
      ...(expectedUpdatedAt ? [eq(products.updatedAt, expectedUpdatedAt)] : []),
    )).returning();
    return product ?? null;
  },
};

function applyWorkflowDefaults(changes: ProductConfigurationChanges): ProductConfigurationChanges {
  return changes.workflowIntent === "service_fee"
    ? { ...changes, measurementMode: "quantity_only", requiresProductionJob: false, requiresProofApproval: false }
    : changes;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}
function proposalFingerprint(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function version(product: ProductConfigurationRecord): string { return new Date(product.updatedAt).toISOString(); }

/** Transport-independent application operation used by both the Product Editor
 * route and the confirmed AI command. Authorization remains at their trusted
 * boundaries; this service owns product-state validation and atomic writes. */
export class CanonicalProductConfigurationOperations {
  constructor(private readonly store: ProductConfigurationRepository = repository) {}

  private async normalizedChanges(product: ProductConfigurationRecord, raw: unknown): Promise<ProductConfigurationChanges> {
    const parsed = productConfigurationChangesSchema.safeParse(raw);
    if (!parsed.success) throw new CanonicalProductConfigurationError("NO_PRODUCT_CONFIGURATION_CHANGES", "A supported product configuration change is required.");
    let changes = applyWorkflowDefaults(parsed.data);
    if (Object.prototype.hasOwnProperty.call(changes, "productTypeId")) {
      const guarded = applyProductTypeIdUpdateGuard({ productData: changes, existingProductTypeId: product.productTypeId, knownProductTypeIds: await this.store.listProductTypeIds(product.organizationId) });
      if (!guarded.ok) throw new CanonicalProductConfigurationError(guarded.code, guarded.message);
      changes = guarded.productData as ProductConfigurationChanges;
    }
    return changes;
  }

  private changesFor(product: ProductConfigurationRecord, changes: ProductConfigurationChanges): CanonicalProductConfigurationChange[] {
    return (Object.keys(changes) as Array<keyof ProductConfigurationChanges>).flatMap((field) => product[field] === changes[field] ? [] : [{ field, before: product[field], after: changes[field] }]);
  }

  async propose(input: { organizationId: string; productId: string; changes: unknown }): Promise<CanonicalProductConfigurationProposal> {
    const product = await this.store.getProduct(input);
    if (!product) throw new CanonicalProductConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available.");
    const changes = await this.normalizedChanges(product, input.changes);
    const appliedChanges = this.changesFor(product, changes);
    if (!appliedChanges.length) throw new CanonicalProductConfigurationError("NO_PRODUCT_CONFIGURATION_CHANGES", "The requested product configuration already matches its current state.");
    const expectedUpdatedAt = version(product);
    return { productId: product.id, productName: product.name, expectedUpdatedAt, appliedChanges, operationReference: "products.update_configuration.v1", fingerprint: proposalFingerprint({ productId: product.id, expectedUpdatedAt, changes }) };
  }

  async execute(input: { organizationId: string; actorUserId: string; productId: string; changes: unknown; expectedUpdatedAt?: string; auditContext?: { source: "product_editor" | "assistant_go"; reference?: string } }): Promise<CanonicalProductConfigurationResult> {
    if (!input.actorUserId) throw new CanonicalProductConfigurationError("ACTOR_REQUIRED", "An authenticated actor is required.");
    const product = await this.store.getProduct(input);
    if (!product) throw new CanonicalProductConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available.");
    const currentVersion = version(product);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentVersion) throw new CanonicalProductConfigurationError("PRODUCT_CONFIGURATION_STALE", "The product changed before this update could be applied. Review the current product and try again.");
    const changes = await this.normalizedChanges(product, input.changes);
    const appliedChanges = this.changesFor(product, changes);
    if (!appliedChanges.length) throw new CanonicalProductConfigurationError("NO_PRODUCT_CONFIGURATION_CHANGES", "The requested product configuration already matches its current state.");
    const updated = await this.store.updateProduct({ organizationId: input.organizationId, productId: input.productId, changes, ...(input.expectedUpdatedAt ? { expectedUpdatedAt: new Date(input.expectedUpdatedAt) } : {}) });
    if (!updated) {
      const current = await this.store.getProduct(input);
      if (!current) throw new CanonicalProductConfigurationError("PRODUCT_NOT_FOUND", "The product is no longer available.");
      throw new CanonicalProductConfigurationError("PRODUCT_CONFIGURATION_STALE", "The product changed before this update could be applied. Review the current product and try again.");
    }
    return { product: updated, appliedChanges, resultingVersion: new Date(updated.updatedAt).toISOString(), operationReference: "products.update_configuration.v1", auditReference: input.auditContext?.reference ?? `${input.auditContext?.source ?? "application"}:${updated.id}:${new Date(updated.updatedAt).toISOString()}` };
  }
}

export const canonicalProductConfigurationOperations = new CanonicalProductConfigurationOperations();

export function renderCanonicalProductOperationMigrationMarkdown(): string {
  return `# Shared canonical Product operation migration\n\n> Generated from \`server/services/products/canonicalProductConfigurationOperations.ts\`. This report describes a bounded Phase 5 migration; it does not expose generic Product execution.\n\n| Operation | Shared users | Supported fields | Deferred behavior | AI protection |\n|---|---|---|---|---|\n| \`products.update_configuration.v1\` | Product Editor \`PATCH /api/products/:id\`; confirmed \`products.update_existing_product\` command | Name, description, category, product type, measurement mode, workflow intent, proof requirement, production-job requirement | Pricing, PBV2 tree/options, publish/activate, clone/delete, batch and customer-specific configuration | Trusted entity, admin capability ceiling, plan, GO, authority/state revalidation |\n`;
}
