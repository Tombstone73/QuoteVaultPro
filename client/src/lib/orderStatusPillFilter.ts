export type OrderStatusPillFilterOption = {
  id: string;
  name: string;
  key?: string | null;
  color?: string;
  isActive?: boolean;
};

export function activeOrderStatusPills(pills: readonly OrderStatusPillFilterOption[] | undefined): OrderStatusPillFilterOption[] {
  return (pills ?? []).filter((pill) => pill.isActive !== false);
}

export function selectedOrderStatusPillIds(
  selection: readonly string[] | null,
  pills: readonly OrderStatusPillFilterOption[] | undefined,
): string[] {
  return selection === null ? activeOrderStatusPills(pills).map((pill) => pill.id) : [...selection];
}

export function orderStatusPillIdsForQuery(
  selection: readonly string[] | null,
  pills: readonly OrderStatusPillFilterOption[] | undefined,
): string[] | undefined {
  if (selection === null) return undefined;

  const activeIds = activeOrderStatusPills(pills).map((pill) => pill.id);
  const selected = Array.from(new Set(selection));
  const activeIdSet = new Set(activeIds);
  const selectsEveryActivePill = activeIds.length > 0
    && selected.length === activeIds.length
    && selected.every((id) => activeIdSet.has(id));

  return selectsEveryActivePill ? undefined : selected;
}

export function toggleOrderStatusPillId(
  selection: readonly string[] | null,
  pillId: string,
  pills: readonly OrderStatusPillFilterOption[] | undefined,
): string[] {
  const selected = selectedOrderStatusPillIds(selection, pills);
  return selected.includes(pillId)
    ? selected.filter((id) => id !== pillId)
    : [...selected, pillId];
}

export function hideCompleteOrderStatusPill(
  selection: readonly string[] | null,
  pills: readonly OrderStatusPillFilterOption[] | undefined,
): string[] {
  const completePill = activeOrderStatusPills(pills).find((pill) =>
    pill.name.trim().toLowerCase() === "complete" || pill.key === "complete",
  );
  if (!completePill) return selectedOrderStatusPillIds(selection, pills);
  return selectedOrderStatusPillIds(selection, pills).filter((id) => id !== completePill.id);
}

export function orderStatusPillFilterLabel(
  selection: readonly string[] | null,
  pills: readonly OrderStatusPillFilterOption[] | undefined,
): string {
  const active = activeOrderStatusPills(pills);
  if (active.length === 0) return "No status pills configured";

  const selected = selectedOrderStatusPillIds(selection, active);
  if (selection === null || selected.length === active.length) return "All Status Pills";
  if (selected.length === 0) return "No Status Pills";

  const completePill = active.find((pill) => pill.name.trim().toLowerCase() === "complete" || pill.key === "complete");
  if (completePill && !selected.includes(completePill.id) && selected.length === active.length - 1) {
    return "All except Complete";
  }
  if (selected.length === 1) return active.find((pill) => pill.id === selected[0])?.name ?? "1 status";
  return `${selected.length} statuses`;
}
