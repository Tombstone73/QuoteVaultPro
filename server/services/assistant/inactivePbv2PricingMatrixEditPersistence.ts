import { and, eq } from "drizzle-orm";
import { aiConfigurableProductProposals, pbv2TreeVersions, products } from "@shared/schema";
import {
  InactivePbv2PricingMatrixEditError,
  inactivePbv2PricingMatrixExecutionResultSchema,
  inactivePbv2PricingMatrixProposalSchema,
  inactivePbv2PricingMatrixSourceFingerprint,
  inactivePbv2PricingMatrixSourceSnapshotSchema,
  type InactivePbv2PricingMatrixEditStore,
  type InactivePbv2PricingMatrixExecutionResult,
  type InactivePbv2PricingMatrixPreview,
  type InactivePbv2PricingMatrixProposal,
  type InactivePbv2PricingMatrixSourceSnapshot,
} from "./inactivePbv2PricingMatrixEditService";

const matrixProposalKind = "replace_inactive_pbv2_matrix" as const;
const matrixProposalVersion = 1 as const;

/** Importing an execution command must remain safe for injected-store tests.
 * The real database is required only when the production store is invoked. */
async function loadDatabase() {
  return (await import("../../db")).db;
}

type PersistedMatrixProposal = {
  kind: typeof matrixProposalKind;
  version: typeof matrixProposalVersion;
  proposal: Omit<InactivePbv2PricingMatrixProposal, "id">;
};

function persistedProposal(proposal: Omit<InactivePbv2PricingMatrixProposal, "id">): Record<string, unknown> {
  return { kind: matrixProposalKind, version: matrixProposalVersion, proposal };
}

function parseProposal(row: typeof aiConfigurableProductProposals.$inferSelect): InactivePbv2PricingMatrixProposal | null {
  const value = row.specification as Partial<PersistedMatrixProposal>;
  if (value.kind !== matrixProposalKind || value.version !== matrixProposalVersion || !value.proposal) return null;
  const parsed = inactivePbv2PricingMatrixProposalSchema.safeParse({ id: row.id, ...value.proposal, status: row.status });
  return parsed.success ? parsed.data : null;
}

function sourceSnapshot(product: typeof products.$inferSelect, tree: typeof pbv2TreeVersions.$inferSelect): InactivePbv2PricingMatrixSourceSnapshot {
  return inactivePbv2PricingMatrixSourceSnapshotSchema.parse({
    organizationId: product.organizationId,
    product: { id: product.id, name: product.name, isActive: product.isActive, pbv2ActiveTreeVersionId: product.pbv2ActiveTreeVersionId },
    pbv2Tree: { id: tree.id, productId: tree.productId, status: tree.status, schemaVersion: tree.schemaVersion, updatedAt: tree.updatedAt.toISOString(), treeJson: tree.treeJson },
  });
}

function cloneJson<T>(value: T): T {
  const structured = globalThis.structuredClone as ((input: T) => T) | undefined;
  return structured ? structured(value) : JSON.parse(JSON.stringify(value)) as T;
}

function replaceMatrix(treeJson: Record<string, unknown>, location: InactivePbv2PricingMatrixPreview["location"], matrix: unknown): Record<string, unknown> {
  const next = cloneJson(treeJson);
  if (location === "tree.pricingMatrix") return { ...next, pricingMatrix: cloneJson(matrix) };
  const meta = next.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_LOCATION_STALE", "The planned PBV2 pricing-matrix location is no longer available.");
  }
  return { ...next, meta: { ...(meta as Record<string, unknown>), pricingMatrix: cloneJson(matrix) } };
}

/**
 * Durable production persistence for the narrow matrix-replacement service.
 * The canonical configurable-proposal table stores a versioned envelope, so
 * this adds no competing proposal table or migration.
 */
