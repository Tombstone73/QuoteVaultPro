import { createHash } from "node:crypto";
import { z } from "zod";
import { pricingV2TierSchema } from "@shared/optionTreeV2";
import { CanonicalProductPricingError, validateCanonicalPricingTierReplacement } from "../products/canonicalProductPricingOperations";

/** Reserved assistant command identity; route wiring is intentionally separate. */
export const inactivePbv2QuantityTierEditAction = "products.update_inactive_draft_tiers" as const;

export const inactivePbv2TierSetSchema = z.object({
  tierType: z.enum(["qtyTiers", "sqftTiers"]),
  tiers: z.array(pricingV2TierSchema).min(1).max(1_000),
}).strict();
export type InactivePbv2TierSet = z.infer<typeof inactivePbv2TierSetSchema>;
/** The source side of a creation preview may legitimately be empty. */
export const inactivePbv2TierSnapshotSchema = z.object({
  tierType: z.enum(["qtyTiers", "sqftTiers"]),
  tiers: z.array(pricingV2TierSchema).max(1_000),
}).strict();
export type InactivePbv2TierSnapshot = z.infer<typeof inactivePbv2TierSnapshotSchema>;

export const inactivePbv2QuantityTierSourceSnapshotSchema = z.object({
  organizationId: z.string().trim().min(1),
  product: z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1), isActive: z.literal(false), pbv2ActiveTreeVersionId: z.null() }).strict(),
  pbv2Tree: z.object({ id: z.string().trim().min(1), productId: z.string().trim().min(1), status: z.literal("DRAFT"), schemaVersion: z.literal(2), updatedAt: z.string().datetime({ offset: true }), treeJson: z.record(z.unknown()) }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.product.id !== snapshot.pbv2Tree.productId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pbv2Tree", "productId"], message: "PBV2 tree must belong to the bound product." });
});
export type InactivePbv2QuantityTierSourceSnapshot = z.infer<typeof inactivePbv2QuantityTierSourceSnapshotSchema>;

export const inactivePbv2QuantityTierPreviewSchema = z.object({
  source: inactivePbv2QuantityTierSourceSnapshotSchema,
  before: inactivePbv2TierSnapshotSchema,
  after: inactivePbv2TierSetSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  editorLink: z.string().startsWith("/products/"),
}).strict();
export type InactivePbv2QuantityTierPreview = z.infer<typeof inactivePbv2QuantityTierPreviewSchema>;

export const inactivePbv2QuantityTierProposalSchema = z.object({
  id: z.string().trim().min(1), organizationId: z.string().trim().min(1), actorUserId: z.string().trim().min(1), productId: z.string().trim().min(1), pbv2TreeVersionId: z.string().trim().min(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i), fingerprint: z.string().regex(/^[a-f0-9]{64}$/i), preview: inactivePbv2QuantityTierPreviewSchema, status: z.enum(["proposed", "succeeded"]),
}).strict();
export type InactivePbv2QuantityTierProposal = z.infer<typeof inactivePbv2QuantityTierProposalSchema>;

