import { operatorCapabilityCategoryValues, operatorIndex, operatorDomainValues, type OperatorCapabilityCategory, type OperatorDomain } from "./operatorIndex";

/** Versioned manifests establish index integrity only. Skill content remains in
 * the approved knowledge corpus and is not injected into normal decisions in
 * Phase 3. */
export type OperatorSkillManifest = {
  skillId: string;
  domain: OperatorDomain;
  version: "v1";
  relatedDomains: readonly OperatorDomain[];
  capabilityCategories: readonly OperatorCapabilityCategory[];
  knowledgeRoot: "docs/knowledge";
};

export const operatorSkillManifests = Object.freeze(operatorIndex.map((entry) => ({
  skillId: entry.skillId, domain: entry.domain, version: entry.skillVersion,
  relatedDomains: entry.relatedDomains, capabilityCategories: entry.capabilityCategories,
  knowledgeRoot: "docs/knowledge" as const,
})) satisfies readonly OperatorSkillManifest[]);

export function validateOperatorSkillManifests(): void {
  const ids = new Set<string>();
  for (const manifest of operatorSkillManifests) {
    if (ids.has(manifest.skillId)) throw new Error(`Duplicate operator skill ID: ${manifest.skillId}`);
    ids.add(manifest.skillId);
    if (!operatorDomainValues.includes(manifest.domain)) throw new Error(`Unknown skill domain: ${manifest.domain}`);
    for (const domain of manifest.relatedDomains) if (!operatorDomainValues.includes(domain)) throw new Error(`Unknown related skill domain: ${domain}`);
    for (const category of manifest.capabilityCategories) if (!operatorCapabilityCategoryValues.includes(category)) throw new Error(`Unknown skill capability category: ${category}`);
  }
}
