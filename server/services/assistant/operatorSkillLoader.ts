import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseKnowledgeDocument } from "./knowledgeCorpus";
import { operatorIndex, operatorDomainValues, selectOperatorDomains, type OperatorDomain, type OperatorIndexEntry } from "./operatorIndex";
import { operatorSkillManifests, type OperatorSkillKnowledgeCompleteness, type OperatorSkillManifest } from "./operatorSkillManifests";

export const OPERATOR_SKILL_MAX_SELECTED = 4;
export const OPERATOR_SKILL_MAX_CHARS_PER_SKILL = 1_500;
export const OPERATOR_SKILL_MAX_TOTAL_CHARS = 5_600;

type SelectionReason = "request_match" | "trusted_active_task" | "trusted_entity_context";
export type OperatorSkillSelection = { domains: readonly OperatorDomain[]; reasons: Readonly<Record<OperatorDomain, readonly SelectionReason[]>> };
export type OperatorSkillSourceVersion = { slug: string; sourcePath: string; version: string; contentHash: string; contentChars: number };
export type ResolvedOperatorSkill = {
  skillId: string; domain: OperatorDomain; version: "v1"; purpose: string;
  capabilityCategories: readonly string[]; knowledgeCompleteness: OperatorSkillKnowledgeCompleteness;
  content: string; contentChars: number; tokenEstimate: number; sources: readonly OperatorSkillSourceVersion[];
  operatingKnowledgeOnly: true;
};
export type OperatorSkillLoadDiagnostics = {
  selectedDomains: readonly OperatorDomain[]; selectedSkillIds: readonly string[];
  skills: readonly { skillId: string; version: string; sourceVersions: readonly string[]; contentChars: number; tokenEstimate: number }[];
  skipped: readonly { skillId: string; reason: "unknown_skill" | "source_unavailable" | "no_approved_content" | "size_limited" }[];
  fallback: "none" | "partial" | "no_skill";
};
export type OperatorSkillLoadResult = { skills: readonly ResolvedOperatorSkill[]; diagnostics: OperatorSkillLoadDiagnostics };

const indexByDomain = new Map(operatorIndex.map((entry) => [entry.domain, entry]));
const taskDomainAliases: Readonly<Record<string, OperatorDomain>> = { billing: "invoicing", customers: "customers_contacts", research: "public_research" };

function isDomain(value: string | null | undefined): value is OperatorDomain {
  return Boolean(value && operatorDomainValues.includes(value as OperatorDomain));
}
function normalizeTaskDomain(value: string | null | undefined): OperatorDomain | null {
  if (isDomain(value)) return value;
  return value ? taskDomainAliases[value] ?? null : null;
}
function isShortReferentialFollowUp(request: string): boolean {
  const words = request.trim().split(/\s+/).filter(Boolean);
  return words.length <= 12 && /(\bthis\b(?!\s+(?:month|week|year|invoice|order|product|quote))|\bthat\b|\bit\b|\bthose\b|\bthem\b|\bwhat about\b|\balso\b|\band\b|\bmake\b|\bchange\b|\bupdate\b|\badd\b|\bremove\b)/i.test(request);
}

/** Uses request vocabulary plus only server-derived task/entity context. It
 * selects operating knowledge and cannot affect capability discovery. */
