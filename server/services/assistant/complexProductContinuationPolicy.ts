export type ConfigurableProductContinuation = {
  id: string;
  conversationId: string | null;
  actorUserId: string | null;
  status: string;
  specification?: unknown;
};

export class ComplexProductContinuationPolicyError extends Error {}

/**
 * Selects the only proposal that may continue a configurable-product chat.
 * The conversation lookup is authoritative; a card proposal ID is merely a
 * consistency check for that same conversation.
 */
export function selectConfigurableProductContinuation(input: {
  conversationId: string;
  actorUserId: string;
  priorProposalId?: string | null;
  conversationProposals: ConfigurableProductContinuation[];
  priorProposal?: ConfigurableProductContinuation | null;
}): ConfigurableProductContinuation | null {
  if (input.conversationProposals.length > 1) {
    throw new ComplexProductContinuationPolicyError("Multiple configurable-product proposals are bound to this conversation; no proposal was updated.");
  }
  const proposal = input.conversationProposals[0] ?? null;
  if (!proposal) {
    if (!input.priorProposalId) return null;
    const referenced = input.priorProposal;
    if (!referenced || referenced.conversationId !== input.conversationId || referenced.actorUserId !== input.actorUserId || referenced.status !== "proposed") {
      throw new ComplexProductContinuationPolicyError("The configurable-product confirmation no longer refers to an editable proposal in this conversation.");
    }
    return referenced;
  }
  if (proposal.actorUserId !== input.actorUserId) {
    throw new ComplexProductContinuationPolicyError("The configurable-product proposal belongs to a different actor and was not updated.");
  }
  if (proposal.status !== "proposed") {
    throw new ComplexProductContinuationPolicyError("The configurable-product proposal is no longer editable and was not updated.");
  }
  if (input.priorProposalId && input.priorProposalId !== proposal.id) {
    throw new ComplexProductContinuationPolicyError("The configurable-product confirmation is stale; no proposal was updated.");
  }
  return proposal;
}
