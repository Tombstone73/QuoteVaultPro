import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderOperatorSkillInventoryMarkdown, resolveOperatorSkills, selectOperatorSkills, OPERATOR_SKILL_MAX_CHARS_PER_SKILL, OPERATOR_SKILL_MAX_TOTAL_CHARS } from "../services/assistant/operatorSkillLoader";
import { operatorSkillManifests, validateOperatorSkillManifests } from "../services/assistant/operatorSkillManifests";

const selected = (domains: string[]) => ({ domains: domains as any, reasons: {} as any });

describe("Operator runtime skills", () => {
  it("selects deterministic single, cross-domain, and public research skills", () => {
    expect(selectOperatorSkills({ request: "Change the pricing on this banner Product" }).domains).toEqual(["products", "pricing"]);
    expect(selectOperatorSkills({ request: "Create a Product that requires proof approval and routes to flatbed production" }).domains).toEqual(["products", "proofing", "production"]);
    expect(selectOperatorSkills({ request: "Why can't this order ship?" }).domains).toEqual(["orders", "fulfillment"]);
    expect(selectOperatorSkills({ request: "Which invoices are unpaid and record this check" }).domains).toEqual(["invoicing", "payments"]);
    expect(selectOperatorSkills({ request: "Research this material online and help me create a Product from it" }).domains).toEqual(expect.arrayContaining(["products", "materials", "public_research"]));
  });

  it("preserves a trusted active domain only for a short follow-up and does not default general requests to every skill", () => {
    expect(selectOperatorSkills({ request: "Make grommets optional.", activeDomain: "products" }).domains).toEqual(["products"]);
    expect(selectOperatorSkills({ request: "What about the proof?", activeDomain: "orders" }).domains).toEqual(["orders", "proofing"]);
    expect(selectOperatorSkills({ request: "Show unpaid invoices for this month", activeDomain: "products" }).domains).toEqual(["invoicing", "payments"]);
    expect(selectOperatorSkills({ request: "Hello there" }).domains).toEqual([]);
  });

  it("loads only approved, bounded knowledge and removes shared source text across domains", async () => {
    const result = await resolveOperatorSkills(selected(["products", "pricing", "proofing", "production"]));
    expect(result.skills.map((skill) => skill.skillId)).toEqual(["products.pbv2", "pricing.pbv2", "proofing.operations", "production.operations"]);
    expect(result.skills.every((skill) => skill.operatingKnowledgeOnly && skill.contentChars <= OPERATOR_SKILL_MAX_CHARS_PER_SKILL)).toBe(true);
    expect(result.skills.reduce((total, skill) => total + skill.contentChars, 0)).toBeLessThanOrEqual(OPERATOR_SKILL_MAX_TOTAL_CHARS);
    const joined = result.skills.map((skill) => skill.content).join("\n");
    expect(joined.match(/PBV2 is PrintersHero's versioned product-option and pricing configuration/g)).toHaveLength(1);
    expect(joined).not.toContain("database_url");
  });

  it("keeps the partial Product skill grounded in the migrated shared-operation knowledge", async () => {
    const result = await resolveOperatorSkills(selected(["products"]));
    expect(result.skills[0]).toMatchObject({ skillId: "products.pbv2", knowledgeCompleteness: "partial" });
    expect(result.skills[0]?.content).toContain("shared canonical PBV2 DRAFT operation");
    expect(result.skills[0]?.content).toContain("Shared option configuration");
    expect(result.skills[0]?.content).toContain("visibility rules");
    expect(result.skills[0]?.contentChars).toBeLessThanOrEqual(OPERATOR_SKILL_MAX_CHARS_PER_SKILL);
  });

  it("uses a minimal declared fallback and soft-fails a missing approved source", async () => {
    const research = await resolveOperatorSkills(selected(["public_research"]));
    expect(research.skills[0]).toMatchObject({ skillId: "research.public", knowledgeCompleteness: "minimal", sources: [] });
    const broken = operatorSkillManifests.map((manifest) => manifest.domain === "products" ? { ...manifest, approvedSources: [{ slug: "not-real", sourcePath: "docs/knowledge/not-real.md" as const }] } : manifest);
    const result = await resolveOperatorSkills(selected(["products"]), { manifests: broken });
    expect(result.skills).toEqual([]);
    expect(result.diagnostics.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ skillId: "products.pbv2", reason: "source_unavailable" }), expect.objectContaining({ skillId: "products.pbv2", reason: "no_approved_content" })]));
  });

  it("rejects malformed manifests and keeps the generated runtime inventory checked in", async () => {
    expect(() => validateOperatorSkillManifests([{ ...operatorSkillManifests[0], approvedSources: [{ slug: "bad path", sourcePath: "docs/knowledge/not-real.md" }] } as any])).toThrow("Malformed approved skill source");
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/ai-operator-runtime-skill-inventory.md"), "utf8")).resolves.toBe(renderOperatorSkillInventoryMarkdown());
  });
});
