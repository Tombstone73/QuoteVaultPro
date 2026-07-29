import { ComplexProductContinuationPolicyError, selectConfigurableProductContinuation } from "../services/assistant/complexProductContinuationPolicy";

const current = { id: "proposal_1", conversationId: "conversation_1", actorUserId: "user_1", status: "proposed" };

describe("selectConfigurableProductContinuation", () => {
  it("recovers the single editable proposal bound to the canonical conversation", () => {
    expect(selectConfigurableProductContinuation({ conversationId: "conversation_1", actorUserId: "user_1", priorProposalId: "proposal_1", conversationProposals: [current] })).toBe(current);
  });

  it("fails safely when a card proposal belongs to another conversation", () => {
    expect(() => selectConfigurableProductContinuation({ conversationId: "conversation_2", actorUserId: "user_1", priorProposalId: "proposal_1", conversationProposals: [], priorProposal: current })).toThrow(ComplexProductContinuationPolicyError);
  });

  it("does not recover a proposal for another actor or tenant-scoped lookup", () => {
    expect(() => selectConfigurableProductContinuation({ conversationId: "conversation_1", actorUserId: "user_2", conversationProposals: [current] })).toThrow(ComplexProductContinuationPolicyError);
    expect(() => selectConfigurableProductContinuation({ conversationId: "conversation_1", actorUserId: "user_1", priorProposalId: "proposal_1", conversationProposals: [], priorProposal: null })).toThrow(ComplexProductContinuationPolicyError);
  });

  it("does not reuse a completed proposal", () => {
    expect(() => selectConfigurableProductContinuation({ conversationId: "conversation_1", actorUserId: "user_1", conversationProposals: [{ ...current, status: "succeeded" }] })).toThrow(ComplexProductContinuationPolicyError);
  });

  it("fails closed when a conversation has ambiguous in-progress proposals", () => {
    expect(() => selectConfigurableProductContinuation({ conversationId: "conversation_1", actorUserId: "user_1", conversationProposals: [current, { ...current, id: "proposal_2" }] })).toThrow(ComplexProductContinuationPolicyError);
  });
});
