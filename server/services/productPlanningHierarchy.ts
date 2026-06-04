export type ProductPlanningParentLookup = (id: string) => Promise<{ id: string; parentId: string | null } | null>;

export async function validateProductPlanningParent(args: {
  workItemId: string;
  parentId: string | null | undefined;
  lookup: ProductPlanningParentLookup;
}): Promise<{ valid: true } | { valid: false; message: string }> {
  const parentId = args.parentId ?? null;
  if (!parentId) return { valid: true };

  if (parentId === args.workItemId) {
    return { valid: false, message: "A work item cannot be its own parent." };
  }

  const visited = new Set<string>();
  let cursor: string | null = parentId;

  while (cursor) {
    if (cursor === args.workItemId) {
      return { valid: false, message: "Parent selection would create a circular epic hierarchy." };
    }

    if (visited.has(cursor)) {
      return { valid: false, message: "Existing epic hierarchy already contains a cycle." };
    }
    visited.add(cursor);

    const row = await args.lookup(cursor);
    if (!row) {
      return { valid: false, message: "Parent work item not found." };
    }

    cursor = row.parentId;

    if (visited.size > 100) {
      return { valid: false, message: "Epic hierarchy is too deep." };
    }
  }

  return { valid: true };
}
