export type ProductPlanningDependencyLookup = (workItemId: string) => Promise<string[]>;

export async function wouldCreateProductPlanningDependencyCycle(args: {
  workItemId: string;
  dependsOnWorkItemId: string;
  lookupDependsOnIds: ProductPlanningDependencyLookup;
}): Promise<boolean> {
  if (args.workItemId === args.dependsOnWorkItemId) return true;

  const visited = new Set<string>();
  const stack = [args.dependsOnWorkItemId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current === args.workItemId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    if (visited.size > 250) return true;
    const next = await args.lookupDependsOnIds(current);
    stack.push(...next);
  }

  return false;
}
