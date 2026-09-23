export type OrderedQuoteLine = {
  id?: string | null;
  tempId?: string;
  parentLineItemId?: string | null;
  displayOrder?: number | null;
};
export const quoteLineKey = (line: OrderedQuoteLine) => line.tempId || line.id || "";

/** Canonical hierarchy, never adjacency. Also handles valid nested groups. */
export function groupQuoteLines<T extends OrderedQuoteLine>(lines: readonly T[]): T[] {
  const byId = new Map(lines.filter((line) => line.id).map((line) => [line.id!, line]));
  const children = new Map<T, T[]>();
  for (const line of lines) {
    const parent = line.parentLineItemId ? byId.get(line.parentLineItemId) : undefined;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), line]);
  }
  const result: T[] = [];
  const seen = new Set<T>();
  const visit = (line: T) => {
    if (seen.has(line)) return;
    seen.add(line);
    result.push(line);
    for (const child of children.get(line) ?? []) visit(child);
  };
  for (const line of lines) if (!line.parentLineItemId || !byId.has(line.parentLineItemId)) visit(line);
  for (const line of lines) visit(line); // Preserve malformed/orphan historical rows.
  return result;
}

export function moveQuoteLineGroup<T extends OrderedQuoteLine>(lines: readonly T[], activeKey: string, overKey: string): T[] {
  const grouped = groupQuoteLines(lines);
  const active = grouped.find((line) => quoteLineKey(line) === activeKey);
  let over = grouped.find((line) => quoteLineKey(line) === overKey);
  if (!active || !over || active === over) return grouped;
  const byId = new Map(grouped.filter((line) => line.id).map((line) => [line.id!, line]));
  const parent = (line: T) => line.parentLineItemId ? byId.get(line.parentLineItemId) : undefined;
  const seen = new Set<T>();
  // Dragging a parent onto a descendant of a peer means moving the whole group.
  while (over && parent(over) !== parent(active)) {
    if (seen.has(over)) return grouped;
    seen.add(over);
    over = parent(over);
  }
  if (!over || active === over) return grouped; // Never reparent a child.
  const siblings = grouped.filter((line) => parent(line) === parent(active));
  const from = siblings.indexOf(active), to = siblings.indexOf(over);
  siblings.splice(from, 1);
  siblings.splice(to, 0, active);
  let index = 0;
  return groupQuoteLines(grouped.map((line) => parent(line) === parent(active) ? siblings[index++] : line));
}

export function validateQuoteLineOrder(lines: readonly OrderedQuoteLine[], ids: readonly string[], expectedIds: readonly string[]): void {
  const currentIds = lines.map((line) => line.id);
  if (!ids.length || ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
    throw Object.assign(new Error("Provide every Quote line exactly once."), { statusCode: 400 });
  }
  if (JSON.stringify(currentIds) !== JSON.stringify(expectedIds)) {
    throw Object.assign(new Error("Quote line order changed. Refresh and try again."), { statusCode: 409 });
  }
  const ordered = ids.map((id) => lines.find((line) => line.id === id)!);
  if (JSON.stringify(groupQuoteLines(ordered).map((line) => line.id)) !== JSON.stringify(ids)) {
    throw Object.assign(new Error("Move parent lines together with their children."), { statusCode: 400 });
  }
}