export const inactivePbv2QuantityTierExecutionResultSchema = z.object({
  productId: z.string().trim().min(1), pbv2TreeVersionId: z.string().trim().min(1), inactive: z.literal(true), pbv2Status: z.literal("DRAFT"), editorLink: z.string().startsWith("/products/"), reused: z.boolean(),
}).strict().superRefine((result, ctx) => {
  if (result.editorLink !== exactInactiveDraftTierEditorLink(result.productId, result.pbv2TreeVersionId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editorLink"], message: "The result must link to the exact PBV2 DRAFT tree." });
});
export type InactivePbv2QuantityTierExecutionResult = z.infer<typeof inactivePbv2QuantityTierExecutionResultSchema>;

export class InactivePbv2QuantityTierEditError extends Error { constructor(readonly code: string, message: string) { super(message); } }

export interface InactivePbv2QuantityTierEditStore {
  loadSource(input: { organizationId: string; productId: string; pbv2TreeVersionId: string }): Promise<InactivePbv2QuantityTierSourceSnapshot | null>;
  createProposal(input: Omit<InactivePbv2QuantityTierProposal, "id">): Promise<InactivePbv2QuantityTierProposal>;
  getProposal(input: { organizationId: string; proposalId: string }): Promise<InactivePbv2QuantityTierProposal | null>;
  /** Atomic transaction: lock/reload org + inactive product + exact DRAFT,
   * compare fingerprint, replace only meta.pricingV2[tierType], update the
   * draft timestamp, and persist/reuse the result by idempotency key. */
  executeTierReplacementIdempotently(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string; expectedSourceFingerprint: string; idempotencyKey: string; preview: InactivePbv2QuantityTierPreview }): Promise<InactivePbv2QuantityTierExecutionResult>;
}

function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`; }
function fingerprint(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function cloneJson<T>(value: T): T { const structured = globalThis.structuredClone as ((input: T) => T) | undefined; return structured ? structured(value) : JSON.parse(JSON.stringify(value)) as T; }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

function tierSetAt(treeJson: Record<string, unknown>, tierType: InactivePbv2TierSet["tierType"]): InactivePbv2TierSnapshot {
  const pricing = asRecord(asRecord(treeJson.meta)?.pricingV2);
  const tiers = pricing?.[tierType];
  // A full replacement may also create the requested tier family.  The
  // preview still records the empty prior set, and the executor may only add
  // that one declared key under the bound DRAFT's canonical pricingV2 block.
  if (tiers === undefined) return inactivePbv2TierSnapshotSchema.parse({ tierType, tiers: [] });
  if (!Array.isArray(tiers)) throw new InactivePbv2QuantityTierEditError("PBV2_TIERS_INVALID", `The bound PBV2 DRAFT has an invalid ${tierType} value.`);
  return inactivePbv2TierSnapshotSchema.parse({ tierType, tiers });
}

/** Canonical PricingV2 tiers are lower-bound ranges. Requiring a first bound
 * of 1 and strict ascending bounds means each implicit range starts exactly
 * where the prior range ends, with no overlap or unpriced starting range. */
function validateCompleteTierReplacement(set: InactivePbv2TierSet): InactivePbv2TierSet {
  try {
    return validateCanonicalPricingTierReplacement(set);
  } catch (error) {
    if (error instanceof CanonicalProductPricingError) throw new InactivePbv2QuantityTierEditError(error.code, error.message);
    throw error;
  }
}

function sourceFingerprint(source: InactivePbv2QuantityTierSourceSnapshot): string { return fingerprint(source); }
export function exactInactiveDraftTierEditorLink(productId: string, pbv2TreeVersionId: string): string { return `/products/${encodeURIComponent(productId)}/edit?draftTreeVersionId=${encodeURIComponent(pbv2TreeVersionId)}`; }

export class InactivePbv2QuantityTierEditService {
  constructor(private readonly store: InactivePbv2QuantityTierEditStore) {}

  async prepareProposal(input: { organizationId: string; actorUserId: string; productId: string; pbv2TreeVersionId: string; replacement: InactivePbv2TierSet }): Promise<InactivePbv2QuantityTierProposal> {
    const replacement = validateCompleteTierReplacement(inactivePbv2TierSetSchema.parse(input.replacement));
    const loaded = await this.store.loadSource({ organizationId: input.organizationId, productId: input.productId, pbv2TreeVersionId: input.pbv2TreeVersionId });
    if (!loaded) throw new InactivePbv2QuantityTierEditError("INACTIVE_DRAFT_NOT_FOUND", "The exact inactive PBV2 DRAFT was not found in this organization.");
    const source = inactivePbv2QuantityTierSourceSnapshotSchema.parse(loaded);
    if (source.organizationId !== input.organizationId || source.product.id !== input.productId || source.pbv2Tree.id !== input.pbv2TreeVersionId) throw new InactivePbv2QuantityTierEditError("INACTIVE_DRAFT_BINDING_INVALID", "The PBV2 DRAFT could not be bound exactly to this organization and product.");
    const before = tierSetAt(source.pbv2Tree.treeJson, replacement.tierType);
    if (stable(before) === stable(replacement)) throw new InactivePbv2QuantityTierEditError("PBV2_TIERS_NO_CHANGES", "The requested quantity tiers already match this PBV2 DRAFT.");
    const sourceHash = sourceFingerprint(source);
    const preview = inactivePbv2QuantityTierPreviewSchema.parse({ source: cloneJson(source), before, after: replacement, sourceFingerprint: sourceHash, proposalFingerprint: fingerprint({ sourceHash, before, replacement }), editorLink: exactInactiveDraftTierEditorLink(source.product.id, source.pbv2Tree.id) });
    return this.store.createProposal({ organizationId: input.organizationId, actorUserId: input.actorUserId, productId: source.product.id, pbv2TreeVersionId: source.pbv2Tree.id, sourceFingerprint: sourceHash, fingerprint: preview.proposalFingerprint, preview, status: "proposed" });
  }

  private async requireBoundProposal(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string }) {
    const proposal = await this.store.getProposal({ organizationId: input.organizationId, proposalId: input.proposalId });
    if (!proposal) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_NOT_FOUND", "The quantity-tier proposal was not found in this organization.");
    const parsed = inactivePbv2QuantityTierProposalSchema.parse(proposal);
    if (parsed.organizationId !== input.organizationId || parsed.actorUserId !== input.actorUserId) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_ACTOR_MISMATCH", "This quantity-tier proposal is bound to a different actor or organization.");
    if (parsed.fingerprint !== input.proposalFingerprint || parsed.preview.proposalFingerprint !== input.proposalFingerprint) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_PROPOSAL_STALE", "The quantity-tier proposal changed; create a new confirmation plan.");
    return parsed;
  }

  async revalidateProposal(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string }): Promise<InactivePbv2QuantityTierProposal> {
    const proposal = await this.requireBoundProposal(input); if (proposal.status === "succeeded") return proposal;
    const loaded = await this.store.loadSource({ organizationId: input.organizationId, productId: proposal.productId, pbv2TreeVersionId: proposal.pbv2TreeVersionId });
    if (!loaded) throw new InactivePbv2QuantityTierEditError("INACTIVE_DRAFT_NOT_FOUND", "The exact inactive PBV2 DRAFT is no longer available.");
    const current = inactivePbv2QuantityTierSourceSnapshotSchema.parse(loaded);
    if (current.organizationId !== input.organizationId || current.product.id !== proposal.productId || current.pbv2Tree.id !== proposal.pbv2TreeVersionId || sourceFingerprint(current) !== proposal.sourceFingerprint) throw new InactivePbv2QuantityTierEditError("PBV2_TIER_SOURCE_STALE", "The inactive PBV2 DRAFT changed; review a new quantity-tier preview.");
    return proposal;
  }

  async execute(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string; idempotencyKey: string }): Promise<InactivePbv2QuantityTierExecutionResult> {
    const proposal = await this.revalidateProposal(input);
    return inactivePbv2QuantityTierExecutionResultSchema.parse(await this.store.executeTierReplacementIdempotently({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, expectedSourceFingerprint: proposal.sourceFingerprint, idempotencyKey: input.idempotencyKey, preview: proposal.preview }));
  }
}
