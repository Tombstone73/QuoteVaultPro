import { and, desc, eq } from "drizzle-orm";
import { aiConfigurableProductProposals, pbv2TreeVersions, products } from "@shared/schema";
import { db } from "../../db";
import { buildCanonicalComplexProductTree, measurementModeForComplexProductSpecification, measurementModeQuestion, pricingUnitForComplexProductMatrix, specificationFingerprint, validateComplexProductSpecification, type ComplexProductSpecification } from "./complexProductSpecification";
import { configurableProductConfirmationDto, configurableProductResultDto } from "./complexProductPresentation";
import { ComplexProductContinuationPolicyError, selectConfigurableProductContinuation } from "./complexProductContinuationPolicy";

export class ComplexProductDraftError extends Error {}
export class ComplexProductContinuationError extends ComplexProductDraftError {}
function nextProposalVersion(specification: ComplexProductSpecification, previous?: unknown): ComplexProductSpecification {
  const prior = previous && typeof previous === "object" && Number.isInteger((previous as { proposalVersion?: unknown }).proposalVersion)
    ? (previous as { proposalVersion: number }).proposalVersion : 0;
  return { ...structuredClone(specification), proposalVersion: Math.max(1, prior + 1) };
}
export async function getComplexProductProposal(organizationId: string, proposalId: string) {
  const [proposal] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, organizationId), eq(aiConfigurableProductProposals.id, proposalId))).limit(1);
  return proposal ?? null;
}
export async function getComplexProductProposalForConversation(organizationId: string, conversationId: string) {
  const [proposal] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, organizationId), eq(aiConfigurableProductProposals.conversationId, conversationId))).orderBy(desc(aiConfigurableProductProposals.updatedAt), desc(aiConfigurableProductProposals.createdAt)).limit(1);
  return proposal ?? null;
}
/** Resolve the one editable proposal bound to the canonical assistant conversation.
 * A prior card ID is only a tenant-scoped consistency check, never the primary key. */
export async function resolveConfigurableProductContinuation(input: { organizationId: string; actorUserId: string; conversationId: string; priorProposalId?: string | null }) {
  const proposals = await db.select().from(aiConfigurableProductProposals).where(and(
    eq(aiConfigurableProductProposals.orgId, input.organizationId),
    eq(aiConfigurableProductProposals.conversationId, input.conversationId),
  )).orderBy(desc(aiConfigurableProductProposals.updatedAt), desc(aiConfigurableProductProposals.createdAt));
  const priorProposal = !proposals.length && input.priorProposalId
    ? await getComplexProductProposal(input.organizationId, input.priorProposalId)
    : null;
  try {
    return selectConfigurableProductContinuation({
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      priorProposalId: input.priorProposalId,
      conversationProposals: proposals,
      priorProposal,
    });
  } catch (error) {
    if (error instanceof ComplexProductContinuationPolicyError) throw new ComplexProductContinuationError(error.message);
    throw error;
  }
}
export async function getComplexProductConfirmation(organizationId: string, proposalId: string) {
  const proposal = await getComplexProductProposal(organizationId, proposalId); if (!proposal) return null;
  const specification = proposal.specification as ComplexProductSpecification; const blockers = Array.from(new Set([...validateComplexProductSpecification(specification), ...specification.review.blockers]));
  return configurableProductConfirmationDto({ proposalId: proposal.id, fingerprint: proposal.fingerprint, specification, blockers });
}
export async function persistComplexProductProposal(input: { organizationId: string; conversationId?: string; actorUserId?: string | null; specification: ComplexProductSpecification }) {
  if (!input.conversationId) { const specification = nextProposalVersion(input.specification); const blockers = validateComplexProductSpecification(specification); if (blockers.length) throw new ComplexProductDraftError(blockers.join(" ")); return { id: null, fingerprint: specificationFingerprint(specification), specification }; }
  const [existing] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.conversationId, input.conversationId))).limit(1);
  const specification = nextProposalVersion(input.specification, existing?.specification); const blockers = validateComplexProductSpecification(specification); if (blockers.length && !blockers.every((blocker) => blocker === "Are these prices per piece or per square foot?" || blocker === measurementModeQuestion || /pricing matrix/i.test(blocker))) throw new ComplexProductDraftError(blockers.join(" "));
  const fingerprint = specificationFingerprint(specification);
  if (existing) { const [updated] = await db.update(aiConfigurableProductProposals).set({ specification, fingerprint, status: "proposed", idempotencyKey: null, updatedAt: new Date() }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, existing.id))).returning(); return { id: updated!.id, fingerprint, specification }; }
  const [created] = await db.insert(aiConfigurableProductProposals).values({ orgId: input.organizationId, conversationId: input.conversationId, actorUserId: input.actorUserId ?? null, specification, fingerprint }).returning(); return { id: created!.id, fingerprint, specification };
}
export async function updateComplexProductProposal(input: { organizationId: string; proposalId: string; specification: ComplexProductSpecification }) {
  const [current] = await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId), eq(aiConfigurableProductProposals.status, "proposed"))).limit(1);
  if (!current) throw new ComplexProductDraftError("The configurable-product proposal is not editable.");
  const specification = nextProposalVersion(input.specification, current.specification); const blockers = validateComplexProductSpecification(specification); const fingerprint = specificationFingerprint(specification);
  const [updated] = await db.update(aiConfigurableProductProposals).set({ specification, fingerprint, status: "proposed", idempotencyKey: null, updatedAt: new Date() }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId), eq(aiConfigurableProductProposals.status, "proposed"))).returning();
  if (!updated) throw new ComplexProductDraftError("The configurable-product proposal is not editable.");
  return { proposal: updated, blockers };
}

