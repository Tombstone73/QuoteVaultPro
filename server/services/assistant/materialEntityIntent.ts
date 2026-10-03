/**
 * Entity nouns are a server-owned routing constraint, not a provider hint.
 * A Material request must never be allowed to open a Product Builder draft
 * merely because both domains mention pricing or inventory.
 */
export type ExplicitCreationEntity = "material" | "product" | null;

const productNoun = /\b(?:product|products|catalog\s+item)\b/i;
const materialNoun = /\b(?:material|materials|inventory\s+material|ink|substrate)\b/i;
const creationVerb = /\b(?:add|create|make|new)\b/i;

export function resolveExplicitCreationEntity(message: string): ExplicitCreationEntity {
  const value = String(message ?? "").trim();
  if (!value || !creationVerb.test(value)) return null;

  // A named Product is authoritative even when it names or uses a material.
  if (productNoun.test(value)) return "product";
  if (materialNoun.test(value)) return "material";
  return null;
}
