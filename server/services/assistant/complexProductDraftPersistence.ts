import { and, eq } from "drizzle-orm";
import { aiConfigurableProductProposals, pbv2TreeVersions, products } from "@shared/schema";
import { db } from "../../db";
import { buildCanonicalComplexProductTree, specificationFingerprint, validateComplexProductSpecification, type ComplexProductSpecification } from "./complexProductSpecification";

export class ComplexProductDraftError extends Error {}
export async function getComplexProductProposal(organizationId: string, proposalId: string) {
  const [proposal] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, organizationId), eq(aiConfigurableProductProposals.id, proposalId))).limit(1);
  return proposal ?? null;
}
export async function persistComplexProductProposal(input: { organizationId: string; conversationId?: string; actorUserId?: string | null; specification: ComplexProductSpecification }) {
  const blockers = validateComplexProductSpecification(input.specification); if (blockers.length) throw new ComplexProductDraftError(blockers.join(" "));
  const fingerprint = specificationFingerprint(input.specification);
  if (!input.conversationId) return { id: null, fingerprint, specification: input.specification };
  const [existing] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.conversationId, input.conversationId))).limit(1);
  if (existing) { const [updated] = await db.update(aiConfigurableProductProposals).set({ specification: input.specification, fingerprint, status: "proposed", idempotencyKey: null, updatedAt: new Date() }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, existing.id))).returning(); return { id: updated!.id, fingerprint, specification: input.specification }; }
  const [created] = await db.insert(aiConfigurableProductProposals).values({ orgId: input.organizationId, conversationId: input.conversationId, actorUserId: input.actorUserId ?? null, specification: input.specification, fingerprint }).returning(); return { id: created!.id, fingerprint, specification: input.specification };
}

/** Canonical products + PBV2 DRAFT transaction. No active tree is assigned. */
export async function createComplexProductDraft(input: { organizationId: string; proposalId: string; fingerprint: string; actorUserId: string | null; idempotencyKey: string }) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId))).limit(1);
    if (!proposal || proposal.fingerprint !== input.fingerprint) throw new ComplexProductDraftError("The configurable-product proposal changed or was not found.");
    if (proposal.status === "succeeded" && proposal.createdProductId && proposal.createdPbv2TreeVersionId) return { productId: proposal.createdProductId, pbv2TreeVersionId: proposal.createdPbv2TreeVersionId, reused: true };
    const specification = proposal.specification as ComplexProductSpecification; const blockers = validateComplexProductSpecification(specification); if (blockers.length) throw new ComplexProductDraftError(blockers.join(" "));
    const [duplicate] = await tx.select({ id: products.id }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.name, specification.name))).limit(1); if (duplicate) throw new ComplexProductDraftError("A product with this name already exists in this organization.");
    const now = new Date(); const treeJson = buildCanonicalComplexProductTree(specification); const [product] = await tx.insert(products).values({ organizationId: input.organizationId, name: specification.name, description: specification.description, category: specification.category, pricingMode: "sqft", pricingEngine: "pricingProfile", pricingProfileKey: "default", requiresProductionJob: true, requiresProofApproval: false, isTaxable: specification.taxable, isService: false, isActive: false, optionTreeJson: null, pbv2ActiveTreeVersionId: null }).returning();
    if (!product) throw new ComplexProductDraftError("Product creation failed.");
    const [tree] = await tx.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: product.id, status: "DRAFT", schemaVersion: 2, treeJson, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId, createdAt: now, updatedAt: now }).returning();
    if (!tree) throw new ComplexProductDraftError("PBV2 draft creation failed.");
    await tx.update(aiConfigurableProductProposals).set({ status: "succeeded", createdProductId: product.id, createdPbv2TreeVersionId: tree.id, idempotencyKey: input.idempotencyKey, updatedAt: now }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, proposal.id)));
    return { productId: product.id, pbv2TreeVersionId: tree.id, reused: false };
  });
}
