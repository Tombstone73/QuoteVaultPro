import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, materials, products } from "@shared/schema";

const nonEmpty = z.string().trim().min(1).max(255);
const trustedCandidateSchema = z.object({ id: nonEmpty, label: nonEmpty }).strict();

/** Canonical pre-persistence material intent. Only server-owned resolution may
 * move an unresolved user label to a trusted tenant Material reference. */
export const canonicalProductMaterialProposalSchema = z.object({
  operationReference: z.literal("products.update_material_configuration.v1"),
  material: z.discriminatedUnion("state", [
    z.object({ state: z.literal("explicitly_unset") }).strict(),
    z.object({ state: z.literal("unresolved"), requestedLabel: nonEmpty, candidates: z.array(trustedCandidateSchema).max(10).default([]) }).strict(),
    z.object({ state: z.literal("resolved"), materialId: nonEmpty, label: nonEmpty }).strict(),
  ]),
}).strict();
export type CanonicalProductMaterialProposal = z.infer<typeof canonicalProductMaterialProposalSchema>;
export type CanonicalMaterialCandidate = z.infer<typeof trustedCandidateSchema> & { isActive: boolean };

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Exact matching preserves the existing ProductIntent rule. Ambiguous and
 * missing requests remain unresolved with only trusted active candidates. */
export function resolveCanonicalProductMaterialProposal(
  requestedLabel: string,
  candidates: readonly CanonicalMaterialCandidate[],
): CanonicalProductMaterialProposal {
  const label = nonEmpty.parse(requestedLabel);
  const exact = candidates.filter((candidate) => candidate.isActive && normalized(candidate.label) === normalized(label));
  return canonicalProductMaterialProposalSchema.parse({
    operationReference: "products.update_material_configuration.v1",
    material: exact.length === 1
      ? { state: "resolved", materialId: exact[0]!.id, label: exact[0]!.label }
      : { state: "unresolved", requestedLabel: label, candidates: exact.map(({ id, label: candidateLabel }) => ({ id, label: candidateLabel })) },
  });
}

export function canonicalProductMaterialProposalFromReference(reference: { state: "resolved"; id: string; label: string } | { state: "unresolved"; label: string } | { state: "explicitly_unset" }): CanonicalProductMaterialProposal {
  return canonicalProductMaterialProposalSchema.parse({
    operationReference: "products.update_material_configuration.v1",
    material: reference.state === "resolved"
      ? { state: "resolved", materialId: reference.id, label: reference.label }
      : reference.state === "unresolved"
        ? { state: "unresolved", requestedLabel: reference.label, candidates: [] }
        : { state: "explicitly_unset" },
  });
}

/** Trusted transports may carry a Material ID, but not its label or tenant
 * status. This placeholder is never displayed and is replaced by the
 * server-loaded Material label before a proposal/result is returned. */
export function canonicalProductMaterialProposalFromTrustedId(materialId: string | null): CanonicalProductMaterialProposal {
  return canonicalProductMaterialProposalFromReference(materialId
    ? { state: "resolved", id: materialId, label: "Trusted Material reference" }
    : { state: "explicitly_unset" });
}

export type CanonicalProductMaterialChange = { field: "primaryMaterialId"; before: string | null; after: string | null };
export type CanonicalProductMaterialProposalForExisting = {
  productId: string;
  productName: string;
  expectedUpdatedAt: string;
  material: CanonicalProductMaterialProposal["material"];
  appliedChanges: readonly CanonicalProductMaterialChange[];
  operationReference: "products.update_material_configuration.v1";
  fingerprint: string;
};

export class CanonicalProductMaterialError extends Error {
  constructor(readonly code: "ACTOR_REQUIRED" | "PRODUCT_NOT_FOUND" | "PRODUCT_MATERIAL_STALE" | "MATERIAL_NOT_FOUND" | "MATERIAL_INACTIVE" | "MATERIAL_UNRESOLVED" | "NO_PRODUCT_MATERIAL_CHANGES", message: string) {
    super(message);
    this.name = "CanonicalProductMaterialError";
  }
}

type ProductMaterialRecord = typeof products.$inferSelect;
type MaterialRecord = Pick<typeof materials.$inferSelect, "id" | "organizationId" | "name" | "isActive">;
type ProductMaterialRepository = {
  getProduct(input: { organizationId: string; productId: string }): Promise<ProductMaterialRecord | null>;
  getMaterial(input: { organizationId: string; materialId: string }): Promise<MaterialRecord | null>;
  update(input: { organizationId: string; productId: string; materialId: string | null; previousMaterialId: string | null; expectedUpdatedAt?: Date; actorUserId: string; auditReference: string }): Promise<typeof products.$inferSelect | null>;
};

