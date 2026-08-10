import { and, eq, sql } from "drizzle-orm";
import { aiConfigurableProductProposals, pbv2TreeVersions, products } from "@shared/schema";
import {
  CloneInactiveProductDraftError,
  type CloneInactiveProductDraftStore,
  type CloneInactiveProductExecutionResult,
  type CloneInactiveProductPreview,
  type CloneInactiveProductProposal,
  type CloneInactiveProductSourceSnapshot,
  cloneInactiveProductProposalSchema,
  cloneInactiveProductSourceFingerprint,
  cloneInactiveProductSourceSnapshotSchema,
  normalizeCloneProductName,
} from "./cloneInactiveProductDraftService";

const cloneProposalKind = "clone_inactive_product_draft" as const;
const cloneProposalVersion = 1 as const;

/** Keep injected-store execution tests independent from DATABASE_URL. */
async function loadDatabase() {
  return (await import("../../db")).db;
}

type PersistedCloneProposal = {
  kind: typeof cloneProposalKind;
  version: typeof cloneProposalVersion;
  proposal: Omit<CloneInactiveProductProposal, "id">;
};

function persistedProposal(value: Omit<CloneInactiveProductProposal, "id">): Record<string, unknown> {
  return { kind: cloneProposalKind, version: cloneProposalVersion, proposal: value };
}

function parseProposal(row: typeof aiConfigurableProductProposals.$inferSelect): CloneInactiveProductProposal | null {
  const value = row.specification as Partial<PersistedCloneProposal>;
  if (value.kind !== cloneProposalKind || value.version !== cloneProposalVersion || !value.proposal) return null;
  const parsed = cloneInactiveProductProposalSchema.safeParse({ id: row.id, ...value.proposal, status: row.status });
  return parsed.success ? parsed.data : null;
}

function productConfiguration(product: typeof products.$inferSelect): Record<string, unknown> {
  return {
    priceBreaks: product.priceBreaks, optionsJson: product.optionsJson, optionTreeJson: product.optionTreeJson,
    artworkPolicy: product.artworkPolicy, pricingProfileKey: product.pricingProfileKey,
    pricingProfileConfig: product.pricingProfileConfig, pricingEngine: product.pricingEngine,
    pricingFormula: product.pricingFormula, pricingFormulaId: product.pricingFormulaId,
    useNestingCalculator: product.useNestingCalculator, sheetWidth: product.sheetWidth,
    sheetHeight: product.sheetHeight, materialType: product.materialType,
    minPricePerItem: product.minPricePerItem, nestingVolumePricing: product.nestingVolumePricing,
    allowZeroPrice: product.allowZeroPrice,
  };
}

function snapshot(product: typeof products.$inferSelect, tree: typeof pbv2TreeVersions.$inferSelect): CloneInactiveProductSourceSnapshot {
  return cloneInactiveProductSourceSnapshotSchema.parse({
    organizationId: product.organizationId,
    product: {
      id: product.id, name: product.name, description: product.description, category: product.category,
      isActive: product.isActive, measurementMode: product.measurementMode, workflowIntent: product.workflowIntent,
      isTaxable: product.isTaxable, pricingMode: product.pricingMode, primaryMaterialId: product.primaryMaterialId,
      pbv2ActiveTreeVersionId: product.pbv2ActiveTreeVersionId, configuration: productConfiguration(product),
    },
    pbv2Tree: {
      id: tree.id, productId: tree.productId, status: tree.status, schemaVersion: tree.schemaVersion,
      updatedAt: tree.updatedAt.toISOString(), treeJson: tree.treeJson,
    },
  });
}

/**
 * Drizzle-backed persistence for the isolated clone contract. It deliberately
 * reuses the canonical configurable-proposal table: the JSON envelope is
 * versioned and discriminated, so clone plans cannot be confused with product
 * creation plans and no duplicate proposal migration is needed.
 */
