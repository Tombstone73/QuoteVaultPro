import type { AssistantStructuredCard } from "@shared/assistantContracts";

function canonicalProposalId(card: unknown): string | null {
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const value = card as { kind?: unknown; details?: { proposalId?: unknown }; plan?: { action?: unknown; proposalId?: unknown } };
  if (value.kind === "canonical_product_intent_proposal" && typeof value.details?.proposalId === "string") return value.details.proposalId;
  if (value.kind === "action_proposal" && value.plan?.action === "products.create_from_canonical_intent" && typeof value.plan.proposalId === "string") return value.plan.proposalId;
  return null;
}

export function replaceCanonicalProposalCards(existing: unknown, proposalId: string, replacement: AssistantStructuredCard[]): AssistantStructuredCard[] {
  const retained = Array.isArray(existing) ? existing.filter((card) => canonicalProposalId(card) !== proposalId) : [];
  return [...retained, ...replacement] as AssistantStructuredCard[];
}

export function hasCanonicalProposalCard(cards: unknown, proposalId: string): boolean {
  return Array.isArray(cards) && cards.some((card) => canonicalProposalId(card) === proposalId);
}
