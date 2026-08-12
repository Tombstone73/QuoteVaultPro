import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProductOptionPricingMatrix } from "@shared/productOptionPricingMatrix";
import { CanonicalProductPricingError, validateCanonicalPricingMatrixReplacement } from "../products/canonicalProductPricingOperations";

/** Reserved command identity for the assistant integration layer. */
export const inactivePbv2PricingMatrixEditAction = "products.update_inactive_draft_matrix" as const;

/**
 * This is intentionally a narrow proposal/execution boundary instead of a
 * general PBV2 patch. A caller must replace the complete effective pricing
 * matrix for one exact, inactive PBV2 DRAFT snapshot. Production persistence
 * can implement the injected store transaction without introducing another
 * competing product-draft write path.
 */
const jsonRecordSchema = z.record(z.unknown());

export const inactivePbv2PricingMatrixRowSchema = z.object({
  id: z.string().trim().min(1).max(255).optional(),
  when: jsonRecordSchema.optional(),
  match: jsonRecordSchema.optional(),
  combination: jsonRecordSchema.optional(),
  variables: jsonRecordSchema.optional(),
  values: jsonRecordSchema.optional(),
  qtyTiers: z.array(jsonRecordSchema).max(10_000).optional(),
  tierBasis: z.enum(["line_item_quantity", "computed_sheet_usage", "product_default"]).optional(),
}).passthrough().superRefine((row, ctx) => {
  const matches = [row.when, row.match, row.combination].filter((value) => value !== undefined);
  if (matches.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each pricing matrix row must specify exactly one of when, match, or combination." });
  }
});

export const inactivePbv2PricingMatrixReplacementSchema = z.object({
  id: z.string().trim().min(1).max(255).optional(),
  dimensions: z.array(z.string().trim().min(1).max(128)).min(1).max(12),
  rows: z.array(inactivePbv2PricingMatrixRowSchema).min(1).max(10_000),
}).strict().superRefine((matrix, ctx) => {
  if (new Set(matrix.dimensions).size !== matrix.dimensions.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensions"], message: "Pricing matrix dimensions must be unique." });
  }
});
export type InactivePbv2PricingMatrixReplacement = z.infer<typeof inactivePbv2PricingMatrixReplacementSchema>;

export const inactivePbv2PricingMatrixSourceSnapshotSchema = z.object({
  organizationId: z.string().trim().min(1),
  product: z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1).max(255),
    isActive: z.literal(false),
    pbv2ActiveTreeVersionId: z.null(),
  }).strict(),
  pbv2Tree: z.object({
    id: z.string().trim().min(1),
    productId: z.string().trim().min(1),
    status: z.literal("DRAFT"),
    schemaVersion: z.literal(2),
    updatedAt: z.string().datetime({ offset: true }),
    treeJson: jsonRecordSchema,
  }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.product.id !== snapshot.pbv2Tree.productId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pbv2Tree", "productId"], message: "PBV2 tree must belong to the bound product." });
  }
});
export type InactivePbv2PricingMatrixSourceSnapshot = z.infer<typeof inactivePbv2PricingMatrixSourceSnapshotSchema>;

export type InactivePbv2PricingMatrixLocation = "tree.pricingMatrix" | "tree.meta.pricingMatrix";

export const inactivePbv2PricingMatrixPreviewSchema = z.object({
  source: inactivePbv2PricingMatrixSourceSnapshotSchema,
  location: z.enum(["tree.pricingMatrix", "tree.meta.pricingMatrix"]),
  before: inactivePbv2PricingMatrixReplacementSchema,
  after: inactivePbv2PricingMatrixReplacementSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  editorLink: z.string().startsWith("/products/"),
}).strict();
export type InactivePbv2PricingMatrixPreview = z.infer<typeof inactivePbv2PricingMatrixPreviewSchema>;

