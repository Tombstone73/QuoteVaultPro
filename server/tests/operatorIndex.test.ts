import { readFile } from "node:fs/promises";
import path from "node:path";
import { operatorIndex, renderOperatorIndexMarkdown, selectOperatorDomains } from "../services/assistant/operatorIndex";
import { operatorSkillManifests, validateOperatorSkillManifests } from "../services/assistant/operatorSkillManifests";

describe("Operator Index and skill manifests", () => {
  it("covers the permanent small domain index and valid skill references", () => {
    expect(operatorIndex).toHaveLength(14);
    expect(operatorSkillManifests).toHaveLength(operatorIndex.length);
    expect(() => validateOperatorSkillManifests()).not.toThrow();
  });

  it("selects multiple relevant domains deterministically without loading skill content", () => {
    expect(selectOperatorDomains("Create a Product with a proof requirement and flatbed production routing").map((entry) => entry.domain)).toEqual(expect.arrayContaining(["products", "proofing", "production"]));
    expect(selectOperatorDomains("Why can't this order ship?").map((entry) => entry.domain)).toEqual(expect.arrayContaining(["orders", "fulfillment"]));
  });

  it("keeps the checked-in Operator Index report generated", async () => {
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/ai-operator-index.md"), "utf8")).resolves.toBe(renderOperatorIndexMarkdown());
  });
});
