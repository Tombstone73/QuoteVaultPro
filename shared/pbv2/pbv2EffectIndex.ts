import type { ChildItemProposal } from "@shared/pbv2/pricingAdapter";

export function assignEffectIndexFallback(
  childItems: ChildItemProposal[],
): (ChildItemProposal & { effectIndex: number })[] {
  const items = childItems.map((ci, originalIndex) => ({ ci, originalIndex }));

  // Determine which sourceNodeId groups need fallback.
  const needsFallbackBySourceNodeId: Record<string, boolean> = {};
  for (const { ci } of items) {
    const key = String((ci as any).sourceNodeId || "");
    if (!key) continue;
    const hasIndex = typeof (ci as any).effectIndex === "number" && Number.isFinite((ci as any).effectIndex);
    if (!hasIndex) needsFallbackBySourceNodeId[key] = true;
  }

  // Stable ordering independent of object/map iteration order.
  const sorted = [...items].sort((a, b) => {
    const aKey = String((a.ci as any).sourceNodeId || "");
    const bKey = String((b.ci as any).sourceNodeId || "");
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return a.originalIndex - b.originalIndex;
  });

  const nextIndexBySourceNodeId: Record<string, number> = {};
  const assignedByOriginalIndex = new Map<number, number>();

  for (const { ci, originalIndex } of sorted) {
    const key = String((ci as any).sourceNodeId || "");
    if (!key) continue;

    if (!needsFallbackBySourceNodeId[key]) {
      const existing =
        typeof (ci as any).effectIndex === "number" && Number.isFinite((ci as any).effectIndex)
          ? Math.trunc((ci as any).effectIndex)
          : 0;
      assignedByOriginalIndex.set(originalIndex, existing);
      continue;
    }

    const next = nextIndexBySourceNodeId[key] ?? 0;
    assignedByOriginalIndex.set(originalIndex, next);
    nextIndexBySourceNodeId[key] = next + 1;
  }

  return items.map(({ ci, originalIndex }) => ({
    ...(ci as any),
    effectIndex: assignedByOriginalIndex.get(originalIndex) ?? 0,
  }));
}