/** Canonical products + PBV2 DRAFT transaction. No active tree is assigned. */
export async function createComplexProductDraft(input: { organizationId: string; proposalId: string; fingerprint: string; actorUserId: string | null; idempotencyKey: string }) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId))).limit(1);
    if (!proposal || proposal.fingerprint !== input.fingerprint) throw new ComplexProductDraftError("The configurable-product proposal changed or was not found.");
    if (proposal.status === "succeeded" && proposal.createdProductId && proposal.createdPbv2TreeVersionId) return { productId: proposal.createdProductId, pbv2TreeVersionId: proposal.createdPbv2TreeVersionId, reused: true };
    const specification = proposal.specification as ComplexProductSpecification; const blockers = validateComplexProductSpecification(specification); if (blockers.length) throw new ComplexProductDraftError(blockers.join(" "));
    const [duplicate] = await tx.select({ id: products.id }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.name, specification.name))).limit(1); if (duplicate) throw new ComplexProductDraftError("A product with this name already exists in this organization.");
    const now = new Date(); const treeJson = buildCanonicalComplexProductTree(specification); const perPiece = pricingUnitForComplexProductMatrix(specification.pricing) === "per_piece"; const measurementMode = measurementModeForComplexProductSpecification(specification); const [product] = await tx.insert(products).values({ organizationId: input.organizationId, name: specification.name, description: specification.description, category: specification.category, pricingMode: perPiece ? "quantity" : "area", measurementMode: measurementMode === "dimensions_required" ? "dimensions_required" : "quantity_only", pricingEngine: "pricingProfile", pricingProfileKey: perPiece ? "qty_only" : "default", requiresProductionJob: true, requiresProofApproval: false, isTaxable: specification.taxable, isService: false, isActive: false, optionTreeJson: null, pbv2ActiveTreeVersionId: null }).returning();
    if (!product) throw new ComplexProductDraftError("Product creation failed.");
    const [tree] = await tx.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: product.id, status: "DRAFT", schemaVersion: 2, treeJson, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId, createdAt: now, updatedAt: now }).returning();
    if (!tree) throw new ComplexProductDraftError("PBV2 draft creation failed.");
    await tx.update(aiConfigurableProductProposals).set({ status: "succeeded", createdProductId: product.id, createdPbv2TreeVersionId: tree.id, idempotencyKey: input.idempotencyKey, updatedAt: now }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, proposal.id)));
    return { productId: product.id, pbv2TreeVersionId: tree.id, reused: false };
  });
}