export const inactivePbv2PricingMatrixProposalSchema = z.object({
  id: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  actorUserId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  pbv2TreeVersionId: z.string().trim().min(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  preview: inactivePbv2PricingMatrixPreviewSchema,
  status: z.enum(["proposed", "succeeded"]),
}).strict();
export type InactivePbv2PricingMatrixProposal = z.infer<typeof inactivePbv2PricingMatrixProposalSchema>;

export const inactivePbv2PricingMatrixExecutionResultSchema = z.object({
  productId: z.string().trim().min(1),
  pbv2TreeVersionId: z.string().trim().min(1),
  inactive: z.literal(true),
  pbv2Status: z.literal("DRAFT"),
  editorLink: z.string().startsWith("/products/"),
  reused: z.boolean(),
}).strict().superRefine((result, ctx) => {
  const expected = exactDraftEditorLink(result.productId, result.pbv2TreeVersionId);
  if (result.editorLink !== expected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editorLink"], message: "The result must link to the exact edited PBV2 DRAFT tree." });
  }
});
export type InactivePbv2PricingMatrixExecutionResult = z.infer<typeof inactivePbv2PricingMatrixExecutionResultSchema>;

export class InactivePbv2PricingMatrixEditError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface InactivePbv2PricingMatrixEditStore {
  loadSource(input: { organizationId: string; productId: string; pbv2TreeVersionId: string }): Promise<InactivePbv2PricingMatrixSourceSnapshot | null>;
  createProposal(input: Omit<InactivePbv2PricingMatrixProposal, "id">): Promise<InactivePbv2PricingMatrixProposal>;
  getProposal(input: { organizationId: string; proposalId: string }): Promise<InactivePbv2PricingMatrixProposal | null>;
  /** Must run atomically: reload the exact inactive product/DRAFT tree,
   * compare expectedSourceFingerprint, write only the replacement matrix at
   * the planned location, and persist/reuse the result by idempotencyKey. */
  executeReplacementIdempotently(input: {
    organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string;
    expectedSourceFingerprint: string; idempotencyKey: string; preview: InactivePbv2PricingMatrixPreview;
  }): Promise<InactivePbv2PricingMatrixExecutionResult>;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function cloneJson<T>(value: T): T {
  const structured = globalThis.structuredClone as ((input: T) => T) | undefined;
  return structured ? structured(value) : JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function matrixAt(treeJson: Record<string, unknown>): { location: InactivePbv2PricingMatrixLocation; matrix: unknown } {
  if (Object.prototype.hasOwnProperty.call(treeJson, "pricingMatrix")) return { location: "tree.pricingMatrix", matrix: treeJson.pricingMatrix };
  const meta = asRecord(treeJson.meta);
  if (meta && Object.prototype.hasOwnProperty.call(meta, "pricingMatrix")) return { location: "tree.meta.pricingMatrix", matrix: meta.pricingMatrix };
  throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_NOT_FOUND", "The bound PBV2 DRAFT does not have a pricing matrix to replace.");
}

function requireCompleteReplacement(treeJson: Record<string, unknown>, replacement: InactivePbv2PricingMatrixReplacement): ProductOptionPricingMatrix {
  try {
    return validateCanonicalPricingMatrixReplacement(treeJson, replacement);
  } catch (error) {
    if (error instanceof CanonicalProductPricingError) throw new InactivePbv2PricingMatrixEditError(error.code, error.message);
    throw error;
  }
}

/** Shared with the transactional store so the write boundary repeats the exact
 * snapshot check performed during plan creation. */
export function inactivePbv2PricingMatrixSourceFingerprint(source: InactivePbv2PricingMatrixSourceSnapshot): string {
  return fingerprint(source);
}

export function exactDraftEditorLink(productId: string, pbv2TreeVersionId: string): string {
  return `/products/${encodeURIComponent(productId)}/edit?draftTreeVersionId=${encodeURIComponent(pbv2TreeVersionId)}`;
}

export class InactivePbv2PricingMatrixEditService {
  constructor(private readonly store: InactivePbv2PricingMatrixEditStore) {}

  async prepareProposal(input: { organizationId: string; actorUserId: string; productId: string; pbv2TreeVersionId: string; replacement: InactivePbv2PricingMatrixReplacement }): Promise<InactivePbv2PricingMatrixProposal> {
    const replacement = inactivePbv2PricingMatrixReplacementSchema.parse(input.replacement);
    const loaded = await this.store.loadSource({ organizationId: input.organizationId, productId: input.productId, pbv2TreeVersionId: input.pbv2TreeVersionId });
    if (!loaded) throw new InactivePbv2PricingMatrixEditError("INACTIVE_DRAFT_NOT_FOUND", "The exact inactive PBV2 DRAFT was not found in this organization.");
    const source = inactivePbv2PricingMatrixSourceSnapshotSchema.parse(loaded);
    if (source.organizationId !== input.organizationId || source.product.id !== input.productId || source.pbv2Tree.id !== input.pbv2TreeVersionId) {
      throw new InactivePbv2PricingMatrixEditError("INACTIVE_DRAFT_BINDING_INVALID", "The PBV2 DRAFT could not be bound exactly to this organization and product.");
    }
    const current = matrixAt(source.pbv2Tree.treeJson);
    const before = inactivePbv2PricingMatrixReplacementSchema.parse(current.matrix);
    const after = inactivePbv2PricingMatrixReplacementSchema.parse(requireCompleteReplacement(source.pbv2Tree.treeJson, replacement));
    if (stable(before) === stable(after)) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_NO_CHANGES", "The requested pricing-matrix replacement already matches this PBV2 DRAFT.");
    const sourceHash = inactivePbv2PricingMatrixSourceFingerprint(source);
    const preview = inactivePbv2PricingMatrixPreviewSchema.parse({
      source: cloneJson(source), location: current.location, before: cloneJson(before), after: cloneJson(after), sourceFingerprint: sourceHash,
      proposalFingerprint: fingerprint({ sourceHash, location: current.location, before, after }), editorLink: exactDraftEditorLink(source.product.id, source.pbv2Tree.id),
    });
    return this.store.createProposal({
      organizationId: input.organizationId, actorUserId: input.actorUserId, productId: source.product.id, pbv2TreeVersionId: source.pbv2Tree.id,
      sourceFingerprint: sourceHash, fingerprint: preview.proposalFingerprint, preview, status: "proposed",
    });
  }

  private async requireBoundProposal(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string }): Promise<InactivePbv2PricingMatrixProposal> {
    const proposal = await this.store.getProposal({ organizationId: input.organizationId, proposalId: input.proposalId });
    if (!proposal) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_PROPOSAL_NOT_FOUND", "The pricing-matrix proposal was not found in this organization.");
    const parsed = inactivePbv2PricingMatrixProposalSchema.parse(proposal);
    if (parsed.organizationId !== input.organizationId || parsed.actorUserId !== input.actorUserId) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_PROPOSAL_ACTOR_MISMATCH", "This pricing-matrix proposal is bound to a different actor or organization.");
    if (parsed.fingerprint !== input.proposalFingerprint || parsed.preview.proposalFingerprint !== input.proposalFingerprint) throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_PROPOSAL_STALE", "The pricing-matrix proposal changed; create a new confirmation plan.");
    return parsed;
  }

  async revalidateProposal(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string }): Promise<InactivePbv2PricingMatrixProposal> {
    const proposal = await this.requireBoundProposal(input);
    if (proposal.status === "succeeded") return proposal;
    const loaded = await this.store.loadSource({ organizationId: input.organizationId, productId: proposal.productId, pbv2TreeVersionId: proposal.pbv2TreeVersionId });
    if (!loaded) throw new InactivePbv2PricingMatrixEditError("INACTIVE_DRAFT_NOT_FOUND", "The exact inactive PBV2 DRAFT is no longer available.");
    const current = inactivePbv2PricingMatrixSourceSnapshotSchema.parse(loaded);
    if (current.organizationId !== input.organizationId || current.product.id !== proposal.productId || current.pbv2Tree.id !== proposal.pbv2TreeVersionId || inactivePbv2PricingMatrixSourceFingerprint(current) !== proposal.sourceFingerprint) {
      throw new InactivePbv2PricingMatrixEditError("PBV2_MATRIX_SOURCE_STALE", "The inactive PBV2 DRAFT changed; review a new pricing-matrix preview.");
    }
    return proposal;
  }

  async execute(input: { organizationId: string; actorUserId: string; proposalId: string; proposalFingerprint: string; idempotencyKey: string }): Promise<InactivePbv2PricingMatrixExecutionResult> {
    const proposal = await this.revalidateProposal(input);
    return inactivePbv2PricingMatrixExecutionResultSchema.parse(await this.store.executeReplacementIdempotently({
      organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: proposal.id, proposalFingerprint: proposal.fingerprint,
      expectedSourceFingerprint: proposal.sourceFingerprint, idempotencyKey: input.idempotencyKey, preview: proposal.preview,
    }));
  }
}
