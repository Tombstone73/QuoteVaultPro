import { describe, expect, test } from "@jest/globals";
import { selectProductQueryCandidate } from "../services/assistant/productIdentityResolution";
import { replaceCanonicalProposalCards } from "../services/assistant/canonicalProductIntentCardPersistence";

describe("assistant Product identity and canonical action persistence", () => {
  test("prefers one exact case-insensitive Product name over fuzzy candidates", () => {
    const exact = { id: "product-b", name: "Coroplast Signs" };
    expect(selectProductQueryCandidate([{ id: "product-a", name: "Legacy Coroplast Signs" }, exact], " coroplast signs ")).toEqual({ resolution: "resolved", candidate: exact });
  });

  test("fails closed when a Product query has multiple fuzzy matches and no exact name", () => {
    expect(selectProductQueryCandidate([{ name: "Banner 13 oz" }, { name: "Banner 18 oz" }], "Banner")).toEqual({ resolution: "ambiguous" });
    expect(selectProductQueryCandidate([], "Missing")).toEqual({ resolution: "not_found" });
  });

  test("supersedes one canonical proposal revision while preserving unrelated turn cards", () => {
    const proposalId = "11111111-1111-4111-8111-111111111111";
    const unrelated = { kind: "notice", title: "Keep", summary: "Unrelated", sourceLinks: [] } as any;
    const latest = [
      { kind: "canonical_product_intent_proposal", title: "Revision 5", summary: "Ready", sourceLinks: [], details: { proposalId } },
      { kind: "action_proposal", title: "Review revision 5", summary: "Review", sourceLinks: [], plan: { action: "products.create_from_canonical_intent", proposalId, revision: 5 } },
    ] as any;
    const result = replaceCanonicalProposalCards([
      unrelated,
      { kind: "canonical_product_intent_proposal", details: { proposalId } },
      { kind: "action_proposal", plan: { action: "products.create_from_canonical_intent", proposalId, revision: 4 } },
    ], proposalId, latest);

    expect(result).toEqual([unrelated, ...latest]);
  });
});
