import { operatorCapabilityCategoryValues, operatorIndex, operatorDomainValues, type OperatorCapabilityCategory, type OperatorDomain } from "./operatorIndex";

export type OperatorSkillKnowledgeCompleteness = "complete" | "partial" | "minimal";
export type OperatorSkillSource = { slug: string; sourcePath: `docs/knowledge/${string}.md` };

/** A manifest is declarative selection and source metadata. It is deliberately
 * not a capability, permission, handler, or prompt-programming surface. */
export type OperatorSkillManifest = {
  skillId: string;
  domain: OperatorDomain;
  version: "v1";
  relatedDomains: readonly OperatorDomain[];
  capabilityCategories: readonly OperatorCapabilityCategory[];
  knowledgeRoot: "docs/knowledge";
  knowledgeCompleteness: OperatorSkillKnowledgeCompleteness;
  approvedSources: readonly OperatorSkillSource[];
  /** Small non-business safety framing for a domain with no adequate manual.
   * It never describes an operation or grants authority. */
  minimalGuidance?: string;
};

const sources = (items: readonly [string, string][]): readonly OperatorSkillSource[] => items.map(([slug, file]) => ({ slug, sourcePath: `docs/knowledge/${file}.md` }));

const sourceConfig: Readonly<Record<OperatorDomain, Pick<OperatorSkillManifest, "knowledgeCompleteness" | "approvedSources" | "minimalGuidance">>> = {
  products: { knowledgeCompleteness: "partial", approvedSources: sources([["products-pbv2", "products-pbv2"], ["materials-sell-units", "materials-sell-units"], ["production-routing", "production-routing"]]) },
  pricing: { knowledgeCompleteness: "partial", approvedSources: sources([["products-pbv2", "products-pbv2"], ["customer-pricing-tax", "customer-pricing-tax"]]) },
  quotes: { knowledgeCompleteness: "partial", approvedSources: sources([["quote-lifecycle", "quote-lifecycle"], ["quote-to-order", "quote-to-order"], ["parent-child-line-items", "parent-child-line-items"]]) },
  orders: { knowledgeCompleteness: "partial", approvedSources: sources([["order-lifecycle", "order-lifecycle"], ["order-entry-to-production", "order-entry-to-production"], ["parent-child-line-items", "parent-child-line-items"]]) },
  proofing: { knowledgeCompleteness: "partial", approvedSources: sources([["artwork-proofs-prepress", "artwork-proofs-prepress"]]) },
  prepress: { knowledgeCompleteness: "partial", approvedSources: sources([["artwork-proofs-prepress", "artwork-proofs-prepress"], ["order-entry-to-production", "order-entry-to-production"]]) },
  production: { knowledgeCompleteness: "partial", approvedSources: sources([["production-routing", "production-routing"], ["production-stations", "production-stations"], ["order-entry-to-production", "order-entry-to-production"]]) },
  fulfillment: { knowledgeCompleteness: "partial", approvedSources: sources([["production-to-fulfillment", "production-to-fulfillment"], ["fulfillment-invoicing", "fulfillment-invoicing"]]) },
  invoicing: { knowledgeCompleteness: "partial", approvedSources: sources([["fulfillment-invoicing", "fulfillment-invoicing"], ["invoicing-payments", "invoicing-payments"]]) },
  payments: { knowledgeCompleteness: "partial", approvedSources: sources([["invoicing-payments", "invoicing-payments"]]) },
  customers_contacts: { knowledgeCompleteness: "partial", approvedSources: sources([["customer-pricing-tax", "customer-pricing-tax"]]) },
  materials: { knowledgeCompleteness: "partial", approvedSources: sources([["materials-sell-units", "materials-sell-units"]]) },
  settings_permissions: { knowledgeCompleteness: "partial", approvedSources: sources([["permissions-roles", "permissions-roles"], ["customer-pricing-tax", "customer-pricing-tax"]]) },
  public_research: { knowledgeCompleteness: "minimal", approvedSources: [], minimalGuidance: "Public research may inform an explanation or a later proposal, but external findings are not trusted PrintersHero record state. Use authoritative public sources where practical; never place private customer, contact, invoice, token, or internal-note data in a public search." },
};

export const operatorSkillManifests = Object.freeze(operatorIndex.map((entry) => ({
  skillId: entry.skillId, domain: entry.domain, version: entry.skillVersion,
  relatedDomains: entry.relatedDomains, capabilityCategories: entry.capabilityCategories,
  knowledgeRoot: "docs/knowledge" as const, ...sourceConfig[entry.domain],
})) satisfies readonly OperatorSkillManifest[]);

export function validateOperatorSkillManifests(manifests: readonly OperatorSkillManifest[] = operatorSkillManifests): void {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (ids.has(manifest.skillId)) throw new Error(`Duplicate operator skill ID: ${manifest.skillId}`);
    ids.add(manifest.skillId);
    if (!operatorDomainValues.includes(manifest.domain)) throw new Error(`Unknown skill domain: ${manifest.domain}`);
    if (!manifest.skillId || !manifest.version || !["complete", "partial", "minimal"].includes(manifest.knowledgeCompleteness)) throw new Error(`Malformed operator skill manifest: ${manifest.skillId}`);
    for (const domain of manifest.relatedDomains) if (!operatorDomainValues.includes(domain)) throw new Error(`Unknown related skill domain: ${domain}`);
    for (const category of manifest.capabilityCategories) if (!operatorCapabilityCategoryValues.includes(category)) throw new Error(`Unknown skill capability category: ${category}`);
    const sourceSlugs = new Set<string>();
    for (const source of manifest.approvedSources) {
      if (sourceSlugs.has(source.slug)) throw new Error(`Duplicate approved skill source: ${manifest.skillId}/${source.slug}`);
      sourceSlugs.add(source.slug);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.slug) || source.sourcePath !== `docs/knowledge/${source.slug}.md`) throw new Error(`Malformed approved skill source: ${manifest.skillId}/${source.slug}`);
    }
    if (!manifest.approvedSources.length && !manifest.minimalGuidance) throw new Error(`Skill without approved knowledge or minimal fallback: ${manifest.skillId}`);
  }
}
