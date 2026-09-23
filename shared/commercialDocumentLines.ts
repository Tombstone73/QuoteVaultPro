/** Read-only customer presentation. Never pass these totals back to accounting. */
export type CommercialLine = {
  id?: string | null;
  parentLineItemId?: string | null;
  orderLineItemId?: string | null;
  lineItemRole?: string | null;
  displayOrder?: number | null;
  sortOrder?: number | null;
};

export function projectCommercialDocumentLines<T extends CommercialLine>(
  lines: readonly T[],
  amountCents: (line: T) => number,
  options: { policy?: "collapsed" | "expanded"; identity?: "quote" | "invoice" } = {},
): Array<{ line: T; totalCents: number; memberCount: number }> {
  const ordered = lines.map((line, index) => ({ line, index })).sort((a, b) =>
    (a.line.displayOrder ?? a.line.sortOrder ?? a.index) - (b.line.displayOrder ?? b.line.sortOrder ?? b.index)
    || a.index - b.index,
  ).map(({ line }) => line);
  // Invoice parent snapshots reference orderLineItemId, not the generated invoice
  // row ID. Only explicit, unique identities can establish a relationship.
  const byId = new Map<string, T | null>();
  for (const line of ordered) {
    const key = options.identity === "invoice" ? line.orderLineItemId ?? line.id : line.id;
    if (key) byId.set(key, byId.has(key) ? null : line);
  }
  const parentOf = (line: T) => line.parentLineItemId ? byId.get(line.parentLineItemId) ?? undefined : undefined;
  const rootOf = (line: T): T => {
    const visited = new Set<T>();
    let cursor = line;
    while (parentOf(cursor)) {
      if (visited.has(cursor)) return line; // Corrupt historical hierarchy: do not guess.
      visited.add(cursor);
      cursor = parentOf(cursor)!;
    }
    return cursor;
  };
  const groups = new Map<T, { line: T; totalCents: number; memberCount: number }>();
  for (const line of ordered) {
    const root = rootOf(line);
    const visible = options.policy === "expanded" ? line : root;
    const group = groups.get(visible) ?? { line: visible, totalCents: 0, memberCount: 0 };
    // Dedicated synthetic bundle wrappers ALREADY contain their children's
    // commercial amount. Ordinary operational parents do not. Keep the same
    // billable contribution rule as getBillableBundleRoots, including overrides.
    const contribution = root === line || parentOf(line)?.lineItemRole !== "parent" ? amountCents(line) : 0;
    group.totalCents += contribution;
    group.memberCount += 1;
    groups.set(visible, group);
  }
  return ordered.filter((line) => groups.has(line)).map((line) => groups.get(line)!);
}
