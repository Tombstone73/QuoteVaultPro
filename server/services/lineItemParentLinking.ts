export type ParentLinkLine = {
  id: string;
  parentLineItemId?: string | null;
  lineItemRole?: string | null;
};

/** Validate a proposed link using the complete set of lines in one document.
 * Routes must load these lines through their tenant-scoped quote/order first. */
export function assertValidParentLink(
  lines: ParentLinkLine[],
  childId: string,
  parentId: string | null,
): void {
  const byId = new Map(lines.map((line) => [String(line.id), line]));
  if (!byId.has(childId)) throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  if (parentId === null) return;
  if (parentId === childId) throw Object.assign(new Error("A line item cannot be its own parent."), { statusCode: 400 });
  const parent = byId.get(parentId);
  if (!parent) throw Object.assign(new Error("Parent line item must belong to the same quote or order."), { statusCode: 400 });

  // Walk the proposed parent's ancestry. This prevents both direct and deeper cycles.
  const visited = new Set<string>();
  let cursor: ParentLinkLine | undefined = parent;
  while (cursor) {
    const cursorId = String(cursor.id);
    if (cursorId === childId) {
      throw Object.assign(new Error("A line item cannot be linked under one of its descendants."), { statusCode: 400 });
    }
    if (visited.has(cursorId)) {
      throw Object.assign(new Error("The existing line item hierarchy is invalid."), { statusCode: 400 });
    }
    visited.add(cursorId);
    cursor = cursor.parentLineItemId ? byId.get(String(cursor.parentLineItemId)) : undefined;
  }
}
