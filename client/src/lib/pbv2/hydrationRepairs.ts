/** Changes made by compatibility normalization, before any user edit. */
export type HydrationRepair = { path: string; before: unknown; after: unknown };

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]));
}

export function describeHydrationRepairs(before: unknown, after: unknown): HydrationRepair[] {
  const repairs: HydrationRepair[] = [];
  const visit = (left: unknown, right: unknown, path: string) => {
    if (sameValue(left, right)) return;
    // The evaluator uses "base" when an addPercent impact has no basis.
    // Writing that default explicitly is formatting, not a pricing repair.
    if (path.includes("pricingImpact[") && path.endsWith(".basis") &&
        (left === undefined || left === null || left === "") && right === "base") return;
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        visit(left[index], right[index], `${path}[${index}]`);
      }
      return;
    }
    if (left && right && typeof left === "object" && typeof right === "object" &&
        !Array.isArray(left) && !Array.isArray(right)) {
      const leftRecord = left as Record<string, unknown>;
      const rightRecord = right as Record<string, unknown>;
      for (const key of Array.from(new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]))) {
        visit(leftRecord[key], rightRecord[key], `${path}.${key}`);
      }
      return;
    }
    repairs.push({ path, before: left, after: right });
  };
  visit(before, after, "tree");
  return repairs;
}

/** Hydration is never a manual edit. Leave proposed changes out of the live tree. */
export function planPbv2Hydration(
  persistedTree: unknown,
  normalizedTree: unknown,
  repairedFromActive = false,
): { tree: unknown; repairs: HydrationRepair[]; hasUserChanges: false } {
  const repairs = describeHydrationRepairs(persistedTree, normalizedTree);
  if (repairedFromActive) {
    repairs.unshift({ path: "draft.treeJson", before: "Unusable DRAFT tree", after: "ACTIVE tree fallback" });
  }
  return { tree: repairs.length ? persistedTree : normalizedTree, repairs, hasUserChanges: false };
}
