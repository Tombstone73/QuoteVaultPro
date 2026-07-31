import { and, eq } from "drizzle-orm";
import { aiConfigurableProductProposals } from "@shared/schema";
import { db } from "../../db";
import {
  ProductCandidateSelectionContinuationError,
  productCandidateSelectionContinuationSchema,
  type ProductCandidateSelectionContinuation,
  type ProductCandidateSelectionContinuationStore,
} from "./productCandidateSelectionContinuation";

const kind = "product_candidate_selection_continuation" as const;
const version = 1 as const;
type Envelope = { kind: typeof kind; version: typeof version; continuation: Omit<ProductCandidateSelectionContinuation, "id"> };

function parse(row: typeof aiConfigurableProductProposals.$inferSelect): ProductCandidateSelectionContinuation | null {
  const value = row.specification as Partial<Envelope>;
  if (value.kind !== kind || value.version !== version || !value.continuation) return null;
  const parsed = productCandidateSelectionContinuationSchema.safeParse({ id: row.id, ...value.continuation });
  return parsed.success ? parsed.data : null;
}

/** Reuses the canonical proposal row keyed by conversation. It never overwrites
 * a configurable-product proposal; callers receive a safe clarification. */
export class DrizzleProductCandidateSelectionContinuationStore implements ProductCandidateSelectionContinuationStore {
  async get(input: { organizationId: string; actorUserId: string; conversationId: string }) {
    const [row] = await db.select().from(aiConfigurableProductProposals).where(and(
      eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.conversationId, input.conversationId),
    )).limit(1);
    const continuation = row ? parse(row) : null;
    return continuation?.actorUserId === input.actorUserId ? continuation : null;
  }

  async save(input: Omit<ProductCandidateSelectionContinuation, "id"> & { id?: string }) {
    const { id: continuationId, ...continuation } = input;
    const existing = continuationId
      ? (await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, continuationId), eq(aiConfigurableProductProposals.conversationId, input.conversationId))).limit(1))[0]
      : (await db.select().from(aiConfigurableProductProposals).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.conversationId, input.conversationId))).limit(1))[0];
    const specification: Envelope = { kind, version, continuation };
    if (existing) {
      const parsed = parse(existing);
      if (!parsed) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_CONVERSATION_BUSY", "This conversation already has a different product proposal; start the selection in a new conversation.");
      if (parsed.actorUserId !== input.actorUserId) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_ACTOR_MISMATCH", "This product selection belongs to another actor.");
      const [updated] = await db.update(aiConfigurableProductProposals).set({ specification, fingerprint: `${kind}:v${version}`, status: "proposed", updatedAt: new Date() }).where(and(eq(aiConfigurableProductProposals.orgId, input.organizationId), eq(aiConfigurableProductProposals.id, existing.id))).returning();
      const result = updated && parse(updated);
      if (!result) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_SAVE_FAILED", "Could not save the product selection.");
      return result;
    }
    const [created] = await db.insert(aiConfigurableProductProposals).values({ orgId: input.organizationId, conversationId: input.conversationId, actorUserId: input.actorUserId, specification, fingerprint: `${kind}:v${version}`, status: "proposed" }).returning();
    const result = created && parse(created);
    if (!result) throw new ProductCandidateSelectionContinuationError("CANDIDATE_CONTINUATION_SAVE_FAILED", "Could not save the product selection.");
    return result;
  }
}

export function createDrizzleProductCandidateSelectionContinuationStore(): ProductCandidateSelectionContinuationStore {
  return new DrizzleProductCandidateSelectionContinuationStore();
}
