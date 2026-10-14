import { describeHydrationRepairs, planPbv2Hydration } from "./hydrationRepairs";

test("opening an ACTIVE tree in the DRAFT editor is a lifecycle view, not a repair", () => {
  const active = { status: "ACTIVE", nodes: { root: { label: "Product" } } };
  const editable = { ...active, status: "DRAFT" };
  expect(describeHydrationRepairs(active, editable)).toEqual([]);
  expect(planPbv2Hydration(active, editable)).toEqual({ tree: editable, repairs: [], hasUserChanges: false });
});

test("meaningful tree changes still require explicit repair", () => {
  const active = { status: "ACTIVE", nodes: { root: { label: "Product" } } };
  const normalized = { status: "DRAFT", nodes: { root: { label: "Changed" } } };
  const plan = planPbv2Hydration(active, normalized);
  expect(plan.tree).toBe(active);
  expect(plan.repairs).toEqual([{ path: "tree.nodes.root.label", before: "Product", after: "Changed" }]);
});