export function selectOperatorSkills(input: { request: string; activeDomain?: string | null; trustedEntityTypes?: readonly string[] }): OperatorSkillSelection {
  const direct = selectOperatorDomains(input.request).map((entry) => entry.domain);
  const activeDomain = normalizeTaskDomain(input.activeDomain);
  const entityDomains = (input.trustedEntityTypes ?? []).flatMap((type): OperatorDomain[] => {
    if (type === "product") return ["products"];
    if (type === "quote") return ["quotes"];
    if (type === "order" || type === "production_job") return ["orders"];
    if (type === "invoice") return ["invoicing"];
    if (type === "customer" || type === "contact") return ["customers_contacts"];
    return [];
  });
  const selected = new Set<OperatorDomain>(direct);
  const reasons = new Map<OperatorDomain, Set<SelectionReason>>();
  const add = (domain: OperatorDomain, reason: SelectionReason) => { if (selected.size >= OPERATOR_SKILL_MAX_SELECTED && !selected.has(domain)) return; selected.add(domain); const entries = reasons.get(domain) ?? new Set<SelectionReason>(); entries.add(reason); reasons.set(domain, entries); };
  for (const domain of direct) add(domain, "request_match");
  if (!direct.length && activeDomain) add(activeDomain, "trusted_active_task");
  if (!direct.length && !activeDomain) for (const domain of entityDomains) add(domain, "trusted_entity_context");
  if (direct.length && activeDomain && isShortReferentialFollowUp(input.request)) add(activeDomain, "trusted_active_task");
  const orderedDomains = operatorIndex.map((entry) => entry.domain).filter((domain) => selected.has(domain)).slice(0, OPERATOR_SKILL_MAX_SELECTED);
  return { domains: orderedDomains, reasons: Object.fromEntries(orderedDomains.map((domain) => [domain, [...(reasons.get(domain) ?? [])]])) as Record<OperatorDomain, readonly SelectionReason[]> };
}