const repository: ProductMaterialRepository = {
  async getProduct({ organizationId, productId }) {
    const { db } = await import("../../db");
    const [product] = await db.select()
      .from(products).where(and(eq(products.organizationId, organizationId), eq(products.id, productId))).limit(1);
    return product ?? null;
  },
  async getMaterial({ organizationId, materialId }) {
    const { db } = await import("../../db");
    const [material] = await db.select({ id: materials.id, organizationId: materials.organizationId, name: materials.name, isActive: materials.isActive })
      .from(materials).where(and(eq(materials.organizationId, organizationId), eq(materials.id, materialId))).limit(1);
    return material ?? null;
  },
  async update({ organizationId, productId, materialId, previousMaterialId, expectedUpdatedAt, actorUserId, auditReference }) {
    const { db } = await import("../../db");
    return db.transaction(async (tx) => {
      const now = new Date();
      const [updated] = await tx.update(products).set({ primaryMaterialId: materialId, updatedAt: now }).where(and(
        eq(products.organizationId, organizationId),
        eq(products.id, productId),
        ...(expectedUpdatedAt ? [eq(products.updatedAt, expectedUpdatedAt)] : []),
      )).returning();
      if (!updated) return null;
      await tx.insert(auditLogs).values({
        organizationId,
        userId: actorUserId,
        actionType: "product_material_configuration_updated",
        entityType: "product",
        entityId: productId,
        entityName: updated.name,
        description: `Canonical Product material configuration updated (${auditReference}).`,
        oldValues: { primaryMaterialId: previousMaterialId },
        newValues: { operationReference: "products.update_material_configuration.v1", primaryMaterialId: materialId, auditReference },
      } as any);
      return updated;
    });
  },
};

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}
function fingerprint(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function version(product: ProductMaterialRecord): string { return new Date(product.updatedAt).toISOString(); }

export class CanonicalProductMaterialOperations {
  constructor(private readonly store: ProductMaterialRepository = repository) {}

  private async trustedMaterial(organizationId: string, proposalValue: unknown): Promise<{ id: string; label: string } | null> {
    const proposal = canonicalProductMaterialProposalSchema.parse(proposalValue);
    if (proposal.material.state === "unresolved") throw new CanonicalProductMaterialError("MATERIAL_UNRESOLVED", "The requested material must be resolved to one trusted tenant Material before it can be assigned.");
    if (proposal.material.state === "explicitly_unset") return null;
    const material = await this.store.getMaterial({ organizationId, materialId: proposal.material.materialId });
    return validateCanonicalProductMaterialSelection(proposal, material);
  }

  async propose(input: { organizationId: string; productId: string; material: unknown }): Promise<CanonicalProductMaterialProposalForExisting> {
    const product = await this.store.getProduct(input);
    if (!product) throw new CanonicalProductMaterialError("PRODUCT_NOT_FOUND", "The Product is no longer available.");
    const proposal = canonicalProductMaterialProposalSchema.parse(input.material);
    if (proposal.material.state === "resolved" && proposal.material.materialId === product.primaryMaterialId) throw new CanonicalProductMaterialError("NO_PRODUCT_MATERIAL_CHANGES", "The Product already uses the requested material configuration.");
    const trusted = await this.trustedMaterial(input.organizationId, proposal);
    const after = trusted?.id ?? null;
    if (after === product.primaryMaterialId) throw new CanonicalProductMaterialError("NO_PRODUCT_MATERIAL_CHANGES", "The Product already uses the requested material configuration.");
    const expectedUpdatedAt = version(product);
    const material = trusted ? { state: "resolved" as const, materialId: trusted.id, label: trusted.label } : { state: "explicitly_unset" as const };
    return {
      productId: product.id,
      productName: product.name,
      expectedUpdatedAt,
      material,
      appliedChanges: [{ field: "primaryMaterialId", before: product.primaryMaterialId, after }],
      operationReference: "products.update_material_configuration.v1",
      fingerprint: fingerprint({ organizationId: input.organizationId, productId: product.id, expectedUpdatedAt, material }),
    };
  }

  async execute(input: { organizationId: string; actorUserId: string; productId: string; material: unknown; expectedUpdatedAt?: string; auditContext?: { source: "product_editor" | "assistant_go" | "product_intent_execution"; reference?: string } }) {
    if (!input.actorUserId) throw new CanonicalProductMaterialError("ACTOR_REQUIRED", "An authenticated actor is required.");
    const product = await this.store.getProduct(input);
    if (!product) throw new CanonicalProductMaterialError("PRODUCT_NOT_FOUND", "The Product is no longer available.");
    const currentVersion = version(product);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentVersion) throw new CanonicalProductMaterialError("PRODUCT_MATERIAL_STALE", "The Product changed before its material could be updated. Review the current Product and try again.");
    const proposal = canonicalProductMaterialProposalSchema.parse(input.material);
    // Preserve a historical inactive/deleted-tenant assignment when a broad
    // Product Editor save resubmits the unchanged FK. New assignments still
    // pass through active, tenant-owned Material validation below.
    if (proposal.material.state === "resolved" && proposal.material.materialId === product.primaryMaterialId) return { product, appliedChanges: [] as CanonicalProductMaterialChange[], resultingVersion: currentVersion, operationReference: "products.update_material_configuration.v1" as const, auditReference: input.auditContext?.reference ?? `material:no-change:${product.id}` };
    const trusted = await this.trustedMaterial(input.organizationId, proposal);
    const materialId = trusted?.id ?? null;
    if (materialId === product.primaryMaterialId) return { product, appliedChanges: [] as CanonicalProductMaterialChange[], resultingVersion: currentVersion, operationReference: "products.update_material_configuration.v1" as const, auditReference: input.auditContext?.reference ?? `material:no-change:${product.id}` };
    const auditReference = input.auditContext?.reference ?? `${input.auditContext?.source ?? "application"}:${product.id}:${currentVersion}`;
    const updated = await this.store.update({ organizationId: input.organizationId, productId: input.productId, materialId, previousMaterialId: product.primaryMaterialId, ...(input.expectedUpdatedAt ? { expectedUpdatedAt: new Date(input.expectedUpdatedAt) } : {}), actorUserId: input.actorUserId, auditReference });
    if (!updated) {
      const current = await this.store.getProduct(input);
      if (!current) throw new CanonicalProductMaterialError("PRODUCT_NOT_FOUND", "The Product is no longer available.");
      throw new CanonicalProductMaterialError("PRODUCT_MATERIAL_STALE", "The Product changed before its material could be updated. Review the current Product and try again.");
    }
    return { product: updated, appliedChanges: [{ field: "primaryMaterialId" as const, before: product.primaryMaterialId, after: materialId }], resultingVersion: new Date(updated.updatedAt).toISOString(), operationReference: "products.update_material_configuration.v1" as const, auditReference };
  }
}