export class DrizzleCloneInactiveProductDraftStore implements CloneInactiveProductDraftStore {
  async loadSource(input: { organizationId: string; productId: string }): Promise<CloneInactiveProductSourceSnapshot | null> {
    const db = await loadDatabase();
    const [product] = await db.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, input.productId))).limit(1);
    if (!product) return null;
    const trees = product.pbv2ActiveTreeVersionId
      ? await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, product.pbv2ActiveTreeVersionId), eq(pbv2TreeVersions.productId, product.id))).limit(1)
      : await db.select().from(pbv2TreeVersions).where(and(eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.productId, product.id), eq(pbv2TreeVersions.status, "DRAFT"))).limit(2);
    // An inactive source is cloneable only when it has exactly one explicit
    // DRAFT snapshot. Multiple drafts require a future explicit tree selector.
    if (!product.pbv2ActiveTreeVersionId && trees.length !== 1) return null;
    const tree = trees[0];
    return tree ? snapshot(product, tree) : null;
  }

  async findProductsByNormalizedName(input: { organizationId: string; normalizedName: string }): Promise<Array<{ id: string; name: string }>> {
    const db = await loadDatabase();
    return db.select({ id: products.id, name: products.name }).from(products).where(and(
      eq(products.organizationId, input.organizationId),
      sql`lower(regexp_replace(trim(${products.name}), '\\s+', ' ', 'g')) = ${input.normalizedName}`,
    ));
  }

  async createProposal(input: Omit<CloneInactiveProductProposal, "id">): Promise<CloneInactiveProductProposal> {
    const db = await loadDatabase();
    const [created] = await db.insert(aiConfigurableProductProposals).values({
      orgId: input.organizationId, actorUserId: input.actorUserId,
      specification: persistedProposal(input), fingerprint: input.fingerprint, status: input.status,
    }).returning();
    if (!created) throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_CREATE_FAILED", "Could not persist the clone proposal.");
    const parsed = parseProposal(created);
    if (!parsed) throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_INVALID", "The persisted clone proposal is invalid.");
    return parsed;
  }

  async getProposal(input: { organizationId: string; proposalId: string }): Promise<CloneInactiveProductProposal | null> {
    const db = await loadDatabase();
    const [row] = await db.select().from(aiConfigurableProductProposals).where(and(
      eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId),
    )).limit(1);
    return row ? parseProposal(row) : null;
  }

  async executeCloneIdempotently(input: {
    organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string;
    expectedSourceFingerprint: string; idempotencyKey: string; preview: CloneInactiveProductPreview;
  }): Promise<CloneInactiveProductExecutionResult> {
    const db = await loadDatabase();
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(aiConfigurableProductProposals).where(and(
        eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId),
      )).limit(1);
      if (!row) throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_NOT_FOUND", "The clone proposal was not found in this organization.");
      const proposal = parseProposal(row);
      if (!proposal || proposal.actorUserId !== input.actorUserId || proposal.fingerprint !== input.proposalFingerprint || proposal.sourceFingerprint !== input.expectedSourceFingerprint) {
        throw new CloneInactiveProductDraftError("CLONE_PROPOSAL_STALE", "The clone proposal changed; create a new confirmation plan.");
      }
      if (proposal.status === "succeeded" && row.createdProductId && row.createdPbv2TreeVersionId) {
        return { productId: row.createdProductId, productName: proposal.preview.result.product.name, pbv2TreeVersionId: row.createdPbv2TreeVersionId, inactive: true, pbv2Status: "DRAFT", reused: true };
      }
      const [sourceProduct] = await tx.select().from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.id, proposal.sourceProductId))).limit(1);
      if (!sourceProduct) throw new CloneInactiveProductDraftError("CLONE_SOURCE_NOT_FOUND", "The source product is no longer available in this organization.");
      const [sourceTree] = await tx.select().from(pbv2TreeVersions).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, proposal.sourcePbv2TreeVersionId), eq(pbv2TreeVersions.productId, sourceProduct.id),
      )).limit(1);
      if (!sourceTree || (sourceProduct.pbv2ActiveTreeVersionId ? sourceProduct.pbv2ActiveTreeVersionId !== proposal.sourcePbv2TreeVersionId : sourceTree.status !== "DRAFT")) {
        throw new CloneInactiveProductDraftError("CLONE_SOURCE_STALE", "The source product or its PBV2 tree changed; review a new clone preview.");
      }
      // This check repeats the service's fingerprint validation within the
      // write transaction, closing the race between GO revalidation and insert.
      const current = snapshot(sourceProduct, sourceTree);
      if (cloneInactiveProductSourceFingerprint(current) !== input.expectedSourceFingerprint) {
        throw new CloneInactiveProductDraftError("CLONE_SOURCE_STALE", "The source product changed; review a new clone preview.");
      }
      const matches = await tx.select({ id: products.id }).from(products).where(and(
        eq(products.organizationId, input.organizationId),
        sql`lower(regexp_replace(trim(${products.name}), '\\s+', ' ', 'g')) = ${normalizeCloneProductName(proposal.preview.result.product.name)}`,
      )).limit(1);
      if (matches.length) throw new CloneInactiveProductDraftError("CLONE_NAME_CONFLICT", `A product named "${proposal.preview.result.product.name}" already exists in this organization.`);
      const { id: _id, organizationId: _organizationId, createdAt: _createdAt, updatedAt: _updatedAt, pbv2ActiveTreeVersionId: _activeTree, ...copy } = sourceProduct;
      const now = new Date();
      const [product] = await tx.insert(products).values({ ...copy, organizationId: input.organizationId, name: proposal.preview.result.product.name, description: proposal.preview.result.product.description, category: proposal.preview.result.product.category, isActive: false, pbv2ActiveTreeVersionId: null, updatedAt: now }).returning();
      if (!product) throw new CloneInactiveProductDraftError("CLONE_PRODUCT_CREATE_FAILED", "Could not create the inactive clone.");
      const [tree] = await tx.insert(pbv2TreeVersions).values({ organizationId: input.organizationId, productId: product.id, status: "DRAFT", schemaVersion: 2, treeJson: input.preview.result.pbv2Tree.treeJson, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId, createdAt: now, updatedAt: now }).returning();
      if (!tree) throw new CloneInactiveProductDraftError("CLONE_TREE_CREATE_FAILED", "Could not create the clone PBV2 DRAFT.");
      await tx.update(aiConfigurableProductProposals).set({ status: "succeeded", createdProductId: product.id, createdPbv2TreeVersionId: tree.id, idempotencyKey: input.idempotencyKey, updatedAt: now }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, proposal.id)));
      return { productId: product.id, productName: product.name, pbv2TreeVersionId: tree.id, inactive: true, pbv2Status: "DRAFT", reused: false };
    });
  }
}

export function createDrizzleCloneInactiveProductDraftStore(): CloneInactiveProductDraftStore {
  return new DrizzleCloneInactiveProductDraftStore();
}