export class DrizzleInactivePbv2PricingMatrixEditStore implements InactivePbv2PricingMatrixEditStore {
  async loadSource(input: { organizationId: string; productId: string; pbv2TreeVersionId: string }): Promise<InactivePbv2PricingMatrixSourceSnapshot | null> {
    const db = await loadDatabase();
    const [product] = await db.select().from(products).where(and(
      eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.isActive, false),
    )).limit(1);
    if (!product || product.pbv2ActiveTreeVersionId !== null) return null;
    const [tree] = await db.select().from(pbv2TreeVersions).where(and(
      eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, input.pbv2TreeVersionId),
      eq(pbv2TreeVersions.productId, product.id), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.schemaVersion, 2),
    )).limit(1);
    return tree ? sourceSnapshot(product, tree) : null;
  }

  async createProposal(input: Omit<InactivePbv2PricingMatrixProposal, "id">): Promise<InactivePbv2PricingMatrixProposal> {
    const db = await loadDatabase();
    const [row] = await db.insert(aiConfigurableProductProposals).values({
      orgId: input.organizationId, actorUserId: input.actorUserId, specification: persistedProposal(input), fingerprint: input.fingerprint, status: input.status,
    }).returning();
    const parsed = row && parseProposal(row);
    if (!parsed) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_PROPOSAL_CREATE_FAILED", "Could not persist the pricing-matrix proposal.");
    return parsed;
  }

  async getProposal(input: { organizationId: string; proposalId: string }): Promise<InactivePbv2PricingMatrixProposal | null> {
    const db = await loadDatabase();
    const [row] = await db.select().from(aiConfigurableProductProposals).where(and(
      eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId),
    )).limit(1);
    return row ? parseProposal(row) : null;
  }

  async executeReplacementIdempotently(input: {
    organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string;
    expectedSourceFingerprint: string; idempotencyKey: string; preview: InactivePbv2PricingMatrixPreview;
  }): Promise<InactivePbv2PricingMatrixExecutionResult> {
    const db = await loadDatabase();
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(aiConfigurableProductProposals).where(and(
        eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId),
      )).limit(1);
      if (!row) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_PROPOSAL_NOT_FOUND", "The pricing-matrix proposal was not found in this organization.");
      const proposal = parseProposal(row);
      if (!proposal || proposal.actorUserId !== input.actorUserId || proposal.fingerprint !== input.proposalFingerprint || proposal.sourceFingerprint !== input.expectedSourceFingerprint) {
        throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_PROPOSAL_STALE", "The pricing-matrix proposal changed; create a new confirmation plan.");
      }
      if (proposal.status === "succeeded" && row.createdProductId && row.createdPbv2TreeVersionId) {
        return inactivePbv2PricingMatrixExecutionResultSchema.parse({ productId: row.createdProductId, pbv2TreeVersionId: row.createdPbv2TreeVersionId, inactive: true, pbv2Status: "DRAFT", editorLink: proposal.preview.editorLink, reused: true });
      }
      const [product] = await tx.select().from(products).where(and(
        eq(products.organizationId, input.organizationId), eq(products.id, proposal.productId), eq(products.isActive, false),
      )).limit(1);
      if (!product || product.pbv2ActiveTreeVersionId !== null) throw new InactivePbv2PricingMatrixEditError("INACTIVE_DRAFT_NOT_FOUND", "The bound product is no longer an inactive PBV2 DRAFT product.");
      const [tree] = await tx.select().from(pbv2TreeVersions).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, proposal.pbv2TreeVersionId),
        eq(pbv2TreeVersions.productId, product.id), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.schemaVersion, 2),
      )).limit(1);
      if (!tree) throw new InactivePbv2PricingMatrixEditError("INACTIVE_DRAFT_NOT_FOUND", "The exact PBV2 DRAFT is no longer available.");
      const current = sourceSnapshot(product, tree);
      if (inactivePbv2PricingMatrixSourceFingerprint(current) !== input.expectedSourceFingerprint) {
        throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_SOURCE_STALE", "The inactive PBV2 DRAFT changed; review a new pricing-matrix preview.");
      }
      const now = new Date();
      const nextTreeJson = replaceMatrix(tree.treeJson, proposal.preview.location, proposal.preview.after);
      const updated = await tx.update(pbv2TreeVersions).set({ treeJson: nextTreeJson, updatedAt: now, updatedByUserId: input.actorUserId }).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.updatedAt, tree.updatedAt),
      )).returning({ id: pbv2TreeVersions.id });
      if (!updated.length) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_SOURCE_STALE", "The inactive PBV2 DRAFT changed while the replacement was being applied.");
      await tx.update(aiConfigurableProductProposals).set({
        status: "succeeded", createdProductId: product.id, createdPbv2TreeVersionId: tree.id, idempotencyKey: input.idempotencyKey, updatedAt: now,
      }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, proposal.id)));
      return inactivePbv2PricingMatrixExecutionResultSchema.parse({ productId: product.id, pbv2TreeVersionId: tree.id, inactive: true, pbv2Status: "DRAFT", editorLink: proposal.preview.editorLink, reused: false });
    });
  }
}

export function createDrizzleInactivePbv2PricingMatrixEditStore(): InactivePbv2PricingMatrixEditStore {
  return new DrizzleInactivePbv2PricingMatrixEditStore();
}