/** Shared assignment validation for both persisted Product updates and the
 * transactional new-Product writer. The caller owns the tenant-scoped lookup. */
export function validateCanonicalProductMaterialSelection(
  proposalValue: unknown,
  material: MaterialRecord | null,
): { id: string; label: string } | null {
  const proposal = canonicalProductMaterialProposalSchema.parse(proposalValue);
  if (proposal.material.state === "unresolved") throw new CanonicalProductMaterialError("MATERIAL_UNRESOLVED", "The requested material must be resolved to one trusted tenant Material before it can be assigned.");
  if (proposal.material.state === "explicitly_unset") return null;
  if (!material || material.id !== proposal.material.materialId) throw new CanonicalProductMaterialError("MATERIAL_NOT_FOUND", "The selected material is not available for this tenant.");
  if (!material.isActive) throw new CanonicalProductMaterialError("MATERIAL_INACTIVE", "Inactive materials cannot be newly assigned to a Product.");
  return { id: material.id, label: material.name };
}

export const canonicalProductMaterialOperations = new CanonicalProductMaterialOperations();

export function takeCanonicalProductMaterialChange(value: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, "primaryMaterialId")) return undefined;
  const raw = value.primaryMaterialId;
  delete value.primaryMaterialId;
  return raw === null || raw === "" || raw === undefined ? null : nonEmpty.parse(raw);
}

export function renderCanonicalProductMaterialMigrationMarkdown(): string {
  return `# Shared canonical Product material migration\n\n> Generated from \`server/services/products/canonicalProductMaterialOperations.ts\`. This is one completed slice of original migration item 9.\n\n| Material concept | Canonical ownership | Product Editor | AI / ProductIntent | Status |\n|---|---|---|---|---|\n| Product primary material | \`products.update_material_configuration.v1\` | Existing Product PATCH delegates assign/change/clear | Existing Product GO and new-draft canonical material proposal use the same tenant/active validation | \`shared_canonical\` |\n| Tenant material resolution | Server-owned exact matching over active tenant Materials; ambiguity remains unresolved | IDs are revalidated, not trusted from transport | Natural-language labels become trusted references only after server resolution | \`shared_canonical\` |\n| Allowed Product links | Material editor / \`material_product_links\` | Separate surface | Not broadened | \`deferred_existing\` |\n| PBV2 overrides/effects and production consumption | Existing PBV2, prepress, inventory, and production services | Unchanged | Not broadened | \`downstream_unchanged\` |\n\nInactive materials remain valid historical references but cannot be newly assigned. Deleted primary references retain the database's existing \`ON DELETE SET NULL\` behavior. Historical V1 Product drafts import material state through one compatibility adapter on their next write.\n`;
}
