/** Presentation-only recovery for snapshots created before Order bundle links were copied.
 * A current, tenant-scoped Order link is usable only when both unique source IDs
 * occur in this Invoice. Explicit snapshot links always win. */
export function enrichInvoiceLineRelationships<T extends Record<string, any>>(
  snapshots: readonly T[],
  sourceLines: readonly { id: string; orderId?: string | null; parentLineItemId?: string | null; sortOrder?: number | null }[],
): T[] {
  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
  const counts = new Map<string, number>();
  for (const line of snapshots) {
    const id = String(line.orderLineItemId ?? "").trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const snapshotOrders = snapshots.map((line) => Number(line.sortOrder ?? 0));
  const lacksUsefulSnapshotOrder = snapshots.length > 1 && new Set(snapshotOrders).size === 1;
  const orderSources = snapshots.map((line) => {
    const id = String(line.orderLineItemId ?? "").trim();
    return counts.get(id) === 1 ? sourceById.get(id) : undefined;
  });
  const sourceOrderIds = new Set(orderSources.map((source) => source?.orderId));
  const sourceOrders = orderSources.map((source) => source?.sortOrder);
  const useSourceOrder = lacksUsefulSnapshotOrder && orderSources.every(Boolean)
    && sourceOrderIds.size === 1 && !sourceOrderIds.has(null) && !sourceOrderIds.has(undefined)
    && sourceOrders.every((order) => typeof order === "number")
    && new Set(sourceOrders).size === snapshots.length;
  return snapshots.map((line) => {
    const id = String(line.orderLineItemId ?? "").trim();
    const source = counts.get(id) === 1 ? sourceById.get(id) : undefined;
    const sourceParent = String(source?.parentLineItemId ?? "").trim();
    const parentSource = sourceById.get(sourceParent);
    const recoveredParent = !line.parentLineItemId && sourceParent && counts.get(sourceParent) === 1
      && parentSource && source?.orderId && source.orderId === parentSource.orderId
      ? sourceParent : null;
    const sourceOrder = source?.sortOrder;
    return {
      ...line,
      ...(recoveredParent ? { parentLineItemId: recoveredParent } : {}),
      ...(useSourceOrder && typeof sourceOrder === "number" ? { displayOrder: sourceOrder } : {}),
    };
  });
}