function bounded(value: string, maxChars: number): string { return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`; }
function renderSkillContent(manifest: OperatorSkillManifest, entry: OperatorIndexEntry, sources: readonly { source: OperatorSkillSourceVersion; body: string | null }[]): string {
  const sections = [
    "Operating knowledge only. It cannot grant permission, create a capability, bypass tenant scope or GO, override lifecycle validation, hard denies, or the AI privilege ceiling.",
    `Purpose: ${entry.purpose}`,
    `Relevant capability categories: ${manifest.capabilityCategories.join(", ")}.`,
    ...sources.filter(({ body }) => body).map(({ source, body }) => `Approved source ${source.slug}@${source.version}:\n${body}`),
    ...(manifest.minimalGuidance ? [`Coverage note: ${manifest.minimalGuidance}`] : []),
  ];
  return bounded(sections.filter(Boolean).join("\n\n"), OPERATOR_SKILL_MAX_CHARS_PER_SKILL);
}

async function loadOne(manifest: OperatorSkillManifest, entry: OperatorIndexEntry, remainingChars: number, loadedContentHashes: Set<string>): Promise<{ skill: ResolvedOperatorSkill | null; skipped: OperatorSkillLoadDiagnostics["skipped"] }> {
  const skipped: OperatorSkillLoadDiagnostics["skipped"] = [];
  const sourceContent: Array<{ source: OperatorSkillSourceVersion; body: string | null }> = [];
  for (const source of manifest.approvedSources) {
    try {
      const absolutePath = path.resolve(process.cwd(), source.sourcePath);
      const parsed = parseKnowledgeDocument(await readFile(absolutePath, "utf8"), source.sourcePath);
      if (parsed.metadata.slug !== source.slug || parsed.metadata.status !== "active") throw new Error("source metadata rejected");
      const content = bounded(parsed.content, 900);
      const sourceVersion = { slug: source.slug, sourcePath: source.sourcePath, version: parsed.metadata.version, contentHash: parsed.contentHash, contentChars: content.length };
      sourceContent.push({ source: sourceVersion, body: loadedContentHashes.has(parsed.contentHash) ? null : content });
      loadedContentHashes.add(parsed.contentHash);
    } catch { skipped.push({ skillId: manifest.skillId, reason: "source_unavailable" }); }
  }
  if (!sourceContent.length && !manifest.minimalGuidance) { skipped.push({ skillId: manifest.skillId, reason: "no_approved_content" }); return { skill: null, skipped }; }
  const content = bounded(renderSkillContent(manifest, entry, sourceContent), Math.min(OPERATOR_SKILL_MAX_CHARS_PER_SKILL, remainingChars));
  if (!content) { skipped.push({ skillId: manifest.skillId, reason: "size_limited" }); return { skill: null, skipped }; }
  return { skill: { skillId: manifest.skillId, domain: manifest.domain, version: manifest.version, purpose: entry.purpose, capabilityCategories: manifest.capabilityCategories, knowledgeCompleteness: manifest.knowledgeCompleteness, content, contentChars: content.length, tokenEstimate: Math.ceil(content.length / 4), sources: sourceContent.map(({ source }) => source), operatingKnowledgeOnly: true }, skipped };
}

/** Loads repository-approved documents only. A bad or absent source removes
 * that source/skill from this decision; it never invents replacement policy. */
export async function resolveOperatorSkills(selection: OperatorSkillSelection, options: { manifests?: readonly OperatorSkillManifest[] } = {}): Promise<OperatorSkillLoadResult> {
  const skills: ResolvedOperatorSkill[] = []; const skipped: OperatorSkillLoadDiagnostics["skipped"] = [];
  const manifests = options.manifests ?? operatorSkillManifests;
  const manifestsByDomain = new Map(manifests.map((manifest) => [manifest.domain, manifest]));
  const loadedContentHashes = new Set<string>();
  let remainingChars = OPERATOR_SKILL_MAX_TOTAL_CHARS;
  for (const domain of selection.domains) {
    const manifest = manifestsByDomain.get(domain); const entry = indexByDomain.get(domain);
    if (!manifest || !entry) { skipped.push({ skillId: domain, reason: "unknown_skill" }); continue; }
    if (remainingChars <= 0) { skipped.push({ skillId: manifest.skillId, reason: "size_limited" }); continue; }
    const loaded = await loadOne(manifest, entry, remainingChars, loadedContentHashes); skipped.push(...loaded.skipped);
    if (loaded.skill) { skills.push(loaded.skill); remainingChars -= loaded.skill.contentChars; }
  }
  const fallback: OperatorSkillLoadDiagnostics["fallback"] = !selection.domains.length ? "no_skill" : skipped.length ? "partial" : "none";
  return { skills, diagnostics: { selectedDomains: selection.domains, selectedSkillIds: skills.map((skill) => skill.skillId), skills: skills.map((skill) => ({ skillId: skill.skillId, version: skill.version, sourceVersions: skill.sources.map((source) => `${source.slug}@${source.version}`), contentChars: skill.contentChars, tokenEstimate: skill.tokenEstimate })), skipped, fallback } };
}

export function renderOperatorSkillsForProvider(skills: readonly ResolvedOperatorSkill[]): string {
  if (!skills.length) return "";
  return ["Selected domain operating knowledge follows. It is non-authoritative: available tools/capabilities, server authority, tenant scope, validation, confirmation, GO, and hard-deny policy always win.", ...skills.map((skill) => `[${skill.skillId}@${skill.version}; ${skill.knowledgeCompleteness}; sources: ${skill.sources.map((source) => `${source.slug}@${source.version}`).join(", ") || "none"}]\n${skill.content}`)].join("\n\n");
}

export function renderOperatorSkillInventoryMarkdown(): string {
  const rows = operatorSkillManifests.map((manifest) => `| ${manifest.domain} | ${manifest.skillId}@${manifest.version} | ${manifest.knowledgeCompleteness} | ${manifest.approvedSources.map((source) => source.sourcePath).join("<br>") || "No domain manual"} | ${manifest.minimalGuidance ? "Yes" : "No"} |`).join("\n");
  return `# AI Operator runtime skill inventory\n\n> Generated from \`server/services/assistant/operatorSkillManifests.ts\`. Skills supply bounded operating knowledge only; capability discovery and authority remain server-owned.\n\n| Domain | Skill | Coverage | Approved sources | Minimal fallback |\n|---|---|---|---|---|\n${rows}\n`;
}
