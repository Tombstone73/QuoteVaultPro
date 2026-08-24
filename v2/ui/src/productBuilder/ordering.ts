/**
 * Moves one existing member of a persisted authoring collection without
 * changing the member itself.  Product Builder uses array order as the
 * canonical persisted order for options, rules, recipe lines, production
 * units, and matrix dimensions; stable IDs and reference keys stay intact.
 */
export const moveProductBuilderItem = <Value>(
  values: readonly Value[],
  from: number,
  to: number,
): readonly Value[] => {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= values.length ||
    to >= values.length ||
    from === to
  ) return values;
  const next = [...values];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
};

export const canMoveProductBuilderItem = (
  values: readonly unknown[],
  index: number,
  direction: -1 | 1,
): boolean => index + direction >= 0 && index + direction < values.length;
