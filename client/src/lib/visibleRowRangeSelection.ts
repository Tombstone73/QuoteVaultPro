/**
 * Resolves a checkbox range against the rows currently rendered by a table.
 * It deliberately has no pagination or persistence knowledge: callers supply
 * only the visible page, so it cannot select hidden rows.
 */
export function getVisibleRowRangeIds<Row>(input: {
  rows: readonly Row[];
  getId: (row: Row) => string;
  anchorId: string | null;
  targetId: string;
  isSelectable?: (row: Row) => boolean;
}): string[] | null {
  if (!input.anchorId) return null;

  const anchorIndex = input.rows.findIndex((row) => input.getId(row) === input.anchorId);
  const targetIndex = input.rows.findIndex((row) => input.getId(row) === input.targetId);
  if (anchorIndex < 0 || targetIndex < 0) return null;

  const first = Math.min(anchorIndex, targetIndex);
  const last = Math.max(anchorIndex, targetIndex);
  return input.rows
    .slice(first, last + 1)
    .filter((row) => input.isSelectable?.(row) ?? true)
    .map((row) => input.getId(row));
}

/** Applies one normal or Shift checkbox interaction without disturbing IDs outside the visible range. */
export function applyVisibleRowSelection<Row>(input: {
  currentSelection: ReadonlySet<string>;
  rows: readonly Row[];
  getId: (row: Row) => string;
  anchorId: string | null;
  targetId: string;
  checked: boolean;
  shiftKey: boolean;
  isSelectable?: (row: Row) => boolean;
}): { selectedIds: Set<string>; nextAnchorId: string; usedRange: boolean } {
  const rangeIds = input.shiftKey
    ? getVisibleRowRangeIds(input)
    : null;
  const idsToChange = rangeIds ?? [input.targetId];
  const selectedIds = new Set(input.currentSelection);
  idsToChange.forEach((id) => {
    if (input.checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  return {
    selectedIds,
    nextAnchorId: input.targetId,
    usedRange: rangeIds !== null,
  };
}
