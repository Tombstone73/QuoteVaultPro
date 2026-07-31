import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { aiConfigurableProductProposals, pbv2TreeVersions, products } from "@shared/schema";
import { db } from "../../db";
import {
  InactivePbv2QuantityTierEditError,
  type InactivePbv2QuantityTierEditStore,
  type InactivePbv2QuantityTierExecutionResult,
  type InactivePbv2QuantityTierPreview,
  type InactivePbv2QuantityTierProposal,
  type InactivePbv2QuantityTierSourceSnapshot,
  inactivePbv2QuantityTierProposalSchema,
  inactivePbv2QuantityTierSourceSnapshotSchema,
  exactInactiveDraftTierEditorLink,
} from "./inactivePbv2QuantityTierEditService";

const tierProposalKind = "inactive_pbv2_quantity_tier_edit" as const;
const tierProposalVersion = 1 as const;

type PersistedTierProposal = {
  kind: typeof tierProposalKind;
  version: typeof tierProposalVersion;
  proposal: Omit<InactivePbv2QuantityTierProposal, "id">;
};

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function sourceFingerprint(source: InactivePbv2QuantityTierSourceSnapshot): string {
  return createHash("sha256").update(stable(source)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function snapshot(product: typeof products.$inferSelect, tree: typeof pbv2TreeVersions.$inferSelect): InactivePbv2QuantityTierSourceSnapshot {
  return inactivePbv2QuantityTierSourceSnapshotSchema.parse({
    organizationId: product.organizationId,
    product: { id: product.id, name: product.name, isActive: product.isActive, pbv2ActiveTreeVersionId: product.pbv2ActiveTreeVersionId },
    pbv2Tree: { id: tree.id, productId: tree.productId, status: tree.status, schemaVersion: tree.schemaVersion, updatedAt: tree.updatedAt.toISOString(), treeJson: tree.treeJson },
  });
}

function persistedProposal(proposal: Omit<InactivePbv2QuantityTierProposal, "id">): Record<string, unknown> {
  return { kind: tierProposalKind, version: tierProposalVersion, proposal };
}

function parseProposal(row: typeof aiConfigurableProductProposals.$inferSelect): InactivePbv2QuantityTierProposal | null {
  const value = row.specification as Partial<PersistedTierProposal>;
  if (value.kind !== tierProposalKind || value.version !== tierProposalVersion || !value.proposal) return null;
  const parsed = inactivePbv2QuantityTierProposalSchema.safeParse({ id: row.id, ...value.proposal });
  return parsed.success ? parsed.data : null;
}

function replaceTierFamily(treeJson: Record<string, unknown>, preview: InactivePbv2QuantityTierPreview): Record<string, unknown> {
  const tree = structuredClone(treeJson);
  const meta = asRecord(tree.meta);
  if (!meta) throw new InactivePbv2QuantityTierEditError("PBV2_TIERS_INVALID", "The bound PBV2 DRAFT has no canonical meta block for quantity pricing.");
  const pricing = asRecord(meta.pricingV2);
  if (meta.pricingV2 !== undefined && !pricing) throw new InactivePbv2QuantityTierEditError("PBV2_TIERS_INVALID", "The bound PBV2 DRAFT has an invalid canonical pricingV2 block.");
  meta.pricingV2 = { ...(pricing ?? {}), [preview.after.tierType]: structuredClone(preview.after.tiers) };
  tree.meta = meta;
  return tree;
}

/** Durable production store for full quantity-tier replacements. The shared
 * proposal table is intentionally used with a discriminated versioned envelope
 * so a tier proposal cannot be interpreted as a configurable-product proposal. */
export class DrizzleInactivePbv2QuantityTierEditStore implements InactivePbv2QuantityTierEditStore {
  async loadSource(input: { organizationId: string; productId: string; pbv2TreeVersionId: string }): Promise<InactivePbv2QuantityTierSourceSnapshot | null> {
    const [product] = await db.select().from(products).where(and(
      eq(products.organizationId, input.organizationId), eq(products.id, input.productId), eq(products.isActive, false), isNull(products.pbv2ActiveTreeVersionId),
    )).limit(1);
    if (!product) return null;
    const [tree] = await db.select().from(pbv2TreeVersions).where(and(
      eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, input.pbv2TreeVersionId), eq(pbv2TreeVersions.productId, product.id), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.schemaVersion, 2),
    )).limit(1);
    return tree ? snapshot(product, tree) : null;
  }

  async createProposal(input: Omit<InactivePbv2QuantityTierProposal, "id">): Promise<InactivePbv2QuantityTierProposal> {
    const [created] = await db.insert(aiConfigurableProductProposals).values({
      orgId: input.organizationId, actorUserId: input.actorUserId, specification: persistedProposal(input), fingerprint: input.fingerprint, status: input.status,
    }).returning();
    if (!created) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_CREATE_FAILED", "Could not persist the quantity-tier proposal.");
    const proposal = parseProposal(created);
    if (!proposal) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_INVALID", "The persisted quantity-tier proposal is invalid.");
    return proposal;
  }

  async getProposal(input: { organizationId: string; proposalId: string }): Promise<InactivePbv2QuantityTierProposal | null> {
    const [row] = await db.select().from(aiConfigurableProductProposals).where(and(
      eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId),
    )).limit(1);
    return row ? parseProposal(row) : null;
  }

  async executeTierReplacementIdempotently(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string; expectedSourceFingerprint: string; idempotencyKey: string; preview: InactivePbv2QuantityTierPreview }): Promise<InactivePbv2QuantityTierExecutionResult> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(aiConfigurableProductProposals).where(and(
        eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, input.proposalId),
      )).limit(1);
      if (!row) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_NOT_FOUND", "The quantity-tier proposal was not found in this organization.");
      const proposal = parseProposal(row);
      if (!proposal || proposal.actorUserId !== input.actorUserId || proposal.fingerprint !== input.proposalFingerprint || proposal.sourceFingerprint !== input.expectedSourceFingerprint) {
        throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_STALE", "The quantity-tier proposal changed; create a new confirmation plan.");
      }
      const result = { productId: proposal.productId, pbv2TreeVersionId: proposal.pbv2TreeVersionId, inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: exactInactiveDraftTierEditorLink(proposal.productId, proposal.pbv2TreeVersionId) };
      if (proposal.status === "succeeded" && row.createdProductId === proposal.productId && row.createdPbv2TreeVersionId === proposal.pbv2TreeVersionId) return { ...result, reused: true };

      const [product] = await tx.select().from(products).where(and(
        eq(products.organizationId, input.organizationId), eq(products.id, proposal.productId), eq(products.isActive, false), isNull(products.pbv2ActiveTreeVersionId),
      )).limit(1);
      const [tree] = product ? await tx.select().from(pbv2TreeVersions).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, proposal.pbv2TreeVersionId), eq(pbv2TreeVersions.productId, proposal.productId), eq(pbv2TreeVersions.status, "DRAFT"), eq(pbv2TreeVersions.schemaVersion, 2),
      )).limit(1) : [];
      if (!product || !tree) throw new InactivePbv2QuantityTierEditError("INACTIVE_DRAFT_NOT_FOUND", "The exact inactive PBV2 DRAFT is no longer available.");
      if (sourceFingerprint(snapshot(product, tree)) !== input.expectedSourceFingerprint) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_SOURCE_STALE", "The inactive PBV2 DRAFT changed; review a new quantity-tier preview.");

      const now = new Date();
      const changed = await tx.update(pbv2TreeVersions).set({ treeJson: replaceTierFamily(tree.treeJson, proposal.preview), updatedAt: now, updatedByUserId: input.actorUserId }).where(and(
        eq(pbv2TreeVersions.organizationId, input.organizationId), eq(pbv2TreeVersions.id, tree.id), eq(pbv2TreeVersions.updatedAt, tree.updatedAt),
      )).returning({ id: pbv2TreeVersions.id });
      if (!changed.length) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_SOURCE_STALE", "The inactive PBV2 DRAFT changed; review a new quantity-tier preview.");
      await tx.update(aiConfigurableProductProposals).set({ status: "succeeded", createdProductId: proposal.productId, createdPbv2TreeVersionId: proposal.pbv2TreeVersionId, idempotencyKey: input.idempotencyKey, updatedAt: now }).where(and(
        eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, proposal.id),
      ));
      return { ...result, reused: false };
    });
  }
}

export function createDrizzleInactivePbv2QuantityTierEditStore(): InactivePbv2QuantityTierEditStore {
  return new DrizzleInactivePbv2QuantityTierEditStore();
}
