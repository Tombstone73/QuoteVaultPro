import { z } from "zod";

/**
 * A deliberately narrow, persisted pause between an ambiguous product request
 * and the authoritative command proposal.  This is not a mutation proposal:
 * it has no confirmation token and cannot be executed.
 */
export const productCandidateSelectionOperationSchema = z.enum([
  "clone_inactive_product_draft",
  "replace_inactive_matrix",
  "replace_inactive_quantity_tiers",
]);
export type ProductCandidateSelectionOperation = z.infer<typeof productCandidateSelectionOperationSchema>;

export const productCandidateSelectionCandidateSchema = z.object({
  /** Opaque server-issued identity; drafts use productId:treeId to disambiguate two drafts on one product. */
  candidateId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  isActive: z.boolean(),
  pricingMode: z.string().trim().min(1).nullable(),
  productUpdatedAt: z.string().datetime({ offset: true }),
  pbv2TreeVersionId: z.string().trim().min(1).nullable(),
  pbv2TreeStatus: z.enum(["DRAFT", "ACTIVE", "DEPRECATED", "ARCHIVED"]).nullable(),
  pbv2TreeUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  selectable: z.boolean(),
  blockingReason: z.string().trim().min(1).nullable(),
}).strict();
export type ProductCandidateSelectionCandidate = z.infer<typeof productCandidateSelectionCandidateSchema>;

export const productCandidateSelectionContinuationSchema = z.object({
  id: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  actorUserId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  operation: productCandidateSelectionOperationSchema,
  version: z.literal(1),
  originalMessage: z.string().max(20_000),
  /** Validated, normalized command input, deliberately retained verbatim. */
  requestedChanges: z.record(z.unknown()),
  candidates: z.array(productCandidateSelectionCandidateSchema).min(2).max(100),
  state: z.enum(["pending_selection", "resolved"]),
  selectedCandidateId: z.string().trim().min(1).nullable(),
  resultProposal: z.object({ id: z.string().trim().min(1), fingerprint: z.string().trim().min(1) }).strict().nullable(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type ProductCandidateSelectionContinuation = z.infer<typeof productCandidateSelectionContinuationSchema>;

export class ProductCandidateSelectionContinuationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface ProductCandidateSelectionContinuationStore {
  get(input: { organizationId: string; actorUserId: string; conversationId: string }): Promise<ProductCandidateSelectionContinuation | null>;
  save(input: Omit<ProductCandidateSelectionContinuation, "id"> & { id?: string }): Promise<ProductCandidateSelectionContinuation>;
}

export class ProductCandidateSelectionContinuationService {
  constructor(private readonly store: ProductCandidateSelectionContinuationStore, private readonly now: () => Date = () => new Date()) {}

  async begin(input: Omit<ProductCandidateSelectionContinuation, "id" | "version" | "state" | "selectedCandidateId" | "resultProposal" | "expiresAt"> & { expiresInMs?: number }) {
    const { expiresInMs, ...continuation } = input;
    const expiresAt = new Date(this.now().getTime() + (expiresInMs ?? 30 * 60_000)).toISOString();
    return this.store.save(productCandidateSelectionContinuationSchema.omit({ id: true }).parse({
      ...continuation, version: 1, state: "pending_selection", selectedCandidateId: null, resultProposal: null, expiresAt,
    }));
  }

  async get(input: { organizationId: string; actorUserId: string; conversationId: string }) {
    const continuation = await this.store.get(input);
    return continuation ? productCandidateSelectionContinuationSchema.parse(continuation) : null;
  }

  async select(input: { organizationId: string; actorUserId: string; conversationId: string; candidateId: string; revalidate: (candidate: ProductCandidateSelectionCandidate, operation: ProductCandidateSelectionOperation) => Promise<boolean> }) {
    const continuation = await this.get(input);
    if (!continuation) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_NOT_FOUND", "There is no pending product selection in this conversation.");
    if (new Date(continuation.expiresAt).getTime() <= this.now().getTime()) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_EXPIRED", "The product selection expired; submit the request again.");
    if (continuation.state === "resolved") {
      if (continuation.selectedCandidateId !== input.candidateId || !continuation.resultProposal) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_CONSUMED", "This product selection has already been resolved.");
      return continuation;
    }
    const candidate = continuation.candidates.find((item) => item.candidateId === input.candidateId);
    if (!candidate) throw new ProductCandidateSelectionContinuationError("CANDIDATE_NOT_IN_CONTINUATION", "That product was not one of the candidates shown for this request.");
    if (!candidate.selectable) throw new ProductCandidateSelectionContinuationError("CANDIDATE_NOT_SELECTABLE", candidate.blockingReason ?? "That product cannot be selected for this operation.");
    if (!await input.revalidate(candidate, continuation.operation)) throw new ProductCandidateSelectionContinuationError("CANDIDATE_STALE", "That product or PBV2 tree changed and can no longer be selected safely. Submit the request again.");
    return this.store.save({ ...continuation, state: "resolved", selectedCandidateId: candidate.candidateId });
  }

  async attachResult(input: { organizationId: string; actorUserId: string; conversationId: string; candidateId: string; proposalId: string; proposalFingerprint: string }) {
    const continuation = await this.get(input);
    if (!continuation || continuation.state !== "resolved" || continuation.selectedCandidateId !== input.candidateId) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_STATE_INVALID", "The product selection is not ready to resume.");
    if (continuation.resultProposal) return continuation;
    return this.store.save(productCandidateSelectionContinuationSchema.parse({ ...continuation, resultProposal: { id: input.proposalId, fingerprint: input.proposalFingerprint } }));
  }
}
