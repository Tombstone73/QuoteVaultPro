import { describe, expect, it } from "@jest/globals";

import { validateProductPlanningParent } from "../services/productPlanningHierarchy";

describe("validateProductPlanningParent", () => {
  it("allows an empty parent", async () => {
    await expect(validateProductPlanningParent({
      workItemId: "child",
      parentId: null,
      lookup: async () => null,
    })).resolves.toEqual({ valid: true });
  });

  it("rejects self-parenting", async () => {
    await expect(validateProductPlanningParent({
      workItemId: "item",
      parentId: "item",
      lookup: async () => null,
    })).resolves.toEqual({
      valid: false,
      message: "A work item cannot be its own parent.",
    });
  });

  it("rejects circular ancestry", async () => {
    const parents = new Map<string, string | null>([
      ["epic", "root"],
      ["root", "child"],
    ]);

    await expect(validateProductPlanningParent({
      workItemId: "child",
      parentId: "epic",
      lookup: async (id) => parents.has(id) ? { id, parentId: parents.get(id) ?? null } : null,
    })).resolves.toEqual({
      valid: false,
      message: "Parent selection would create a circular epic hierarchy.",
    });
  });

  it("rejects missing parents", async () => {
    await expect(validateProductPlanningParent({
      workItemId: "child",
      parentId: "missing",
      lookup: async () => null,
    })).resolves.toEqual({
      valid: false,
      message: "Parent work item not found.",
    });
  });
});
