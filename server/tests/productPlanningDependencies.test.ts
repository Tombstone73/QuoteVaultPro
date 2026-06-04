import { describe, expect, it } from "@jest/globals";

import { wouldCreateProductPlanningDependencyCycle } from "../services/productPlanningDependencies";

describe("wouldCreateProductPlanningDependencyCycle", () => {
  it("rejects self-dependencies", async () => {
    await expect(wouldCreateProductPlanningDependencyCycle({
      workItemId: "a",
      dependsOnWorkItemId: "a",
      lookupDependsOnIds: async () => [],
    })).resolves.toBe(true);
  });

  it("detects an indirect circular dependency", async () => {
    const graph = new Map<string, string[]>([
      ["b", ["c"]],
      ["c", ["a"]],
    ]);

    await expect(wouldCreateProductPlanningDependencyCycle({
      workItemId: "a",
      dependsOnWorkItemId: "b",
      lookupDependsOnIds: async (id) => graph.get(id) ?? [],
    })).resolves.toBe(true);
  });

  it("allows unrelated dependencies", async () => {
    const graph = new Map<string, string[]>([
      ["b", ["c"]],
    ]);

    await expect(wouldCreateProductPlanningDependencyCycle({
      workItemId: "a",
      dependsOnWorkItemId: "b",
      lookupDependsOnIds: async (id) => graph.get(id) ?? [],
    })).resolves.toBe(false);
  });
});
