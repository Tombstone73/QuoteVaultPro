type PlanningOrderable = {
  id: string;
  createdAt: string | Date;
  sortOrder?: number | null;
  roadmapOrder?: number | null;
};

export function sortPlanningItems<T extends PlanningOrderable>(items: T[], orderKey: "sortOrder" | "roadmapOrder"): T[] {
  return [...items].sort((a, b) => {
    const left = a[orderKey] ?? Number.MAX_SAFE_INTEGER;
    const right = b[orderKey] ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function movePlanningItem<T extends { id: string }>(items: T[], itemId: string, direction: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === itemId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;

  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function toSequentialPlanningOrder<T extends { id: string }, K extends "sortOrder" | "roadmapOrder">(
  items: T[],
  orderKey: K,
): Array<{ id: string } & Record<K, number>> {
  return items.map((item, index) => ({
    id: item.id,
    [orderKey]: (index + 1) * 10,
  } as { id: string } & Record<K, number>));
}
